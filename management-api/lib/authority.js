'use strict';

/**
 * lib/authority — the action authority axis (REC-6, PRD-019 / ADR-037 D2 /
 * DDD-017 §AuthorityClass).
 *
 * `authority_class` (`recoverable` | `zero-tolerance`) is a NEW axis, ORTHOGONAL
 * to the WAC ACL resource modes in lib/mandate.js (`Read`/`Write`/`Append`/
 * `Control`). The mandate axis answers "which pod container may this agent
 * touch"; this axis answers "is this action reversible". The two are never
 * conflated (DDD-017 invariant 8, ADR-037 D2 rejected alternative 1).
 *
 * Three rules the gate enforces:
 *
 *   1. ESCALATION BY DEFAULT. An action class that is neither in the config
 *      classification table nor carried on the skill's frontmatter is
 *      `escalation-required`, NOT permissive. The cost of forgetting to classify
 *      is a blocking prompt, never an unreviewed irreversible action
 *      (ADR-037 D2 rejected alternative 2; falsification clause 1).
 *
 *   2. ZERO-TOLERANCE BLOCKS ON A SIGNED RESPONSE. A `zero-tolerance` action (or
 *      an unclassified/escalation-required one) does not proceed until a signed
 *      ACSP ActionResponse (kind 31403) approving it arrives and verifies. The
 *      gate PUBLISHES the request (kind 31402, via lib/agent-control-surface) and
 *      CONSUMES the forum's signed decision — it never signs the response or
 *      makes the decision itself. The ACSP 31400–31405 signing/decision loop is
 *      owned by nostr-rust-forum (COM-16); agentbox consumes the contract
 *      (ADR-037 D2 rejected alternative 3; falsification clause 3).
 *
 *   3. FAIL-CLOSED FOR ZERO-TOLERANCE. If the decision surface is unavailable, or
 *      the response times out, is unverifiable, or is not an approval, a
 *      zero-tolerance action is DENIED — never released. Only a verified,
 *      approving, signed 31403 releases it (falsification clause 2). A
 *      `recoverable` action, by contrast, proceeds without any blocking wait.
 *
 * The classification is a TABLE IN CONFIG (`agentbox.toml [skills.authority]`),
 * not hardcoded here, so the action surface is classified declaratively and the
 * table can grow without a code change.
 *
 * Two additions land here from PRD-augmentation-conditions (ADR-2087):
 *
 *   4. THE TASK-PROPERTY TRIPLE IS STAMPED ON THE REQUEST (FR3.4, ADR-2011).
 *      `authority_class` answers reversibility alone. The forum sets escalation
 *      posture from three properties of the TASK — verifiability, reversibility,
 *      stakes — so the gate derives the triple (lib/task-properties.js) and
 *      stamps it on its own 31402 as `tp-*` tags AND inside `fields`. A caller
 *      may pass `taskProperties` to TIGHTEN it; nothing can loosen it.
 *
 *   5. EVERY DENY IS JOURNALLED (FR4.4, EXP-AC-004). A denial that exists only
 *      as a `logger.warn` is invisible to the operator surface at
 *      `/v1/agent-events`. Each deny path now also appends a hash-chained
 *      `authority.deny {agent_did, stage, reason, action_class,
 *      operation_sha256}` record through the injected journal. The journal is
 *      best-effort: a journal failure is itself logged and NEVER converts a
 *      deny into an exception — fail-closed on the action, fail-open on the
 *      record of it.
 *
 * @see lib/task-properties.js        (the ADR-2011 triple derivation)
 * @see lib/authority-journal.js      (the hash-chained authority.deny sink)
 * @see lib/agent-control-surface.js  (buildActionRequest / publishPanelEvent — the 31402 producer)
 * @see lib/mandate.js                (the orthogonal WAC resource axis)
 * @see management-api/routes/broker-bridge.js (the broker REST the forum drives)
 */

const acs = require('./agent-control-surface');
const { responseMatchesRequest, canonicalOperation, operationDigest } = require('./governance-correlation');
const taskProperties = require('./task-properties');

const AUTHORITY_CLASSES = Object.freeze(['recoverable', 'zero-tolerance']);
/** Disposition of an unclassified action — a prompt, never a silent proceed. */
const ESCALATION_REQUIRED = 'escalation-required';
/** ACSP kinds this module consumes/produces (from the single-source registry). */
const ACTION_REQUEST_KIND = acs.kinds.ACTION_REQUEST;   // 31402 — we PRODUCE (request)
const ACTION_RESPONSE_KIND = acs.kinds.ACTION_RESPONSE; // 31403 — we CONSUME (signed decision)

class AuthorityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthorityError';
  }
}

function isAuthorityClass(v) {
  return v === 'recoverable' || v === 'zero-tolerance';
}

