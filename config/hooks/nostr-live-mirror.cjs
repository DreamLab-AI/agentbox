#!/usr/bin/env node
'use strict';

/**
 * Live Nostr session mirror — the live-chat complement to the SessionEnd digest
 * (config/hooks/nostr-session-summary.py, gated by [sovereign_mesh.mobile_bridge]).
 *
 * Where the digest mirror sends ONE curated kind-30840 summary at SessionEnd,
 * this hook mirrors the running task chat turn-by-turn to the operator's phone
 * as NIP-59 gift-wrapped DMs (kind 1059 wrapping a kind-14 DM rumor), readable
 * in Amethyst with the operator's key:
 *
 *   - SessionStart     → "▶ session started" lifecycle line
 *   - UserPromptSubmit → the operator's prompt text
 *   - Stop             → the LAST assistant message text from the transcript
 *   - SessionEnd       → "■ session ended (<reason>)" lifecycle line
 *
 * Transport: EXCLUSIVELY the cloud relay (operator constraint). The relay admits
 * a kind-1059 gift wrap iff its FIRST ["p"] recipient is whitelisted; the
 * operator pubkey is whitelisted in every cohort, and nip59.wrapEvent stamps an
 * ephemeral author — so the mirror needs no key of its own on the relay and
 * never touches relay.damus.io / relay.primal.net. The mirror does NOT read the
 * NOSTR_RELAYS fan-out list; the cloud relay is hardcoded as the default with a
 * single env override (NOSTR_MIRROR_RELAY) for testing.
 *
 * Privacy: unlike the digest path there is NO external LLM hop — the raw turn
 * text is end-to-end-sealed (NIP-59) straight to the operator's pubkey. The only
 * network egress is the encrypted gift wrap to the cloud relay.
 *
 * Gating: silent no-op (exit 0) unless an operator recipient pubkey is present
 * (AGENTBOX_PUBKEY / AGENTBOX_BRIDGE_RECIPIENT_PUBKEY / AGENTBOX_ADMIN_PUBKEY /
 * AGENTBOX_MIRROR_RECIPIENT_PUBKEY). Toggle off explicitly with
 * AGENTBOX_LIVE_MIRROR=0.
 *
 * Discipline (Claude Code hook contract): reads the hook JSON on STDIN, exits 0
 * FAST, never blocks the session. A hard deadline aborts the publish and every
 * error is swallowed. Fail-open everywhere.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Cloud relay (operator constraint: EXCLUSIVELY this relay) ────────────────
const DEFAULT_RELAY = 'wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev';

// Total wall-clock budget for the whole hook (connect + publish). The Claude
// Code hook timeout is ~8s; we stay well under it and fail-open on expiry.
const DEADLINE_MS = 6000;

// Per-message rumor body cap (a phone notification, not a log dump).
const MAX_BODY_CHARS = 4000;

const KIND_GIFT_WRAP = 1059; // NIP-59 gift wrap
const KIND_DM_RUMOR = 14;    // NIP-17 / NIP-59 DM rumor

function log(msg) {
  try { process.stderr.write(`[nostr-live-mirror] ${msg}\n`); } catch { /* ignore */ }
}

function envFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** The operator's hex pubkey is the DM recipient. */
function recipientPubkey() {
  const pk = envFirst(
    'AGENTBOX_MIRROR_RECIPIENT_PUBKEY',
    'AGENTBOX_PUBKEY',
    'AGENTBOX_BRIDGE_RECIPIENT_PUBKEY',
    'AGENTBOX_ADMIN_PUBKEY'
  ).toLowerCase();
  return /^[0-9a-f]{64}$/.test(pk) ? pk : '';
}

/**
 * Resolve the gift-wrap relay. Hardcoded cloud-relay default with a single env
 * override (NOSTR_MIRROR_RELAY) for testing. We deliberately ignore NOSTR_RELAYS
 * so the mirror never fans out to public relays.
 */
function mirrorRelay() {
  const override = envFirst('NOSTR_MIRROR_RELAY');
  if (override && /^wss?:\/\//i.test(override)) return override;
  return DEFAULT_RELAY;
}

// nostr-tools (incl. nip59) resolves from management-api/node_modules; fall back
// to mcp/node_modules. Loaded lazily so a missing dep is a silent no-op.
function loadNostrTools() {
  const here = __dirname;
  const candidates = [
    path.resolve(here, '..', '..', 'management-api', 'node_modules', 'nostr-tools'),
    path.resolve(here, '..', '..', 'mcp', 'node_modules', 'nostr-tools'),
    'nostr-tools',
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  return null;
}

function loadWs() {
  const here = __dirname;
  const candidates = [
    path.resolve(here, '..', '..', 'management-api', 'node_modules', 'ws'),
    path.resolve(here, '..', '..', 'mcp', 'node_modules', 'ws'),
    'ws',
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  return null;
}

/** Sender identity sealed inside the gift wrap. */
function senderSecretKey(tools) {
  const hex = envFirst('AGENTBOX_PRIVKEY_HEX', 'AGENTBOX_BRIDGE_SK', 'OPERATOR_NOSTR_PRIVKEY');
  if (/^[0-9a-f]{64}$/i.test(hex)) {
    try { return Uint8Array.from(Buffer.from(hex, 'hex')); } catch { /* fall through */ }
  }
  // No operator key available: seal under a throwaway key. The phone still
  // receives + decrypts the DM; it just shows an unknown inner sender.
  return tools.generateSecretKey();
}

/** Pull human-readable text out of a transcript message content (string|blocks). */
function contentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') parts.push(block);
    else if (block && typeof block === 'object' && block.type === 'text') parts.push(String(block.text || ''));
  }
  return parts.map((p) => String(p).trim()).filter(Boolean).join(' ').trim();
}

/**
 * Read the LAST assistant text message from a Claude Code .jsonl transcript.
 * Scans from the end for efficiency; fail-open to '' on any error.
 */
function lastAssistantText(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      const message = rec && rec.message;
      if (!message || typeof message !== 'object' || message.role !== 'assistant') continue;
      const text = contentText(message.content);
      if (text) return text;
    }
  } catch { /* fail-open */ }
  return '';
}

