'use strict';
// ontology-push.js — the synchronous PUSH-channel breadcrumb generator
// (PRD-020 WS-5 / ADR-112 §2.2). Runs inside the UserPromptSubmit hook, so it
// MUST be synchronous, <15ms, and do NO network I/O (the adversarial review
// killed the async-network design). It reads a LOCAL pre-warmed Class-Summary
// cache and does a trigram match — mirroring intelligence.cjs getContext.
//
// Until the WS-2 condensation mesh populates the cache, this no-ops (returns
// null) — which is the correct default-off behaviour. Fail-open everywhere.

const fs = require('fs');
const path = require('path');
const budget = require('./ontology-budget');

const DEFAULT_CACHE = process.env.ONTOLOGY_PUSH_CACHE
  || path.join(process.env.HOME || '/home/devuser', '.claude-flow/data/ontology-classes-cache.json');
const MIN_RELEVANCE = parseFloat(process.env.ONTOLOGY_PUSH_MIN_RELEVANCE || '0.3');

function trigrams(s) {
  const t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const g = new Set();
  const w = ' ' + t + ' ';
  for (let i = 0; i < w.length - 2; i++) g.add(w.slice(i, i + 3));
  return g;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

let _cache = null, _cachePath = null, _cacheMtime = -1;
function loadCache(p) {
  try {
    const st = fs.statSync(p);
    if (_cache && _cachePath === p && st.mtimeMs === _cacheMtime) return _cache;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const classes = Array.isArray(raw) ? raw : (raw.classes || []);
    _cache = classes.map((c) => ({
      iri: c.iri, label: c.label, domain: c.domain, maturity: c.maturity,
      _g: trigrams(`${c.label || ''} ${(c.terms || []).join(' ')} ${c.domain || ''}`),
    }));
    _cachePath = p; _cacheMtime = st.mtimeMs;
    return _cache;
  } catch {
    return null; // no cache file yet (pre-WS-2) → no-op
  }
}

/**
 * Synchronous breadcrumb for one turn. Returns a single clamped `[ONTOLOGY]`
 * line, or null (off-topic / no cache / any error). NEVER throws, NEVER awaits.
 * @returns {string|null}
 */
function getOntologyBreadcrumb(prompt, opts = {}) {
  try {
    if (!prompt || !String(prompt).trim()) return null;
    const classes = loadCache(opts.cachePath || DEFAULT_CACHE);
    if (!classes || !classes.length) return null;
    const pg = trigrams(prompt);
    let best = null, bestScore = 0;
    for (const c of classes) {
      const s = jaccard(pg, c._g);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    const floor = opts.minRelevance != null ? opts.minRelevance : MIN_RELEVANCE;
    if (!best || bestScore < floor) return null; // relevance null-gate → 0 tokens
    const tags = [best.maturity, best.domain].filter(Boolean).join(', ');
    const ln = (best.iri ? best.iri.split(/[#/:]/).pop() : best.label) || 'class';
    const line = `[ONTOLOGY] seed: vc:${ln}${tags ? ` (${tags})` : ''} → expand via ontology_ask`;
    return budget.clampBreadcrumb(line).line;
  } catch {
    return null;
  }
}

module.exports = { getOntologyBreadcrumb, _loadCache: loadCache, _trigrams: trigrams, _jaccard: jaccard };
