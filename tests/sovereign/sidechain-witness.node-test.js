'use strict';

/**
 * scripts/activation/sidechain-demo-witness.sh (ADR-2103 interim receipt,
 * amended 2026-10-02): the receipt's required elements, its claims block, and
 * one end-to-end run.
 *
 * Runner: node:test (`node --test tests/sovereign/sidechain-witness.node-test.js`,
 * wired into management-api `npm run test:node`).
 *
 * The pure cases always run. The end-to-end case needs the upstream `siding`
 * checkout (a loopback chain at 2 s blocks, no parent, no relays) and a built
 * replay helper (scripts/activation/sidechain-witness-replay, or
 * SIDECHAIN_REPLAY_BIN); it serves the signer's kind-33333 from an in-process
 * relay, passes agent events as a capture file, and a fixture journal. All
 * keys are throwaway test keys in a temporary directory; nothing is published.
 */

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { finalizeEvent, getPublicKey } = require('../../management-api/node_modules/nostr-tools');
const { WebSocketServer } = require('../../management-api/node_modules/ws');
const W = require('../../scripts/activation/sidechain-witness.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const SK_A = Uint8Array.from(Buffer.from('21'.repeat(32), 'hex'));
const SK_B = Uint8Array.from(Buffer.from('22'.repeat(32), 'hex'));
const PK_A = getPublicKey(SK_A);
const PK_B = getPublicKey(SK_B);
const URN = 'urn:agentbox:meta:session-sidestr-agent-test-1';

function journalLine(kind, eventId, causation, tool, extra = {}) {
  return { kind, ts: '2026-10-02T20:00:00.000Z', hash: `h-${eventId}`, payload: { session_urn: URN, event_id: eventId, causation, harness: 'sidestr-agent', payload: { tool, ...extra } } };
}

function passingFacts(over = {}) {
  const T = (h) => ({ found: true, at: { height: h, hash: `${h}`.padStart(64, 'a'), index: 1 }, spends: [], spent_by: [] });
  return {
    agents: [PK_A, PK_B],
    payment: 'b'.repeat(64),
    funding: ['c'.repeat(64)],
    close: 'd'.repeat(64),
    closeRequired: true,
    publicOnly: false,
    replay: { height: 50, tip_hash: 'e'.repeat(64), txs: { ['b'.repeat(64)]: T(20), ['c'.repeat(64)]: T(10), ['d'.repeat(64)]: T(30) } },
    mirrorIndexHash: 'e'.repeat(64),
    anchoring: { anchored: false, reason: W.SC5_REASON, decision: W.SC5_DECISION },
    anchored: false,
    tipEvent: { id: 'f'.repeat(64), tip: 50 },
    highestHeight: 30,
    agentEvents: { [PK_A]: { 23500: [], 23600: ['1'.repeat(64)] }, [PK_B]: { 23500: [], 23600: ['2'.repeat(64)] } },
    journal: W.pairJournal([
      journalLine('exec.tool.called', 'e1', null, 'hitch.open'),
      journalLine('exec.tool.completed', 'e2', 'e1', 'hitch.open', { ok: true }),
    ], URN),
    ...over,
  };
}

const status = (r, id) => r.checks.find((c) => c.id === id).status;

describe('journal pairing (as C2 of adr-2087-check.sh)', () => {
  test('a started/completed pair under the URN is a pair; other sessions are ignored', () => {
    const j = W.pairJournal([
      journalLine('exec.tool.called', 'e1', null, 'hitch.pay'),
      journalLine('exec.tool.completed', 'e2', 'e1', 'hitch.pay', { ok: true }),
      { ...journalLine('exec.tool.called', 'x1', null, 'other'), payload: { session_urn: 'urn:agentbox:meta:session-x', event_id: 'x1' } },
    ], URN);
    assert.equal(j.pairs.length, 1);
    assert.equal(j.pairs[0].tool, 'hitch.pay');
    assert.equal(j.pairs[0].completed.ok, true);
    assert.deepEqual(j.unpaired, []);
    assert.deepEqual(j.orphans, []);
  });

  test('a started record with no completion is unpaired; a completion with no start is orphaned', () => {
    const j = W.pairJournal([
      journalLine('exec.tool.called', 'e1', null, 'hitch.close'),
      journalLine('exec.tool.completed', 'e9', 'e8', 'hitch.close'),
    ], URN);
    assert.equal(j.pairs.length, 0);
    assert.equal(j.unpaired.length, 1);
    assert.equal(j.orphans.length, 1);
  });

  test('the derived session URN is minted by uris.js exactly as exec-record mints it', () => {
    assert.equal(W.sessionUrnFor('sidestr-agent', 'test-1'), URN);
  });
});

describe('evaluate: every required element', () => {
  test('all present: PASS, close and journal included', () => {
    const r = W.evaluate(passingFacts());
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((c) => c.status !== 'PASS')));
    for (const id of ['R1', 'R2', 'S1', 'S2', 'S3', 'A1', 'N1', 'N2', 'N3', 'J1']) assert.equal(status(r, id), 'PASS', id);
  });

  const breaks = {
    'R1 replay failed': { replay: null, replayError: 'block 7 refused' },
    'R2 mirror index disagrees': { mirrorIndexHash: '0'.repeat(64) },
    'S1 payment absent': { payment: '9'.repeat(64) },
    'S2 no funding': { funding: [] },
    'S3 Hitch close absent': { close: undefined },
    'A1 anchoring not stated': { anchoring: { anchored: false, reason: 'unknown' } },
    'A1 anchored without a parent txid': { anchoring: { anchored: true, checkpoint: {} } },
    'N1 no tip announcement': { tipEvent: null },
    'N1 announcement below the cited height': { tipEvent: { id: 'f'.repeat(64), tip: 29 } },
    'N2/N3 an agent signed nothing': { agentEvents: { [PK_A]: { 23500: ['1'.repeat(64)], 23600: [] }, [PK_B]: { 23500: [], 23600: [] } } },
    'J1 no pairs': { journal: W.pairJournal([], URN) },
    'J1 an unpaired start': { journal: W.pairJournal([journalLine('exec.tool.called', 'e1', null, 'hitch.pay')], URN) },
    'J1 no session URN': { journal: { error: 'no --session-urn' } },
  };
  for (const [name, over] of Object.entries(breaks)) {
    test(`${name}: FAIL`, () => assert.equal(W.evaluate(passingFacts(over)).verdict, 'FAIL'));
  }

  test('--public-only waives the journal, and only the journal', () => {
    const r = W.evaluate(passingFacts({ publicOnly: true, journal: { skipped: '--public-only' } }));
    assert.equal(status(r, 'J1'), 'NOT-RUN');
    assert.equal(r.verdict, 'PASS');
    assert.equal(W.evaluate(passingFacts({ publicOnly: true, journal: { skipped: '--public-only' }, tipEvent: null })).verdict, 'FAIL');
  });

  test('without a Hitch session the close is not applicable, not required', () => {
    const r = W.evaluate(passingFacts({ closeRequired: false, close: undefined }));
    assert.equal(status(r, 'S3'), 'NOT-RUN');
    assert.equal(r.verdict, 'PASS');
  });
});

