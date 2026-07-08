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

// ── REC-9: provenance to the pocket (PRD-019 / ADR-037 D5) ───────────────────
// The live mirror carries readable turn text; REC-9 adds a signed-adjacent
// urn:agentbox:activity reference INSIDE the already gift-wrap-sealed rumor, so
// the recipient can resolve the DM back to the underlying execution record
// (/v1/uri/<urn> → 307 → /v1/agent-events). Minted via the canonical minter
// (ADR-013) — no second signature, no second event, within the body cap.

/** Load the canonical URI minter (lib/uris.js). Fail-open null; no external deps. */
function loadUris() {
  const here = __dirname;
  const candidates = [
    path.resolve(here, '..', '..', 'management-api', 'lib', 'uris.js'),
    path.resolve(here, '..', '..', 'mcp', 'servers', 'lib', 'uris.js'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  return null;
}

/**
 * Scope pubkey for the activity urn (BIP-340 x-only hex). Same precedence the
 * digest producer uses so the two egress paths mint the SAME reference for a
 * session; falls back to the all-zero dev pubkey when no identity is set (the
 * convention consultant-base.js and the orchestrator adapters use).
 */
function activityScopePubkey() {
  const candidate = envFirst('AGENTBOX_AGENT_PUBKEY', 'AGENTBOX_PUBKEY', 'AGENTBOX_ADMIN_PUBKEY')
    || (envFirst('AGENTBOX_AGENT_DID') || '').replace(/^did:nostr:/, '')
    || (envFirst('AGENTBOX_DID') || '').replace(/^did:nostr:/, '');
  const lc = String(candidate).toLowerCase();
  return /^[0-9a-f]{64}$/.test(lc) ? lc : '0'.repeat(64);
}

/**
 * Mint the session's urn:agentbox:activity reference, deterministic on the
 * session id + scope, so every turn of a session shares one urn and the
 * SessionEnd digest (nostr-pod-bridge) mirrors the identical reference. Returns
 * '' (fail-open, text-only) on any error or when there is no session id.
 */
function mintActivityUrn(uris, payload) {
  try {
    if (!uris || typeof uris.mint !== 'function') return '';
    const session_id = String((payload && payload.session_id) || '').trim();
    if (!session_id) return '';
    return uris.mint({
      kind:    'activity',
      pubkey:  activityScopePubkey(),
      payload: { surface: 'session', session_id },
    });
  } catch { return ''; }
}

/**
 * Compose the final rumor body: the turn text plus the provenance reference,
 * guaranteed within MAX_BODY_CHARS with the urn NEVER truncated. When no urn is
 * available, degrades to the original text-only cap behaviour (fail-open).
 */
function composeBody(text, urn) {
  const base = String(text || '');
  if (!urn) {
    return base.length > MAX_BODY_CHARS ? `${base.slice(0, MAX_BODY_CHARS)}…` : base;
  }
  const ref = `\n\n⛓ ${urn}`;
  const budget = MAX_BODY_CHARS - ref.length;
  if (budget <= 0) {
    // The reference alone exceeds the cap (a urn is short, so this is only
    // reachable with an absurd cap) — never drop provenance; ship the ref.
    return ref.replace(/^\n+/, '');
  }
  let head = base;
  if (head.length > budget) head = `${head.slice(0, Math.max(0, budget - 1))}…`;
  return head + ref;
}

/**
 * Deterministic single-purpose mirror key derived from the operator key:
 *   child_sk = HMAC-SHA256(operator_sk, AGENTBOX_MIRROR_KEY_TAG | "agentbox-mirror-v1")
 * Domain-separated and rotatable (bump the tag). This keeps the ROOT operator
 * key OFF the phone — the device holds only this child, signs nothing of
 * consequence with it, and the mirror is a self-DM on the child identity.
 * Returns null when child mode is off (AGENTBOX_MIRROR_CHILD=0) or no operator
 * key is present, in which case the legacy operator-self-DM path is used.
 */
let _childCache;
function deriveChildKey() {
  if (_childCache !== undefined) return _childCache;
  if (String(process.env.AGENTBOX_MIRROR_CHILD || '').trim() === '0') { _childCache = null; return null; }
  const hex = envFirst('AGENTBOX_PRIVKEY_HEX', 'AGENTBOX_BRIDGE_SK', 'OPERATOR_NOSTR_PRIVKEY');
  if (!/^[0-9a-f]{64}$/i.test(hex)) { _childCache = null; return null; }
  const tag = envFirst('AGENTBOX_MIRROR_KEY_TAG') || 'agentbox-mirror-v1';
  try {
    const d = crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update(tag).digest();
    _childCache = Uint8Array.from(d);
  } catch { _childCache = null; }
  return _childCache;
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

  // Gate: explicit off switch → no-op. We then need EITHER a derivable child
  // key (default, preferred) OR an explicit recipient pubkey (legacy).
  if (String(process.env.AGENTBOX_LIVE_MIRROR || '').trim() === '0') return 0;
  const childSk = deriveChildKey();
  const explicitRecipient = recipientPubkey();
  if (!childSk && !explicitRecipient) return 0;

  const raw = await readStdin();
  let payload = {};
  if (raw && raw.trim()) {
    try { payload = JSON.parse(raw); } catch { payload = {}; }
  }

  let body = bodyForEvent(event, payload);
  if (!body || !body.trim()) return 0;

  // REC-9: append the session's urn:agentbox:activity provenance reference,
  // minted via lib/uris.js (ADR-013), INSIDE the rumor body and within the cap.
  // Fail-open: an unmintable/missing urn degrades to text-only, never blocks.
  const activityUrn = mintActivityUrn(loadUris(), payload);
  body = composeBody(body, activityUrn);

  // Dry-run affordance (operator / CI smoke test): compose the sealed body and
  // print it to stderr WITHOUT any network egress, then exit 0. Lets a mirror
  // smoke test observe the provenance reference without publishing to the relay.
  if (String(process.env.AGENTBOX_MIRROR_DRY_RUN || '').trim() === '1') {
    const to = explicitRecipient || (childSk ? 'child-self-dm' : 'none');
    log(`DRY-RUN (${event}) recipient=${to} urn=${activityUrn || '(none — text-only)'} body:\n${body}`);
    return 0;
  }

  const tools = loadNostrTools();
  const WS = loadWs();
  if (!tools || !tools.nip59 || typeof tools.nip59.wrapEvent !== 'function' || !WS) {
    log('nostr-tools/ws unavailable; skipping mirror');
    return 0;
  }

  let wrap;
  try {
    // Default: a SELF-DM on the derived child identity — the root operator key
    // never reaches the phone. Legacy fallback: operator-signed DM to an
    // explicit recipient pubkey.
    const sk = childSk || senderSecretKey(tools);
    const recipient = childSk ? tools.getPublicKey(childSk) : explicitRecipient;
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

// Exported for unit tests. The CLI entrypoint (guard + main) runs ONLY when the
// hook is invoked directly, so a `require()` in a test never spawns the publish
// path or the process-exit guard.
module.exports = {
  composeBody,
  mintActivityUrn,
  activityScopePubkey,
  bodyForEvent,
  MAX_BODY_CHARS,
};

if (require.main === module) {
  // Hard kill-switch: never let the hook outlive its budget under any circumstance.
  const guard = setTimeout(() => { try { process.exit(0); } catch { /* ignore */ } }, DEADLINE_MS + 1500);
  if (typeof guard.unref === 'function') guard.unref();

  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((err) => { log(`fatal (swallowed): ${err && err.message}`); process.exit(0); });
}
