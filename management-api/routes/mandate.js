'use strict';

/**
 * /v1/mandate — scoped WAC agent-delegation mandates (ADR-043 D4.5, PRD-021 F3-5,
 * DDD-019 §MandatePort; enforcement and revocation per AB-11).
 *
 * A mandate is the signed, revocable record by which the pod owner grants a
 * session's `did:nostr` write/append authority over ONE pod container, so the
 * session writes under its own DID and never holds the owner's nsec. It is
 * ENFORCED AT THE POD: granting PUTs the container's whole WAC sidecar
 * (lib/mandate-acl), signs and publishes the kind-30078 envelope with the pod
 * owner's key, and only then marks the mandate active (lib/mandate-grant);
 * revoking removes the agent from the sidecar, publishes `status=revoked`, and
 * leaves a tombstone (lib/mandate-revocation).
 *
 * Signing is fail-closed: with no pod-owner signer both routes answer 503
 * `signer_unavailable` and change nothing. That AMENDS ADR-043 D4.5, which
 * minted unsigned mandates when no signer existed (see the AB-11 ADR).
 *
 * Per the operator decision (ADR-043 D4.5) mandate scope is LAZY: a session's
 * mandate is minted on its FIRST pod write, scoped to the container being
 * written. `ensureMandate()` below is that mint-if-absent path; sessions known
 * to be pod-writers carry `eager_mandate = true` and are minted at the session
 * boundary (routes/sessions-boundary.js).
 *
 * Every mandate URN is minted through lib/uris.js inside createMandate()
 * (ADR-013, N-07).
 *
 * Routes:
 *   POST /v1/mandate          grant   { issuer?, agent, container, modes?, expires_at? }
 *   POST /v1/mandate/revoke   revoke  { urn } | { agent, container }
 *   GET  /v1/mandate          list mandates in the registry, with their state
 *
 * Auth is the global NIP-98/bearer onRequest hook; every route is operator-only.
 */

const mandateLib = require('../lib/mandate');
const authz = require('../lib/authz');
const registry = require('../lib/mandate-registry');
const { grantMandate, MandateRevokedError, GrantError } = require('../lib/mandate-grant');
const { revokeMandate, RevokeError } = require('../lib/mandate-revocation');
const { SignerUnavailable } = require('../lib/mandate-signer');

/** The operator's own x-only pubkey — the default mandate issuer (= pod owner). */
function _operatorPubkey() {
  return process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || process.env.AGENTBOX_PUBKEY || '';
}

// ── ensureMandate — the lazy mint-if-absent helper (exported) ────────────────

/**
 * Return the session agent's active mandate over `container`, granting one
 * scoped to that container if none exists yet (ADR-043 D4.5). Idempotent: a
 * second call returns the active mandate without touching the pod.
 *
 * Fail-CLOSED on signing (amends ADR-043 D4.5): no pod-owner signer → throws
 * {@link SignerUnavailable}; a failed pod write or publish → {@link GrantError}.
 * A REVOKED mandate is a tombstone: this throws {@link MandateRevokedError}
 * instead of re-minting. Only {@link createSignedMandate} (the operator's
 * explicit grant) replaces one.
 *
 * @param {object} args
 * @param {string} [args.issuer]     - pod owner (defaults to AGENTBOX_X_ONLY_PUBKEY_HEX)
 * @param {string} args.agent        - session agent did/pubkey (the grantee)
 * @param {string} args.container    - `/pods/<issuer>/…/`
 * @param {string[]} [args.modes]    - Read/Write/Append (never Control)
 * @param {number|null} [args.expiresAt]
 * @param {object} [args.manifest]
 * @param {object} [args.logger]
 * @param {object} [args.deps]       - test seam (lib/mandate-runtime)
 * @returns {Promise<{ urn, record, acl_turtle, signed, signed_event, reused }>}
 */
async function ensureMandate(args = {}) {
  return grantMandate({ ...args, issuer: args.issuer || _operatorPubkey(), regrant: false, anyContainer: false });
}