describe('claims', () => {
  test('an unanchored receipt says so first, with the owner\'s reason verbatim', () => {
    const c = W.claims(passingFacts());
    assert.match(c.does_not_prove[0], /NOT anchored/);
    assert.ok(c.does_not_prove[0].includes('checkpoints off, cost; open'));
    assert.ok(c.does_not_prove[0].includes('owner decision 2026-10-02, SC5'));
    assert.ok(!c.proves.some((p) => /checkpoint/.test(p)));
  });

  test('an anchored receipt claims the checkpoint and drops the disclaimer', () => {
    const c = W.claims(passingFacts({ anchored: true, anchoring: { anchored: true, checkpoint: { parent_txid: 'a'.repeat(64) } } }));
    assert.ok(c.proves.some((p) => /checkpoint transaction/.test(p)));
    assert.ok(!c.does_not_prove.some((p) => /NOT anchored/.test(p)));
  });

  test('--public-only says the journal was not examined', () => {
    assert.ok(W.claims(passingFacts({ publicOnly: true })).does_not_prove.some((p) => /journal/.test(p)));
  });
});

describe('arguments', () => {
  test('two distinct agents, a payment txid, and the paths are required', () => {
    const base = ['--chain', 'sidestr:x', '--agent', PK_A, '--agent', PK_B, '--payment', 'b'.repeat(64), '--replay-bin', '/x', '--out', '/y'];
    assert.doesNotThrow(() => W.parseArgs(base));
    assert.throws(() => W.parseArgs(base.slice(0, 4).concat(base.slice(6))), /exactly two/);
    assert.throws(() => W.parseArgs(['--chain', 'sidestr:x', '--agent', PK_A, '--agent', PK_A, '--payment', 'b'.repeat(64), '--replay-bin', '/x', '--out', '/y']), /must differ/);
    assert.throws(() => W.parseArgs(base.map((x) => (x === 'b'.repeat(64) ? 'nothex' : x))), /not a txid/);
  });
});

