#!/usr/bin/env node
'use strict';

/**
 * The logic behind scripts/activation/sidechain-demo-witness.sh (ADR-2103
 * interim receipt, amended 2026-10-02). Read-only: it fetches public files,
 * asks public relays, reads the local journal, and writes one JSON receipt.
 * It never signs, never broadcasts and never spends.
 *
 * Usage (normally through the .sh wrapper, which documents every flag):
 *   node sidechain-witness.cjs --chain sidestr:dreamlab --agent <hex> --agent <hex> \
 *     --payment <txid> [--funding <txid>]... [--close <txid>] [--hitch-session <id>] \
 *     [--session-urn <urn> | --harness <name>] [--mirror <url>] [--producer <url>] \
 *     [--relays a,b] [--nostr-capture FILE] [--events-dir DIR] [--public-only] \
 *     --replay-bin PATH --out FILE
 *
 * Kinds 23500 and 23600 sit in the NIP-01 ephemeral range (20000-29999):
 * relays forward them and do not store them, so a later relay query finds
 * nothing. The demo's own events therefore come from --nostr-capture, a JSONL
 * file of signed events recorded while the session ran (by the Hitch host or
 * a subscription). Every event, captured or queried, is held to its id and
 * signature here, and the receipt embeds the verified events whole, so anyone
 * can re-verify them without trusting this script.
 *
 * Exit 0: every required element is present and agrees. Exit 1: any required
 * element is missing or disagrees (the receipt is still written, verdict FAIL).
 * Exit 2: bad arguments.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');

/** The owner's reason, verbatim (owner decision 2026-10-02, SC5). */
const SC5_REASON = 'checkpoints off, cost; open';
const SC5_DECISION = 'owner decision 2026-10-02, SC5';
const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://nostr.oxtr.dev'];
const HEX64 = /^[0-9a-f]{64}$/;
const KIND = { tx: 23500, hitch: 23600, tip: 33333, chain: 3500 };

// ── arguments ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { agents: [], funding: [], relays: null, publicOnly: false, harness: 'sidestr-agent' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = () => {
      const x = argv[i + 1];
      if (x === undefined) throw new Error(`${k} needs a value`);
      i += 1;
      return x;
    };
    switch (k) {
      case '--chain': a.chain = v(); break;
      case '--agent': a.agents.push(v().toLowerCase()); break;
      case '--payment': a.payment = v().toLowerCase(); break;
      case '--funding': a.funding.push(v().toLowerCase()); break;
      case '--close': a.close = v().toLowerCase(); break;
      case '--hitch-session': a.hitchSession = v(); break;
      case '--session-urn': a.sessionUrn = v(); break;
      case '--harness': a.harness = v(); break;
      case '--mirror': a.mirror = v().replace(/\/+$/, ''); break;
      case '--producer': a.producer = v().replace(/\/+$/, ''); break;
      case '--relays': a.relays = v().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--events-dir': a.eventsDir = v(); break;
      case '--nostr-capture': a.capture = v(); break;
      case '--public-only': a.publicOnly = true; break;
      case '--replay-bin': a.replayBin = v(); break;
      case '--out': a.out = v(); break;
      case '--timeout-ms': a.timeoutMs = Number(v()); break;
      default: throw new Error(`unknown argument ${k}`);
    }
  }
  if (!a.chain) throw new Error('--chain is required (sidestr:<name> or the 64-hex chain event id)');
  if (a.agents.length !== 2 || !a.agents.every((p) => HEX64.test(p))) throw new Error('exactly two --agent x-only pubkeys (64 hex) are required');
  if (a.agents[0] === a.agents[1]) throw new Error('the two --agent keys must differ');
  for (const t of [a.payment, ...a.funding, a.close].filter((x) => x !== undefined)) {
    if (!HEX64.test(t)) throw new Error(`not a txid: ${t}`);
  }
  if (!a.payment) throw new Error('--payment <txid> is required');
  if (!a.replayBin) throw new Error('--replay-bin is required');
  if (!a.out) throw new Error('--out is required');
  a.relays = a.relays || DEFAULT_RELAYS;
  a.timeoutMs = a.timeoutMs || 8000;
  return a;
}

// ── journal (ADR-2071): started/completed pairs under one session URN ───────
/**
 * Pair exec.tool.called with exec.tool.completed under `sessionUrn`, as C2 of
 * scripts/activation/adr-2087-check.sh does: each called must have exactly one
 * completed whose causation names it, and each completed exactly one called.
 * @param {object[]} records  parsed events-log lines
 */
