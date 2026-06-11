#!/usr/bin/env node
'use strict';

/**
 * Standalone Per-User Agent Fabric (PUAF) runner — ADR-028.
 *
 * Starts ONE per-user agent (the owner's autonomous Claude-style agent) against
 * NOSTR_RELAYS, independent of the management-api process, so the loop can be
 * live-tested without a full container restart. Mirrors run-junkiejarvis.cjs.
 *
 * Env loading order (we never overwrite an already-set var):
 *   1. process.env (whatever the shell already exported)
 *   2. agentbox/.env                      (carries JUNKIEJARVIS_PRIVKEY_HEX, POD urls)
 *   3. agentbox/.env.dreamlab-additions   (carries NOSTR_RELAYS, PER_USER_*)
 *
 * Key material is read into the signer and is NEVER printed or logged here.
 *
 * Inputs (env or argv KEY=VALUE):
 *   USER_PUBKEY        - the OWNER's 64-hex pubkey (required).
 *   AGENT_PRIVKEY_HEX  - the agent's delegated key (64 hex). Prototype fallback:
 *                        JUNKIEJARVIS_PRIVKEY_HEX so it runs without provisioning.
 *   POD_BASE           - pod API base; falls back to PER_USER_POD_BASE,
 *                        VITE_POD_API_URL, then SOLID_POD_BASE_URL.
 *
 * Usage:
 *   USER_PUBKEY=<owner-hex> node scripts/run-per-user-agent.cjs
 *   node scripts/run-per-user-agent.cjs USER_PUBKEY=<owner-hex>
 *   timeout 20 node scripts/run-per-user-agent.cjs USER_PUBKEY=<owner-hex>  # smoke
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ── argv KEY=VALUE overrides (highest precedence after the shell) ────────────
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf('=');
  if (eq > 0) {
    const k = arg.slice(0, eq).trim();
    const v = arg.slice(eq + 1);
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

// ── minimal dotenv: parse KEY=VALUE lines, never clobber existing env ─────────
function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  let count = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let val = line.slice(eq + 1).trim();
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

// NOSTR_RELAYS override: prefer an explicit JUNKIEJARVIS_NOSTR_RELAYS, else the
// .env.dreamlab-additions value (DreamLab-relay-first) — mirrors run-junkiejarvis.
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
  } catch { /* keep whatever is set */ }
  if (additions) process.env.NOSTR_RELAYS = additions;
})();

// Force-enable in the standalone runner via deps.force (no env flip needed).
const { NostrBridge } = require(path.join(REPO_ROOT, 'mcp/servers/nostr-bridge'));
const { startPerUserAgent, signerFromHex } = (() => {
  const mod = require(path.join(REPO_ROOT, 'management-api/lib/per-user-agent'));
  const jj = require(path.join(REPO_ROOT, 'management-api/lib/junkiejarvis-agent'));
  return { startPerUserAgent: mod.startPerUserAgent, signerFromHex: jj.signerFromHex };
})();

const logger = {
  info: (obj, msg) => console.log('[puaf]', msg || obj, msg ? obj : ''),
  warn: (obj, msg) => console.warn('[puaf:warn]', msg || obj, msg ? obj : ''),
  error: (obj, msg) => console.error('[puaf:error]', msg || obj, msg ? obj : ''),
  debug: () => {},
};

function resolvePodBase() {
  return (
    process.env.POD_BASE ||
    process.env.PER_USER_POD_BASE ||
    process.env.VITE_POD_API_URL ||
    process.env.SOLID_POD_BASE_URL ||
    ''
  );
}

// Resolve the management-api base URL the agent uses for memory recall.
function resolveManagementApiUrl() {
  return (process.env.MANAGEMENT_API_URL || 'http://127.0.0.1:9090').replace(/\/+$/, '');
}

/**
 * Surface the effective MANAGEMENT_API_KEY. The .env files were already loaded
 * into process.env above. As a belt-and-braces step we also read the boot-time
 * secrets file (entrypoint-unified.sh may write the auto-generated key there)
 * when the env var is absent. NEVER printed — only its presence/length is.
 */