/**
 * The operator's explicit grant: like {@link ensureMandate} but it replaces a
 * revoked mandate (the operator has decided to re-grant).
 */
async function createSignedMandate(args = {}) {
  return grantMandate({ ...args, issuer: args.issuer || _operatorPubkey(), regrant: true, anyContainer: true });
}

// ── Route plugin ─────────────────────────────────────────────────────────────

async function mandateRoutes(fastify, options) {
  const { logger } = options;
  const manifest = options.manifest || {};
  // Test seam (lib/mandate-runtime): pod fetch, signer, relay publisher, clock.
  const deps = options.deps;

  const errorBody = (error, message, extra = {}) => ({ error, message, ...extra });
  /** Map a lifecycle failure to its HTTP answer; rethrow anything unexpected. */
  const lifecycleError = (reply, err) => {
    if (err instanceof SignerUnavailable) {
      logger.warn({ event: 'mandate.signer-unavailable', reason: err.reason }, `mandate: ${err.message} — nothing changed`);
      // A revoke that could not reach the pod is already "revoking" locally (denied everywhere).
      const extra = err.effective_at_pod === false ? { effective_at_pod: false, state: err.state } : {};
      return reply.code(503).send(errorBody('signer_unavailable', err.message, { reason: err.reason, ...extra }));
    }
    if (err instanceof mandateLib.MandateError) return reply.code(400).send(errorBody('mandate', err.message));
    if (err instanceof MandateRevokedError) return reply.code(409).send(errorBody('mandate_revoked', err.message, { state: err.state }));
    if (err instanceof RevokeError) return reply.code(502).send(errorBody(err.code, err.message, { effective_at_pod: false }));
    if (err instanceof GrantError) return reply.code(err.status || 502).send(errorBody(err.code, err.message, { effective_at_pod: false }));
    if (err instanceof registry.RegistryError) {
      logger.error({ event: 'mandate.registry-error', err: err.message }, 'mandate: registry unavailable');
      return reply.code(503).send(errorBody('registry_unavailable', err.message));
    }
    throw err;
  };

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
      pod:        { type: 'string' },
      state:      { type: 'string' },
    },
  };
  const errorSchema = { type: 'object', additionalProperties: true, properties: { error: { type: 'string' }, message: { type: 'string' } } };

  // ── POST /v1/mandate — create + sign ──────────────────────────────────────
  // Finding 3: creating a mandate binds the operator's own delegation authority
  // to an agent, so it is OPERATOR-ONLY. Any other authenticated principal is
  // Forbidden (403). The issuer is always the authenticated operator — a
  // caller-supplied issuer that disagrees is rejected 400 (never sign an
  // operator-key mandate for an arbitrary issuer).
  fastify.post('/v1/mandate', {
    preHandler: authz.requireOperator({ manifest }),
    schema: {
      description: 'Grant a scoped agent-delegation mandate: PUT the container WAC sidecar at the pod, sign and publish the kind-30078 envelope, then activate. Fails closed (503) with no pod-owner signer. Operator-only.',
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
        400: errorSchema,
        403: errorSchema,
        409: errorSchema,
        502: errorSchema,
        503: errorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body || {};
    // The issuer is the authenticated operator, full stop. `authenticatedPubkey`
    // is the operator's NIP-98 signer pubkey, or the operator pubkey when the
    // operator bearer is used. A caller-supplied `issuer` is accepted only when
    // it equals that identity — otherwise 400 (finding 3): the operator key must
    // never sign a mandate attributing itself as an arbitrary third-party issuer.
    const effectiveIssuer = authz.authenticatedPubkey(request) || _operatorPubkey();
    if (body.issuer) {
      let suppliedHex = null;
      let operatorHex = null;
      try { suppliedHex = mandateLib.normalisePubkey(body.issuer); } catch (_) { suppliedHex = null; }
      try { operatorHex = mandateLib.normalisePubkey(effectiveIssuer); } catch (_) { operatorHex = null; }
      if (!suppliedHex || !operatorHex || suppliedHex.toLowerCase() !== operatorHex.toLowerCase()) {
        logger.warn(
          { event: 'mandate.issuer-mismatch', supplied: body.issuer, operator: effectiveIssuer, pubkey: request.auth && request.auth.pubkey },
          'mandate: create refused — caller-supplied issuer disagrees with the authenticated operator',
        );
        return reply.code(400).send({
          error: 'issuer_mismatch',
          message: 'A caller-supplied issuer must equal the authenticated operator identity; the operator key never signs a mandate for an arbitrary issuer.',
        });
      }
    }
    const issuer = effectiveIssuer;
    try {
      const result = await createSignedMandate({
        issuer,
        agent: body.agent,
        container: body.container,
        modes: body.modes,
        expiresAt: body.expires_at,
        manifest,
        logger,
        deps,
      });
      reply.code(201).send(result);
    } catch (err) {
      return lifecycleError(reply, err);
    }
  });

  // ── POST /v1/mandate/revoke ───────────────────────────────────────────────
  // Operator-only (finding 3). Deliberately NOT behind authority.guard (AB-11
  // decision d): revocation only ever reduces authority, so it must not wait on
  // an approval a stuck governance pipeline could withhold.
  fastify.post('/v1/mandate/revoke', {
    preHandler: authz.requireOperator({ manifest }),
    schema: {
      description: 'Revoke a mandate by urn, or by (agent, container): remove the agent from the pod sidecar, publish status=revoked, leave a tombstone. 503 and no change when there is no pod-owner signer. Operator-only.',
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
            state:  { type: 'string' },
            signed: { type: 'boolean' },
            effective_at_pod: { type: 'boolean' },
            published: { type: 'boolean' },
            publish_error: { type: 'string' },
            signed_event: { type: ['object', 'null'], additionalProperties: true },
          },
        },
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
        502: errorSchema,
        503: errorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body || {};
    if (!body.urn && !(body.agent && body.container)) {
      return reply.code(400).send({ error: 'validation', message: 'provide urn, or both agent and container' });
    }
    let result;
    try {
      result = await revokeMandate({
        urn: body.urn,
        agent: body.agent,
        container: body.container,
        manifest,
        logger,
        deps,
      });
    } catch (err) {
      return lifecycleError(reply, err);
    }
    if (!result) return reply.code(404).send({ error: 'not-found', message: 'no matching mandate in the registry' });
    reply.send(result);
  });

  // ── GET /v1/mandate — list active mandates ────────────────────────────────
  // Operator-only (finding 3): the mandate registry enumerates every delegation
  // the operator has granted — not a list an arbitrary session may read.
  fastify.get('/v1/mandate', {
    preHandler: authz.requireOperator({ manifest }),
    schema: {
      description: 'List mandates recorded in the local registry, each with its lifecycle state. Operator-only.',
      tags: ['mandate'],
      response: {
        200: {
          type: 'object',
          properties: {
            mandates: { type: 'array', items: recordSchema },
            count: { type: 'integer' },
          },
        },
        403: errorSchema,
        503: errorSchema,
      },
    },
  }, async (request, reply) => {
    let reg;
    try { reg = registry.load(); } catch (err) { return lifecycleError(reply, err); }
    const mandates = Object.values(reg)
      .filter((e) => e && e.record)
      .map((e) => ({ ...e.record, state: e.state }));
    reply.send({ mandates, count: mandates.length });
  });

  logger.debug({ event: 'mandate.route-mounted' }, 'Mandate route ready at /v1/mandate (create/revoke over lib/mandate.js)');
}

module.exports = mandateRoutes;
module.exports.ensureMandate = ensureMandate;
module.exports.createSignedMandate = createSignedMandate;
module.exports.revokeMandate = revokeMandate;
module.exports.reconcileMandates = require('../lib/mandate-revocation').reconcileMandates;
module.exports.startReconciler = require('../lib/mandate-revocation').startReconciler;
