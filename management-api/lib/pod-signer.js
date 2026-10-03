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
 * Signing source (ADR-2078) — chosen deterministically, never by fallback:
 *
 *   - **Sovereign identity (the default).** The container identity that
 *     `nostr-pod-bridge bootstrap` mints at boot phase 3,
 *     `<AGENTBOX_IDENTITY_ROOT>/<AGENTBOX_AGENT_ID>.json`
 *     (`/var/lib/agentbox/identities/agentbox-core.json`), read through
 *     `lib/agent-identity.loadSovereignSigner`. Its keypair is the one the
 *     bootstrap writes into the pod's ACL and DID documents, so it is the
 *     identity a default-deny pod accepts.
 *   - **Per-stack identity.** Only when a stack is named explicitly — the
 *     `AGENTBOX_STACK` env or `[integrations.solid_pod_rs].sign_stack` — for a
 *     profile that owns a distinct identity (`<profiles>/<stack>/nostr.key.enc`
 *     via nostr-bridge `loadSigner`). `AGENTBOX_PROFILE` no longer selects it:
 *     every harness wrapper exports that slug, and an ambient session hint must
 *     not divert pod writes away from the identity the pod trusts.
 *
 * A missing or unusable sovereign identity never falls through to the stack
 * path or to unsigned; the originator returns `null` and the adapter, which is
 * constructed with `requireSigned` from the same flag, throws
 * `SigningUnavailable` before any byte is sent (ADR-2064):
 *
 *   - `sign_requests` OFF → no signer is wanted; this returns `null` without
 *     touching any key material and the adapter goes out unsigned,
 *     byte-identical to the pre-signing baseline.
 *   - `sign_requests` ON  → a `null` header (key absent, unreadable,
 *     inconsistent) makes every request throw `SigningUnavailable`.
 *
 * **Identity port (custody X-1 step 1, ADR-2122).** Under
 * `[security].role_isolation` (manifest, or `AGENTBOX_ROLE_ISOLATION=1` as the
 * entrypoint exports it) — or when `[integrations.solid_pod_rs].sign_source =
 * "identity-port"` names it explicitly — the header comes from the identity
 * port: `nostr-pod-bridge sign-request nip98` over the unix socket, authorised
 * by this process's uid. It is then the ONLY source: no key file and no stack
 * key is ever read, so this process holds no key at all. A refused or absent
 * port (client exit 1 or 2, or any failure to answer) throws, and the adapter
 * turns that into `SigningUnavailable` with zero bytes sent (ADR-2064).
 *
 * There is no dev-profile relaxation: as recorded at ADR-2041, a grep across
 * agentbox for `AGENTBOX_DEV*` / `dev_profile` / `dev_mode` / `dev-profile`
 * finds no such flag, and ADR-2064 does not invent one.
 *
 * @see PRD-014 §4.2  @see ADR-005 §pods slot  @see ADR-2064  @see ADR-2078
 */

/**
 * @param {object} manifest - Parsed agentbox.toml.
 * @param {object} [deps]   - Injection seam for tests.
 * @param {object} [deps.bridge]                - nostr-bridge module override.
 * @param {Function} [deps.loadSigner]          - `(stack, opts) => signer` (per-stack source).
 * @param {Function} [deps.loadSovereignSigner] - `(opts) => signer` (sovereign source).
 * @param {Function} [deps.buildNip98Header]    - `(signer, method, url, opts) => Promise<string>`.
 * @param {object} [deps.env]                   - Environment override (defaults to process.env).
 * @param {object} [deps.signerOpts]            - Passed through to the selected loader.
 * @param {Function} [deps.onError]             - Invoked once if the key load fails.
 * @param {Function} [deps.signRequest]         - `(op, params, env) => Promise<{code, out}>`
 *   identity-port client override (defaults to spawning `nostr-pod-bridge sign-request`).
 * @returns {(null|function(string,string,*):Promise<string|null>)}
 */
