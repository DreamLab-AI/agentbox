'use strict';
// ontology-telemetry.js — the real default liveness sink for the pervasive
// ontology augmentation binding (ADR-119 / ADR-112 / PRD-020).
//
// The retrieval brain (ontology-retrieval.js) records `fail_open` / `ask` /
// `cache_hit` events. Historically the default sink was a no-op `{ record(){} }`,
// so those records vanished and `fail_open_count` / the liveness matrix were
// unobservable — the exact "wired ≠ working" trap ADR-119 exists to avoid.
//
// This sink makes them OBSERVABLE three ways:
//   1. in-memory counters (fail_open_count, per-stage, canary) via snapshot()
//   2. an append-only JSONL audit trail on disk: {ts, event, detail, counters}
//   3. a startup canary that writes one liveness record and reads it back
//
// Contract (ADR-112 / PRD-020): FAIL OPEN. Every disk operation is wrapped; a
// dead or read-only data dir degrades to in-memory counters + a loud warning and
// NEVER throws into the retrieval path.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Data-dir convention mirrors precedent-bridge / governance-bridge:
//   AGENTBOX_POD_ROOT (default /var/lib/agentbox). Telemetry lives under
//   <root>/telemetry/ontology-retrieval.jsonl. A dedicated override wins.
function resolveTelemetryPath() {
  const explicit = process.env.AGENTBOX_ONTOLOGY_TELEMETRY_PATH
    || process.env.ONTOLOGY_TELEMETRY_PATH;
  if (explicit) return explicit;
  const root = process.env.AGENTBOX_POD_ROOT || '/var/lib/agentbox';
  return path.join(root, 'telemetry', 'ontology-retrieval.jsonl');
}

function newCounters() {
  return {
    ask: 0,
    cache_hit: 0,
    fail_open: 0,          // aliased to fail_open_count in snapshot() (ADR-119)
    fail_open_seed: 0,
    fail_open_expand: 0,
    canary_ok: 0,
    canary_fail: 0,
    write_errors: 0,
    events_total: 0,
    last_event: null,
    last_event_ts: null,
  };
}

/**
 * Create the default file+memory telemetry sink.
 * @param {object} opts
 *   filePath   override the resolved JSONL path
 *   clock      () => ms (test injection)
 *   fs         node:fs impl (test injection)
 *   warn       (msg) => void  loud-warning channel (default console.error)
 * @returns {{ record: Function, snapshot: Function, canary: Function, path: string, counters: object }}
 */
function createTelemetrySink(opts = {}) {
  const clock = opts.clock || (() => Date.now());
  const fsImpl = opts.fs || fs;
  const warn = opts.warn || ((m) => { try { console.error(m); } catch { /* ignore */ } });
  const primaryPath = opts.filePath || resolveTelemetryPath();
  const counters = newCounters();

  let activePath = primaryPath;   // repointed to tmp on fallback
  let fileEnabled = true;         // flips false if disk is wholly unusable
  let canaryDone = false;

  function _isoNow() {
    return new Date(clock()).toISOString();
  }

  function _writeLine(p, record) {
    fsImpl.mkdirSync(path.dirname(p), { recursive: true });
    fsImpl.appendFileSync(p, JSON.stringify(record) + '\n');
  }

  function _append(record) {
    if (!fileEnabled) return false;
    try {
      _writeLine(activePath, record);
      return true;
    } catch (err) {
      counters.write_errors++;
      warn(`[ontology-telemetry] JSONL append failed at ${activePath}: ${err && err.message}`);
      fileEnabled = false; // stop hammering a dead sink; counters stay live
      return false;
    }
  }

  // Startup canary: write one liveness record, read it back, verify. Loud on
  // failure, but FAIL OPEN — the binding must never block retrieval (ADR-112).
  function canary() {
    if (canaryDone) return snapshot();
    canaryDone = true;
    const marker = `canary-${process.pid}-${clock()}-${Math.random().toString(16).slice(2)}`;
    const record = { ts: _isoNow(), event: 'canary', detail: { marker }, counters: { ...counters } };

    const proveWritable = (p) => {
      _writeLine(p, { ...record, detail: { marker, path: p } });
      const back = fsImpl.readFileSync(p, 'utf-8');
      if (!back.includes(marker)) throw new Error('canary marker absent on read-back');
    };

    try {
      proveWritable(primaryPath);
      activePath = primaryPath;
      fileEnabled = true;
      counters.canary_ok++;
    } catch (primaryErr) {
      // Fall back to a guaranteed-writable tmp location before giving up.
      const fallback = path.join(os.tmpdir(), 'agentbox-ontology-retrieval.jsonl');
      try {
        proveWritable(fallback);
        activePath = fallback;
        fileEnabled = true;
        counters.canary_ok++;
        warn(`[ontology-telemetry] CANARY FALLBACK: ${primaryPath} unwritable ` +
          `(${primaryErr && primaryErr.message}); telemetry now at ${fallback}`);
      } catch (fallbackErr) {
        fileEnabled = false;
        counters.canary_fail++;
        warn('[ontology-telemetry] CANARY FAILED: no writable telemetry sink ' +
          `(primary ${primaryPath}: ${primaryErr && primaryErr.message}; ` +
          `fallback ${fallback}: ${fallbackErr && fallbackErr.message}). ` +
          'fail_open_count remains observable IN MEMORY ONLY. Fail-open: retrieval continues.');
      }
    }
    return snapshot();
  }

  function record(event) {
    if (!canaryDone) canary(); // first-use canary (ADR-119)
    const name = (event && event.event) || 'unknown';
    const { event: _e, ...detail } = event || {};
    counters.events_total++;
    counters.last_event = name;
    counters.last_event_ts = _isoNow();
    if (typeof counters[name] === 'number') counters[name]++;
    if (name === 'fail_open') {
      if (detail.stage === 'seed') counters.fail_open_seed++;
      else if (detail.stage === 'expand') counters.fail_open_expand++;
    }
    _append({ ts: counters.last_event_ts, event: name, detail, counters: { ...counters } });
  }

  function snapshot() {
    return {
      ...counters,
      fail_open_count: counters.fail_open, // ADR-119 named observable
      file_enabled: fileEnabled,
      path: activePath,
      canary_done: canaryDone,
    };
  }

  return {
    record,
    snapshot,
    canary,
    get path() { return activePath; },
    get counters() { return { ...counters }; },
  };
}

module.exports = { createTelemetrySink, resolveTelemetryPath };
