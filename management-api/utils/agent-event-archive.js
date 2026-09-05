'use strict';

/**
 * agent-event-archive.js — durable provenance behind the in-memory event buffer.
 *
 * ADR-2026 provenance-consumer closeout, 2026-09-05.
 *
 * The mirror and the digest both carry a `urn:agentbox:activity` reference to
 * the operator's phone. Resolving that reference went through the publisher's
 * in-memory ring buffer, retained at 1,000 events. The estate review reproduced
 * the consequence directly: after 1,000 unrelated events the reference returned
 * 404, a new publisher process started empty with numeric ids restarting at one,
 * and two decisions sharing a session reference could never both be returned
 * because only the newest match was.
 *
 * A reference that stops resolving is worse than one that never existed: the
 * operator is holding a link to a decision they can no longer inspect. So the
 * publisher appends every event to a size-bounded JSONL archive, and the
 * resolver falls back to it on a buffer miss.
 *
 * Deliberate limits, stated rather than implied:
 *   • The archive is append-only JSONL with simple generation rotation. It is a
 *     provenance record, not a database, and it makes no ordering guarantee
 *     beyond append order.
 *   • It is bounded. Once `maxBytes * generations` is exceeded the oldest
 *     generation is dropped, and a lookup that finds nothing reports whether the
 *     archive was searched — so "expired" is distinguishable from "never
 *     existed".
 *   • It is fail-open. An unwritable path disables archiving and is reported;
 *     it never breaks an emit.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024; // per generation
const DEFAULT_GENERATIONS = 4;              // ~128 MiB total ceiling

function defaultArchiveDir() {
  const explicit = String(process.env.AGENTBOX_EVENT_ARCHIVE_DIR || '').trim();
  if (explicit) return explicit;
  const ws = String(process.env.WORKSPACE || '').trim();
  if (ws) return path.join(ws, '.agentbox', 'agent-events');
  return path.join(os.tmpdir(), 'agentbox-agent-events');
}

class AgentEventArchive {
  /**
   * @param {object} [opts]
   * @param {string} [opts.dir]         archive directory
   * @param {number} [opts.maxBytes]    per-generation size cap
   * @param {number} [opts.generations] how many generations to retain
   * @param {boolean} [opts.enabled]    explicit override of the env gate
   */
  constructor(opts = {}) {
    this.dir = opts.dir || defaultArchiveDir();
    this.maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : DEFAULT_MAX_BYTES;
    this.generations = Number.isFinite(opts.generations) ? opts.generations : DEFAULT_GENERATIONS;
    // Default ON: a provenance reference that cannot be resolved is the defect.
    // '0' disables it explicitly.
    const gate = String(process.env.AGENTBOX_EVENT_ARCHIVE || '').trim();
    this.enabled = opts.enabled !== undefined ? !!opts.enabled : gate !== '0';
    this.file = path.join(this.dir, 'events.jsonl');
    this.lastError = null;
    this._ready = false;
  }

  _ensure() {
    if (this._ready || !this.enabled) return this._ready;
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      this._ready = true;
    } catch (e) {
      this.enabled = false;
      this.lastError = `archive disabled — cannot create ${this.dir}: ${e.message}`;
    }
    return this._ready;
  }

  _rotateIfNeeded() {
    try {
      const st = fs.statSync(this.file);
      if (st.size < this.maxBytes) return;
    } catch { return; } // no file yet
    try {
      // events.jsonl → .1 → .2 … dropping the oldest generation.
      const oldest = `${this.file}.${this.generations - 1}`;
      try { fs.rmSync(oldest, { force: true }); } catch { /* ignore */ }
      for (let i = this.generations - 2; i >= 1; i--) {
        const from = `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch { /* ignore */ }
      }
      fs.renameSync(this.file, `${this.file}.1`);
    } catch (e) {
      this.lastError = `rotation failed: ${e.message}`;
    }
  }

  /**
   * Append one emitted event. Never throws.
   * @param {object} event
   * @returns {boolean} whether the event was durably appended
   */
  append(event) {
    if (!this.enabled || !this._ensure()) return false;
    try {
      this._rotateIfNeeded();
      fs.appendFileSync(this.file, JSON.stringify(event) + '\n', { mode: 0o600 });
      return true;
    } catch (e) {
      this.lastError = `append failed: ${e.message}`;
      return false;
    }
  }

  /** Generation files, newest first. */
  _files() {
    const list = [this.file];
    for (let i = 1; i < this.generations; i++) list.push(`${this.file}.${i}`);
    return list.filter((f) => { try { return fs.existsSync(f); } catch { return false; } });
  }

  /**
   * Every archived event matching `predicate`, in append (chronological) order.
   *
   * This returns the FULL history, not the newest match: two decisions that
   * share a session reference are two records, and silently returning one of
   * them was the review's "arbitrary latest event" finding.
   *
   * @param {(e:object)=>boolean} predicate
   * @param {number} [limit] maximum records to return (most recent kept)
   * @returns {{events:object[], searched:boolean, files:number, error:string|null}}
   */
  find(predicate, limit = 100) {
    if (!this.enabled) {
      return { events: [], searched: false, files: 0, error: this.lastError || 'archive disabled' };
    }
    const out = [];
    const files = this._files();
    // Oldest generation first so the result is in chronological order.
    for (const f of [...files].reverse()) {
      let raw;
      try { raw = fs.readFileSync(f, 'utf8'); }
      catch (e) { this.lastError = `read failed for ${f}: ${e.message}`; continue; }
      for (const line of raw.split('\n')) {
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        try { if (predicate(ev)) out.push(ev); } catch { /* a bad predicate never breaks a lookup */ }
      }
    }
    return {
      events: limit > 0 && out.length > limit ? out.slice(-limit) : out,
      searched: true,
      files: files.length,
      error: null,
    };
  }

  /** Archive state for a health/diagnostic surface. */
  status() {
    let bytes = 0;
    for (const f of this._files()) {
      try { bytes += fs.statSync(f).size; } catch { /* ignore */ }
    }
    return {
      enabled: this.enabled,
      dir: this.dir,
      generations: this.generations,
      max_bytes_per_generation: this.maxBytes,
      files: this._files().length,
      bytes,
      last_error: this.lastError,
    };
  }
}

// Process singleton — the publisher writes it, the resolver reads it.
const agentEventArchive = new AgentEventArchive();

module.exports = { AgentEventArchive, agentEventArchive, defaultArchiveDir };
