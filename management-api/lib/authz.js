'use strict';

/**
 * lib/authz — the single canonical authorization policy for the management-api
 * sovereign surfaces (ADR-043 D4.5/D4.7, PRD-021 F3-5/F3-6; security-remediation
 * findings 2 & 3).
 *
 * Before this module the approval allowlist lived inline in
 * lib/authority-consumer.js (its old lines 160-171) and nothing enforced it on
 * the HTTP front doors — a *verified* NIP-98 request from ANY key could drive
 * /v1/approvals and /v1/mandate. Extracting the predicate here gives the relay
 * consumer and the HTTP routes ONE source of truth:
 *
 *   approvalAllowlist(manifest) → Set<hex>   the keys allowed to answer/approve
 *   operatorPubkey()            → hex | ''   the box operator's own x-only key
 *   isOperator(pk)              → bool        pk === the operator key
 *   isApprover(pk, manifest)    → bool        pk ∈ approvalAllowlist
 *   isSessionAgent(pk, id)      → bool        pk is the did bound to session id
 *   isBearer(request)           → bool        request authed by the operator bearer
 *   authenticatedPubkey(req)    → hex | null  the effective acting pubkey
 *   requireApprover(opts)       → preHandler  403 unless a NIP-98 allowlisted key
 *   requireOperator(opts)       → preHandler  403 unless the operator (nip98|bearer)
 *
 * The predicates are pure and env/manifest-driven; the preHandlers are Fastify
 * hooks that short-circuit with a typed 403. The global auth middleware
 * (middleware/auth.js) has already established `request.auth` (401 otherwise)
 * before any of these run — so a failure here is always an AUTHORISATION (403)
 * failure, never an authentication (401) one.
 *
 * @see lib/authority-consumer.js  (imports approvalAllowlist to build its `allow` Set)
 * @see routes/approvals.js        (finding 2 — approver-gated decide)
 * @see routes/mandate.js          (finding 3 — operator-only create/revoke/list)
 */

const fs = require('fs');
const path = require('path');

const HEX64 = /^[0-9a-f]{64}$/;

function _norm(pk) {
  return String(pk == null ? '' : pk).toLowerCase();
}

/** Extract a 64-hex x-only pubkey from a bare hex or a `did:nostr:<hex>` value. */
function _extractHex(value) {
  const s = _norm(value);
  if (HEX64.test(s)) return s;
  const m = s.match(/([0-9a-f]{64})/);
  return m ? m[1] : null;
}

/** The box operator's own x-only pubkey (hex), or '' when unset/malformed. */
function operatorPubkey() {
  const pk = _norm(process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || process.env.AGENTBOX_PUBKEY || '');
  return HEX64.test(pk) ? pk : '';
}

/**
 * approvalAllowlist(manifest) → Set<hex-pubkey>. The canonical set of keys
 * permitted to answer an authority-gate approval (release a kind-31402 gate with
 * a signed 31403) and to act as the operator's delegated approvers on the HTTP
 * surface. This is the EXACT Set lib/authority-consumer.js historically built
 * inline: the operator pubkey + `[sovereign_mesh.relay].allowed_pubkeys` + the
 * env `AGENTBOX_RELAY_ALLOWED_PUBKEYS` / `AGENTBOX_APPROVAL_ALLOWLIST`. Rebuilt
 * on each call so a manifest/env change is picked up without a restart; the set
 * is small so this is cheap.
 *
 * @param {object} [manifest] parsed agentbox.toml
 * @returns {Set<string>}
 */
