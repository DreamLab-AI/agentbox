'use strict';

/**
 * lib/pod-signer — build the NIP-98 originator for the pods adapter.
 *
 * Gated by `[integrations.solid_pod_rs].sign_requests` in agentbox.toml.
 * When enabled, returns an `async (method, url, body) => header` function
 * that the pods adapter attaches to every request so an autonomous agent
 * authenticates to a default-deny Solid pod under its OWN `did:nostr`
 * (PRD-014 Seam C / C2). The signing key is loaded lazily and cached.
 *
 * Fail-open at the adapter layer: when signing is disabled, no stack is
 * resolvable, or the key cannot be decrypted, this returns `null` and the
 * adapter goes out unsigned exactly as before — the pod itself still fails
 * closed if it requires auth. This keeps default (unsigned) behaviour
 * byte-identical so enabling the flag is the only behavioural change.
 *
 * @see PRD-014 §4.2  @see ADR-005 §pods slot
 */

/**
 * @param {object} manifest - Parsed agentbox.toml.
 * @param {object} [deps]   - Injection seam for tests.
 * @param {object} [deps.bridge]            - nostr-bridge module override.
 * @param {Function} [deps.loadSigner]      - `(stack, opts) => signer`.
 * @param {Function} [deps.buildNip98Header]- `(signer, method, url, opts) => Promise<string>`.
 * @param {object} [deps.env]               - Environment override (defaults to process.env).
 * @param {object} [deps.signerOpts]        - Passed through to loadSigner.
 * @param {Function} [deps.onError]         - Invoked once if key load fails.
 * @returns {(null|function(string,string,*):Promise<string|null>)}
 */
function buildPodNip98(manifest, deps = {}) {
  const integ =
    (manifest && manifest.integrations && manifest.integrations.solid_pod_rs) || {};
  if (!integ.sign_requests) return null;

  const env = deps.env || process.env;
  const stack =
    env.AGENTBOX_STACK || env.AGENTBOX_PROFILE || integ.sign_stack || null;
  if (!stack) {
    if (deps.onError) {
      deps.onError(
        new Error(
          'pod-signer: sign_requests is on but no stack resolved ' +
            '(set AGENTBOX_STACK or integrations.solid_pod_rs.sign_stack)'
        )
      );
    }
    return null;
  }

  let bridge = null;
  const getBridge = () => {
    if (deps.bridge) return deps.bridge;
    if (!bridge) bridge = require('../../mcp/servers/nostr-bridge');
    return bridge;
  };
  const loadSigner = deps.loadSigner || ((s, o) => getBridge().loadSigner(s, o));
  const buildNip98Header =
    deps.buildNip98Header || ((...a) => getBridge().NostrBridge.buildNip98Header(...a));

  let signer = null;
  let loadFailed = false;
  const getSigner = () => {
    if (signer || loadFailed) return signer;
    try {
      signer = loadSigner(stack, deps.signerOpts || {});
    } catch (err) {
      loadFailed = true;
      signer = null;
      if (deps.onError) deps.onError(err);
    }
    return signer;
  };

  return async function nip98(method, url, body) {
    const s = getSigner();
    if (!s) return null;
    return buildNip98Header(s, method, url, { body });
  };
}

module.exports = { buildPodNip98 };
