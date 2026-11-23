'use strict';

/**
 * lib/mandate-signer — the ONE authority that changes a pod's mandates (AB-11).
 *
 * Enforcing and revoking a mandate needs two signatures that must come from the
 * same key: the NIP-98 header on the ACL PUT/DELETE (only the pod's Control
 * holder may write an `.acl`), and the kind-30078 mandate event. That key is the
 * pod owner's, selected by the deterministic rule the pods adapter already uses
 * (`podSignerSource`, ADR-2078): the identity port's `core` key under role
 * isolation (ADR-2122), else a stack named explicitly, else the sovereign
 * identity the boot minted. It replaces the old `_loadSigner(stack)`, which
 * signed with whatever operator stack happened to be configured and silently
 * produced UNSIGNED mandates when there was none.
 *
 * Fail closed (ADR-2064 applied to mandates; amends ADR-043 D4.5):
 *
 *   - no signer → {@link SignerUnavailable}; the caller returns 503 and changes
 *     nothing. There is no unsigned grant and no unsigned revoke.
 *   - a signer whose pubkey is not the mandate's issuer/pod owner →
 *     `signer_mismatch`, same outcome. One authority per pod (design decision b).
 *   - nothing is cached negatively: a signer that was down is looked up afresh
 *     on the next call (the old `_signerCache = false` stuck for the process).
 *
 * This works even when `[integrations.solid_pod_rs].sign_requests` is off. That
 * flag governs the pods ADAPTER (it then goes out unsigned); a mandate must be
 * enforced at the pod regardless, so this module never reads it.
 *
 * @see lib/pod-signer.js  @see lib/identity-port.js  @see lib/mandate-acl.js
 */

const podSigner = require('./pod-signer');
const identityPort = require('./identity-port');

const PUBKEY_RE = /^[0-9a-f]{64}$/;
const CORE_KEY = 'core';

/** No usable pod-owner signer: the HTTP layer answers 503 `signer_unavailable`. */
class SignerUnavailable extends Error {
  /**
   * @param {string} message
   * @param {{ reason?: string, cause?: Error }} [info]
   */
  constructor(message, { reason = 'signer_unavailable', cause } = {}) {
    super(message);
    this.name = 'SignerUnavailable';
    this.code = 'signer_unavailable';
    this.reason = reason;
    if (cause) this.cause = cause;
  }
}

