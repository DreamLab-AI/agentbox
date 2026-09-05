'use strict';

/**
 * lib/agent-event-auth — per-agent did:nostr verification for the
 * agent-action egress route (PRD-014 Seam B / B4).
 *
 * `POST /v1/agent-events/emit` (and `/batch`) lets any caller assert a
 * `source_urn`, so an action can be attributed to an agent that did not
 * perform it. This module verifies the caller's identity and derives the
 * acting agent's identity from that verification, so `source_urn` becomes
 * `did:nostr:<verified-pubkey>` — provable, not caller-asserted.
 *
 * Two verification paths (ADR-2042):
 *   1. A direct NIP-98 `Authorization: Nostr <event>` header, verified here
 *      via `NostrBridge.verifyNip98` against THIS request's method/url — the
 *      path for a caller that reaches management-api directly (no proxy).
 *   2. `X-Agentbox-Pubkey`, proxy-injected by `config/nip98-proxy/proxy.mjs`
 *      (AB-10.3). The proxy is the sole identity ingress at `:9096`: it
 *      verifies the caller (NIP-98 / NIP-07 session / break-glass) itself,
 *      strips any inbound copy of this header, and re-injects the verified
 *      pubkey (`proxy.mjs:986`) — a client cannot forge it through the
 *      proxy. For NIP-07 / break-glass callers the proxy replaces
 *      `Authorization` with a shared upstream bearer for the `/mgmt/` route
 *      (`proxy.mjs:845,995`), so no re-verifiable signature reaches this
 *      module on that hop — the header is the ONLY carrier of the verified
 *      per-caller identity in that case, hence path 2 exists. Path 2 is used
 *      only when path 1 did not apply (no `Nostr `-prefixed Authorization
 *      header) — a caller that DOES present a Nostr header must have it
 *      verify, or the request is rejected outright (a failed signature is
 *      never papered over by the header).
 *   Trust caveat (non-negotiable, see ADR-2042 Consequences): path 2 is
 *   sound only while (a) the proxy keeps stripping/re-injecting the header
 *   and (b) nothing but the proxy can reach management-api's port directly.
 *   (b) is NOT fully true today — `server.js` binds `0.0.0.0` in-container
 *   (R-003) and cross-container callers on the docker network need only the
 *   shared `MANAGEMENT_API_KEY` to pass the general auth gate before this
 *   module ever runs — so a holder of that key could also forge this
 *   header. That residual risk is documented, not silently assumed away;
 *   see the ADR for the accepted mitigation and follow-up.
 *
 * Gated by `AGENTBOX_AGENT_EVENT_AUTH` (set by flake.nix from
 * `[integrations.solid_pod_rs]`/`[sovereign_mesh]` manifest config; the same
 * flag is this module's own dev/hardened signal — see ADR-2044):
 *   - `off` (dev only, opt-in) → `{ ok:true, did:null }`; the route behaves
 *     exactly as before (caller-supplied / env-defaulted attribution). ADR-2044
 *     flips the module DEFAULT to `nip98`; `off` remains explicitly
 *     selectable via the env var.
 *   - `nip98` (default, ADR-2044) → one of the two paths above is required;
 *     the verified pubkey is returned as `did`.
 *
 * @see PRD-014 §4.1  @see mcp/servers/nostr-bridge.js verifyNip98
 * @see docs/INGRESS-identity.md Invariant 2 (X-Agentbox-Pubkey always
 *      proxy-injected, never trusted inbound)
 */

// ADR-2044: fail-closed by default. `POST /v1/agent-events/emit`/`batch` let
// a caller assert a `source_urn`; a default of 'off' meant any caller behind
// the general management-api auth gate (Bearer OR NIP-98 — see
// middleware/auth.js) could attribute an action to an agent that never acted,
// with zero identity check at this layer. 'off' stays explicitly selectable
// via AGENTBOX_AGENT_EVENT_AUTH for local/dev runs; agentbox.toml's
// [sovereign_mesh].agent_event_auth = "nip98" already matched this default,
// so no manifest-driven deployment's behaviour changes — only a boot that
// never set the env var (e.g. running management-api directly, outside the
// flake-composed image) now gets the hardened behaviour it was missing.
const DEFAULT_POLICY = 'nip98';

// 64 lowercase hex chars — the sole storage/URL identity format
// (INGRESS-identity.md "hex-canonical pubkey"). Anything else is ignored,
// never coerced or lower-cased for trust purposes.
const HEX64_LOWER = /^[0-9a-f]{64}$/;

