'use strict';

/**
 * /v1/chain/info — the sidestr chain this deployment produces, as a `chain`
 * URN record (ADR-2098, amended 2026-10-02 for sidestr SPEC 0.0.5).
 *
 * A chain has two names with two roles (SPEC 3, 11). The hash is the id of its
 * kind-3500 chain event: the identity, what a `urn:agentbox:chain:` URN is keyed
 * by. The alias `sidestr:<name>` is for people and tags. This route returns
 * them separately, with the genesisHash as a cross-check:
 *
 *   { alias, hash, display, urn, genesisHash, signer, parent, legacy, chainEvent }
 *
 * `hash`, `display` and `urn` are null, and `legacy` true, until the signer has
 * published the chain event and `chain-event.json` sits beside the chain
 * document (where upstream's `siding chain-event` writes it and its producer
 * reads it). Read-only: this route never makes, signs or publishes an event.
 *
 * `?hash=<64 hex>` asks for one chain by hash. A hash other than this chain's
 * is a 404, never an answer about a different chain: a resolver does not
 * redirect one id to another.
 *
 * Self-gating: 503 when `[sidechain].enabled` is false. Auth is the global
 * NIP-98/bearer preValidation hook. Not a settlement path, so the ADR-2100
 * authority gate (spends, peg-outs, funding, redemption) does not apply.
 *
 * Paths: `SIDESTR_DOC` (the sealed chain document, default
 * config/sidechain/dreamlab/chain.json) and `SIDESTR_CHAIN_EVENT` (default
 * chain-event.json beside the document); both overridable by route options.
 */

const fs = require('fs');
const path = require('path');
const uris = require('../lib/uris');

const DEFAULT_DOC = path.resolve(__dirname, '..', '..', 'config', 'sidechain', 'dreamlab', 'chain.json');

let nostrTools = null;
function defaultVerify(event) {
  if (!nostrTools) nostrTools = require('nostr-tools');
  return nostrTools.verifyEvent(event) === true;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Load the configured chain's record. Returns `{ record, document, eventPresent }`
 * or throws with a `statusCode` and a reason.
 */
function loadChain({ docPath, eventPath, verify }) {
  let document;
  try {
    document = readJson(docPath);
  } catch (err) {
    const e = new Error(`chain document unreadable at ${docPath}: ${err.message}`);
    e.statusCode = 503; e.code = 'chain-document-unavailable';
    throw e;
  }
  let event = null;
  if (fs.existsSync(eventPath)) {
    try {
      event = readJson(eventPath);
    } catch (err) {
      const e = new Error(`chain event unreadable at ${eventPath}: ${err.message}`);
      e.statusCode = 500; e.code = 'chain-event-invalid';
      throw e;
    }
  }
  try {
    // An event that is present but does not verify, or names another chain, is
    // an error: falling back to the legacy record would hide it.
    return { record: uris.chainRecord({ document, event, verify }), document, eventPresent: !!event };
  } catch (err) {
    const e = new Error(err.message);
    e.statusCode = 500; e.code = event ? 'chain-event-invalid' : 'chain-document-invalid';
    throw e;
  }
}

async function chainRoutes(fastify, options = {}) {
  const { manifest = {} } = options;
  const enabled = !!(manifest.sidechain && manifest.sidechain.enabled);
  const docPath = options.docPath || process.env.SIDESTR_DOC || DEFAULT_DOC;
  const eventPath = options.eventPath || process.env.SIDESTR_CHAIN_EVENT || path.join(path.dirname(docPath), 'chain-event.json');
  const verify = options.verify || defaultVerify;

  fastify.get('/v1/chain/info', async (req, reply) => {
    if (!enabled) {
      reply.code(503).send({ error: 'sidechain disabled', gate: 'sidechain.enabled' });
      return;
    }
    let loaded;
    try {
      loaded = loadChain({ docPath, eventPath, verify });
    } catch (err) {
      reply.code(err.statusCode || 500).send({ error: err.code || 'chain-unavailable', message: err.message });
      return;
    }
    const { record, document, eventPresent } = loaded;
    const asked = req.query && req.query.hash;
    if (asked !== undefined) {
      if (!uris.resolveChain({ hash: asked }, [record])) {
        reply.code(404).send({ error: 'unknown-chain', hash: String(asked), reason: 'no chain with this hash here; a hash is never resolved to another chain' });
        return;
      }
    }
    reply.send({
      alias: record.alias,
      hash: record.hash,
      display: record.display,
      urn: record.urn,
      genesisHash: record.genesisHash,
      signer: record.signer,
      parent: typeof document.parent === 'string' ? document.parent : null,
      legacy: record.legacy,
      chainEvent: eventPresent ? 'present' : 'absent',
    });
  });
}

module.exports = chainRoutes;
module.exports.loadChain = loadChain;
