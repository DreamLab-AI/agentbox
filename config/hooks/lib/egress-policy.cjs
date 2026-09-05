'use strict';

/**
 * egress-policy.cjs — the JavaScript half of the ADR-2026 content-egress policy.
 *
 * The policy itself is `config/egress-policy.json`; this module IMPLEMENTS it
 * for the live-mirror path, and `services/nostr-pod-bridge/src/egress_policy.rs`
 * implements the same rules for the session-digest path. The two are kept
 * honest by a paired fixture (`tests/fixtures/egress-redaction.v1.json`) that
 * both must satisfy — a shared comment is not a shared contract.
 *
 * What the estate review found, and what this closes:
 *
 *   • There was no redaction stage between body selection and wrapping. A
 *     `password=` sentinel survived into the composed rumor for BOTH the
 *     explicit-recipient and child-key configurations. Encryption is not
 *     redaction: a gift wrap protects the body in transit and tells you nothing
 *     about what the body contains.
 *   • `AGENTBOX_LIVE_MIRROR=0` disabled one path. It was being read as proof
 *     that session content was not leaving, but the separately configured Rust
 *     digest path has its own gating. There is now ONE global switch that both
 *     obey.
 *   • Recipient syntax was checked but no enumerated allowlist existed.
 *   • Exit zero was indistinguishable between "disabled", "failed to send" and
 *     "delivered". The outcome vocabulary below makes those three different
 *     observable states.
 */

const OUTCOME = Object.freeze({
  SKIPPED: 'skipped',
  ATTEMPTED: 'attempted',
  ACCEPTED: 'accepted',
  FAILED: 'failed',
});

function isOff(v) { return String(v === undefined || v === null ? '' : v).trim() === '0'; }

/** 64-char lowercase hex — the canonical Nostr pubkey form (ADR-2011). */
function isHexPubkey(s) { return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s); }

/**
 * The configured recipient allowlist, or null when none is configured.
 * @param {object} env
 * @returns {Set<string>|null}
 */
function recipientAllowlist(env = process.env) {
  const raw = String(env.AGENTBOX_MIRROR_RECIPIENTS || '').trim();
  if (!raw) return null;
  const set = new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return set.size ? set : null;
}

/**
 * Is this recipient permitted to receive mirrored content?
 * @returns {{allowed:boolean, reason?:string}}
 */
function recipientAllowed(recipient, env = process.env) {
  if (!isHexPubkey(recipient)) {
    return { allowed: false, reason: 'malformed-recipient' };
  }
  const list = recipientAllowlist(env);
  if (list && !list.has(recipient)) {
    return { allowed: false, reason: 'recipient-not-allowlisted' };
  }
  return { allowed: true };
}

// ── redaction ───────────────────────────────────────────────────────────────
// Deliberately narrower and simpler than the trajectory redactor: this text is
// prose plus pasted fragments, not shell syntax, so there is no flag grammar to
// parse. It covers assignment, JSON/YAML, URI-embedded credentials, bearer
// headers and long hex/base64 runs — the forms that actually appear in session
// text — and it must match the Rust implementation case for case.

const SECRET_WORD = 'password|passwd|pwd|token|secret|api[-_]?key|apikey|auth|authorization|credential|credentials|nsec|private[-_]?key';

