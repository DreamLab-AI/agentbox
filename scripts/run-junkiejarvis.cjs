#!/usr/bin/env node
'use strict';

/**
 * Standalone JunkieJarvis forum-agent runner.
 *
 * Starts JUST the JunkieJarvis agent against NOSTR_RELAYS — independent of the
 * management-api process — so the forum agent can be live-tested without a full
 * container restart. Mirrors the wiring in management-api/server.js.
 *
 * Env loading order (we never overwrite an already-set var):
 *   1. process.env (whatever the shell already exported)
 *   2. agentbox/.env                      (carries JUNKIEJARVIS_PRIVKEY_HEX)
 *   3. agentbox/.env.dreamlab-additions   (carries NOSTR_RELAYS, JUNKIEJARVIS_*)
 *
 * The private key (JUNKIEJARVIS_PRIVKEY_HEX) is read into the signer and is
 * NEVER printed or logged here.
 *
 * Usage:
 *   node /home/devuser/workspace/project/agentbox/scripts/run-junkiejarvis.cjs
 *   JUNKIEJARVIS_ENABLED=true node scripts/run-junkiejarvis.cjs   # force-enable
 *   timeout 10 node scripts/run-junkiejarvis.cjs                  # 10s smoke test
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ── minimal dotenv: parse KEY=VALUE lines, never clobber existing env ────────
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 0; // missing file is fine
  }
  let count = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let val = line.slice(eq + 1).trim();
    // strip matching surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    count += 1;
  }
  return count;
}

loadEnvFile(path.join(REPO_ROOT, '.env'));
loadEnvFile(path.join(REPO_ROOT, '.env.dreamlab-additions'));

// NOSTR_RELAYS override: the container often pre-exports a generic
// damus/primal value that shadows both .env files (loadEnvFile never clobbers
// a pre-set var). For this live forum deployment the .env.dreamlab-additions
// value is authoritative — it puts the DreamLab relay FIRST, which the agent
// needs to reach the forum. Apply it explicitly when present and not already
// dreamlab-first. Operators can still force a value by exporting
// JUNKIEJARVIS_NOSTR_RELAYS, which always wins.
(function resolveRelays() {
  if (process.env.JUNKIEJARVIS_NOSTR_RELAYS) {
    process.env.NOSTR_RELAYS = process.env.JUNKIEJARVIS_NOSTR_RELAYS;
    return;
  }
  let additions = '';
  try {
    const text = fs.readFileSync(path.join(REPO_ROOT, '.env.dreamlab-additions'), 'utf8');
    const m = text.match(/^NOSTR_RELAYS=(.+)$/m);
    if (m) additions = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* no additions file — keep whatever is set */ }
  if (additions) process.env.NOSTR_RELAYS = additions;
})();

// Default to enabled in the standalone runner so a bare invocation works.
if (!('JUNKIEJARVIS_ENABLED' in process.env)) process.env.JUNKIEJARVIS_ENABLED = 'true';

const { NostrBridge } = require(path.join(REPO_ROOT, 'mcp/servers/nostr-bridge'));
const { startJunkieJarvis } = require(path.join(REPO_ROOT, 'management-api/lib/junkiejarvis-agent'));

// Tiny logger — same shape (info/warn/error) the agent expects.
const logger = {
  info: (obj, msg) => console.log('[junkiejarvis]', msg || obj, msg ? obj : ''),
  warn: (obj, msg) => console.warn('[junkiejarvis:warn]', msg || obj, msg ? obj : ''),
  error: (obj, msg) => console.error('[junkiejarvis:error]', msg || obj, msg ? obj : ''),
  debug: () => {},
};

async function main() {
  const relays = (process.env.NOSTR_RELAYS || '')
    .split(',').map((r) => r.trim()).filter(Boolean);
  if (relays.length === 0) {
    console.error('[junkiejarvis] NOSTR_RELAYS is empty — set it in .env.dreamlab-additions');
    process.exit(1);
  }
  console.log('[junkiejarvis] relays:', relays.join(', '));
  console.log('[junkiejarvis] primary (first):', relays[0]);

  const bridge = new NostrBridge({ relays });
  await bridge.connect();

  const agent = startJunkieJarvis({ bridge, logger });
  if (!agent) {
    console.error('[junkiejarvis] not started — check JUNKIEJARVIS_ENABLED and JUNKIEJARVIS_PRIVKEY_HEX');
    await bridge.disconnect();
    process.exit(1);
  }

  // Health heartbeat so the operator sees relay connectivity. The first
  // snapshot is delayed past the WS handshake so it is meaningful.
  setTimeout(() => {
    console.log('[junkiejarvis] relay health:', JSON.stringify(bridge.health()));
  }, 3000).unref();

  const shutdown = async (sig) => {
    console.log(`[junkiejarvis] ${sig} — shutting down`);
    try { agent.stop(); } catch (_) { /* ignore */ }
    try { await bridge.disconnect(); } catch (_) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Periodic health log so a long-running operator session sees reconnections.
  setInterval(() => {
    console.log('[junkiejarvis] relay health:', JSON.stringify(bridge.health()));
  }, 30000).unref();
}

main().catch((err) => {
  console.error('[junkiejarvis] fatal:', err && err.message);
  process.exit(1);
});
