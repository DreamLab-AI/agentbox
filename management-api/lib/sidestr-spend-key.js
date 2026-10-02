'use strict';

/**
 * sidestr-spend-key — the per-agent spend key `k_spend` and its binding to the
 * identity key `k_id` (ADR-2101 D3/D4, ADR-2097 D3 as amended 2026-10-02).
 *
 * `k_id` is the agent's did:nostr key (agent-identity.js). It never spends.
 * `k_spend` is a second secp256k1 key, minted at spawn beside `k_id` from an
 * independent random seed (nostr-tools `generateSecretKey`), never derived
 * from `k_id`: a leaked spend key reveals nothing about the identity, and an
 * identity key reachable by every supervised program cannot reach the coins.
 * It is stored the way `k_id` is stored: 64 hex in a 0600 file in the identity
 * directory, one per chain:
 *
 *   <identityDir>/agent-spend-<chain name>-<did hex>.key
 *
 * The binding is the kind-38420 `sidestr-account-binding` event
 * (PROTOCOL-registry, ADR-2098 D2): addressable, signed by `k_id`, content the
 * spend pubkey, `d` = `<chain id>:<did hex>`, where the chain id is the 64-hex
 * id of the chain's kind-3500 event, or its genesis hash for a chain sealed
 * before sidestr 0.0.5 (then tagged `legacy`). It is written beside the key as
 * `<key>.binding.json` and published to relays fail-open; a payee inlines it in
 * its 402 offer so a payer can verify who it pays without a relay round trip.
 *
 * All signing and key generation is nostr-tools (noble secp256k1, BIP-340).
 * Nothing here prints, logs or returns a private key.
 */

const fs = require('fs');
const path = require('path');
const { SIDESTR_CHAINS, sidestrBindingD } = require('./pay402');

const BINDING_KIND = 38420;
const HEX64 = /^[0-9a-f]{64}$/;

let nostrTools = null;
function nt() {
  if (!nostrTools) nostrTools = require('nostr-tools');
  return nostrTools;
}

function _chain(chainId) {
  if (!Object.prototype.hasOwnProperty.call(SIDESTR_CHAINS, chainId)) {
    throw new Error(`sidestr-spend-key: chain ${chainId} is not compiled in`);
  }
  return SIDESTR_CHAINS[chainId];
}

function _identityDir(opts = {}) {
  return opts.identityDir || process.env.AGENTBOX_AGENT_IDENTITY_DIR || '/var/lib/agentbox/identities';
}

/**
 * Path of the spend-key file for one agent on one chain.
 *
 * @param {object} opts
 * @param {string} opts.chainId   - "sidestr:<name>"
 * @param {string} opts.didHex    - the agent's identity pubkey (64 hex)
 * @param {string} [opts.identityDir]
 * @returns {string}
 */
function spendKeyPath({ chainId, didHex, identityDir } = {}) {
  _chain(chainId);
  if (!HEX64.test(didHex || '')) throw new Error('sidestr-spend-key: didHex must be 64 hex');
  const name = chainId.slice('sidestr:'.length).replace(/[^a-z0-9-]/g, '_');
  return path.join(_identityDir({ identityDir }), `agent-spend-${name}-${didHex}.key`);
}

function _readHexKey(file) {
  try {
    const v = fs.readFileSync(file, 'utf8').trim().toLowerCase();
    return HEX64.test(v) ? v : null;
  } catch {
    return null;
  }
}

function _pub(secretHex) {
  return nt().getPublicKey(Uint8Array.from(Buffer.from(secretHex, 'hex')));
}

/**
 * Build and sign the kind-38420 binding. Pure apart from the signature's
 * auxiliary randomness: the event id is fixed by its inputs (known-answer
 * tested), the signature verifies but differs per call.
 *
 * @param {object} opts
 * @param {string} opts.idSecretHex   - k_id, 64 hex
 * @param {string} opts.spendPubkey   - k_spend's x-only pubkey, 64 hex
 * @param {string} opts.chainId
 * @param {number} opts.createdAt     - unix seconds
 * @returns {object} the signed event
 */