function pairJournal(records, sessionUrn) {
  const mine = records.filter((r) => r && r.payload && r.payload.session_urn === sessionUrn);
  const called = mine.filter((r) => r.kind === 'exec.tool.called');
  const done = mine.filter((r) => r.kind === 'exec.tool.completed');
  const pairs = [];
  const unpaired = [];
  for (const c of called) {
    const matches = done.filter((d) => d.payload.causation === c.payload.event_id);
    if (matches.length !== 1) {
      unpaired.push({ event: c.payload.event_id, tool: c.payload.payload && c.payload.payload.tool, completions: matches.length });
      continue;
    }
    const d = matches[0];
    pairs.push({
      tool: c.payload.payload && c.payload.payload.tool,
      called: { event: c.payload.event_id, ts: c.ts, hash: c.hash || null },
      completed: { event: d.payload.event_id, ts: d.ts, hash: d.hash || null, ok: d.payload.payload ? d.payload.payload.ok !== false : true },
    });
  }
  const orphans = done
    .filter((d) => called.filter((c) => c.payload.event_id === d.payload.causation).length !== 1)
    .map((d) => ({ event: d.payload.event_id, causation: d.payload.causation }));
  return { session_urn: sessionUrn, records: mine.length, pairs, unpaired, orphans };
}

function readJournal(eventsDir, sessionUrn) {
  let files = [];
  try {
    files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch (err) {
    return { error: `events directory unreadable: ${err.code || err.message}`, records: [] };
  }
  const records = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(eventsDir, f), 'utf8');
    if (!text.includes(sessionUrn)) continue;
    for (const line of text.split('\n')) {
      if (!line.includes(sessionUrn)) continue;
      try { records.push(JSON.parse(line)); } catch (_) { /* a torn line is not evidence */ }
    }
  }
  return { records, files: files.length };
}

function sessionUrnFor(harness, session) {
  // uris.js is the only minter (AGENTS.md); exec-record.js mints exactly this.
  const uris = require(path.join(REPO, 'management-api', 'lib', 'uris.js'));
  return uris.mint({ kind: 'meta', localId: `session-${harness}-${session}` });
}

// ── network ─────────────────────────────────────────────────────────────────
async function fetchWith(url, timeoutMs, as) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    if (as === 'buf') return { ok: true, value: Buffer.from(await res.arrayBuffer()) };
    return { ok: true, value: await res.json() };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : (err.cause && err.cause.code) || err.message };
  } finally {
    clearTimeout(t);
  }
}

function loadVerifier() {
  const candidates = [
    path.join(REPO, 'management-api', 'node_modules', 'nostr-tools'),
    'nostr-tools',
  ];
  for (const c of candidates) {
    try { return require(c).verifyEvent; } catch (_) { /* next */ }
  }
  throw new Error('nostr-tools is needed to verify event signatures (npm i nostr-tools, or run from an agentbox checkout with management-api/node_modules)');
}

/**
 * Ask every relay for `filters`, until EOSE or the timeout; return the union,
 * de-duplicated by id, keeping only events whose id and signature verify.
 */
async function queryRelays(relays, filters, timeoutMs, verify) {
  const byId = new Map();
  const report = [];
  let rejected = 0;
  await Promise.all(relays.map((url) => new Promise((resolve) => {
    let ws;
    let n = 0;
    const done = (status) => {
      clearTimeout(timer);
      report.push({ relay: url, status, events: n });
      try { ws.close(); } catch (_) { /* closed */ }
      resolve();
    };
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      report.push({ relay: url, status: `error: ${err.message}`, events: 0 });
      resolve();
      return;
    }
    const sub = `w${crypto.randomBytes(4).toString('hex')}`;
    ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, ...filters]));
    ws.onerror = () => done('error');
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString()); } catch (_) { return; }
      if (msg[0] === 'EVENT' && msg[1] === sub && msg[2]) {
        const ev = msg[2];
        if (!verify(ev)) { rejected += 1; return; }
        n += 1;
        if (!byId.has(ev.id)) byId.set(ev.id, ev);
      } else if (msg[0] === 'EOSE' && msg[1] === sub) {
        done('eose');
      } else if (msg[0] === 'CLOSED' && msg[1] === sub) {
        done(`closed: ${msg[2] || ''}`);
      }
    };
  })));
  return { events: [...byId.values()], relays: report, rejected };
}

