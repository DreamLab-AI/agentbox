'use strict';

/**
 * /v1/mandate — scoped WAC agent-delegation mandates (ADR-043 D4.5,
 * PRD-021 F3-5, DDD-019 §MandatePort).
 *
 * Mounts the complete-but-previously-routeless lib/mandate.js as a REST
 * surface and adds the LAZY mint-if-absent helper the pod-write path uses.
 *
 * A mandate is the signed, revocable record by which the operator grants a
 * session's `did:nostr` write/append authority over ONE pod container, so the
 * session writes under its own DID and never holds the operator's nsec
 * (lib/mandate.js). Per the operator decision (ADR-043 D4.5) mandate scope is
 * LAZY: a session's mandate is minted on its FIRST pod write, scoped to the
 * container being written — `ensureMandate()` below is that mint-if-absent
 * path, exported for the pods dispatch. Sessions known to be pod-writers carry
 * `eager_mandate = true` in their seed and are minted at the session boundary
 * instead (routes/sessions-boundary.js honours the flag), degrading lazy into
 * eager per-seed rather than globally.
 *
 * Every mandate URN is minted through lib/uris.js inside createMandate()
 * (ADR-013, N-07); the signed envelope is a revocable kind-30078 replaceable
 * event (NIP-33 (pubkey, kind, d-tag) triple), so revocation is a re-publish
 * under the same d-tag with `{ revoked: true }`.
 *
 * Routes:
 *   POST /v1/mandate          create+sign a mandate  { issuer?, agent, container, modes?, expires_at? }
 *   POST /v1/mandate/revoke   revoke a mandate       { urn } | { agent, container }
 *   GET  /v1/mandate          list active mandates in the registry
 *
 * Auth is the global NIP-98/bearer onRequest hook.
 */

const fs = require('fs');
const path = require('path');

const mandateLib = require('../lib/mandate');

// ── Registry (durable mint-if-absent + revocation state) ─────────────────────
//
// A small JSON registry keyed by `<agentHex>|<container>` records every minted
// mandate so `ensureMandate()` is idempotent (one mandate per agent+container)
// and revocation is addressable. Kept deliberately simple — the authoritative
// signed record is the kind-30078 event on the relay; this is the local index.

function _stateDir() {
  return process.env.AGENTBOX_STATE_DIR || '/var/lib/agentbox';
}

function _registryPath() {
  return path.join(_stateDir(), 'mandates', 'registry.json');
}