function buildBinding({ idSecretHex, spendPubkey, chainId, createdAt }) {
  const chain = _chain(chainId);
  if (!HEX64.test(idSecretHex || '') || !HEX64.test(spendPubkey || '')) {
    throw new Error('sidestr-spend-key: buildBinding needs a 64-hex identity key and spend pubkey');
  }
  const didHex = _pub(idSecretHex);
  if (didHex === spendPubkey) throw new Error('sidestr-spend-key: k_spend must differ from k_id (ADR-2101 D3)');
  const tags = [
    ['d', sidestrBindingD(chain, didHex)],
    ['alias', chainId],
    ['genesis', chain.genesisHash],
    chain.hash ? ['chain', chain.hash] : ['legacy', 'pre-0.0.5'],
    ['alt', `sidestr account binding: the spend key of did:nostr:${didHex} on ${chainId}`],
  ];
  return nt().finalizeEvent(
    { kind: BINDING_KIND, created_at: createdAt, tags, content: spendPubkey },
    Uint8Array.from(Buffer.from(idSecretHex, 'hex')),
  );
}

/**
 * Verify a Nostr event's id and signature on a fresh plain copy. nostr-tools
 * caches a successful verification on the event object under a symbol, and
 * object spread copies own symbols, so `{ ...verified, content: x }` would
 * otherwise report true without re-hashing.
 *
 * @returns {boolean}
 */
function verifyEventFresh(event) {
  if (!event || typeof event !== 'object') return false;
  const plain = {
    id: event.id, pubkey: event.pubkey, created_at: event.created_at,
    kind: event.kind, tags: event.tags, content: event.content, sig: event.sig,
  };
  try { return nt().verifyEvent(JSON.parse(JSON.stringify(plain))) === true; } catch { return false; }
}

/**
 * Check a binding event: kind, author, content, `d` tag, signature.
 *
 * @returns {boolean}
 */
function verifyBinding(event, { chainId, didHex, spendPubkey }) {
  try {
    const chain = _chain(chainId);
    if (!event || event.kind !== BINDING_KIND || event.pubkey !== didHex || event.content !== spendPubkey) return false;
    const d = (event.tags || []).find((t) => Array.isArray(t) && t[0] === 'd');
    if (!d || d[1] !== sidestrBindingD(chain, didHex)) return false;
    return verifyEventFresh(event);
  } catch {
    return false;
  }
}

/**
 * Load, or mint and persist, the spend key and binding for an agent identity.
 *
 * @param {object} opts
 * @param {{pubkey: string, keyPath: string}} opts.identity - from agent-identity.loadOrMint
 * @param {string} opts.chainId
 * @param {string} [opts.identityDir]
 * @param {function} [opts.now] - () => unix seconds
 * @returns {{did: string, spendPubkey: string, spendKeyPath: string, binding: object, minted: boolean}}
 */