// ── End to end against a loopback siding ────────────────────────────────────
const UP = process.env.SIDESTR_UPSTREAM || path.join(process.env.WORKSPACE || path.join(os.homedir(), 'workspace'), 'sidestr', 'upstream');
const SIDING = path.join(UP, 'spec', 'siding', 'bin', 'siding.mjs');
const REPLAY = process.env.SIDECHAIN_REPLAY_BIN || path.join(REPO, 'scripts', 'activation', 'sidechain-witness-replay', 'target', 'release', 'sidechain-witness-replay');
const skip = !fs.existsSync(SIDING) ? `no upstream siding checkout at ${UP}` : !fs.existsSync(REPLAY) ? `no built replay helper at ${REPLAY}` : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function runAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    c.stderr.on('data', (d) => { stderr += d; });
    c.stdout.resume();
    const t = setTimeout(() => c.kill('SIGKILL'), 60_000);
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stderr }); });
  });
}

describe('end to end: loopback chain, in-process relay, capture, fixture journal', { skip }, () => {
  let dir; let child; let wss; let mirrorServer;
  after(() => {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    if (wss) wss.close();
    if (mirrorServer) mirrorServer.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('every element but the payment present: exits 1 with S1/S2 the only failures; receipt states non-anchoring', { timeout: 90_000 }, async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-e2e-'));
    const env = { ...process.env, SCHEMA: path.join(UP, 'schema'), BLAKETESTNODE: path.join(UP, 'blaketestnode') };
    const doc = path.join(dir, 'chain.json');
    const keyFile = path.join(dir, 'signer.key');
    const made = spawnSync(process.execPath, [SIDING, 'new', '--name', 'witnesstest', '--prefix', 'wit', '--parent', 'tbtc4', '--out', doc, '--key-file', keyFile, '--dir', path.join(dir, 'd')], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(made.status, 0, made.stderr);
    const port = 39000 + Math.floor(Math.random() * 900);
    child = spawn(process.execPath, [SIDING, 'produce', '--chain', doc, '--dir', path.join(dir, 'd'), '--key-file', keyFile, '--port', String(port), '--interval', '2'], { env, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    let tip = null;
    for (let i = 0; i < 40 && !(tip && tip.height >= 2); i += 1) {
      await sleep(500);
      try { tip = await (await fetch(`${base}/tip`)).json(); } catch (_) { /* starting */ }
    }
    assert.ok(tip && tip.height >= 2, 'loopback producer made no blocks');
    // Snapshot the producer's public files into a static mirror, then stop it,
    // so the mirror, the index and the announcement all name one tip.
    // blocks.dat first: the index fetched after it may be a block ahead, never behind.
    const files = {};
    for (const f of ['blocks.dat', 'chain.json', 'blocks.json', 'checkpoints.json']) {
      files[f] = Buffer.from(await (await fetch(`${base}/${f}`)).arrayBuffer());
    }
    child.kill('SIGKILL');
    const datLen = files['blocks.dat'].length;
    tip = JSON.parse(files['blocks.json'].toString()).blocks.find((b) => b.offset + 8 + b.size === datLen);
    assert.ok(tip, 'no index entry ends where the block file ends');
    mirrorServer = http.createServer((req, res) => {
      const body = files[req.url.replace(/^\/+/, '')];
      if (!body) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); res.end(body);
    });
    await new Promise((r) => mirrorServer.listen(0, '127.0.0.1', r));
    const mirror = `http://127.0.0.1:${mirrorServer.address().port}`;

    // The signer's tip announcement, signed with the throwaway signer key.
    const signerSk = Uint8Array.from(Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex'));
    const now = Math.floor(Date.now() / 1000);
    const tipEv = finalizeEvent({ kind: 33333, created_at: now, tags: [['d', 'sidestr:witnesstest'], ['tip', String(tip.height)], ['u', mirror, 'mirror']], content: '' }, signerSk);
    const relayEvents = [tipEv];
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((r) => wss.on('listening', r));
    wss.on('connection', (sock) => sock.on('message', (raw) => {
      const [type, sub, ...filters] = JSON.parse(raw.toString());
      if (type !== 'REQ') return;
      for (const ev of relayEvents) {
        if (filters.some((f) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f.authors || f.authors.includes(ev.pubkey))
          && (!f['#d'] || ev.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1]))) && (!f.ids || f.ids.includes(ev.id)))) {
          sock.send(JSON.stringify(['EVENT', sub, ev]));
        }
      }
      sock.send(JSON.stringify(['EOSE', sub]));
    }));
    const relay = `ws://127.0.0.1:${wss.address().port}`;

    // Captured agent events (ephemeral kinds: relays would not keep them), one forged.
    const capture = path.join(dir, 'capture.jsonl');
    const evA = finalizeEvent({ kind: 23600, created_at: now, tags: [['p', PK_B]], content: 'open' }, SK_A);
    const evB = finalizeEvent({ kind: 23600, created_at: now, tags: [['p', PK_A]], content: 'accept' }, SK_B);
    const forged = { ...finalizeEvent({ kind: 23600, created_at: now, tags: [], content: 'x' }, SK_B), content: 'tampered' };
    fs.writeFileSync(capture, [evA, evB, forged].map((e) => JSON.stringify(e)).join('\n'));

    const events = path.join(dir, 'events');
    fs.mkdirSync(events);
    fs.writeFileSync(path.join(events, '2026-10-02.jsonl'), [
      journalLine('exec.tool.called', 'e1', null, 'hitch.pay'),
      journalLine('exec.tool.completed', 'e2', 'e1', 'hitch.pay', { ok: true }),
    ].map((l) => JSON.stringify(l)).join('\n'));

    const out = path.join(dir, 'receipt.json');
    // Async: the relay and the mirror answer from this process's event loop.
    const run = await runAsync('bash', [path.join(REPO, 'scripts', 'activation', 'sidechain-demo-witness.sh'),
      '--chain', 'sidestr:witnesstest', '--agent', PK_A, '--agent', PK_B, '--payment', '7'.repeat(64),
      '--session-urn', URN, '--relays', relay, '--producer', mirror, '--nostr-capture', capture,
      '--events-dir', events, '--out', out, '--timeout-ms', '3000'],
    { env: { ...process.env, SIDECHAIN_REPLAY_BIN: REPLAY } });
    assert.equal(run.status, 1, run.stderr);
    const r = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(Array.isArray(r.checks), `witness error: ${r.error}`);
    const st = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    assert.deepEqual(st, { R1: 'PASS', R2: 'PASS', S1: 'FAIL', S2: 'FAIL', S3: 'NOT-RUN', A1: 'PASS', N1: 'PASS', N2: 'PASS', N3: 'PASS', N4: 'FAIL', J1: 'PASS' }, run.stderr);
    assert.equal(r.verdict, 'FAIL');
    assert.equal(r.replay.height, tip.height);
    assert.equal(r.replay.tip_hash, tip.hash, 'the Rust replay reaches the JS producer\'s tip hash');
    assert.equal(r.anchoring.anchored, false);
    assert.equal(r.anchoring.reason, 'checkpoints off, cost; open');
    assert.match(r.anchoring.detail, /every 0/);
    assert.equal(r.nostr.tip_announcement.id, tipEv.id);
    assert.equal(r.nostr.rejected_signatures, 1, 'the tampered capture line is refused');
    assert.deepEqual(r.nostr.events.map((e) => e.event.id).sort(), [evA.id, evB.id].sort());
    assert.ok(r.nostr.events.every((e) => e.source === 'capture'));
    assert.equal(r.journal.pairs.length, 1);
    assert.match(r.claims.does_not_prove[0], /NOT anchored/);
  });
});