/**
 * Normalise the `[skills.authority]` classification table from a parsed manifest
 * into `{ enabled, default, classes }`. Unknown/missing → an empty table whose
 * default is escalation-required (fail-closed for classification).
 *
 * @param {object} manifest - parsed agentbox.toml
 * @returns {{ enabled: boolean, default: string, classes: Record<string,string> }}
 */
function loadClassificationTable(manifest) {
  const auth = (manifest && manifest.skills && manifest.skills.authority) || {};
  const classes = {};
  const rawClasses = (auth.classes && typeof auth.classes === 'object') ? auth.classes : {};
  for (const [name, cls] of Object.entries(rawClasses)) {
    if (isAuthorityClass(cls)) classes[name] = cls;
    // A malformed entry is ignored here; the schema's enum already rejects it at
    // validate time, so it never reaches a live manifest.
  }
  // The only honest default is escalation — a table that "defaults to permissive"
  // is exactly the posture the register flags, so we never honour that value.
  return {
    enabled: auth.enabled !== false,
    default: ESCALATION_REQUIRED,
    classes,
  };
}

/**
 * Classify one action. Priority: per-skill frontmatter override, then the config
 * table, then escalation-required. Never returns "permissive".
 *
 * @param {string} actionClass - the action-class key (matches a table key)
 * @param {object} [opts]
 * @param {object} [opts.table]        - a table from loadClassificationTable()
 * @param {object} [opts.frontmatter]  - a SKILL.md frontmatter object (may carry authority_class)
 * @returns {'recoverable'|'zero-tolerance'|'escalation-required'}
 */
function classifyAction(actionClass, opts = {}) {
  const fm = opts.frontmatter || {};
  if (isAuthorityClass(fm.authority_class)) return fm.authority_class;

  const table = opts.table || { classes: {} };
  const fromTable = table.classes && table.classes[actionClass];
  if (isAuthorityClass(fromTable)) return fromTable;

  return ESCALATION_REQUIRED;
}

/**
 * Build the authority gate. Mirrors lib/elevation-publisher's dependency shape:
 * the ACSP producer + a consumer of the signed decision are injected so the gate
 * is testable without a live relay, and so production wires the SAME
 * already-connected NostrBridge the rest of the sovereign mesh uses.
 *
 * @param {object} manifest - parsed agentbox.toml (supplies the classification table)
 * @param {object} [deps]
 * @param {object}   [deps.logger]
 * @param {Function} [deps.publishActionRequest] - (unsignedEvent) => Promise<signedRequest>.
 *   Publishes the kind-31402 request over an already-connected bridge and returns
 *   the SIGNED request event (so we can match a response to its id). Defaults to a
 *   thin wrapper over acs.publishPanelEvent when deps.bridge + deps.signer given.
 * @param {Function} [deps.awaitDecision] - (signedRequest, {timeoutMs}) => Promise<signedResponse|null>.
 *   Consumes the forum's signed ActionResponse (kind 31403) referencing the
 *   request. Returns the signed 31403 event, or null on timeout/unavailable. The
 *   forum OWNS this decision loop; the gate only consumes it.
 * @param {Function} [deps.verifyEvent] - (event) => boolean. Verifies the 31403
 *   Schnorr signature. Defaults to nostr-tools verifyEvent (lazy require).
 * @param {object}   [deps.bridge]  - a connected NostrBridge (production wiring)
 * @param {object}   [deps.signer]  - a loaded signer (production wiring)
 * @param {object}   [deps.journal] - `{ append(record) }` sink for `authority.deny`
 *   records (lib/authority-journal.js in production). Absent → denials are only
 *   logged, as before this change.
 * @param {string}   [deps.agentDid] - the DID stamped on journalled denials.
 * @param {number}   [deps.defaultTimeoutMs=120000]
 * @returns {{ classifyAction: Function, guard: Function, table: object }}
 */
