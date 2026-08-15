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

function compose(repos) {
  const icon = v => (v === 'ACCEPT' ? '✅' : v === 'REJECT' ? '❌' : '➖');
  const head = `🌙 Dream-machine nightly digest — ${date}`;
  const body = [head, ''];
  if (!repos.length) {
    body.push('No dream cycles ran tonight.');
    return body.join('\n');
  }
  for (const r of repos) {
    // Last row of the night is the definitive one (earlier rows are degraded
    // attempts, e.g. provider outages).
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

  await new Promise((resolve) => {
    const ws = new WS(RELAY);
    const bail = setTimeout(() => { console.log('digest: relay timeout — skipped (fail-open)'); try { ws.close(); } catch {} resolve(); }, 20_000);
    ws.on('error', () => { clearTimeout(bail); console.log('digest: relay error — skipped (fail-open)'); resolve(); });
    ws.on('message', (raw) => {
      const d = JSON.parse(raw.toString());
      if (d[0] === 'AUTH') {
        ws.send(JSON.stringify(['AUTH', tools.finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', RELAY], ['challenge', d[1]]], content: '' }, sk)]));
        setTimeout(() => ws.send(JSON.stringify(['EVENT', event])), 600);
      }
      if (d[0] === 'OK') {
        clearTimeout(bail);
        console.log(`digest: ${d[2] ? 'published' : 'REJECTED'} ${d[1]?.slice(0, 12)}… ${d[3] || ''}`);
        ws.close();
        resolve();
      }
    });
  });
}

main().catch(e => { console.log(`digest: ${e.message} — skipped (fail-open)`); process.exit(0); });