/**
 * Map a hook event to the mirror line (a single { body } or null to skip).
 * @param {string} event  Claude Code hook event name
 * @param {object} payload  parsed STDIN JSON
 */
function bodyForEvent(event, payload) {
  const shortId = String((payload && payload.session_id) || 'unknown').slice(0, 8);
  switch (event) {
    case 'SessionStart': {
      const src = (payload && payload.source) ? ` (${payload.source})` : '';
      return `▶ session ${shortId} started${src}`;
    }
    case 'UserPromptSubmit': {
      const prompt = typeof (payload && payload.prompt) === 'string' ? payload.prompt.trim() : '';
      if (!prompt) return null;
      return `🧑 [${shortId}] ${prompt}`;
    }
    case 'Stop': {
      const text = lastAssistantText(payload && payload.transcript_path);
      if (!text) return null;
      return `🤖 [${shortId}] ${text}`;
    }
    case 'SessionEnd': {
      const reason = (payload && payload.reason) ? ` (${payload.reason})` : '';
      return `■ session ${shortId} ended${reason}`;
    }
    default:
      return null;
  }
}

/**
 * Publish ONE pre-signed gift wrap to the cloud relay and wait for the relay's
 * OK frame (or the deadline). Resolves on OK/close/timeout; never rejects.
 */
function publishWrap(WS, relayUrl, wrap, deadlineMs) {
  return new Promise((resolve) => {
    let done = false;
    let ws = null;
    const finish = () => {
      if (done) return;
      done = true;
      try { if (ws) ws.close(); } catch { /* ignore */ }
      resolve();
    };
    const timer = setTimeout(finish, deadlineMs);
    try {
      ws = new WS(relayUrl, { handshakeTimeout: Math.min(deadlineMs, 4000) });
      ws.on('open', () => {
        try { ws.send(JSON.stringify(['EVENT', wrap])); } catch { finish(); }
      });
      ws.on('message', (data) => {
        try {
          const frame = JSON.parse(String(data));
          // ['OK', <id>, <accepted:bool>, <msg>]
          if (Array.isArray(frame) && frame[0] === 'OK' && frame[1] === wrap.id) {
            if (!frame[2]) log(`relay rejected wrap: ${frame[3] || 'no reason'}`);
            clearTimeout(timer);
            finish();
          }
        } catch { /* ignore non-JSON frames */ }
      });
      ws.on('error', () => { clearTimeout(timer); finish(); });
      ws.on('close', () => { clearTimeout(timer); finish(); });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { buf += chunk; });
      process.stdin.on('end', () => resolve(buf));
      process.stdin.on('error', () => resolve(buf));
      // STDIN may already be closed if invoked without input.
      if (process.stdin.isTTY) resolve('');
    } catch {
      resolve(buf);
    }
  });
}

async function main() {
  // The event name is the first CLI arg (SessionStart|UserPromptSubmit|Stop|SessionEnd).
  const event = process.argv[2] || '';

  // Gate: explicit off switch, or no recipient configured → silent no-op.
  if (String(process.env.AGENTBOX_LIVE_MIRROR || '').trim() === '0') return 0;
  const recipient = recipientPubkey();
  if (!recipient) return 0;

  const raw = await readStdin();
  let payload = {};
  if (raw && raw.trim()) {
    try { payload = JSON.parse(raw); } catch { payload = {}; }
  }

  let body = bodyForEvent(event, payload);
  if (!body || !body.trim()) return 0;
  if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}…`;

  const tools = loadNostrTools();
  const WS = loadWs();
  if (!tools || !tools.nip59 || typeof tools.nip59.wrapEvent !== 'function' || !WS) {
    log('nostr-tools/ws unavailable; skipping mirror');
    return 0;
  }

  let wrap;
  try {
    const sk = senderSecretKey(tools);
    const rumor = {
      kind: KIND_DM_RUMOR,
      content: body,
      tags: [['p', recipient]],
      created_at: Math.floor(Date.now() / 1000),
    };
    // Recipient FIRST in the wrap's ["p"] tag → passes the relay whitelist gate.
    wrap = tools.nip59.wrapEvent(rumor, sk, recipient);
    if (!wrap || wrap.kind !== KIND_GIFT_WRAP) return 0;
  } catch (err) {
    log(`wrap failed (non-fatal): ${err && err.message}`);
    return 0;
  }

  try {
    await publishWrap(WS, mirrorRelay(), wrap, DEADLINE_MS);
  } catch (err) {
    log(`publish failed (non-fatal): ${err && err.message}`);
  }
  return 0;
}

// Hard kill-switch: never let the hook outlive its budget under any circumstance.
const guard = setTimeout(() => { try { process.exit(0); } catch { /* ignore */ } }, DEADLINE_MS + 1500);
if (typeof guard.unref === 'function') guard.unref();

main()
  .then((code) => process.exit(typeof code === 'number' ? code : 0))
  .catch((err) => { log(`fatal (swallowed): ${err && err.message}`); process.exit(0); });
