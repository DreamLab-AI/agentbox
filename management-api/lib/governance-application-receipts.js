'use strict';

// Local mutation-owner receipts. An incomplete claim is never retried blindly:
// an upstream timeout or crash can occur after the mutation, before its receipt.
//
// ADR-2087 adds two things to this store, both in service of FR7 (manual
// continuation during an outage):
//
//   * the received record carries the CASE and the approved OUTCOME alongside
//     the binding, so a receipt can be found by case id when the mesh — and
//     therefore the case's own decision surface — is unavailable. These are
//     recorded OUTSIDE `binding`, so the replay comparison that protects
//     against a mutation being repeated is byte-identical to before and legacy
//     receipt files still replay;
//   * `applied-manually` joins the terminal stages, admitted only with an
//     acknowledgement naming a HUMAN did:nostr and the evidence they left.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { operationDigest } = require('./governance-correlation');

/** A human (or any) sovereign identity on the wire. */
const HUMAN_DID = /^did:nostr:[0-9a-f]{64}$/;

class ApplicationReceiptStore {
  constructor(directory = path.join(process.env.AGENTBOX_STATE_DIR || path.join(os.homedir(), '.local/state/agentbox'), 'governance-applications')) {
    this.directory = directory;
  }
  _paths(responseId) {
    const key = createHash('sha256').update(responseId).digest('hex');
    return { received: path.join(this.directory, `${key}.received.json`), outcome: path.join(this.directory, `${key}.outcome.json`) };
  }
  _writeOnce(file, value) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temp = path.join(this.directory, `.${randomUUID()}.tmp`);
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, file); }
    finally { fs.unlinkSync(temp); }
    const dir = fs.openSync(this.directory, 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
  /**
   * Claim the right to perform one approved mutation.
   *
   * @param {object} gate      - an authority-gate result with `released: true`
   * @param {object} operation - the exact approved operation
   * @param {object} [meta]    - non-binding context: `{ case_id }`
   */
  begin(gate, operation, meta = {}) {
    if (!gate?.released || !gate.request_event_id || !gate.response_event_id
        || gate.operation_sha256 !== operationDigest(operation)) {
      throw new Error('application receipt requires an exact approved operation');
    }
    const binding = {
      schema_version: 1, request_event_id: gate.request_event_id,
      response_event_id: gate.response_event_id, operation_sha256: gate.operation_sha256,
    };
    const files = this._paths(gate.response_event_id);
    const record = {
      ...binding,
      stage: 'consumer-received',
      received_at: new Date().toISOString(),
      // Non-binding context. `case_id` is the only handle an operator has
      // during an outage; `outcome` is what makes "continue an APPROVED action"
      // checkable without the relay that carried the approval.
      case_id: (meta && meta.case_id) || null,
      outcome: gate.outcome || null,
    };
    try { this._writeOnce(files.received, record); return { fresh: true, binding }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const prior = JSON.parse(fs.readFileSync(files.received, 'utf8'));
    for (const key of Object.keys(binding)) {
      if (prior[key] !== binding[key]) throw new Error('decision replay has different request or operation');
    }
    try { return { fresh: false, binding, outcome: JSON.parse(fs.readFileSync(files.outcome, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { fresh: false, binding, outcome: null };
  }
  finish(claim, stage, acknowledgement) {
    if (!claim.fresh || !['applied', 'not-applied', 'unknown', 'applied-manually'].includes(stage)) throw new Error('invalid application receipt transition');
    if (stage === 'applied' && acknowledgement?.writeback_committed !== true) throw new Error('applied requires a committed mutation acknowledgement');
    // `applied-manually` asserts that a PERSON did the thing. The claim is only
    // as good as the identity it names, so an unnamed or agent-shaped executor
    // is refused here rather than recorded and disbelieved later.
    if (stage === 'applied-manually') {
      if (acknowledgement?.manual !== true) throw new Error('applied-manually requires acknowledgement.manual === true');
      if (!HUMAN_DID.test(acknowledgement?.executed_by || '')) throw new Error('applied-manually requires executed_by as did:nostr:<64-hex>');
      if (typeof acknowledgement?.evidence !== 'string' || !acknowledgement.evidence.trim()) {
        throw new Error('applied-manually requires evidence');
      }
    }
    const record = { ...claim.binding, stage, observed_at: new Date().toISOString(), acknowledgement };
    this._writeOnce(this._paths(claim.binding.response_event_id).outcome, record);
    return record;
  }

  /** Read the two records for one response id. Missing files read as null. */
  load(responseEventId) {
    const files = this._paths(responseEventId);
    const read = (file) => {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    return { received: read(files.received), outcome: read(files.outcome) };
  }

  /**
   * Find the receipt pair for a case id. Receipts are addressed by response
   * event id, so this is a scan — the directory holds one pair per gated
   * decision, and manual continuation is a rare, operator-initiated act.
   * Returns the NEWEST match, so a superseded decision on the same case does
   * not shadow the current one.
   *
   * @param {string} caseId
   * @returns {{received: object, outcome: object|null}|null}
   */
  findByCase(caseId) {
    if (!caseId) return null;
    let entries;
    try { entries = fs.readdirSync(this.directory).filter((f) => f.endsWith('.received.json')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }

    let best = null;
    for (const file of entries) {
      let received;
      try { received = JSON.parse(fs.readFileSync(path.join(this.directory, file), 'utf8')); }
      catch { continue; } // a torn file is not a receipt
      if (received.case_id !== caseId) continue;
      if (!best || String(received.received_at) > String(best.received.received_at)) {
        best = this.load(received.response_event_id);
      }
    }
    return best;
  }

  /**
   * Build a claim for a MANUAL continuation of an already-approved case.
   *
   * Unlike `begin()` this mints no new approval and performs no mutation — the
   * approval already exists and the operator has already acted. It exists so
   * `finish()` has a claim to write against, and it refuses every case where
   * "continue" would actually mean "decide": no local approval, a non-approve
   * outcome, a different operation, or a case that already reached a terminal
   * stage.
   *
   * @param {object} params
   * @param {string} params.case_id
   * @param {string} [params.operation_sha256] - when given, must match the approval
   * @returns {{fresh: true, binding: object, received: object}}
   * @throws {Error} with a `code` naming which precondition failed
   */
  manualClaim({ case_id: caseId, operation_sha256: digest } = {}) {
    const found = this.findByCase(caseId);
    if (!found || !found.received) {
      throw Object.assign(new Error(`no local application receipt for case ${caseId}`), { code: 'no-approved-receipt' });
    }
    const { received, outcome } = found;
    const approved = ['approve', 'approved', 'allow'].includes(String(received.outcome || '').toLowerCase());
    if (!approved) {
      throw Object.assign(new Error(`case ${caseId} was not approved (outcome: ${received.outcome || 'none recorded'})`), { code: 'not-approved' });
    }
    if (digest && digest !== received.operation_sha256) {
      throw Object.assign(new Error('the supplied operation does not match the approved operation digest'), { code: 'operation-digest-mismatch' });
    }
    if (outcome) {
      throw Object.assign(new Error(`case ${caseId} already reached stage ${outcome.stage}`), { code: 'already-resolved', stage: outcome.stage });
    }
    const binding = {
      schema_version: 1,
      request_event_id: received.request_event_id,
      response_event_id: received.response_event_id,
      operation_sha256: received.operation_sha256,
    };
    return { fresh: true, binding, received };
  }
}
module.exports = { ApplicationReceiptStore, HUMAN_DID };