const tagOf = (ev, name) => (ev.tags || []).filter((t) => t[0] === name).map((t) => t[1]);

// ── evaluation (pure) ───────────────────────────────────────────────────────
/**
 * Decide each required element from the gathered facts. Pure, so the
 * self-test can drive every branch without a network.
 * @returns {{checks: object[], verdict: string}}
 */
function evaluate(f) {
  const checks = [];
  const add = (id, required, ok, summary) => checks.push({ id, required, status: ok === null ? 'NOT-RUN' : ok ? 'PASS' : 'FAIL', summary });
  const r = f.replay || {};
  const txs = r.txs || {};

  add('R1', true, !!r.tip_hash, r.tip_hash
    ? `sidestr-core replayed the mirror's block file to height ${r.height}, tip ${r.tip_hash}`
    : `independent replay failed: ${f.replayError || 'no result'}`);
  add('R2', true, !!r.tip_hash && f.mirrorIndexHash === r.tip_hash,
    `mirror blocks.json names ${f.mirrorIndexHash || 'nothing'} at height ${r.height}; the replay reached ${r.tip_hash || 'nothing'}`);

  const pay = txs[f.payment];
  add('S1', true, !!(pay && pay.found), pay && pay.found
    ? `payment ${f.payment} at height ${pay.at.height}, block ${pay.at.hash}`
    : `payment ${f.payment} is not in the replayed chain`);

  const funding = f.funding || [];
  const fundingFound = funding.length > 0 && funding.every((t) => txs[t] && txs[t].found);
  add('S2', true, fundingFound, funding.length === 0
    ? 'no funding transaction: the payment spends nothing (a coinbase?) and no --funding was given'
    : fundingFound ? `funding ${funding.join(', ')} located` : `funding ${funding.filter((t) => !(txs[t] && txs[t].found)).join(', ')} not in the replayed chain`);

  if (f.closeRequired) {
    const close = f.close ? txs[f.close] : null;
    add('S3', true, !!(close && close.found), close && close.found
      ? `close ${f.close} at height ${close.at.height}, block ${close.at.hash}`
      : `a Hitch session needs its close: ${f.close ? `${f.close} is not in the replayed chain` : 'none given and no spender of the funding output was found'}`);
  } else {
    add('S3', false, null, 'no Hitch session named: there is no channel to close');
  }

  const a = f.anchoring || {};
  add('A1', true, a.anchored === true ? !!(a.checkpoint && a.checkpoint.parent_txid) : a.reason === SC5_REASON,
    a.anchored === true ? `anchored: parent checkpoint ${a.checkpoint.parent_txid} covers height ${a.checkpoint.covers_height}` : `not anchored, stated: "${a.reason}"`);

  const tip = f.tipEvent;
  const needHeight = f.highestHeight;
  add('N1', true, !!tip && Number(tip.tip) >= (needHeight || 0),
    tip ? `kind-33333 ${tip.id} by the chain signer announces tip ${tip.tip} (needs >= ${needHeight})` : 'no kind-33333 tip announcement by the chain signer found on the relays');

  for (const [i, pk] of f.agents.entries()) {
    const mine = (f.agentEvents && f.agentEvents[pk]) || {};
    const total = Object.values(mine).reduce((s, ids) => s + ids.length, 0);
    add(`N${2 + i}`, true, total > 0, total > 0
      ? `agent ${pk.slice(0, 12)}… signed ${Object.entries(mine).map(([k, ids]) => `${ids.length} kind-${k}`).join(', ')}`
      : `no kind-${KIND.tx}/${KIND.hitch} event signed by agent ${pk.slice(0, 12)}… found (both kinds are ephemeral: relays do not keep them, so pass --nostr-capture)`);
  }
  if (f.paymentEvent !== undefined) {
    add('N4', false, !!f.paymentEvent, f.paymentEvent
      ? `the payment travelled as kind-23500 ${f.paymentEvent}`
      : 'no kind-23500 event carries the payment (it may have been POSTed to the producer)');
  }

  const j = f.journal;
  if (!j || j.skipped) {
    add('J1', true, null, `journal not checked: ${j && j.skipped ? j.skipped : 'no session URN'}`);
  } else if (j.error) {
    add('J1', true, false, j.error);
  } else {
    const bad = j.unpaired.length + j.orphans.length;
    add('J1', true, j.pairs.length >= 1 && bad === 0,
      `${j.pairs.length} started/completed pair(s) under ${j.session_urn}; ${j.unpaired.length} unpaired, ${j.orphans.length} orphaned`);
  }

  const failed = checks.filter((c) => c.required && c.status !== 'PASS' && !(c.status === 'NOT-RUN' && f.publicOnly && c.id === 'J1'));
  return { checks, verdict: failed.length === 0 ? 'PASS' : 'FAIL' };
}