function _loadRegistry() {
  try {
    const raw = fs.readFileSync(_registryPath(), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

function _saveRegistry(reg) {
  try {
    const p = _registryPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(reg, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function _registryKey(agent, container) {
  const agentHex = mandateLib.normalisePubkey(agent);
  const c = String(container || '');
  const norm = c.endsWith('/') ? c : `${c}/`;
  return `${agentHex}|${norm}`;
}

// ── Operator delegation signer (lazy, cached) ────────────────────────────────
//
// The mandate is ISSUED BY the operator (issuer) so it is signed with the
// operator delegation key. The signer stack + key material are loaded lazily —
// the same vendoring pattern as server.js buildVoiceIntentDispatcher: prefer
// the flake-vendored lib/nostr-bridge, fall back to the mcp/ source tree.

let _signerCache = null;

function _operatorStack(manifest) {
  const integ = (manifest && manifest.integrations && manifest.integrations.solid_pod_rs) || {};
  return process.env.AGENTBOX_STACK || process.env.AGENTBOX_PROFILE || integ.sign_stack || null;
}

function _loadSigner(manifest, logger) {
  if (_signerCache !== null) return _signerCache;
  const stack = _operatorStack(manifest);
  if (!stack) {
    _signerCache = false;
    return false;
  }
  try {
    let loadSigner;
    try { ({ loadSigner } = require('../lib/nostr-bridge')); }
    catch { ({ loadSigner } = require('../../mcp/servers/nostr-bridge')); }
    _signerCache = loadSigner(stack, {});
    return _signerCache;
  } catch (err) {
    if (logger && logger.warn) logger.warn({ err: err.message }, 'mandate: operator signer unavailable — mandates minted unsigned');
    _signerCache = false;
    return false;
  }
}

/** The operator's own x-only pubkey — the default mandate issuer. */
function _operatorPubkey() {
  return process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || process.env.AGENTBOX_PUBKEY || '';
}

// ── ensureMandate — the lazy mint-if-absent helper (exported) ────────────────

/**
 * Return the session agent's active mandate over `container`, minting and
 * signing one scoped to that container if none exists yet (ADR-043 D4.5). This
 * is the path a pod write awaits before writing: minting is scoped to the
 * container being written, and the write then proceeds under the session's own
 * DID. Idempotent — a second write to the same container returns the existing
 * mandate rather than minting a duplicate.
 *
 * Fail-open on signing: if the operator delegation signer is unavailable the
 * mandate record + URN + ACL Turtle are still produced (unsigned), so the pod
 * write is never blocked purely by a missing relay signer. The registry records
 * `signed: false` so the operator can re-mint later.
 *
 * @param {object} args
 * @param {string} [args.issuer]     - operator did/pubkey (defaults to AGENTBOX_X_ONLY_PUBKEY_HEX)
 * @param {string} args.agent        - session agent did/pubkey (the grantee)
 * @param {string} args.container    - absolute pod container path (e.g. "/proj/foo/")
 * @param {string[]} [args.modes]    - acl:mode names (default Read/Write/Append)
 * @param {number|null} [args.expiresAt] - Unix seconds, or null for no expiry
 * @param {object} [args.manifest]   - parsed manifest (for the signer stack)
 * @param {object} [args.logger]
 * @returns {Promise<{ urn, record, acl_turtle, signed, signed_event, reused }>}
 */
async function ensureMandate(args = {}) {
  const { agent, container } = args;

  const key = _registryKey(agent, container);
  const reg = _loadRegistry();
  const existing = reg[key];
  if (existing && existing.record && mandateLib.isMandateActive(existing.record)) {
    return {
      urn: existing.record.urn,
      record: existing.record,
      acl_turtle: mandateLib.mandateToAclTurtle(existing.record),
      signed: existing.signed === true,
      signed_event: null,
      reused: true,
    };
  }

  const result = await createSignedMandate(args);
  return { ...result, reused: false };
}

/**
 * Async create-and-sign — mints a mandate, signs it with the operator
 * delegation key (kind-30078 replaceable), and records it. Used by the REST
 * create route where the signed event is part of the response.
 */
async function createSignedMandate(args = {}) {
  const issuer = args.issuer || _operatorPubkey();
  const { agent, container } = args;
  const logger = args.logger;

  const { urn, record } = mandateLib.createMandate({
    issuer,
    agent,
    container,
    modes: args.modes,
    expiresAt: args.expiresAt,
  });
  const acl_turtle = mandateLib.mandateToAclTurtle(record);

  let signedEvent = null;
  const signer = _loadSigner(args.manifest, logger);
  if (signer) {
    try {
      signedEvent = await mandateLib.signMandate(record, signer);
    } catch (err) {
      if (logger && logger.warn) logger.warn({ err: err.message }, 'mandate: signMandate failed (record kept unsigned)');
    }
  }

  const reg = _loadRegistry();
  reg[_registryKey(agent, container)] = {
    record,
    signed: !!signedEvent,
    signed_event_id: signedEvent ? signedEvent.id : null,
    created_at: new Date().toISOString(),
  };
  _saveRegistry(reg);

  return { urn, record, acl_turtle, signed: !!signedEvent, signed_event: signedEvent };
}

/**
 * Revoke a mandate: re-sign the same NIP-33 d-tag (record.urn) with a record
 * whose `revoked` is true and mark the registry entry revoked. Returns the
 * revocation record (+ signed event when a signer is available).
 */
async function revokeMandate(args = {}) {
  const logger = args.logger;
  const reg = _loadRegistry();

  let key = null;
  let entry = null;
  if (args.urn) {
    for (const [k, v] of Object.entries(reg)) {
      if (v && v.record && v.record.urn === args.urn) { key = k; entry = v; break; }
    }
  } else if (args.agent && args.container) {
    key = _registryKey(args.agent, args.container);
    entry = reg[key];
  }
  if (!entry || !entry.record) return null;

  const revokedRecord = { ...entry.record, revoked: true };
  let signedEvent = null;
  const signer = _loadSigner(args.manifest, logger);
  if (signer) {
    try {
      signedEvent = await mandateLib.signMandate(revokedRecord, signer);
    } catch (err) {
      if (logger && logger.warn) logger.warn({ err: err.message }, 'mandate: revoke sign failed');
    }
  }

  reg[key] = {
    record: revokedRecord,
    signed: !!signedEvent,
    signed_event_id: signedEvent ? signedEvent.id : (entry.signed_event_id || null),
    created_at: entry.created_at,
    revoked_at: new Date().toISOString(),
  };
  _saveRegistry(reg);

  return { urn: revokedRecord.urn, record: revokedRecord, signed: !!signedEvent, signed_event: signedEvent };
}

// ── Route plugin ─────────────────────────────────────────────────────────────

async function mandateRoutes(fastify, options) {
  const { logger } = options;
  const manifest = options.manifest || {};

  const recordSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
      issuer:     { type: 'string' },
      agent:      { type: 'string' },
      container:  { type: 'string' },
      modes:      { type: 'array', items: { type: 'string' } },
      issued_at:  { type: 'integer' },
      expires_at: { type: ['integer', 'null'] },
      revoked:    { type: 'boolean' },
      urn:        { type: 'string' },
    },
  };

  // ── POST /v1/mandate — create + sign ──────────────────────────────────────
  fastify.post('/v1/mandate', {
    schema: {
      description: 'Create and sign a scoped agent-delegation mandate (kind-30078 revocable)',
      tags: ['mandate'],
      body: {
        type: 'object',
        required: ['agent', 'container'],
        properties: {
          issuer:     { type: 'string' },
          agent:      { type: 'string' },
          container:  { type: 'string' },
          modes:      { type: 'array', items: { type: 'string' } },
          expires_at: { type: ['integer', 'null'] },
        },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: true,
          properties: {
            urn:        { type: 'string' },
            record:     recordSchema,
            acl_turtle: { type: 'string' },
            signed:     { type: 'boolean' },
            signed_event: { type: ['object', 'null'], additionalProperties: true },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const body = request.body || {};
    // The authenticated caller's pubkey is the default issuer when present
    // (a NIP-98 operator call), else the box operator pubkey.
    const issuer = body.issuer || (request.auth && request.auth.pubkey) || _operatorPubkey();
    try {
      const result = await createSignedMandate({
        issuer,
        agent: body.agent,
        container: body.container,
        modes: body.modes,
        expiresAt: body.expires_at,
        manifest,
        logger,
      });
      reply.code(201).send(result);
    } catch (err) {
      if (err && err.name === 'MandateError') {
        return reply.code(400).send({ error: 'mandate', message: err.message });
      }
      throw err;
    }
  });

  // ── POST /v1/mandate/revoke ───────────────────────────────────────────────
  fastify.post('/v1/mandate/revoke', {
    schema: {
      description: 'Revoke a mandate by urn, or by (agent, container)',
      tags: ['mandate'],
      body: {
        type: 'object',
        properties: {
          urn:       { type: 'string' },
          agent:     { type: 'string' },
          container: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            urn:    { type: 'string' },
            record: recordSchema,
            signed: { type: 'boolean' },
            signed_event: { type: ['object', 'null'], additionalProperties: true },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const body = request.body || {};
    if (!body.urn && !(body.agent && body.container)) {
      return reply.code(400).send({ error: 'validation', message: 'provide urn, or both agent and container' });
    }
    const result = await revokeMandate({
      urn: body.urn,
      agent: body.agent,
      container: body.container,
      manifest,
      logger,
    });
    if (!result) return reply.code(404).send({ error: 'not-found', message: 'no matching mandate in the registry' });
    reply.send(result);
  });

  // ── GET /v1/mandate — list active mandates ────────────────────────────────
  fastify.get('/v1/mandate', {
    schema: {
      description: 'List mandates currently recorded in the local registry',
      tags: ['mandate'],
      response: {
        200: {
          type: 'object',
          properties: {
            mandates: { type: 'array', items: recordSchema },
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const reg = _loadRegistry();
    const mandates = Object.values(reg)
      .map((e) => e && e.record)
      .filter(Boolean);
    reply.send({ mandates, count: mandates.length });
  });

  logger.debug({ event: 'mandate.route-mounted' }, 'Mandate route ready at /v1/mandate (create/revoke over lib/mandate.js)');
}

module.exports = mandateRoutes;
module.exports.ensureMandate = ensureMandate;
module.exports.createSignedMandate = createSignedMandate;
module.exports.revokeMandate = revokeMandate;
