'use strict';

/**
 * lib/agent-event-auth — per-agent did:nostr verification for the
 * agent-action egress route (PRD-014 Seam B / B4).
 *
 * `POST /v1/agent-events/emit` (and `/batch`) lets any caller assert a
 * `source_urn`, so an action can be attributed to an agent that did not
 * perform it. This module verifies a NIP-98 `Authorization` header on the
 * request and derives the acting agent's identity from the *signature*, so
 * `source_urn` becomes `did:nostr:<verified-pubkey>` — provable, not
 * caller-asserted.
 *
 * Gated by `AGENTBOX_AGENT_EVENT_AUTH` (set by flake.nix from
 * `[integrations.solid_pod_rs]`/`[sovereign_mesh]` manifest config):
 *   - `off` (default) → `{ ok:true, did:null }`; the route behaves exactly
 *     as before (caller-supplied / env-defaulted attribution). Zero
 *     behavioural change until the operator opts in.
 *   - `nip98` → a valid kind-27235 header is required; the verified pubkey
 *     is returned as `did`.
 *
 * @see PRD-014 §4.1  @see mcp/servers/nostr-bridge.js verifyNip98
 */

const DEFAULT_POLICY = 'off';

function resolvePolicy(env = process.env) {
  return String(env.AGENTBOX_AGENT_EVENT_AUTH || DEFAULT_POLICY).toLowerCase();
}

function authHeaderOf(request) {
  const h = (request && request.headers) || {};
  return h.authorization || h.Authorization || null;
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
  if (!authHeader) {
    return { ok: false, status: 401, error: 'NIP-98 Authorization header required' };
  }

  const verify =
    deps.verify || require('../../mcp/servers/nostr-bridge').NostrBridge.verifyNip98;
  // The originator strips the query string from the signed `u` tag, so compare
  // against the path only (verifyNip98 accepts urlTag.endsWith(url)).
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
