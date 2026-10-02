'use strict';

/**
 * sidestr-rail — configuration, producer reads, the chain guard and the
 * inclusion watch for the sidestr payment rail (ADR-2097, amended 2026-10-02).
 *
 * Chain-agnostic by construction (owner decision 2026-10-02, SC1): the chain
 * is whatever `[payments.sidestr].chain_id` names, provided it is compiled
 * into pay402.SIDESTR_CHAINS, and the producer is `[payments.sidestr]
 * .producer_url`. Both estate chains are compiled in, so switching from
 * `sidestr:dreamlab` to the txbt4-sealed demo chain `sidestr:dreamlab-txbt4`
 * is those two config values.
 *
 * The producer interface used is the one every sidestr producer serves
 * (siding, sidestr/spec `fa86dac`): GET /chain.json, GET /tip,
 * GET /coins/<script> (confirmed UTXOs only, each with its height) and
 * GET /blocks.json (height → hash). There is no transaction lookup, so a
 * payment counts as included when the payee's script holds an output of the
 * payment's txid at a height, and that height's hash is the including block.
 */

const { SIDESTR_CHAINS, TESTNET_PARENTS } = require('./pay402');

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Resolve [payments.sidestr] from the parsed manifest. Never throws.
 *
 * The chain is keyed by name the way config/sidechain/run-producer.sh,
 * mirror-sync.sh and run-faucet.sh are: `SIDESTR_CHAIN` (e.g.
 * `dreamlab-txbt4`) overrides `chain_id`; the producer is `producer_url` when
 * it is given for the configured chain, else `http://127.0.0.1:<port>` with
 * port `SIDESTR_PORT`, 3450 for `dreamlab` (run-producer.sh's default) or
 * `[sidechain.<name>].port`. The mirror is the chain's `announce_mirror`.
 * `[sidechain.<name>].enabled` is not read: paying is not producing.
 *
 * @param {object} manifest
 * @param {object} [env=process.env]
 * @returns {{enabled: boolean, reason: string|null, chain_id?: string, chain_name?: string,
 *            chain?: object, producer_url?: string, mirror_url?: string|null,
 *            relays?: string[], settle_timeout_s?: number}}
 */
function railConfig(manifest, env = process.env) {
  const t = manifest && manifest.payments && manifest.payments.sidestr;
  if (!t || typeof t !== 'object') return { enabled: false, reason: 'payments.sidestr absent' };
  if (t.enabled !== true) return { enabled: false, reason: 'payments.sidestr.enabled is false' };
  const fromEnv = typeof env.SIDESTR_CHAIN === 'string' && env.SIDESTR_CHAIN.trim() !== '';
  const chainId = fromEnv ? `sidestr:${env.SIDESTR_CHAIN.trim()}` : t.chain_id;
  if (!Object.prototype.hasOwnProperty.call(SIDESTR_CHAINS, chainId)) {
    return { enabled: false, reason: `chain ${chainId} is not compiled in (pay402.js SIDESTR_CHAINS)` };
  }
  const name = chainId.slice('sidestr:'.length);
  const sc = (manifest && manifest.sidechain) || {};
  const table = name === 'dreamlab' ? sc : (sc[name] && typeof sc[name] === 'object' ? sc[name] : {});

  let producer = null;
  if (typeof t.producer_url === 'string' && chainId === t.chain_id && !env.SIDESTR_PORT) {
    producer = t.producer_url;
  } else {
    const port = env.SIDESTR_PORT ? Number(env.SIDESTR_PORT) : (name === 'dreamlab' ? 3450 : table.port);
    if (Number.isInteger(port) && port > 0 && port < 65536) producer = `http://127.0.0.1:${port}`;
  }
  let url;
  try { url = producer ? new URL(producer) : null; } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    return { enabled: false, reason: `no producer for ${chainId}: set payments.sidestr.producer_url or [sidechain.${name}].port` };
  }
  return {
    enabled: true,
    reason: null,
    chain_id: chainId,
    chain_name: name,
    chain: SIDESTR_CHAINS[chainId],
    producer_url: String(producer).replace(/\/+$/, ''),
    mirror_url: typeof t.mirror_url === 'string' ? t.mirror_url
      : (typeof table.announce_mirror === 'string' ? table.announce_mirror : null),
    relays: Array.isArray(t.relays) ? t.relays.filter((r) => typeof r === 'string' && /^wss?:\/\//.test(r)) : [],
    settle_timeout_s: Number.isInteger(t.settle_timeout_s) && t.settle_timeout_s > 0 ? t.settle_timeout_s : 120,
  };
}

/**
 * A small producer client over an injectable fetch.
 *
 * @param {string} baseUrl
 * @param {object} [opts]
 * @param {function} [opts.fetch=globalThis.fetch]
 * @param {number} [opts.timeoutMs=10000]
 */
function createProducer(baseUrl, { fetch: f = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  async function get(p) {
    const res = await f(`${base}${p}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`producer ${p} answered ${res.status}`);
    return res.json();
  }
  return {
    base,
    chainDocument: () => get('/chain.json'),
    tip: () => get('/tip'),
    coins: (script) => {
      if (!/^[0-9a-f]+$/.test(script)) throw new Error('script must be hex');
      return get(`/coins/${script}`);
    },
    blocks: () => get('/blocks.json'),
    checkpoints: () => get('/checkpoints.json'),
  };
}

/**
 * Refuse a producer whose chain document is not the compiled chain: same
 * alias, same genesis, same testnet parent. Runs before every payment, so a
 * misconfigured producer_url can never move value on another chain.
 *
 * @param {object} doc      - the producer's /chain.json
 * @param {string} chainId
 * @throws {Error} with code 'chain-guard'
 */
function guardChain(doc, chainId) {
  const want = SIDESTR_CHAINS[chainId];
  const fail = (why) => { const e = new Error(`chain guard: ${why}`); e.code = 'chain-guard'; throw e; };
  if (!want) fail(`${chainId} is not compiled in`);
  if (!doc || typeof doc !== 'object') fail('the producer served no chain document');
  if (doc.id !== chainId) fail(`the producer serves ${doc.id}, not ${chainId}`);
  if (doc.genesisHash !== want.genesisHash) fail(`genesis ${doc.genesisHash} is not the compiled ${want.genesisHash}`);
  if (doc.parent !== want.parent || !TESTNET_PARENTS.includes(doc.parent)) fail(`parent ${doc.parent} is not the compiled testnet parent ${want.parent}`);
  if (doc.addressPrefix !== undefined && doc.addressPrefix !== want.addressPrefix) fail(`address prefix ${doc.addressPrefix} is not ${want.addressPrefix}`);
}

/**
 * Wait until the payee's script holds an output of `txid` worth at least
 * `minValue` in a block. Returns the inclusion or null on timeout.
 *
 * @returns {Promise<{outpoint: string, value: number, height: number, blockHash: string}|null>}
 */
async function waitForInclusion({ producer, script, txid, minValue, timeoutMs = 120000, intervalMs = 2000, sleep }) {
  if (!HEX64.test(txid)) throw new Error('txid must be 64 hex');
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let coins = [];
    try { coins = await producer.coins(script); } catch { coins = []; }
    const hit = Array.isArray(coins)
      ? coins.find((c) => c && typeof c.outpoint === 'string' && c.outpoint.startsWith(`${txid}:`) && Number(c.value) >= minValue && Number.isInteger(c.height))
      : null;
    if (hit) {
      const index = await producer.blocks();
      const block = (index && Array.isArray(index.blocks) ? index.blocks : []).find((b) => b.height === hit.height);
      if (block && HEX64.test(block.hash)) {
        return { outpoint: hit.outpoint, value: Number(hit.value), height: hit.height, blockHash: block.hash };
      }
    }
    if (Date.now() >= deadline) return null;
    await pause(intervalMs);
  }
}

/**
 * Journal one side effect as an ADR-2071 pair: `tool.called`, then
 * `tool.completed` whose causation names it, under the payment's URN. The
 * completed event is written whether the effect succeeds or throws.
 *
 * @param {object} journal  - ExecutionJournal
 * @param {object} base     - { session_urn, agent_did }
 * @param {string} tool     - e.g. 'sidestr.send'
 * @param {object} args     - recorded in tool.called (never key material)
 * @param {function} fn     - async () => result (recorded in tool.completed)
 */
async function journalled(journal, base, tool, args, fn) {
  const called = await journal.append({
    session_urn: base.session_urn, agent_did: base.agent_did, harness: 'management-api',
    turn: 0, type: 'tool.called', payload: { tool, args },
  });
  const causation = called.envelope.event_id;
  try {
    const result = await fn();
    await journal.append({
      session_urn: base.session_urn, agent_did: base.agent_did, harness: 'management-api',
      turn: 0, type: 'tool.completed', causation, payload: { tool, ok: true, result },
    });
    return result;
  } catch (err) {
    await journal.append({
      session_urn: base.session_urn, agent_did: base.agent_did, harness: 'management-api',
      turn: 0, type: 'tool.completed', causation, payload: { tool, ok: false, error: String(err && err.message).slice(0, 400) },
    });
    throw err;
  }
}

/** The header a paid retry carries, and its parser (payee side). */
const PAYMENT_HEADER = 'x-sidestr-payment';

function formatPaymentHeader({ txid, memo, receiptUrn }) {
  return `txid=${txid}; memo=${memo}${receiptUrn ? `; receipt=${receiptUrn}` : ''}`;
}

function parsePaymentHeader(value) {
  if (typeof value !== 'string' || value.length > 600) return null;
  const out = {};
  for (const part of value.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return HEX64.test(out.txid || '') && typeof out.memo === 'string' ? { txid: out.txid, memo: out.memo, receiptUrn: out.receipt || null } : null;
}

module.exports = {
  railConfig,
  createProducer,
  guardChain,
  waitForInclusion,
  journalled,
  PAYMENT_HEADER,
  formatPaymentHeader,
  parsePaymentHeader,
};