function approvalAllowlist(manifest = {}) {
  const allow = new Set();
  const op = operatorPubkey();
  if (op) allow.add(op);

  const sm = (manifest && manifest.sovereign_mesh) || {};
  const relayCfg = sm.relay || {};
  const cfgAllow = Array.isArray(relayCfg.allowed_pubkeys) ? relayCfg.allowed_pubkeys : [];
  const envAllow = String(process.env.AGENTBOX_RELAY_ALLOWED_PUBKEYS || process.env.AGENTBOX_APPROVAL_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  for (const pk of [...cfgAllow, ...envAllow]) {
    const lower = _norm(pk);
    if (HEX64.test(lower)) allow.add(lower);
  }
  return allow;
}

/** True iff `pubkey` is the box operator's own key. */
function isOperator(pubkey /* , manifest */) {
  const pk = _norm(pubkey);
  const op = operatorPubkey();
  return HEX64.test(pk) && op !== '' && pk === op;
}

/** True iff `pubkey` is on the approval allowlist (operator or delegated approver). */
function isApprover(pubkey, manifest = {}) {
  const pk = _norm(pubkey);
  if (!HEX64.test(pk)) return false;
  return approvalAllowlist(manifest).has(pk);
}

/** True iff the request was authed by the operator bearer token (not NIP-98). */
function isBearer(request) {
  return !!(request && request.auth && request.auth.mode === 'bearer');
}

/**
 * The effective acting pubkey for an authenticated request:
 *   - NIP-98  → the signer's x-only pubkey (the identity that signed).
 *   - bearer  → the box operator pubkey (the bearer IS the operator's own key).
 *   - neither → null.
 */
function authenticatedPubkey(request) {
  const auth = (request && request.auth) || {};
  if (auth.mode === 'nip98') {
    const pk = _norm(auth.pubkey);
    return HEX64.test(pk) ? pk : null;
  }
  if (auth.mode === 'bearer') {
    const op = operatorPubkey();
    return op || null;
  }
  return null;
}

// ── Session-agent binding ────────────────────────────────────────────────────
//
// The sessions-boundary registry (routes/sessions-boundary.js) writes one JSON
// record per AoE session, each carrying the session's bound `did`/`pubkey` and
// its original `session_id`. isSessionAgent scans that registry and matches on
// the ORIGINAL id stored inside the record — deliberately independent of the
// on-disk filename scheme, so it stays correct across the finding-5 change that
// hashes the filename (the original id lives in the record either way).

function _sessionsDir() {
  const stateDir = process.env.AGENTBOX_STATE_DIR || '/var/lib/agentbox';
  return path.join(stateDir, 'sessions');
}

function _readSessionRecord(sessionId) {
  const dir = _sessionsDir();
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return null; }
  const want = String(sessionId);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    if (rec && String(rec.session_id) === want) return rec;
  }
  return null;
}

/**
 * True iff `pubkey` is the did:nostr bound to AoE session `sessionId` at the
 * session boundary. Matches either the record's `pubkey` field or the hex inside
 * its `did` (`did:nostr:<hex>`).
 */
function isSessionAgent(pubkey, sessionId) {
  const pk = _norm(pubkey);
  if (!HEX64.test(pk) || sessionId == null || sessionId === '') return false;
  const rec = _readSessionRecord(sessionId);
  if (!rec) return false;
  const boundPk = _extractHex(rec.pubkey);
  if (boundPk && boundPk === pk) return true;
  const boundDid = _extractHex(rec.did);
  if (boundDid && boundDid === pk) return true;
  return false;
}

// ── Fastify preHandlers ──────────────────────────────────────────────────────

/**
 * requireOperator — a preHandler that admits ONLY the box operator. The operator
 * proves itself either by a NIP-98 signature from the operator key, or by the
 * operator bearer (MANAGEMENT_API_KEY, which is the operator's own credential).
 * Any other authenticated principal gets a typed 403.
 *
 * @param {object} [opts]
 * @param {object} [opts.manifest]
 * @returns {(request, reply) => Promise<void>}
 */
function requireOperator(opts = {}) {
  const manifest = opts.manifest || {};
  return async function _requireOperator(request, reply) {
    const auth = (request && request.auth) || {};
    if (auth.mode === 'bearer') return; // operator's own bearer credential
    if (auth.mode === 'nip98' && isOperator(auth.pubkey, manifest)) return;
    return reply.code(403).send({
      error: 'forbidden_not_operator',
      message: 'This action is operator-only (ADR-043). Authenticate as the box operator — a NIP-98 signature from the operator key, or the operator bearer.',
    });
  };
}

/**
 * requireApprover — a preHandler that admits ONLY a NIP-98 signature from an
 * allowlisted approver key. A bearer (no signed identity) can never approve a
 * governance decision; a NIP-98 key off the allowlist is rejected 403.
 *
 * @param {object} [opts]
 * @param {object} [opts.manifest]
 * @param {Set<string>} [opts.allowlist] pre-built allowlist (else built from manifest)
 * @returns {(request, reply) => Promise<void>}
 */
function requireApprover(opts = {}) {
  const manifest = opts.manifest || {};
  const allowlist = opts.allowlist instanceof Set ? opts.allowlist : null;
  return async function _requireApprover(request, reply) {
    const auth = (request && request.auth) || {};
    if (auth.mode !== 'nip98' || !auth.pubkey) {
      return reply.code(403).send({
        error: 'forbidden_not_approver',
        message: 'Approval decisions require a NIP-98 signature from an allowlisted approver key (ADR-043 D4.7) — a bearer token cannot approve.',
      });
    }
    const ok = allowlist ? allowlist.has(_norm(auth.pubkey)) : isApprover(auth.pubkey, manifest);
    if (!ok) {
      return reply.code(403).send({
        error: 'forbidden_not_approver',
        message: 'This NIP-98 key is not on the approval allowlist (ADR-043 D4.7 — operator/allowlisted keys only).',
      });
    }
  };
}

module.exports = {
  approvalAllowlist,
  operatorPubkey,
  isOperator,
  isApprover,
  isSessionAgent,
  isBearer,
  authenticatedPubkey,
  requireApprover,
  requireOperator,
  // introspection / test hooks
  _extractHex,
  _readSessionRecord,
};
