'use strict';

// Local mutation-owner receipts. An incomplete claim is never retried blindly:
// an upstream timeout or crash can occur after the mutation, before its receipt.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { operationDigest } = require('./governance-correlation');

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
  begin(gate, operation) {
    if (!gate?.released || !gate.request_event_id || !gate.response_event_id
        || gate.operation_sha256 !== operationDigest(operation)) {
      throw new Error('application receipt requires an exact approved operation');
    }
    const binding = {
      schema_version: 1, request_event_id: gate.request_event_id,
      response_event_id: gate.response_event_id, operation_sha256: gate.operation_sha256,
    };
    const files = this._paths(gate.response_event_id);
    const record = { ...binding, stage: 'consumer-received', received_at: new Date().toISOString() };
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
    if (!claim.fresh || !['applied', 'not-applied', 'unknown'].includes(stage)) throw new Error('invalid application receipt transition');
    if (stage === 'applied' && acknowledgement?.writeback_committed !== true) throw new Error('applied requires a committed mutation acknowledgement');
    const record = { ...claim.binding, stage, observed_at: new Date().toISOString(), acknowledgement };
    this._writeOnce(this._paths(claim.binding.response_event_id).outcome, record);
    return record;
  }
}
module.exports = { ApplicationReceiptStore };