function resolvePolicy(env = process.env) {
  return String(env.AGENTBOX_AGENT_EVENT_AUTH || DEFAULT_POLICY).toLowerCase();
}

function authHeaderOf(request) {
  const h = (request && request.headers) || {};
  return h.authorization || h.Authorization || null;
}

/**
 * Read the proxy-verified pubkey off `X-Agentbox-Pubkey`, if present and
 * well-formed. Returns null for anything that is not exactly 64 lowercase
 * hex chars — a malformed or forged-looking value is never partially
 * trusted (ADR-2042).
 * @param {object} request
 * @returns {string|null}
 */
function proxyVerifiedPubkey(request) {
  const h = (request && request.headers) || {};
  const raw = h['x-agentbox-pubkey'] ?? h['X-Agentbox-Pubkey'];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return HEX64_LOWER.test(value) ? value : null;
}

/**
 * Verify an agent-event emit request.
 *
 * @param {object} request - Fastify request (uses .headers and .url).
 * @param {object} [deps]
 * @param {object}   [deps.env]    - Environment override.
 * @param {string}   [deps.policy] - Force a policy (skips env resolution).
 * @param {Function} [deps.verify] - `(authHeader, method, url) => { valid, pubkey, error }`.
 * @returns {{ ok:boolean, status?:number, error?:string, did?:(string|null), pubkey?:(string|null) }}
 */
function verifyAgentEventRequest(request, deps = {}) {
  const env = deps.env || process.env;
  const policy = deps.policy || resolvePolicy(env);

  if (policy === 'off') return { ok: true, did: null, pubkey: null };
  if (policy !== 'nip98') {
    return { ok: false, status: 500, error: `unknown AGENTBOX_AGENT_EVENT_AUTH policy '${policy}'` };
  }

  const authHeader = authHeaderOf(request);
  const hasNip98Header = typeof authHeader === 'string' && authHeader.startsWith('Nostr ');

  // Only attempt a direct signature verification when a Nostr-prefixed
  // header is actually present. A Bearer (or absent) Authorization header
  // falls straight through to the proxy-header path below, rather than
  // being sent into verifyNip98 to fail on "malformed header" — that keeps
  // the two paths cleanly separated: a PRESENT but INVALID Nostr signature
  // is always rejected outright (never rescued by the header, ADR-2042).
  if (hasNip98Header) {
    // Vendored into lib/ at build time (flake buildPhaseExtra); the sibling
    // mcp/ path only resolves from the source checkout.
    let verify = deps.verify;
    if (!verify) {
      let bridgeMod;
      try { bridgeMod = require('./nostr-bridge'); }
      catch { bridgeMod = require('../../mcp/servers/nostr-bridge'); }
      verify = bridgeMod.NostrBridge.verifyNip98;
    }
    // The originator strips the query string from the signed `u` tag, so
    // compare against the path only (verifyNip98 accepts urlTag.endsWith(url)).
    const pathOnly = String((request && request.url) || '').split('?')[0];

    let result;
    try {
      result = verify(authHeader, 'POST', pathOnly);
    } catch (err) {
      return { ok: false, status: 401, error: `NIP-98 verification failed: ${err.message}` };
    }
    if (!result || !result.valid) {
      return { ok: false, status: 401, error: (result && result.error) || 'invalid NIP-98 auth' };
    }
    return { ok: true, did: `did:nostr:${result.pubkey}`, pubkey: result.pubkey };
  }

  // ADR-2042: no direct NIP-98 signature on this hop — trust the
  // proxy-verified identity carried in X-Agentbox-Pubkey, if present and
  // well-formed. This is the path for NIP-07 session / break-glass callers
  // proxied through :9096 (see module doc comment above for the trust
  // model and its documented caveat).
  const proxyPubkey = proxyVerifiedPubkey(request);
  if (proxyPubkey) {
    return { ok: true, did: `did:nostr:${proxyPubkey}`, pubkey: proxyPubkey };
  }

  return { ok: false, status: 401, error: 'NIP-98 Authorization header required' };
}

/**
 * Reconcile a caller-supplied source_urn against the verified identity.
 * @returns {{ ok:boolean, status?:number, error?:string }}
 */
function reconcileSourceUrn(claimed, verifiedDid) {
  if (!verifiedDid) return { ok: true };
  if (claimed && claimed !== verifiedDid) {
    return {
      ok: false,
      status: 403,
      error: `source_urn '${claimed}' does not match authenticated identity '${verifiedDid}'`,
    };
  }
  return { ok: true };
}

module.exports = { verifyAgentEventRequest, reconcileSourceUrn, resolvePolicy };