function buildPodNip98(manifest, deps = {}) {
  const integ =
    (manifest && manifest.integrations && manifest.integrations.solid_pod_rs) || {};
  if (!integ.sign_requests) return null;

  const env = deps.env || process.env;
  if (identityPortSelected(manifest, integ, env)) {
    return buildPortNip98(deps.signRequest || spawnSignRequest, env);
  }
  const stack = env.AGENTBOX_STACK || integ.sign_stack || null;

  let bridge = null;
  const getBridge = () => {
    if (deps.bridge) return deps.bridge;
    if (!bridge) {
      // Vendored into lib/ at build time (flake buildPhaseExtra); the sibling
      // mcp/ path only resolves from the source checkout.
      try { bridge = require('./nostr-bridge'); }
      catch { bridge = require('../../mcp/servers/nostr-bridge'); }
    }
    return bridge;
  };
  const buildNip98Header =
    deps.buildNip98Header || ((...a) => getBridge().NostrBridge.buildNip98Header(...a));

  const signerOpts = deps.signerOpts || {};
  const load = stack
    ? () => (deps.loadSigner || ((s, o) => getBridge().loadSigner(s, o)))(stack, signerOpts)
    : () => (deps.loadSovereignSigner ||
        ((o) => require('./agent-identity').loadSovereignSigner(o)))({ env, ...signerOpts });
  const describe = stack
    ? `stack '${stack}'`
    : `sovereign identity ${require('./agent-identity').sovereignIdentityPath({ env, ...signerOpts })}`;

  let signer = null;
  let loadFailed = false;
  const getSigner = () => {
    if (signer || loadFailed) return signer;
    try {
      signer = load();
    } catch (err) {
      loadFailed = true;
      signer = null;
      if (deps.onError) {
        // Name the source and keep the cause; the cause never carries key
        // material (fs errors name paths; loaders name files, not contents).
        const wrapped = new Error(`pod-signer: cannot load ${describe}: ${err.message}`);
        wrapped.cause = err;
        deps.onError(wrapped);
      }
    }
    return signer;
  };

  return async function nip98(method, url, body) {
    const s = getSigner();
    if (!s) return null;
    return buildNip98Header(s, method, url, { body });
  };
}

/** Identity-port source selection: the flag forces it; `sign_source` may name it. */
function identityPortSelected(manifest, integ, env) {
  const sec = (manifest && manifest.security) || {};
  if (sec.role_isolation === true || String(env.AGENTBOX_ROLE_ISOLATION || '').trim() === '1') return true;
  return integ.sign_source === 'identity-port';
}

/** hex(sha256(body)) exactly as NostrBridge.buildNip98Header hashes it, or null. */
function payloadSha256(body) {
  if (body === undefined || body === null || body === '') return null;
  const buf = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  if (buf.length === 0) return null;
  return require('crypto').createHash('sha256').update(buf).digest('hex');
}

/**
 * The identity-port originator. Every failure throws with the port's own
 * reason; the reason never carries key material (the port holds none to give).
 */
function buildPortNip98(signRequest, env) {
  return async function nip98(method, url, body) {
    const params = { key: 'core', method: String(method).toUpperCase(), url: String(url) };
    const payload = payloadSha256(body);
    if (payload) params.payload_sha256 = payload;
    const { code, out } = await signRequest('nip98', params, env);
    let res = null;
    try { res = JSON.parse(String(out || '')); } catch { /* reported below */ }
    if (code === 0 && res && typeof res.header === 'string' && res.header.startsWith('Nostr ')) {
      return res.header;
    }
    const why = res && res.refused
      ? `refused: ${res.refused.reason || 'no reason'}`
      : res && res.unavailable
        ? `unavailable: ${res.unavailable.reason || 'no reason'}`
        : `client exit ${code}`;
    throw new Error(`identity port ${why}`);
  };
}

/** Default client: `nostr-pod-bridge sign-request <op>`, params on stdin. */
function spawnSignRequest(op, params, env) {
  const { spawn } = require('child_process');
  const bin = env.AGENTBOX_POD_BRIDGE_BIN || 'nostr-pod-bridge';
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawn(bin, ['sign-request', op], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      done({ code: 2, out: JSON.stringify({ unavailable: { reason: `cannot run ${bin}: ${err.code || err.message}` } }) });
      return;
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); done({ code: 2, out: '' }); }, 15000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ code: 2, out: JSON.stringify({ unavailable: { reason: `cannot run ${bin}: ${err.code || err.message}` } }) });
    });
    child.on('close', (code) => { clearTimeout(timer); done({ code: code === null ? 2 : code, out }); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(params));
  });
}

module.exports = { buildPodNip98, identityPortSelected };