function buildAuthorityGate(manifest, deps = {}) {
  const logger = deps.logger || { debug() {}, warn() {}, info() {} };
  const table = loadClassificationTable(manifest);
  const defaultTimeoutMs = Number.isFinite(deps.defaultTimeoutMs) ? deps.defaultTimeoutMs : 120000;

  // The signed-response verifier. Consuming a signature is not reimplementing the
  // broker — the forum signs the DECISION; we only check its authenticity.
  const verifyEvent = deps.verifyEvent || ((event) => {
    try {
      const { verifyEvent: v } = require('nostr-tools');
      return v(event) === true;
    } catch {
      // nostr-tools not loadable → cannot verify → fail-closed (treated as unverified).
      return false;
    }
  });

  // Publisher of the kind-31402 request. We PRODUCE the request; we never build a
  // 31403 response (that is the forum's to sign).
  const publishActionRequest = deps.publishActionRequest || (async (unsigned) => {
    if (!deps.bridge || !deps.signer) {
      throw new AuthorityError('no ACSP producer wired (need deps.bridge + deps.signer or deps.publishActionRequest)');
    }
    return acs.publishPanelEvent(deps.bridge, deps.signer, unsigned);
  });

  // Consumer of the forum's signed decision. No default: without an injected
  // consumer a zero-tolerance action has no way to receive an approval, so the
  // gate must deny (fail-closed), never invent one.
  const awaitDecision = deps.awaitDecision || null;

  // The `authority.deny` sink. Optional: without one the gate behaves exactly as
  // it did before FR4.4, denying identically but leaving no durable record.
  const journal = (deps.journal && typeof deps.journal.append === 'function') ? deps.journal : null;
  const agentDid = typeof deps.agentDid === 'string' ? deps.agentDid : null;

  /**
   * Record one denial and return the structured gate result. EVERY deny path
   * goes through here, so "was this denial journalled?" has exactly one answer
   * for all of them rather than one per branch.
   *
   * @param {object} ctx - { cls, actionClass, props, operationHash, requestId, responseId, agent_did }
   * @param {string} stage  - where in the gate the denial happened
   * @param {string} reason - the machine-readable reason (legacy field, preserved)
   * @param {object} [extra] - additional fields merged into the result
   */
  async function deny(ctx, stage, reason, extra = {}) {
    const record = {
      type: 'authority.deny',
      agent_did: ctx.agent_did || agentDid,
      stage,
      reason,
      action_class: ctx.actionClass || null,
      authority_class: ctx.cls,
      operation_sha256: ctx.operationHash || null,
      task_properties: ctx.props || null,
      request_event_id: ctx.requestId || null,
      response_event_id: ctx.responseId || null,
    };
    if (journal) {
      try {
        await journal.append(record);
      } catch (err) {
        // Fail-open on the RECORD, never on the decision: the action stays
        // denied, and the failure to journal it is itself surfaced loudly.
        logger.warn({ event: 'authority.deny-unjournalled', stage, reason, err: err.message },
          'authority.deny record could not be journalled — the denial stands but is unrecorded');
      }
    }
    return {
      decision: 'deny', blocked: true, released: false,
      authority_class: ctx.cls,
      task_properties: ctx.props || null,
      stage,
      reason,
      ...(ctx.requestId ? { request_event_id: ctx.requestId } : {}),
      ...(ctx.responseId ? { response_event_id: ctx.responseId } : {}),
      ...extra,
    };
  }

  /**
   * Read the decision outcome from a signed ActionResponse (kind 31403). The
   * response references the exact signed request via an `e` tag. Case/panel
   * labels never substitute for signed-payload identity. Returns 'approve' | 'reject' | 'defer' | null.
   */
  function readOutcome(responseEvent, requestEvent) {
    if (!responseEvent || responseEvent.kind !== ACTION_RESPONSE_KIND) return null;
    if (!responseMatchesRequest(responseEvent, requestEvent)) return null;
    let content;
    try { content = JSON.parse(responseEvent.content); } catch { return null; }
    const value = content.outcome ?? content.action;
    const outcome = typeof value === 'string' ? value.toLowerCase() : null;
    return outcome;
  }

  /**
   * Guard one action against its authority class.
   *
   * @param {object} params
   * @param {string} params.actionClass - the action-class key (table lookup)
   * @param {string} [params.action]     - a human label for the action (panel title)
   * @param {object} [params.frontmatter]- SKILL.md frontmatter (authority_class override)
   * @param {string} [params.panelId]    - NIP-33 d-tag; defaults to a per-action urn-ish id
   * @param {string} [params.reasoning]  - shown to the human in the request
   * @param {number} [params.timeoutMs]
   * @returns {Promise<{ decision:'allow'|'deny', blocked:boolean, released:boolean,
   *   authority_class:string, request_event_id?:string, response_event_id?:string,
   *   outcome?:string|null, reason?:string }>}
   */
  async function guard(params = {}) {
    const cls = classifyAction(params.actionClass, { table, frontmatter: params.frontmatter });

    // ADR-2011 — derive the OPERATOR-declared task-property triple. The action's
    // authority class seeds reversibility; verifiability and stakes come from
    // the manifest (or the skill's frontmatter). `params.taskProperties` is the
    // caller's own declaration: it may only tighten.
    const props = taskProperties.derive(params.actionClass, {
      manifest,
      authorityClass: cls,
      frontmatter: params.frontmatter,
      requested: params.taskProperties,
    });
    const ctx = { cls, actionClass: params.actionClass || null, props, agent_did: params.agentDid };

    // Recoverable — proceed with no blocking wait. The classification is returned
    // so the caller stamps it on the agent-events envelope (acceptance #4).
    if (cls === 'recoverable') {
      return { decision: 'allow', blocked: false, released: false, authority_class: cls, task_properties: props };
    }

    // zero-tolerance OR escalation-required — block on a signed, approving response.
    if (!awaitDecision) {
      logger.warn({ event: 'authority.deny', actionClass: params.actionClass, cls },
        'no decision consumer wired — zero-tolerance/escalation action DENIED (fail-closed)');
      // FR7.3 — the operator learns the continuation option AT THE DENIAL. With
      // the mesh down there IS a legitimate path (execute by hand against an
      // existing Approve, then file an `applied-manually` receipt); naming the
      // tool here is what makes "meaningful human control during unavailability"
      // (condition C2) reachable instead of merely documented.
      return deny(ctx, 'decision-surface', 'no-decision-surface', {
        code: 'no-decision-surface',
        hint: 'governance_manual_continue',
      });
    }

    let operation, operationHash;
    try {
      if (!params.operation || typeof params.operation !== 'object') throw new TypeError('missing operation');
      operation = JSON.parse(canonicalOperation(params.operation));
      operationHash = operationDigest(operation);
    } catch (_) {
      return deny(ctx, 'operation', 'missing-or-invalid-operation');
    }
    ctx.operationHash = operationHash;

    const panelId = params.panelId
      || `urn:agentbox:authority:${params.actionClass || 'action'}:${Date.now()}`;
    const unsigned = acs.buildActionRequest({
      panelId,
      priority: cls === 'zero-tolerance' ? 'critical' : 'high',
      category: 'authority-gate',
      subjectKind: 'action',
      subjectId: params.actionClass || 'action',
      title: params.action || `Authorise ${cls} action "${params.actionClass}"`,
      reasoning: params.reasoning,
      fields: {
        action_class: params.actionClass || null,
        authority_class: cls,
        // ADR-2011: the triple rides the content as well as the tags. Tags are
        // what the relay projects; `fields` is what the reviewer's decision card
        // renders, and a reviewer who cannot see the boundary properties cannot
        // tell a bounded action from a critical one (condition C2).
        task_properties: props,
        operation,
        operation_sha256: operationHash,
      },
      extraTags: taskProperties.toTags(props),
    });

    let signedRequest;
    try {
      signedRequest = await publishActionRequest(unsigned);
    } catch (err) {
      logger.warn({ event: 'authority.deny', err: err.message },
        'failed to publish ACSP request — action DENIED (fail-closed)');
      return deny(ctx, 'publish', `publish-failed: ${err.message}`);
    }
    if (!signedRequest || typeof signedRequest.id !== 'string') {
      return deny(ctx, 'publish', 'no-request-id');
    }
    ctx.requestId = signedRequest.id;

    // Refuse a producer that signs a different payload than the operation
    // awaiting approval. The response's exact e-tag then binds these bytes.
    if (signedRequest.content !== unsigned.content) {
      return deny(ctx, 'publish', 'request-payload-changed');
    }

    let signedResponse;
    try {
      signedResponse = await awaitDecision(signedRequest, {
        timeoutMs: Number.isFinite(params.timeoutMs) ? params.timeoutMs : defaultTimeoutMs,
      });
    } catch (err) {
      logger.warn({ event: 'authority.deny', err: err.message },
        'decision wait errored — action DENIED (fail-closed)');
      return deny(ctx, 'await-decision', `await-failed: ${err.message}`);
    }

    // No response (timeout / unavailable) → DENY. A zero-tolerance action never
    // proceeds without a signed-response wait that RESOLVED to an approval.
    if (!signedResponse) {
      return deny(ctx, 'await-decision', 'no-signed-response');
    }

    // The signature must verify (consume the forum's signing, do not trust blindly).
    if (!verifyEvent(signedResponse)) {
      ctx.responseId = signedResponse.id;
      return deny(ctx, 'verify-signature', 'unverified-signature');
    }
    ctx.responseId = signedResponse.id;

    const outcome = readOutcome(signedResponse, signedRequest);
    const approved = outcome === 'approve' || outcome === 'approved' || outcome === 'allow';
    if (!approved) {
      return deny(ctx, 'outcome', `not-approved: ${outcome || 'unknown'}`, {
        outcome,
        operation_sha256: operationHash,
      });
    }
    return {
      decision: 'allow',
      blocked: true,
      released: true,
      authority_class: cls,
      task_properties: props,
      request_event_id: signedRequest.id,
      response_event_id: signedResponse.id,
      outcome,
      operation_sha256: operationHash,
    };
  }

  return { classifyAction: (a, o = {}) => classifyAction(a, { table, ...o }), guard, table };
}

module.exports = {
  AUTHORITY_CLASSES,
  ESCALATION_REQUIRED,
  ACTION_REQUEST_KIND,
  ACTION_RESPONSE_KIND,
  AuthorityError,
  isAuthorityClass,
  loadClassificationTable,
  classifyAction,
  buildAuthorityGate,
};