function bridgeModule(deps) {
  if (deps.bridge) return deps.bridge;
  // Vendored into lib/ at build time; the sibling mcp/ path resolves from a checkout.
  const candidates = [process.env.NOSTR_BRIDGE_PATH, './nostr-bridge', '../../mcp/servers/nostr-bridge',
    '/opt/agentbox/mcp/servers/nostr-bridge.js'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error(`nostr-bridge unresolvable (tried ${candidates.length} paths)`);
}

/** Decode `Nostr <base64(json)>` far enough to read the signing pubkey; null if it is not one. */
function headerPubkey(header) {
  if (typeof header !== 'string' || !header.startsWith('Nostr ')) return null;
  try {
    const ev = JSON.parse(Buffer.from(header.slice(6).trim(), 'base64').toString('utf8'));
    return typeof ev.pubkey === 'string' ? ev.pubkey.toLowerCase() : null;
  } catch { return null; }
}

/**
 * Where to connect to the pod, and which origin its NIP-98 matching expects.
 *
 * solid-pod-rs matches the signed `u` tag against its configured PUBLIC origin
 * (`public_base_url`) whatever address a request arrived on, and the identity
 * port signs only for `[integrations.solid_pod_rs].base_url`. So the signed
 * origin is `base_url` when set, and the connect origin is the local listener:
 * a loopback call signs the public URL (no tunnel round trip). With no
 * `base_url` the signed origin is the connect origin, and under the identity
 * port that is refused (its allowlist is unresolved) rather than guessed: the
 * request fails closed with `signer_unavailable`.
 *
 * @param {object} manifest
 * @param {object} [env]
 * @returns {{ connectBase: string, signedBase: string }}
 */
function podEndpoints(manifest, env = process.env) {
  const sp = (manifest && manifest.integrations && manifest.integrations.solid_pod_rs) || {};
  const bind = sp.bind && !['0.0.0.0', '::', '[::]'].includes(String(sp.bind)) ? sp.bind : '127.0.0.1';
  const connectBase = String(env.AGENTBOX_MANDATE_POD_URL || `http://${bind}:${sp.port || 8484}`).replace(/\/+$/, '');
  const signedBase = String(sp.base_url || connectBase).replace(/\/+$/, '');
  return { connectBase, signedBase };
}

function fromPort(deps, env) {
  const call = deps.portRequest || ((op, params) => identityPort.request(op, params, { env }));
  return (async () => {
    let info;
    try { info = await call('pubkey', { key: CORE_KEY }); } catch (err) {
      throw new SignerUnavailable(`identity port unavailable: ${err.message}`, { cause: err });
    }
    const pubkey = String(info && info.pubkey || '').toLowerCase();
    if (!PUBKEY_RE.test(pubkey)) throw new SignerUnavailable('identity port returned no public identity');
    return {
      source: 'identity-port',
      pubkey,
      async nip98(method, url, body) {
        const params = { key: CORE_KEY, method: String(method).toUpperCase(), url: String(url) };
        const payload = podSigner.payloadSha256(body);
        if (payload) params.payload_sha256 = payload;
        const res = await call('nip98', params);
        if (!res || typeof res.header !== 'string') throw new Error('identity port returned no header');
        return res.header;
      },
      async signEvent(unsigned) {
        // sign_event, NOT forum_event: caller 1000 holds the 30078 grant on `core`
        // only through sign_event, and the port refuses a 30078 that is not a
        // mandate envelope of this very key.
        const res = await call('sign_event', {
          key: CORE_KEY, kind: unsigned.kind, tags: unsigned.tags || [],
          content: unsigned.content || '', created_at: unsigned.created_at,
        });
        if (!res || !res.event) throw new Error('identity port returned no event');
        return res.event;
      },
    };
  })();
}

function fromKeySigner(signer, deps) {
  return (async () => {
    let pubkey = typeof signer.pubkey === 'string' ? signer.pubkey.toLowerCase() : null;
    if (!pubkey) {
      // Stack signers expose sign() only: learn the pubkey from a throwaway
      // signature that never leaves this process.
      const probe = await signer.sign({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [], content: '' });
      pubkey = String(probe && probe.pubkey || '').toLowerCase();
    }
    if (!PUBKEY_RE.test(pubkey)) throw new SignerUnavailable('signer returned no public identity');
    const { NostrBridge } = bridgeModule(deps);
    return {
      pubkey,
      nip98: (method, url, body) => NostrBridge.buildNip98Header(signer, method, url, { body }),
      signEvent: (unsigned) => signer.sign(unsigned),
    };
  })();
}

/**
 * Resolve the pod-owner signer for this process. Throws {@link SignerUnavailable}.
 *
 * @param {object} manifest - parsed agentbox.toml
 * @param {object} [deps] - injection seam for tests
 * @param {object} [deps.env]
 * @param {Function} [deps.portRequest]          - `(op, params) => Promise<object>`
 * @param {Function} [deps.loadSovereignSigner]  - `(opts) => signer`
 * @param {Function} [deps.loadSigner]           - `(stack, opts) => signer`
 * @param {object}   [deps.bridge]               - nostr-bridge module override
 * @returns {Promise<{ source: string, pubkey: string, nip98: Function, signEvent: Function }>}
 */
async function resolveMandateSigner(manifest, deps = {}) {
  const env = deps.env || process.env;
  const sel = podSigner.podSignerSource(manifest, env);
  if (sel.source === 'identity-port') {
    const s = await fromPort(deps, env);
    return s;
  }
  let signer;
  try {
    if (sel.source === 'stack') {
      const load = deps.loadSigner || ((stack, o) => bridgeModule(deps).loadSigner(stack, o));
      signer = load(sel.stack, deps.signerOpts || {});
    } else {
      const load = deps.loadSovereignSigner || ((o) => require('./agent-identity').loadSovereignSigner(o));
      signer = load({ env, ...(deps.signerOpts || {}) });
    }
  } catch (err) {
    // The cause names a file or loader, never key material (see pod-signer).
    throw new SignerUnavailable(`cannot load the ${sel.source} signer: ${err.message}`, { cause: err });
  }
  if (!signer || typeof signer.sign !== 'function') throw new SignerUnavailable(`the ${sel.source} signer is unusable`);
  const out = await fromKeySigner(signer, deps);
  return { source: sel.source, ...out };
}

/**
 * Preflight shared by grant and revoke: the signer exists, is the issuer (= pod
 * owner), and the NIP-98 header it actually produces carries that pubkey. Sends
 * nothing and changes nothing. Throws {@link SignerUnavailable}.
 *
 * @param {object} args
 * @param {object} args.signer       - from resolveMandateSigner
 * @param {string} args.issuerHex    - record.issuer pubkey (the pod owner)
 * @param {string} args.signedBase   - origin the pod matches NIP-98 against
 * @returns {Promise<void>}
 */
async function assertOwnerSigner({ signer, issuerHex, signedBase }) {
  if (!signer) throw new SignerUnavailable('no pod-owner signer is configured');
  if (String(signer.pubkey).toLowerCase() !== issuerHex) {
    throw new SignerUnavailable('the pod-owner signer is not the mandate issuer', { reason: 'signer_mismatch' });
  }
  let header;
  try {
    header = await signer.nip98('GET', `${signedBase}/`);
  } catch (err) {
    throw new SignerUnavailable(`cannot sign a NIP-98 header for the pod: ${err.message}`, { cause: err });
  }
  if (headerPubkey(header) !== issuerHex) {
    throw new SignerUnavailable('the NIP-98 header is not signed by the mandate issuer', { reason: 'signer_mismatch' });
  }
}

module.exports = {
  SignerUnavailable,
  resolveMandateSigner,
  assertOwnerSigner,
  podEndpoints,
  headerPubkey,
};