/** What a PASS receipt proves, and what it does not. */
function claims(f) {
  const proves = [
    'sidestr-core (crates.io, exact version in replay.engine) validated every block of the published mirror from the genesis to replay.tip_hash under the chain\'s consensus rules',
    'the payment (and funding, and close when present) are in that validated chain at the heights and block hashes given',
    'the mirror\'s own index agrees with the replayed tip hash',
    'the chain signer announced a tip at or above the highest height cited, in a kind-33333 event whose signature verifies',
    'each agent key signed at least one kind-23500/23600 event (from the relays or the capture file); every event is embedded in nostr.events and its id and signature verify',
  ];
  if (!f.publicOnly) proves.push('the agentbox execution journal holds a matched started/completed pair for every side effect recorded under the session URN, and no unpaired or orphaned record');
  if (f.anchoring && f.anchored) proves.push('a parent-chain checkpoint transaction commits to a sidechain tip at or above the highest height cited (verify its txid on a public parent explorer)');
  const doesNot = [
    'that the chain is final: a level-1 chain is one signer\'s word, and the signer could publish a conflicting history',
    'that the agent keys belong to any particular person or agent identity: no key binding is checked here',
    'that the sats have any value: this is a valueless research chain',
    'that the 23600 events listed belong to this session unless hitch_session_tagged says so; they are the keys\' channel messages in the window',
  ];
  if (!(f.anchoring && f.anchored)) doesNot.unshift(`any anchoring: the chain is NOT anchored to its parent (${SC5_REASON}; ${SC5_DECISION}); nothing ties these blocks to the parent's proof of work`);
  if (f.publicOnly) doesNot.push('anything about the agentbox journal: run without --public-only on the box to add it');
  if (!f.closeRequired) doesNot.push('a channel open or close: no Hitch session was named');
  return { proves, does_not_prove: doesNot };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  let a;
  try {
    a = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`sidechain-witness: ${err.message}\n`);
    process.exit(2);
  }
  const verify = loadVerifier();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidechain-witness-'));
  const facts = { agents: a.agents, payment: a.payment, publicOnly: a.publicOnly, notes: [] };
  try {
    // 1. Chain alias, signer and mirror: from the arguments, else discovered.
    let alias = a.chain;
    let chainEvent = null;
    if (HEX64.test(a.chain)) {
      const q = await queryRelays(a.relays, [{ ids: [a.chain], kinds: [KIND.chain] }], a.timeoutMs, verify);
      chainEvent = q.events[0] || null;
      alias = chainEvent ? (tagOf(chainEvent, 'n')[0] || null) : null;
      if (!alias) throw new Error(`no kind-3500 chain event ${a.chain} on the relays`);
    }
    const tipQ = await queryRelays(a.relays, [{ kinds: [KIND.tip], '#d': [alias], limit: 20 }], a.timeoutMs, verify);
    const tips = tipQ.events.sort((x, y) => y.created_at - x.created_at);
    let mirror = a.mirror || null;
    if (!mirror) {
      const u = tips.length ? (tips[0].tags || []).find((t) => t[0] === 'u') : null;
      mirror = u ? u[1].replace(/\/+$/, '') : null;
      if (!mirror) throw new Error(`no --mirror and no kind-33333 announcement for ${alias} names one`);
      facts.notes.push(`mirror discovered from kind-33333 ${tips[0].id}`);
    }

    // 2. The public files.
    const docR = await fetchWith(`${mirror}/chain.json`, a.timeoutMs * 4, 'json');
    const datR = await fetchWith(`${mirror}/blocks.dat`, a.timeoutMs * 8, 'buf');
    const idxR = await fetchWith(`${mirror}/blocks.json`, a.timeoutMs * 4, 'json');
    if (!docR.ok || !datR.ok || !idxR.ok) throw new Error(`mirror ${mirror} incomplete: chain.json ${docR.error || 'ok'}, blocks.dat ${datR.error || 'ok'}, blocks.json ${idxR.error || 'ok'}`);
    const doc = docR.value;
    if (doc.id !== alias) throw new Error(`mirror serves ${doc.id}, not ${alias}`);
    if (chainEvent && chainEvent.pubkey !== doc.signer) throw new Error('the chain event is not signed by the document\'s signer');
    const signer = doc.signer;
    const tipEv = tips.find((e) => e.pubkey === signer) || null;
    fs.writeFileSync(path.join(scratch, 'chain.json'), JSON.stringify(doc));
    fs.writeFileSync(path.join(scratch, 'blocks.dat'), datR.value);

    // 3. The agents' events (kinds 23500, 23600), signatures verified.
    const evQ = await queryRelays(a.relays, [{ kinds: [KIND.tx, KIND.hitch], authors: a.agents, limit: 500 }], a.timeoutMs, verify);
    const source = new Map(evQ.events.map((e) => [e.id, 'relay']));
    const pool = new Map(evQ.events.map((e) => [e.id, e]));
    let captureRejected = 0;
    if (a.capture) {
      const lines = fs.readFileSync(a.capture, 'utf8').split('\n').filter((l) => l.trim());
      for (const line of lines) {
        let ev;
        try { ev = JSON.parse(line); } catch (_) { captureRejected += 1; continue; }
        if (!ev || !verify(ev)) { captureRejected += 1; continue; }
        if (!a.agents.includes(ev.pubkey) || ![KIND.tx, KIND.hitch].includes(ev.kind)) continue;
        if (!pool.has(ev.id)) { pool.set(ev.id, ev); source.set(ev.id, 'capture'); }
      }
    }
    const agentEventList = [...pool.values()];
    const txEvents = agentEventList.filter((e) => e.kind === KIND.tx && tagOf(e, 'chain').includes(alias));
    const hitchEvents = agentEventList.filter((e) => e.kind === KIND.hitch);
    fs.writeFileSync(path.join(scratch, 'decode.txt'), txEvents.map((e) => `${e.id} ${String(e.content).trim()}`).join('\n'));

    // 4. Independent replay, locating the payment and what it spends.
    const replayArgs = ['--chain', path.join(scratch, 'chain.json'), '--blocks', path.join(scratch, 'blocks.dat'), '--decode', path.join(scratch, 'decode.txt'), '--txid', a.payment];
    for (const t of a.funding) replayArgs.push('--txid', t);
    if (a.close) replayArgs.push('--txid', a.close);
    let replay = null;
    try {
      replay = JSON.parse(execFileSync(a.replayBin, replayArgs, { encoding: 'utf8', maxBuffer: 64 << 20 }));
    } catch (err) {
      facts.replayError = String(err.stderr || err.message).trim();
    }
    // Funding defaults to what the payment spends; a second pass locates it.
    let funding = a.funding;
    if (replay && funding.length === 0 && replay.txs[a.payment] && replay.txs[a.payment].found) {
      funding = [...new Set(replay.txs[a.payment].spends.map((s) => s.txid))];
    }
    let close = a.close;
    const closeRequired = !!a.hitchSession;
    if (replay && (funding.length || (closeRequired && !close))) {
      const again = ['--chain', path.join(scratch, 'chain.json'), '--blocks', path.join(scratch, 'blocks.dat'), '--txid', a.payment];
      for (const t of funding) again.push('--txid', t);
      if (close) again.push('--txid', close);
      const r2 = JSON.parse(execFileSync(a.replayBin, again, { encoding: 'utf8', maxBuffer: 64 << 20 }));
      if (closeRequired && !close) {
        // The close of a Hitch channel is the transaction that spends its funding output.
        const spender = funding.map((t) => r2.txs[t]).filter((x) => x && x.found).flatMap((x) => x.spent_by).find((s) => s.by !== a.payment);
        if (spender) {
          close = spender.by;
          facts.notes.push(`close found as the spender of funding output ${spender.vout}`);
          r2.txs[close] = { found: true, at: spender.at };
        }
      }
      replay.txs = { ...r2.txs, ...replay.txs };
      if (close && !replay.txs[close]) replay.txs[close] = r2.txs[close];
    }
    facts.replay = replay;
    facts.funding = funding;
    facts.close = close;
    facts.closeRequired = closeRequired;
    const idx = idxR.value;
    const atTip = replay && Array.isArray(idx.blocks) ? idx.blocks.find((b) => b.height === replay.height) : null;
    facts.mirrorIndexHash = atTip ? atTip.hash : null;

    // Cross-check: the baked sidestr-agent's own replay height, when present.
    let agentCross = null;
    try {
      const out = execFileSync('sidestr-agent', ['--url', mirror, 'assets'], { encoding: 'utf8', timeout: a.timeoutMs * 8, stdio: ['ignore', 'pipe', 'ignore'] });
      agentCross = { engine: execFileSync('sidestr-agent', ['--version'], { encoding: 'utf8' }).trim(), replayed_height: JSON.parse(out).tip };
    } catch (_) { agentCross = null; }

    // 5. Anchoring: a checkpoint at or above the highest cited height, or the stated reason.
    const heights = [a.payment, ...funding, close].filter(Boolean).map((t) => replay && replay.txs[t] && replay.txs[t].found ? replay.txs[t].at.height : null).filter((h) => h !== null);
    facts.highestHeight = heights.length ? Math.max(...heights) : null;
    const checked = [];
    let checkpoints = null;
    for (const src of [a.producer, mirror].filter(Boolean)) {
      const c = await fetchWith(`${src}/checkpoints.json`, a.timeoutMs, 'json');
      checked.push({ source: `${src}/checkpoints.json`, result: c.ok ? 'present' : c.error });
      if (c.ok) { checkpoints = c.value; break; }
    }
    const list = checkpoints ? (Array.isArray(checkpoints) ? checkpoints : checkpoints.checkpoints || []) : [];
    const every = checkpoints && !Array.isArray(checkpoints) ? checkpoints.every : null;
    const cover = list.filter((c) => Number(c.height) >= (facts.highestHeight || 0) && c.parentTxid).sort((x, y) => x.height - y.height)[0] || null;
    let coverHash = null;
    if (cover && replay) {
      // The checkpoint commits to a (height, hash); it vouches for THIS chain only if the replay has that hash there.
      const r3 = JSON.parse(execFileSync(a.replayBin, ['--chain', path.join(scratch, 'chain.json'), '--blocks', path.join(scratch, 'blocks.dat'), '--height', String(cover.height)], { encoding: 'utf8', maxBuffer: 64 << 20 }));
      coverHash = r3.hashes[String(cover.height)] || null;
    }
    facts.anchored = !!cover && coverHash === cover.hash;
    facts.anchoring = cover
      ? { anchored: facts.anchored, parent: doc.parent,
        checkpoint: { parent_txid: cover.parentTxid, covers_height: cover.height, hash: cover.hash, replayed_hash_at_height: coverHash, parent_height: cover.parentHeight ?? null, confirmations: cover.confirmations ?? null },
        ...(facts.anchored ? {} : { reason: `checkpoint hash ${cover.hash} is not the replayed hash ${coverHash} at height ${cover.height}` }),
        checked }
      : { anchored: false, reason: SC5_REASON, decision: SC5_DECISION, parent: doc.parent, checked,
        detail: checkpoints
          ? `checkpoint record: every ${every === null ? '?' : every} block(s), ${list.length} checkpoint(s), none at or above height ${facts.highestHeight}${every === 0 ? ' (every 0: checkpoints are switched off)' : ''}`
          : 'no checkpoint record is published' };

    // 6. Nostr evidence.
    const agentEvents = {};
    for (const pk of a.agents) {
      agentEvents[pk] = {
        [KIND.tx]: txEvents.filter((e) => e.pubkey === pk).map((e) => e.id),
        [KIND.hitch]: hitchEvents.filter((e) => e.pubkey === pk).map((e) => e.id),
      };
    }
    facts.agentEvents = agentEvents;
    const decoded = (replay && replay.decoded) || {};
    facts.paymentEvent = Object.entries(decoded).find(([, txid]) => txid === a.payment)?.[0] || null;
    facts.tipEvent = tipEv ? { id: tipEv.id, pubkey: tipEv.pubkey, created_at: tipEv.created_at, tip: Number(tagOf(tipEv, 'tip')[0]), mirrors: tagOf(tipEv, 'u') } : null;

    // 7. Journal.
    let sessionUrn = a.sessionUrn || null;
    if (!sessionUrn && a.hitchSession) sessionUrn = sessionUrnFor(a.harness, a.hitchSession);
    if (a.publicOnly) {
      facts.journal = { skipped: '--public-only' };
    } else if (!sessionUrn) {
      facts.journal = { error: 'no --session-urn and no --hitch-session to derive one from' };
    } else {
      const eventsDir = a.eventsDir || process.env.AGENTBOX_EVENTS_DIR || path.join(process.env.WORKSPACE || path.join(os.homedir(), 'workspace'), 'events');
      const read = readJournal(eventsDir, sessionUrn);
      facts.journal = read.error ? { session_urn: sessionUrn, error: read.error } : { events_dir: eventsDir, ...pairJournal(read.records, sessionUrn) };
    }

    const { checks, verdict } = evaluate(facts);
    const receipt = {
      receipt: 'sidechain-demo-witness',
      format: 1,
      produced_at: new Date().toISOString(),
      produced_by: 'scripts/activation/sidechain-demo-witness.sh',
      checkout_head: (() => { try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { return null; } })(),
      verdict,
      inputs: { chain: a.chain, agents: a.agents, payment: a.payment, funding: a.funding, close: a.close || null, hitch_session: a.hitchSession || null, session_urn: sessionUrn, mirror, producer: a.producer || null, relays: a.relays, nostr_capture: a.capture || null, public_only: a.publicOnly },
      chain: { alias, signer, parent: doc.parent, genesis_hash: doc.genesisHash, chain_event: chainEvent ? chainEvent.id : null, chain_json_sha256: crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex') },
      sidechain: {
        payment: replay && replay.txs[a.payment] ? { txid: a.payment, ...replay.txs[a.payment] } : { txid: a.payment, found: false },
        funding: funding.map((t) => ({ txid: t, ...((replay && replay.txs[t]) || { found: false }) })),
        close: closeRequired ? (close ? { txid: close, ...((replay && replay.txs[close]) || { found: false }) } : { found: false }) : { applicable: false, reason: 'no Hitch session named' },
      },
      anchoring: facts.anchoring,
      nostr: {
        tip_announcement: facts.tipEvent,
        agents: agentEvents,
        payment_event: facts.paymentEvent,
        hitch_session_tagged: a.hitchSession ? hitchEvents.filter((e) => (e.tags || []).some((t) => t.includes(a.hitchSession))).map((e) => e.id) : null,
        relays: { tip: tipQ.relays, agents: evQ.relays },
        capture: a.capture || null,
        rejected_signatures: tipQ.rejected + evQ.rejected + captureRejected,
        events: agentEventList.map((e) => ({ source: source.get(e.id), event: e })),
      },
      journal: facts.journal,
      replay: replay ? {
        engine: replay.engine,
        height: replay.height,
        tip_hash: replay.tip_hash,
        tip_time: replay.tip_time,
        genesis_hash: replay.genesis_hash,
        blocks_dat_sha256: replay.blocks_dat_sha256,
        blocks_dat_bytes: replay.blocks_dat_bytes,
        mirror_index_hash_at_tip: facts.mirrorIndexHash,
        cross_check: agentCross,
        rerun: `curl -sO ${mirror}/chain.json && curl -sO ${mirror}/blocks.dat && cargo run --release --manifest-path scripts/activation/sidechain-witness-replay/Cargo.toml -- --chain chain.json --blocks blocks.dat --txid ${a.payment}`,
      } : { error: facts.replayError || 'replay did not run' },
      checks,
      claims: claims(facts),
      notes: facts.notes,
    };
    fs.mkdirSync(path.dirname(a.out), { recursive: true });
    fs.writeFileSync(a.out, `${JSON.stringify(receipt, null, 2)}\n`);
    for (const c of checks) process.stderr.write(`${c.id.padEnd(4)} ${c.status.padEnd(7)} ${c.required ? 'req' : 'opt'}  ${c.summary}\n`);
    process.stderr.write(`\nverdict: ${verdict}; receipt: ${a.out}\n`);
    process.exitCode = verdict === 'PASS' ? 0 : 1;
  } catch (err) {
    process.stderr.write(`sidechain-witness: ${err.message}\n`);
    fs.mkdirSync(path.dirname(a.out), { recursive: true });
    fs.writeFileSync(a.out, `${JSON.stringify({ receipt: 'sidechain-demo-witness', format: 1, produced_at: new Date().toISOString(), verdict: 'FAIL', error: err.message, inputs: { chain: a.chain, agents: a.agents, payment: a.payment } }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { parseArgs, pairJournal, evaluate, claims, SC5_REASON, SC5_DECISION, sessionUrnFor };