describe('replay helper: the BLAKE2b family (a chain beside txbt4)', { skip }, () => {
  let dir; let child;
  after(() => {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a loopback chain beside txbt4 replays to the JS producer\'s tip hash', { timeout: 60_000 }, async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-b2b-'));
    const env = { ...process.env, SCHEMA: path.join(UP, 'schema'), BLAKETESTNODE: path.join(UP, 'blaketestnode') };
    const doc = path.join(dir, 'chain.json');
    const keyFile = path.join(dir, 'signer.key');
    const made = spawnSync(process.execPath, [SIDING, 'new', '--name', 'blaketest', '--prefix', 'blk', '--parent', 'txbt4', '--out', doc, '--key-file', keyFile, '--dir', path.join(dir, 'd')], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(made.status, 0, made.stderr);
    const port = 39000 + Math.floor(Math.random() * 900);
    child = spawn(process.execPath, [SIDING, 'produce', '--chain', doc, '--dir', path.join(dir, 'd'), '--key-file', keyFile, '--port', String(port), '--interval', '2'], { env, stdio: 'ignore' });
    let dat = null; let idx = null;
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      try {
        dat = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/blocks.dat`)).arrayBuffer());
        idx = await (await fetch(`http://127.0.0.1:${port}/blocks.json`)).json();
        if (idx.blocks.length >= 3) break;
      } catch (_) { /* starting */ }
    }
    child.kill('SIGKILL');
    assert.ok(idx && idx.blocks.length >= 3, 'loopback producer made no blocks');
    fs.writeFileSync(path.join(dir, 'blocks.dat'), dat);
    const r = JSON.parse(spawnSync(REPLAY, ['--chain', doc, '--blocks', path.join(dir, 'blocks.dat')], { encoding: 'utf8' }).stdout);
    const atTip = idx.blocks.find((b) => b.height === r.height);
    assert.equal(r.engine.header_family, 'blake2b-v2');
    assert.ok(r.height >= 2);
    assert.equal(r.tip_hash, atTip.hash);
  });
});
