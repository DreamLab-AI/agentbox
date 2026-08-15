#!/usr/bin/env node
// dream-night-digest.mjs — post the nightly dream-machine digest to the forum.
//
// The unified "inbox" for dream-cycle decisions (authority stays native: git
// gates code, the 31402/31403 broker gate governs boundary-crossing proposals;
// this digest is VISIBILITY only). Posted by JunkieJarvis as a kind-42 topic
// root in the dreamlab zone's "chat with agents" section.
//
// Usage: node dream-night-digest.mjs [--date YYYY-MM-DD] [--dry-run]
//
// Reads each nominated repo's ledger (dream.config.json marker under
// WORKSPACE) for rows matching the date, composes one digest, signs with
// JUNKIEJARVIS_PRIVKEY_HEX from agentbox/.env, NIP-42 auths to the relay and
// publishes. Fail-open: any missing dependency/key/relay exits 0 with a note
// so the nightly engine is never blocked by digest problems.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.DREAM_WORKSPACE || '/home/devuser/workspace';
const RELAY = process.env.DREAM_DIGEST_RELAY || 'wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev';
const CHANNEL_ID = process.env.DREAM_DIGEST_CHANNEL || 'f2f2bd670b66d01b03cc701e16e1c47920406e337aae49c47f5e3af122960e47';
const SECTION = process.env.DREAM_DIGEST_SECTION || 'zone4-chat-with-agents';
const ENV_FILE = process.env.AGENTBOX_ENV_FILE || path.resolve(here, '..', '.env');

const args = process.argv.slice(2);
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const dryRun = args.includes('--dry-run');
const date = dateArg || new Date().toISOString().slice(0, 10);

// --- lazy deps (house pattern: CJS require against candidate node_modules
// dirs — ESM import() cannot load a package by directory path) ---------------
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
function lazyRequire(name) {
  const candidates = [
    path.resolve(here, '..', 'management-api', 'node_modules', name),
    path.resolve(here, '..', 'mcp', 'node_modules', name),
    path.resolve(WORKSPACE, 'dreamlab-ai-website', 'node_modules', name),
    name,
  ];
  for (const c of candidates) {
    try { return require_(c); } catch { /* next */ }
  }
  return null;
}

// --- collect tonight's rows ---------------------------------------------------
function ledgerRows() {
  const out = [];
  for (const entry of readdirSync(WORKSPACE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(WORKSPACE, entry.name);
    const cfgPath = path.join(repoPath, 'dream.config.json');
    if (!existsSync(cfgPath)) continue;
    let ledgerPath = 'docs/dream-cycle/LEDGER.md';
    try { ledgerPath = JSON.parse(readFileSync(cfgPath, 'utf8')).ledgerPath || ledgerPath; } catch { /* default */ }
    const full = path.join(repoPath, ledgerPath);
    if (!existsSync(full)) continue;

    const lines = readFileSync(full, 'utf8').split('\n').filter(l => l.trim().startsWith('|'));
    let streak = 0;
    const tonight = [];
    for (const line of lines) {
      const cells = line.split('|').map(c => c.trim());
      const verdict = cells[7] || '';
      if (verdict === 'INCONCLUSIVE') streak += 1;
      else if (verdict === 'ACCEPT' || verdict === 'REJECT') streak = 0;
      if ((cells[1] || '') === date && ['ACCEPT', 'REJECT', 'INCONCLUSIVE'].includes(verdict)) {
        tonight.push({ deep: cells[2], finding: cells[3], verdict, witness: cells[9] });
      }
    }
    if (tonight.length) out.push({ repo: entry.name, rows: tonight, streak });
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo));
}

// Two styles, DREAM_DIGEST_STYLE env: "plain" (default — narrative English,
// operator is calibrating trust in the system) or "terse" (icon/table form).
const STYLE = process.env.DREAM_DIGEST_STYLE || 'plain';