function resolveManagementApiKey() {
  if (process.env.MANAGEMENT_API_KEY) return process.env.MANAGEMENT_API_KEY;
  for (const p of ['/var/lib/agentbox/secrets/management-api.key', '/var/lib/agentbox/secrets/MANAGEMENT_API_KEY']) {
    try {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) { process.env.MANAGEMENT_API_KEY = v; return v; }
    } catch { /* not present — fall through */ }
  }
  return '';
}

async function main() {
  const userPubkey = (process.env.USER_PUBKEY || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(userPubkey)) {
    console.error('[puaf] USER_PUBKEY must be a 64-char hex pubkey (set USER_PUBKEY=...)');
    process.exit(1);
  }

  // Agent key: delegated AGENT_PRIVKEY_HEX, prototype fallback to JunkieJarvis.
  const agentPrivHex = (process.env.AGENT_PRIVKEY_HEX
    || process.env.JUNKIEJARVIS_PRIVKEY_HEX
    || process.env.CONCIERGE_PRIVKEY_HEX
    || '').trim();
  const signer = signerFromHex(agentPrivHex);
  if (!signer) {
    console.error('[puaf] no valid agent key — set AGENT_PRIVKEY_HEX (64 hex) or JUNKIEJARVIS_PRIVKEY_HEX');
    process.exit(1);
  }

  const podBase = resolvePodBase();
  if (!podBase) {
    console.warn('[puaf] no POD_BASE / PER_USER_POD_BASE / VITE_POD_API_URL / SOLID_POD_BASE_URL set — identity falls back to DEFAULT_SOUL, heartbeat finds no inbox');
  }

  const relays = (process.env.NOSTR_RELAYS || '')
    .split(',').map((r) => r.trim()).filter(Boolean);
  if (relays.length === 0) {
    console.error('[puaf] NOSTR_RELAYS is empty — set it in .env.dreamlab-additions');
    process.exit(1);
  }
  console.log('[puaf] relays:', relays.join(', '));
  console.log('[puaf] primary (first):', relays[0]);
  console.log('[puaf] pod base:', podBase || '(none)');

  const managementApiUrl = resolveManagementApiUrl();
  const managementApiKey = resolveManagementApiKey();
  console.log('[puaf] management-api:', managementApiUrl);
  console.log('[puaf] management-api key:', managementApiKey ? `present (len ${managementApiKey.length}, redacted)` : '(absent — memory recall will 401)');

  const fetchImpl = typeof fetch === 'function' ? fetch : null;

  const bridge = new NostrBridge({ relays });
  await bridge.connect();

  const agent = startPerUserAgent({
    userPubkey,
    agentSigner: signer,
    podBase,
    bridge,
    fetchImpl,
    logger,
    managementApiUrl,
    managementApiKey,
    force: true,
  });
  if (!agent) {
    console.error('[puaf] not started — check USER_PUBKEY and the agent key');
    await bridge.disconnect();
    process.exit(1);
  }

  console.log(`[puaf] agent for ${userPubkey.slice(0, 8)}… watching`);

  // One heartbeat ~10s after start so the operator sees the inbox loop run.
  setTimeout(async () => {
    try {
      const res = await agent.heartbeat();
      console.log('[puaf] heartbeat result:', JSON.stringify(res));
    } catch (err) {
      console.warn('[puaf] heartbeat error (fail-open):', err && err.message);
    }
  }, 10000).unref();

  // Relay health breadcrumbs.
  setTimeout(() => {
    console.log('[puaf] relay health:', JSON.stringify(bridge.health()));
  }, 3000).unref();
  setInterval(() => {
    console.log('[puaf] relay health:', JSON.stringify(bridge.health()));
  }, 30000).unref();

  const shutdown = async (sig) => {
    console.log(`[puaf] ${sig} — shutting down`);
    try { agent.stop(); } catch (_) { /* ignore */ }
    try { await bridge.disconnect(); } catch (_) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[puaf] fatal:', err && err.message);
  process.exit(1);
});
