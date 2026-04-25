'use strict';

/**
 * memory-logger — appends every consult / health / cost_estimate outcome
 * to a JSONL audit trail under /var/lib/agentbox/consultations/.
 *
 * One file per consultant per day:
 *   /var/lib/agentbox/consultations/<consultant>-<YYYY-MM-DD>.jsonl
 *
 * When AGENTBOX_INTELLIGENCE_DIR is set, also writes ADR-043-shaped
 * QualitySignal files alongside (file-based intelligence-provider
 * pattern) so SONA learning loops can absorb consultation verdicts.
 *
 * No external deps. Synchronous append because:
 *   - consult is already async-bound on the model call (a few ms of
 *     fsync under it does not move the SLO needle), and
 *   - lossy logs are unacceptable for audit / cost-tracking.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LOG_ROOT = '/var/lib/agentbox/consultations';

class MemoryLogger {
  /**
   * @param {object}   opts
   * @param {string}   opts.consultant       short id used in filename + payload
   * @param {string}   [opts.log_dir]        override the JSONL root
   * @param {string}   [opts.intel_dir]      override the ADR-043 signal dir; absent → no signal write
   */
  constructor(opts) {
    if (!opts || !opts.consultant) throw new Error('MemoryLogger: consultant required');
    this.consultant = opts.consultant;
    this.log_dir    = opts.log_dir
                    || process.env.AGENTBOX_CONSULTATIONS_DIR
                    || DEFAULT_LOG_ROOT;
    this.intel_dir  = opts.intel_dir
                    || process.env.AGENTBOX_INTELLIGENCE_DIR
                    || null;
  }

  _logPath() {
    const ymd = new Date().toISOString().slice(0, 10);
    return path.join(this.log_dir, `${this.consultant}-${ymd}.jsonl`);
  }

  _ensureDir(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        // Logging is best-effort. If we cannot create the directory we fall
        // through to writing a message to stderr so the operator knows the
        // audit trail is missing for this run.
        process.stderr.write(`[memory-logger] cannot create ${dir}: ${err.message}\n`);
      }
    }
  }

  /**
   * Append one record. Adds id + ts. Best-effort: errors are logged to
   * stderr but never thrown — losing one log line must not fail a
   * consultation.
   */
  log(record) {
    const id = record.id || crypto.randomUUID();
    const stamped = {
      id,
      ts:         new Date().toISOString(),
      consultant: this.consultant,
      ...record,
    };
    try {
      this._ensureDir(this.log_dir);
      fs.appendFileSync(
        this._logPath(),
        JSON.stringify(stamped) + '\n',
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch (err) {
      process.stderr.write(`[memory-logger] append failed: ${err.message}\n`);
    }

    if (this.intel_dir && stamped.ok && typeof stamped.response_len === 'number') {
      this._writeIntelligenceSignal(stamped);
    }
  }

  _writeIntelligenceSignal(stamped) {
    // ADR-043 §QualitySignal — heuristic mapping from consultation outcome.
    const verdict = stamped.error ? 'failure'
                  : stamped.response_len > 0 ? 'success'
                  : 'partial_success';
    const score   = stamped.error ? 0.0
                  : stamped.response_len > 0 ? 0.85
                  : 0.5;
    const signal = {
      id:               stamped.id,
      task_description: `consultant-${this.consultant}: ${(stamped.question || '').slice(0, 200)}`,
      outcome:          verdict,
      quality_score:    score,
      human_verdict:    null,
      quality_factors:  null,
      completed_at:     stamped.ts,
      provider:         `consultant-${this.consultant}`,
      latency_ms:       stamped.latency_ms,
      cost_usd:         stamped.cost_usd,
    };
    try {
      this._ensureDir(this.intel_dir);
      fs.writeFileSync(
        path.join(this.intel_dir, `${this.consultant}-${stamped.id}.json`),
        JSON.stringify(signal, null, 2),
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch (err) {
      process.stderr.write(`[memory-logger] signal write failed: ${err.message}\n`);
    }
  }
}

module.exports = { MemoryLogger };