function loadOrMintSpend({ identity, chainId, identityDir, now } = {}) {
  _chain(chainId);
  if (!identity || !HEX64.test(identity.pubkey || '') || !identity.keyPath) {
    throw new Error('sidestr-spend-key: an identity with pubkey and keyPath is required');
  }
  const idSecret = _readHexKey(identity.keyPath);
  if (!idSecret || _pub(idSecret) !== identity.pubkey) {
    throw new Error('sidestr-spend-key: the identity key file does not match the identity');
  }
  const dir = identityDir || path.dirname(identity.keyPath);
  const keyPath = spendKeyPath({ chainId, didHex: identity.pubkey, identityDir: dir });

  let spendSecret = _readHexKey(keyPath);
  let minted = false;
  if (!spendSecret) {
    spendSecret = Buffer.from(nt().generateSecretKey()).toString('hex');
    minted = true;
  }
  const spendPubkey = _pub(spendSecret);
  if (spendPubkey === identity.pubkey) throw new Error('sidestr-spend-key: k_spend must differ from k_id (ADR-2101 D3)');
  if (minted) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyPath, `${spendSecret}\n`, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(keyPath, 0o600);
  }
  spendSecret = null;

  const bindingPath = `${keyPath}.binding.json`;
  let binding = null;
  try { binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8')); } catch { binding = null; }
  if (!verifyBinding(binding, { chainId, didHex: identity.pubkey, spendPubkey })) {
    const t = now ? now() : Math.floor(Date.now() / 1000);
    binding = buildBinding({ idSecretHex: idSecret, spendPubkey, chainId, createdAt: t });
    fs.writeFileSync(bindingPath, `${JSON.stringify(binding, null, 1)}\n`, { mode: 0o644 });
  }
  return { did: `did:nostr:${identity.pubkey}`, spendPubkey, spendKeyPath: keyPath, binding, minted };
}

/**
 * Find an existing spend key for an identity (the payer path never mints).
 *
 * @returns {{spendPubkey: string, spendKeyPath: string, binding: object|null}|null}
 */
function findSpendKey({ didHex, chainId, identityDir } = {}) {
  let keyPath;
  try { keyPath = spendKeyPath({ chainId, didHex, identityDir }); } catch { return null; }
  const secret = _readHexKey(keyPath);
  if (!secret) return null;
  const spendPubkey = _pub(secret);
  let binding = null;
  try { binding = JSON.parse(fs.readFileSync(`${keyPath}.binding.json`, 'utf8')); } catch { binding = null; }
  if (binding && !verifyBinding(binding, { chainId, didHex, spendPubkey })) binding = null;
  return { spendPubkey, spendKeyPath: keyPath, binding };
}

/**
 * Publish a binding to relays. Fail-open: the binding is already on disk and
 * travels inline in every offer; a relay copy is for third parties. Counts a
 * relay only when it answers NIP-01 `["OK", <id>, true]`.
 *
 * Transport is the `ws` package (as routes/broker-bridge.js), not nostr-tools'
 * SimplePool: with Node 22's built-in WebSocket, SimplePool.close() on a relay
 * that failed to connect recurses through onerror → close until the stack
 * overflows, which would take the process down.
 *
 * @param {object} event
 * @param {string[]} relays
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=8000]
 * @param {function} [opts.WebSocket] - ws-compatible constructor (tests)
 * @returns {Promise<{ok: number, relays: number}>}
 */
async function publishBinding(event, relays, { timeoutMs = 8000, WebSocket } = {}) {
  if (!Array.isArray(relays) || relays.length === 0) return { ok: 0, relays: 0 };
  let WS = WebSocket;
  if (!WS) {
    try { WS = require('ws'); } catch { return { ok: 0, relays: relays.length }; }
  }
  const one = (url) => new Promise((resolve) => {
    let ws;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws && ws.terminate ? ws.terminate() : ws && ws.close(); } catch { /* ignore */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WS(url);
      ws.on('open', () => { try { ws.send(JSON.stringify(['EVENT', event])); } catch { finish(false); } });
      ws.on('message', (data) => {
        let m;
        try { m = JSON.parse(String(data)); } catch { return; }
        if (Array.isArray(m) && m[0] === 'OK' && m[1] === event.id) finish(m[2] === true);
      });
      ws.on('error', () => finish(false));
      ws.on('close', () => finish(false));
    } catch {
      finish(false);
    }
  });
  const results = await Promise.all(relays.map(one));
  return { ok: results.filter(Boolean).length, relays: relays.length };
}

module.exports = {
  BINDING_KIND,
  spendKeyPath,
  buildBinding,
  verifyBinding,
  verifyEventFresh,
  loadOrMintSpend,
  findSpendKey,
  publishBinding,
};