function composeTerse(repos) {
  const icon = v => (v === 'ACCEPT' ? '✅' : v === 'REJECT' ? '❌' : '➖');
  const body = [`🌙 Dream-machine nightly digest — ${date}`, ''];
  if (!repos.length) {
    body.push('No dream cycles ran tonight.');
    return body.join('\n');
  }
  for (const r of repos) {
    const last = r.rows[r.rows.length - 1];
    body.push(`${icon(last.verdict)} ${r.repo} — ${last.verdict} (${last.deep})`);
    body.push(`   ${last.finding}`);
    if (last.witness && last.witness !== 'BLOCKED') body.push(`   witness ${last.witness}`);
    if (last.verdict === 'ACCEPT') body.push('   → staged branch/PR awaits human review (never auto-merged)');
    if (r.streak >= 4) body.push(`   ⚠ dry streak ${r.streak} — standby at 5 (INCONCLUSIVE-only nights)`);
    if (r.rows.length > 1) body.push(`   (${r.rows.length - 1} degraded attempt(s) earlier tonight)`);
    body.push('');
  }
  body.push('Reports: workspace/.tmp/dream-annexe-artefacts/<date>-<repo>/report.md · Ledgers: <repo>/docs/dream-cycle/LEDGER.md');
  body.push('Authority: git gates code (human merges); the forum broker gate governs boundary-crossing proposals. This digest is the inbox, not the approval.');
  return body.join('\n');
}

function composePlain(repos) {
  const body = [`Dream machine — overnight report for ${date}, in plain English.`, ''];
  if (!repos.length) {
    body.push('No dream cycles ran tonight.');
    return body.join('\n');
  }

  const decisive = repos.filter(r => ['ACCEPT', 'REJECT'].includes(r.rows[r.rows.length - 1].verdict));
  const open = repos.filter(r => !decisive.includes(r));
  const degradedTotal = repos.reduce((n, r) => n + (r.rows.length - 1), 0);

  if (decisive.length) {
    body.push(`${decisive.length === 1 ? 'One repository' : cap(numberWord(decisive.length)) + ' repositories'} reached a firm conclusion tonight.`);
    body.push('');
    for (const r of decisive) {
      const last = r.rows[r.rows.length - 1];
      if (last.verdict === 'ACCEPT') {
        body.push(`${r.repo}: the night's hypothesis was CONFIRMED with solid evidence (the "${last.deep}" investigation). In short: ${sentence(last.finding)} A branch with the proposed change and full report has been staged — it will not be merged until a human reviews it.`);
      } else {
        body.push(`${r.repo}: the night's hypothesis was tested and DISPROVED (the "${last.deep}" investigation) — a useful negative result, recorded so future nights don't repeat it. In short: ${sentence(last.finding)}`);
      }
      if (last.witness && last.witness !== 'BLOCKED') body.push(`(Evidence fingerprint: ${last.witness}.)`);
      body.push('');
    }
  }

  if (open.length) {
    body.push(`${open.length === 1 ? 'One night' : cap(numberWord(open.length)) + ' nights'} ended without a firm conclusion — each for a stated reason, not silence.`);
    body.push('');
    for (const r of open) {
      const last = r.rows[r.rows.length - 1];
      body.push(`${r.repo} ("${last.deep}"): ${sentence(last.finding)}`);
      if (r.streak >= 4) body.push(`Heads-up: this repo has now had ${numberWord(r.streak)} inconclusive nights in a row. At five it is parked automatically until a night produces a firm answer.`);
      body.push('');
    }
  }

  if (degradedTotal > 0) {
    body.push(`Note on reliability: ${numberWord(degradedTotal)} earlier attempt${degradedTotal === 1 ? ' was' : 's were'} disrupted today, mostly by the cloud model's gateway timing out; where needed the engine fell back to our own local model, and the results above are from the successful attempts.`);
    body.push('');
  }

  body.push('Full reports are on the agentbox host under workspace/.tmp/dream-annexe-artefacts, one folder per repo per night. Nothing is ever merged automatically — staged changes wait for human review.');
  return body.join('\n');
}