const RULES = [
  // scheme://user:secret@host  → keep the shape, lose the secret
  [/([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+):[^/\s@]+@/gi, '$1:<redacted>@'],
  // Authorization / Bearer headers — the whole value, not just the first token
  [/\b(Authorization)\s*:\s*[^"'\n,}]*/gi, '$1: <redacted>'],
  [/\b([Bb]earer)\s+[^\s"']+/g, '$1 <redacted>'],
  // JSON / YAML, quoted value consumed whole
  [new RegExp(`(["']?\\b(?:${SECRET_WORD})\\b["']?\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, 'gi'), '$1"<redacted>"'],
  [new RegExp(`(["']?\\b(?:${SECRET_WORD})\\b["']?\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`, 'gi'), '$1"<redacted>"'],
  // --flag "quoted value" / --flag='quoted'
  [new RegExp(`(--?(?:${SECRET_WORD})[=\\s])"(?:\\\\.|[^"\\\\])*"`, 'gi'), '$1<redacted>'],
  [new RegExp(`(--?(?:${SECRET_WORD})[=\\s])'(?:\\\\.|[^'\\\\])*'`, 'gi'), '$1<redacted>'],
  // KEY=value (env style, upper case)
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|PASSWD|PWD|SECRET)[A-Z0-9_]*)=([^\s"']+)/g, '$1=<redacted>'],
  // key=value (any case)
  [new RegExp(`\\b(${SECRET_WORD})\\s*=\\s*[^\\s"',}]+`, 'gi'), '$1=<redacted>'],
  // --flag value (unquoted)
  [new RegExp(`(--?(?:${SECRET_WORD})[=\\s])([^\\s"']+)`, 'gi'), '$1<redacted>'],
  // JSON / YAML unquoted value
  [new RegExp(`(["']?\\b(?:${SECRET_WORD})\\b["']?\\s*:\\s*)(?!["']?<redacted)([^\\s,}\\]"']+)`, 'gi'), '$1<redacted>'],
  // Long hex runs FIRST (nsec, pubkeys, digests). Deliberately the opposite
  // order to the trajectory redactor: the key material on THIS path is hex, and
  // a 64-char hex key is also a valid base64 character run, so hex-first gives
  // the accurate label. Anything reaching the base64 rule is redacted either way.
  [/\b[0-9a-fA-F]{32,}\b/g, '<redacted-hex>'],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '<redacted-b64>'],
];

/**
 * Redact text destined for egress.
 * Returns null when the input is not a string or redaction throws — the caller
 * MUST treat null as "do not send" (the policy's fail-closed invariant).
 *
 * @param {string} text
 * @returns {string|null}
 */
function redactForEgress(text) {
  if (typeof text !== 'string') return null;
  try {
    let out = text;
    for (const [re, repl] of RULES) out = out.replace(re, repl);
    return out;
  } catch {
    return null;
  }
}

/**
 * The egress decision for one path, BEFORE any content is composed or sent.
 *
 * @param {'live-mirror'|'session-digest'} pathId
 * @param {object} [opts]
 * @param {object} [opts.env]
 * @param {string|null} [opts.recipient]   the resolved recipient, when known
 * @param {boolean} [opts.identityPresent] whether a usable sender identity exists
 * @returns {{allowed:boolean, outcome:string, reason:string}}
 */
function egressDecision(pathId, opts = {}) {
  const env = opts.env || process.env;

  // The GLOBAL switch. This is the one the review found missing: it disables
  // every path in the policy, so an operator has a single thing to set and a
  // single thing to check.
  if (isOff(env.AGENTBOX_EGRESS)) {
    return { allowed: false, outcome: OUTCOME.SKIPPED, reason: 'egress-globally-disabled' };
  }
  const perPath = pathId === 'session-digest' ? env.AGENTBOX_SESSION_DIGEST : env.AGENTBOX_LIVE_MIRROR;
  if (isOff(perPath)) {
    return { allowed: false, outcome: OUTCOME.SKIPPED, reason: `${pathId}-disabled` };
  }
  // A disabled redactor is a disabled path. There is no configuration that
  // sends unredacted content.
  if (isOff(env.AGENTBOX_EGRESS_REDACTION)) {
    return { allowed: false, outcome: OUTCOME.SKIPPED, reason: 'redaction-disabled-so-egress-refused' };
  }
  if (opts.identityPresent === false) {
    return { allowed: false, outcome: OUTCOME.SKIPPED, reason: 'no-sender-identity' };
  }
  if (opts.recipient !== undefined && opts.recipient !== null) {
    const r = recipientAllowed(opts.recipient, env);
    if (!r.allowed) return { allowed: false, outcome: OUTCOME.SKIPPED, reason: r.reason };
  }
  return { allowed: true, outcome: OUTCOME.ATTEMPTED, reason: 'permitted' };
}

module.exports = {
  OUTCOME,
  isHexPubkey,
  recipientAllowlist,
  recipientAllowed,
  redactForEgress,
  egressDecision,
  SECRET_WORD,
};
