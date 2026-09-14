'use strict';

/**
 * lib/governance-manual-continue — record an operator's hand-execution of an
 * already-approved action (PRD-augmentation-conditions FR7.1, EXP-AC-007,
 * ADR-2087).
 *
 * WHY THIS EXISTS. Augmentation condition C2 asks whether the human keeps
 * meaningful control INCLUDING during unavailability. Before this, an outage
 * left an operator with two options: wait (the approved action stalls, and the
 * case ages silently), or do the thing by hand with no record (the estate's
 * provenance now has a hole exactly where a consequential action happened).
 * Neither is control. This is the third option: act, and leave a bound,
 * attributable receipt.
 *
 * WHAT IT IS NOT. It is not a way to decide. A manual continuation PRESUPPOSES
 * an approval — it continues one. Every refusal below exists because, without
 * it, "continue" would quietly become "decide with no reviewer":
 *
 *     no-approved-receipt        nothing was ever approved for this case
 *     not-approved               the recorded outcome is not an approval
 *     operation-digest-mismatch  a different operation than the approved one
 *     already-resolved           the case already reached a terminal stage
 *     invalid-executed_by        the executor is not a well-formed did:nostr
 *     executor-not-human         the executor is an agent (or this container)
 *     missing-evidence           an unevidenced claim is not a receipt
 *
 * THE EXECUTOR MUST BE A PERSON. An agent recording itself as having "manually
 * continued" an action would be the purest possible form of the vacuous
 * verification this PRD exists to remove: the loop would close with no human in
 * it at all. So `executed_by` is checked against the agent registry AND against
 * this container's own DID, and the PROV-O activity names that human as
 * `prov:wasAssociatedWith`.
 *
 * ORDER OF WRITES. Local receipt → provenance → forum post. The local receipt
 * is the authority; the forum post is a mirror, so an unreachable forum
 * DOWNGRADES the result (posted:false, queued:true) but never fails it. The
 * publisher queues and replays it, so the act is never lost.
 *
 * @see lib/governance-application-receipts.js (manualClaim / finish)
 * @see lib/governance-receipt-publisher.js    (the forum mirror)
 * @see mcp/servers/governance-bridge.js       (the MCP tool surface)
 * @see lib/authority.js                       (the `no-decision-surface` hint
 *                                              that names this tool)
 */

const fs = require('node:fs');
const path = require('node:path');
const uris = require('./uris');
const { operationDigest } = require('./governance-correlation');

/** The receipt stage this module writes. */
const MANUAL_STAGE = 'applied-manually';

/** A sovereign identity on the wire: lower-case x-only hex, as minted by uris.js. */
const DID_NOSTR = /^did:nostr:[0-9a-f]{64}$/;

const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

/** True for a well-formed `did:nostr:<64 lower-case hex>`. */
function isHumanDid(value) {
  return typeof value === 'string' && DID_NOSTR.test(value);
}

/** Default provenance directory: the pod's governance provenance container. */
function defaultProvenanceDir(env = process.env) {
  const npub = env.AGENTBOX_NPUB || '';
  const podRoot = env.SOLID_POD_ROOT || '/var/lib/solid';
  return npub ? path.join(podRoot, 'pods', npub, 'provenance', 'governance') : null;
}

function fail(error, message, extra = {}) {
  return { ok: false, error, message, ...extra };
}

/**
 * Record a manual continuation.
 *
 * @param {object} params
 * @param {string} params.case_id
 * @param {string} params.executed_by - the HUMAN `did:nostr` who acted
 * @param {string} params.evidence    - what they did, in their own words
 * @param {object} [params.operation] - the operation, when the caller can supply
 *   it; its digest must equal the approved one
 * @param {object} deps
 * @param {object}   deps.receipts        - an ApplicationReceiptStore
 * @param {object}   [deps.publisher]     - a receipt publisher (post())
 * @param {string}   [deps.provenanceDir] - where the PROV-O record is written
 * @param {{isAgent: Function}} [deps.agentRegistry] - "is this DID an agent?"
 * @param {string}   [deps.agentDid]      - this container's own DID
 * @param {object}   [deps.logger]
 * @param {() => string} [deps.now]
 * @returns {Promise<object>} `{ok, ...}` — never throws for an operator error
 */
