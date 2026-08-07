'use strict';

/**
 * ontology-workingset — a session-scoped, IRI-keyed working set of the ontology
 * classes touched during a task, held as COMPACTED DIGESTS carried across turns.
 *
 * Adapted from prime-agent's RLM "context-as-variables" (PrimeIntellect-ai/prime-agent),
 * bound to our substrate. We do NOT adopt prime's naive REPL-dict kernel — a
 * queryable, reasoned, fail-open triplestore (ontology-bridge / ontology-local)
 * is already the strong form of "the corpus as a variable". This closes the two
 * disciplines we actually lacked:
 *
 *   1. a SESSION-SCOPED WORKING SET — the class IRIs a task has touched, held as
 *      named, IRI-keyed variables persisted across turns (keyed to the session's
 *      beads epic / session URN via AGENTBOX_SESSION_ID), instead of today's
 *      stateless per-call ontology_ask.
 *   2. DIGEST-not-raw — each entry is a lean summary produced by a digest step
 *      (the "digest subagent"; a deterministic local compaction by default, or an
 *      injected subagent-backed digestFn), so the parent context never carries
 *      raw triples.
 *
 * Drift guard: every entry stores a canonical source fingerprint; revalidate()
 * recomputes it from the live corpus so a stale working set can be caught before
 * reuse (pair with pipeline.gate for the full consistency check).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function stateDir() {
  return process.env.AGENTBOX_STATE || process.env.AGENTBOX_STATE_DIR || '/home/devuser/.agentbox';
}
function workingSetDir() {
  return process.env.AGENTBOX_WORKINGSET_DIR || path.join(stateDir(), 'working-sets');
}

/** Canonical fingerprint of a class over the fields a refine could change. */
function fingerprintClass(cls) {
  const parents = (cls.parents || []).map((p) => p['@id'] || p.iri || p).sort();
  const rels = Object.entries(cls.relations || {})
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((t) => `${k}:${t['@id'] || t.iri || t}`))
    .sort();
  const canon = `${cls.label || ''}\n${cls.definition || ''}\n${parents.join(',')}\n${rels.join(',')}`;
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

/**
 * Default digest — compact a class into a lean summary. This is the deterministic
 * stand-in for a "digest subagent"; callers may inject a subagent-backed digestFn
 * that returns a richer compaction. Either way the parent stores this, not triples.
 */
function defaultDigest(ontology, iri) {
  const cls = ontology.classGet({ iri });
  if (cls.error) return null;
  const nb = ontology.neighbors({ node_id: iri, depth: 1 });
  const relNames = [...new Set((nb.edges || []).map((e) => e.edge))];
  const def = (cls.definition || '').trim();
  return {
    iri: cls.iri,
    label: cls.label,
    domain: cls.domain,
    maturity: cls.maturity,
    definition: def.length > 240 ? `${def.slice(0, 237)}…` : def,
    parentCount: (cls.parents || []).length,
    edgeCount: nb.edgeCount || 0,
    relations: relNames,
  };
}

/**
 * @param {object} [opts]
 * @param {string}   [opts.sessionId]  - working-set key (default AGENTBOX_SESSION_ID or 'default')
 * @param {object}   [opts.ontology]   - a createLocalOntology()-shaped backend
 * @param {Function} [opts.digestFn]   - (iri) => digest object (default: deterministic local compaction)
 */
function createWorkingSet(opts = {}) {
  const sessionId = opts.sessionId || process.env.AGENTBOX_SESSION_ID || 'default';
  let ontology = opts.ontology;
  if (!ontology) {
    const { createLocalOntology } = require('./ontology-local.js');
    ontology = createLocalOntology();
  }
  const digestFn = opts.digestFn || ((iri) => defaultDigest(ontology, iri));
  const file = path.join(workingSetDir(), `${sessionId.replace(/[^a-zA-Z0-9._:-]/g, '_')}.json`);

  function load() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return { sessionId, created: new Date().toISOString(), entries: {} };
    }
  }
  let state = load();

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    state.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  }

  /** Bring an IRI into the working set as a compacted, fingerprinted digest. */
  function note(iri) {
    const cls = ontology.classGet({ iri });
    if (cls.error) return { error: 'not_found', iri };
    const d = digestFn(iri) || {};
    // Always attach the CANONICAL source fingerprint (not the digestFn's), so
    // revalidate() can detect drift regardless of how the digest was produced.
    state.entries[cls.iri] = { ...d, iri: cls.iri, fingerprint: fingerprintClass(cls), notedAt: new Date().toISOString() };
    save();
    return state.entries[cls.iri];
  }

  // Entries are keyed by canonical IRI (as note() stored them); a caller may pass
  // a bare slug, so resolve to the stored key before lookup/removal.
  function canonKey(iri) {
    if (state.entries[iri]) return iri;
    const c = ontology.classGet({ iri });
    return c && !c.error ? c.iri : iri;
  }
  function get(iri) { return state.entries[canonKey(iri)] || null; }
  function keys() { return Object.keys(state.entries); }
  function entries() { return state.entries; }
  function drop(iri) { const k = canonKey(iri); const had = !!state.entries[k]; delete state.entries[k]; save(); return { dropped: had, iri: k }; }
  function clear() { state.entries = {}; save(); return { cleared: true }; }

  /** Recompute each entry's fingerprint from the live corpus; flag drift/removal. */
  function revalidate() {
    const drifted = [];
    const missing = [];
    let ok = 0;
    for (const iri of keys()) {
      const cls = ontology.classGet({ iri });
      if (cls.error) { missing.push(iri); continue; }
      const now = fingerprintClass(cls);
      if (now !== state.entries[iri].fingerprint) drifted.push({ iri, was: state.entries[iri].fingerprint, now });
      else ok += 1;
    }
    return { sessionId, total: keys().length, ok, drifted, missing };
  }

  return { sessionId, file, note, get, keys, entries, drop, clear, revalidate };
}

module.exports = { createWorkingSet, defaultDigest, fingerprintClass };