function sentence(finding) {
  let s = (finding || '').trim().replace(/\s+/g, ' ');
  if (!s) return '(no summary captured — see the full report).';
  // Ledger findings are truncated at 80 chars; make that honest in prose.
  if (s.length >= 78 && !/[.!?]$/.test(s)) s += '… (summary truncated — full detail in the report).';
  else if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

function numberWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function compose(repos) {
  return STYLE === 'terse' ? composeTerse(repos) : composePlain(repos);
}

// --- publish -------------------------------------------------------------------
async function main() {
  const repos = ledgerRows();
  const content = compose(repos);
  console.log('--- digest ---\n' + content + '\n--------------');
  if (dryRun) return;

  const tools = lazyRequire('nostr-tools');
  const wsMod = lazyRequire('ws');
  const WS = wsMod?.default || wsMod?.WebSocket || wsMod;
  if (!tools?.finalizeEvent || !WS) { console.log('digest: nostr-tools/ws unavailable — skipped (fail-open)'); return; }

  let sk;
  try {
    const env = readFileSync(ENV_FILE, 'utf8');
    sk = Uint8Array.from(Buffer.from(env.match(/^JUNKIEJARVIS_PRIVKEY_HEX=["']?([0-9a-f]{64})/m)[1], 'hex'));
  } catch { console.log('digest: JUNKIEJARVIS_PRIVKEY_HEX unavailable — skipped (fail-open)'); return; }

  const now = () => Math.floor(Date.now() / 1000);
  const event = tools.finalizeEvent({
    kind: 42,
    created_at: now(),
    tags: [['e', CHANNEL_ID, RELAY, 'root'], ['section', SECTION], ['t', 'dream-cycle']],
    content,
  }, sk);

  // The CF worker relay has been observed OK'ing an event and then failing to
  // persist it (first digest, 2026-08-15). Never trust the OK alone: publish,
  // read the event back by id, and republish once if it is missing.
  await new Promise((resolve) => {
    const ws = new WS(RELAY);
    let attempts = 0;
    let verified = false;
    const bail = setTimeout(() => { console.log(`digest: ${verified ? 'published+verified' : 'NOT VERIFIED (relay accepted but event unreadable)'}`); try { ws.close(); } catch {} resolve(); }, 45_000);
    const publish = () => { attempts += 1; ws.send(JSON.stringify(['EVENT', event])); };
    const verify = () => ws.send(JSON.stringify(['REQ', `vf${attempts}`, { ids: [event.id] }]));
    ws.on('error', () => { clearTimeout(bail); console.log('digest: relay error — skipped (fail-open)'); resolve(); });
    ws.on('message', (raw) => {
      const d = JSON.parse(raw.toString());
      if (d[0] === 'AUTH') {
        ws.send(JSON.stringify(['AUTH', tools.finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', d[1]]], content: '' }, sk)]));
        setTimeout(publish, 600);
      }
      if (d[0] === 'OK' && d[1] === event.id) {
        if (!d[2]) { clearTimeout(bail); console.log(`digest: REJECTED ${d[3] || ''}`); ws.close(); resolve(); return; }
        setTimeout(verify, 2500);
      }
      if (d[0] === 'EVENT' && d[2]?.id === event.id) verified = true;
      if (d[0] === 'EOSE') {
        if (verified) {
          clearTimeout(bail);
          console.log(`digest: published+verified ${event.id.slice(0, 12)}… (attempt ${attempts})`);
          ws.close();
          resolve();
        } else if (attempts < 2) {
          console.log(`digest: OK'd but not readable — republishing (attempt ${attempts + 1})`);
          publish();
        } else {
          clearTimeout(bail);
          console.log('digest: NOT VERIFIED after 2 attempts — relay accepted but never persisted');
          ws.close();
          resolve();
        }
      }
    });
  });
}

main().catch(e => { console.log(`digest: ${e.message} — skipped (fail-open)`); process.exit(0); });