async function manualContinue(params = {}, deps = {}) {
  const logger = deps.logger || NOOP_LOGGER;
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString();
  const receipts = deps.receipts;
  if (!receipts || typeof receipts.manualClaim !== 'function') {
    throw new TypeError('manualContinue requires an ApplicationReceiptStore');
  }

  const caseId = params.case_id;
  const executedBy = params.executed_by;
  const evidence = typeof params.evidence === 'string' ? params.evidence.trim() : '';

  if (typeof caseId !== 'string' || !caseId) {
    return fail('invalid-case_id', 'case_id must be a non-empty string');
  }
  if (!isHumanDid(executedBy)) {
    return fail('invalid-executed_by', 'executed_by must be did:nostr:<64 lower-case hex>');
  }
  // An agent may PUBLISH this record (it is the one with the pod and the key),
  // but it may never be its subject: the whole value of the receipt is that a
  // person is on the other end of it.
  const isRegisteredAgent = deps.agentRegistry && typeof deps.agentRegistry.isAgent === 'function'
    ? !!deps.agentRegistry.isAgent(executedBy) : false;
  if (isRegisteredAgent || (deps.agentDid && executedBy === deps.agentDid)) {
    return fail('executor-not-human',
      'executed_by names an agent identity; a manual continuation must be attributed to a human operator');
  }
  if (!evidence) {
    return fail('missing-evidence', 'evidence is required — an unevidenced manual act is not a receipt');
  }

  let suppliedDigest = null;
  if (params.operation !== undefined && params.operation !== null) {
    try { suppliedDigest = operationDigest(params.operation); }
    catch (err) { return fail('invalid-operation', `operation is not canonicalisable: ${err.message}`); }
  }

  let claim;
  try {
    claim = receipts.manualClaim({ case_id: caseId, operation_sha256: suppliedDigest });
  } catch (err) {
    return fail(err.code || 'claim-refused', err.message, err.stage ? { stage_held: err.stage } : {});
  }

  const acknowledgement = { manual: true, executed_by: executedBy, evidence };
  let receipt;
  try {
    receipt = receipts.finish(claim, MANUAL_STAGE, acknowledgement);
  } catch (err) {
    return fail('receipt-not-written', err.message);
  }

  // ── PROV-O ────────────────────────────────────────────────────────────────
  // Content-addressed, owner-scoped URNs (ADR-013), minted through uris.js like
  // every other durable identifier. The activity is SCOPED TO THE HUMAN: the
  // operator who acted is the owner of the provenance, which is what makes
  // `prov:wasAssociatedWith` here mean something an auditor can follow.
  const executedAt = now();
  const humanPubkey = executedBy.slice('did:nostr:'.length);
  let activityUrn = null;
  let receiptUrn = null;
  try {
    const payload = {
      type: 'governance-manual-continuation',
      case_id: caseId,
      response_event_id: claim.binding.response_event_id,
      operation_sha256: claim.binding.operation_sha256,
      executed_by: executedBy,
      executed_at: executedAt,
    };
    activityUrn = uris.mint({ kind: 'activity', pubkey: humanPubkey, payload });
    receiptUrn = uris.mint({ kind: 'receipt', pubkey: humanPubkey, payload: { ...payload, stage: MANUAL_STAGE } });
  } catch (err) {
    // Provenance degrades gracefully (as in the orchestrator's decision path);
    // the receipt itself is already durable.
    logger.warn({ event: 'governance.manual-continue.urn-mint-failed', err: err.message },
      'manual-continuation URNs could not be minted');
  }

  const provenanceRecord = {
    '@context': 'http://www.w3.org/ns/prov#',
    '@type': 'prov:Activity',
    '@id': activityUrn,
    'prov:wasAssociatedWith': executedBy,
    'prov:endedAtTime': executedAt,
    activity_urn: activityUrn,
    receipt_urn: receiptUrn,
    stage: MANUAL_STAGE,
    case_id: caseId,
    request_event_id: claim.binding.request_event_id,
    response_event_id: claim.binding.response_event_id,
    operation_sha256: claim.binding.operation_sha256,
    executed_by: executedBy,
    executed_at: executedAt,
    evidence,
    recorded_by: deps.agentDid || null,
  };

  const provenanceDir = deps.provenanceDir !== undefined ? deps.provenanceDir : defaultProvenanceDir();
  let provenancePath = null;
  if (provenanceDir) {
    try {
      fs.mkdirSync(provenanceDir, { recursive: true });
      const target = path.join(provenanceDir, `${encodeURIComponent(caseId)}.json`);
      const tmp = path.join(provenanceDir, `.${encodeURIComponent(caseId)}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(provenanceRecord, null, 2), 'utf8');
      fs.renameSync(tmp, target);
      provenancePath = target;
    } catch (err) {
      logger.error({ event: 'governance.manual-continue.provenance-failed', err: err.message, case_id: caseId },
        'manual-continuation provenance record could not be written');
    }
  }

  // ── Mirror to the forum ───────────────────────────────────────────────────
  let posted = false;
  let queued = false;
  let postError = null;
  if (deps.publisher && typeof deps.publisher.post === 'function') {
    try {
      const result = await deps.publisher.post({
        response_event_id: claim.binding.response_event_id,
        stage: MANUAL_STAGE,
        acknowledgement,
        executed_by: executedBy,
        evidence,
      });
      posted = !!result.ok;
      queued = !!result.queued;
      postError = result.error || null;
    } catch (err) {
      postError = err.message;
      logger.error({ event: 'governance.manual-continue.post-failed', err: err.message },
        'manual-continuation receipt could not be handed to the publisher');
    }
  }

  logger.info({
    event: 'governance.manual-continue', case_id: caseId, executed_by: executedBy,
    response_event_id: claim.binding.response_event_id, posted, queued,
  }, 'manual continuation recorded');

  return {
    ok: true,
    stage: MANUAL_STAGE,
    case_id: caseId,
    executed_by: executedBy,
    evidence,
    request_event_id: claim.binding.request_event_id,
    response_event_id: claim.binding.response_event_id,
    operation_sha256: claim.binding.operation_sha256,
    receipt,
    activity_urn: activityUrn,
    receipt_urn: receiptUrn,
    provenance_path: provenancePath,
    posted,
    queued,
    ...(postError ? { post_error: postError } : {}),
  };
}

module.exports = { manualContinue, isHumanDid, MANUAL_STAGE, defaultProvenanceDir, DID_NOSTR };
