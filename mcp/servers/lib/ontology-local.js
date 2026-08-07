'use strict';
// ontology-local.js — a local, VisionClaw-free backend for the ontology-bridge.
//
// Indexes the raw Logseq markdown corpus (the JSON-LD `Class` block in each page)
// straight off disk and serves the ontology-bridge read tools, plus a real WRITE
// path that edits the markdown in place. This is the "internal development route"
// (ADR-119 companion): when VisionClaw/Oxigraph is unreachable, the bridge falls
// back here so ontology search / navigation / grounding still works against the
// live corpus, and `ontology_axiom_add` becomes a genuine corpus edit.
//
// Activation: the bridge uses this automatically when a VisionClaw call returns a
// network-family error, or unconditionally when AGENTBOX_ONTOLOGY_LOCAL=1.
// Corpus path: AGENTBOX_ONTOLOGY_LOCAL_PATH (default: the logseq working tree).
//
// Pure Node core modules only — no deps, so it loads in any agentbox context.

const fs = require('fs');
const path = require('path');

const DEFAULT_CORPUS =
  process.env.AGENTBOX_ONTOLOGY_LOCAL_PATH ||
  '/home/devuser/workspace/logseq/mainKnowledgeGraph/pages';

const JSONLD_RE = /```json-ld\s*\n([\s\S]*?)```/g;

function slugOf(iri) {
  return String(iri || '').split(':').pop().split('/').pop();
}
function norm(s) {
  return String(s || '').toLowerCase();
}

// ── Index ────────────────────────────────────────────────────────────────────
// Lazy, mtime-stamped. Rebuilds when the newest page mtime changes so a corpus
// edit (ours or another agent's) is reflected without a process restart.
function createLocalOntology(corpusDir = DEFAULT_CORPUS) {
  let idx = null;        // { byIri, bySlug, list, labels } | null
  let builtAtNewest = 0; // newest mtimeMs seen at build time

  function classBlock(text) {
    let m;
    JSONLD_RE.lastIndex = 0;
    while ((m = JSONLD_RE.exec(text)) !== null) {
      let b;
      try { b = JSON.parse(m[1]); } catch { continue; }
      if (b && b['@type'] === 'Class') return { block: b, raw: m[1] };
    }
    return null;
  }

  function corpusFiles() {
    return fs.readdirSync(corpusDir).filter((f) => f.endsWith('.md'))
      .map((f) => path.join(corpusDir, f));
  }

  function newestMtime(files) {
    let n = 0;
    for (const f of files) {
      try { const t = fs.statSync(f).mtimeMs; if (t > n) n = t; } catch { /* skip */ }
    }
    return n;
  }

  function build() {
    const files = corpusFiles();
    const byIri = new Map(), bySlug = new Map(), list = [], labels = [];
    for (const file of files) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const cb = classBlock(text);
      if (!cb) continue;
      const b = cb.block;
      const iri = b['@id'];
      if (!iri) continue;
      const rec = {
        iri,
        slug: b['vc:slug'] || slugOf(iri),
        file: path.basename(file),
        path: file,
        label: b.label || '',
        definition: b.definition || '',
        domain: b.domain || b['vc:sourceDomain'] || '',
        maturity: b.maturity || '',
        quality: b.quality ?? b.qualityScore ?? null,
        parents: normList(b.subClassOf),
        relations: b.relations && typeof b.relations === 'object' ? b.relations : {},
      };
      byIri.set(iri, rec);
      bySlug.set(rec.slug, rec);
      list.push(rec);
      labels.push([norm(rec.label), rec]);
    }
    idx = { byIri, bySlug, list, labels };
    builtAtNewest = newestMtime(files);
    return idx;
  }

  function normList(v) {
    if (!v) return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.filter((x) => x && x['@id']).map((x) => ({ iri: x['@id'], label: x.label || x['vc:label'] || '' }));
  }

  function ensure() {
    if (!idx) return build();
    // cheap staleness check: newest mtime moved → rebuild
    try {
      if (newestMtime(corpusFiles()) !== builtAtNewest) return build();
    } catch { /* keep current index */ }
    return idx;
  }

  function resolve(iriOrSlug) {
    const ix = ensure();
    if (!iriOrSlug) return null;
    if (ix.byIri.has(iriOrSlug)) return ix.byIri.get(iriOrSlug);
    const s = slugOf(iriOrSlug);
    if (ix.bySlug.has(s)) return ix.bySlug.get(s);
    // last resort: exact label match
    const nl = norm(iriOrSlug);
    const hit = ix.labels.find(([l]) => l === nl);
    return hit ? hit[1] : null;
  }

  // ── Read surface (mirrors the bridge tool shapes) ───────────────────────────
  function health() {
    const ix = ensure();
    return {
      status: 'ok',
      backend: 'local-markdown',
      source: corpusDir,
      classCount: ix.list.length,
      note: 'Served from the raw Logseq corpus on disk (VisionClaw bypassed).',
    };
  }

  function search({ query, limit = 20, offset = 0 }) {
    const ix = ensure();
    const q = norm(query);
    const hits = ix.list
      .filter((r) => norm(r.label).includes(q) || norm(r.slug).includes(q))
      .sort((a, b) => (norm(a.label) === q ? -1 : 0) - (norm(b.label) === q ? -1 : 0) || a.label.length - b.label.length);
    return {
      backend: 'local-markdown',
      total: hits.length,
      results: hits.slice(offset, offset + limit).map(brief),
    };
  }

  function classGet({ iri }) {
    const r = resolve(iri);
    if (!r) return { error: 'not_found', message: `No local class for '${iri}'`, backend: 'local-markdown' };
    return { backend: 'local-markdown', ...full(r) };
  }

  function classList({ domain, limit = 50 }) {
    const ix = ensure();
    let l = ix.list;
    if (domain) l = l.filter((r) => r.domain === domain);
    return { backend: 'local-markdown', total: l.length, classes: l.slice(0, limit).map(brief) };
  }

  function nodeSearch({ label, node_type, limit = 20 }) {
    // node_type is a VisionClaw concept; locally everything is an owl_class.
    if (node_type && node_type !== 'owl_class' && node_type !== 'page') {
      return { backend: 'local-markdown', total: 0, results: [], note: `node_type '${node_type}' not modelled locally` };
    }
    return search({ query: label || '', limit });
  }

  function neighbors({ node_id, depth = 1 }) {
    // node_id here is an iri or slug (the local index is not u32-addressed).
    const start = resolve(node_id);
    if (!start) return { error: 'not_found', message: `No local node for '${node_id}'`, backend: 'local-markdown' };
    const seen = new Set([start.iri]);
    let frontier = [start];
    const edges = [];
    const d = Math.min(depth, 3);
    for (let hop = 0; hop < d; hop++) {
      const next = [];
      for (const r of frontier) {
        for (const p of r.parents) {
          edges.push({ from: r.iri, edge: 'subClassOf', to: p.iri, label: p.label });
          pushNode(p.iri);
        }
        for (const [rel, targets] of Object.entries(r.relations)) {
          const arr = Array.isArray(targets) ? targets : [targets];
          for (const t of arr) {
            if (!t || !t['@id']) continue;
            edges.push({ from: r.iri, edge: rel, to: t['@id'], label: t.label || '' });
            pushNode(t['@id']);
          }
        }
      }
      frontier = next;
      function pushNode(iri) {
        if (seen.has(iri)) return;
        seen.add(iri);
        const rr = resolve(iri);
        if (rr) next.push(rr);
      }
    }
    return { backend: 'local-markdown', node: brief(start), depth: d, edgeCount: edges.length, edges };
  }

  function pathfind({ source_id, target_id }) {
    const src = resolve(source_id), tgt = resolve(target_id);
    if (!src || !tgt) return { error: 'not_found', message: 'source or target not in local corpus', backend: 'local-markdown' };
    const targetIri = tgt.iri;
    const prev = new Map([[src.iri, null]]);
    const queue = [src];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.iri === targetIri) break;
      const outs = [
        ...cur.parents.map((p) => p.iri),
        ...Object.values(cur.relations).flatMap((t) => (Array.isArray(t) ? t : [t])).filter((x) => x && x['@id']).map((x) => x['@id']),
      ];
      for (const iri of outs) {
        if (prev.has(iri)) continue;
        prev.set(iri, cur.iri);
        const rr = resolve(iri);
        if (rr) queue.push(rr);
      }
    }
    if (!prev.has(targetIri)) return { backend: 'local-markdown', found: false, path: [] };
    const pathIris = [];
    for (let n = targetIri; n != null; n = prev.get(n)) pathIris.unshift(n);
    return { backend: 'local-markdown', found: true, hops: pathIris.length - 1, path: pathIris };
  }

  function graphQuery() {
    return {
      error: 'sparql_unsupported_local',
      backend: 'local-markdown',
      message: 'SPARQL is not available on the local route. Use ontology_search, ontology_class_get, ' +
        'ontology_class_list, kg_neighbors or kg_pathfind, which read the same corpus.',
    };
  }

  function validate() {
    const ix = ensure();
    let dangling = 0;
    const defined = new Set(ix.list.map((r) => r.iri));
    for (const r of ix.list) {
      for (const p of r.parents) if (p.iri.startsWith('urn:ngm:class:') && !defined.has(p.iri)) dangling++;
      for (const t of Object.values(r.relations).flat()) {
        if (t && t['@id'] && t['@id'].startsWith('urn:ngm:class:') && !defined.has(t['@id'])) dangling++;
      }
    }
    return { backend: 'local-markdown', classes: ix.list.length, danglingRelationTargets: dangling, errors: 0 };
  }

  // ── ask(): budget-bounded grounding text over the local index ────────────────
  function ask(args) {
    const { query, mode, depth } = args || {};
    const seedHits = search({ query, limit: 6 }).results;
    if (!seedHits.length) return { backend: 'local-markdown', query, subgraph: '', seeds: [], note: 'no local match' };
    if (mode === 'expand') {
      const around = neighbors({ node_id: seedHits[0].iri, depth: depth || 1 });
      return { backend: 'local-markdown', query, seed: seedHits[0], expand: around };
    }
    // menu mode: terse class summaries
    const menu = seedHits.map((h) => {
      const r = resolve(h.iri);
      return `${r.label} (${r.domain || 'no-domain'}) — ${(r.definition || '').slice(0, 160)}`;
    });
    return { backend: 'local-markdown', query, seeds: seedHits, menu };
  }

  // ── WRITE surface: edit the markdown Class block in place ────────────────────
  const AXIOM_TO_REL = {
    SubClassOf: '__parent__',
    ObjectPropertyAssertion: 'relatedTo',
    EquivalentClass: 'sameAs',
    DisjointWith: 'contrastsWith',
    SubPropertyOf: 'partOf',
    SomeValuesFrom: 'requires',
  };

  function axiomAdd({ axiom_type, subject, object }) {
    const subj = resolve(subject);
    if (!subj) return { error: 'not_found', message: `subject '${subject}' not in local corpus`, backend: 'local-markdown' };
    const objRec = resolve(object);
    const objIri = objRec ? objRec.iri : (String(object).startsWith('urn:') ? object : `urn:ngm:class:${slugOf(object)}`);
    const objLabel = objRec ? objRec.label : slugOf(object);
    const rel = AXIOM_TO_REL[axiom_type];
    if (!rel) return { error: 'unsupported_axiom_local', message: `axiom_type '${axiom_type}' not supported locally`, backend: 'local-markdown' };

    const text = fs.readFileSync(subj.path, 'utf8');
    const cb = classBlock(text);
    if (!cb) return { error: 'parse_error', message: 'class block vanished', backend: 'local-markdown' };
    const block = cb.block;

    if (rel === '__parent__') {
      const parents = Array.isArray(block.subClassOf) ? block.subClassOf : (block.subClassOf ? [block.subClassOf] : []);
      if (parents.some((p) => p['@id'] === objIri)) return { backend: 'local-markdown', changed: false, reason: 'already a parent' };
      parents.push({ '@id': objIri, label: objLabel });
      block.subClassOf = parents;
    } else {
      block.relations = block.relations && typeof block.relations === 'object' ? block.relations : {};
      const cur = Array.isArray(block.relations[rel]) ? block.relations[rel] : (block.relations[rel] ? [block.relations[rel]] : []);
      if (cur.some((t) => t['@id'] === objIri)) return { backend: 'local-markdown', changed: false, reason: `already ${rel}` };
      cur.push({ '@id': objIri, label: objLabel });
      block.relations[rel] = cur;
    }
    // provenance breadcrumb for local edits
    block.provenance = block.provenance && typeof block.provenance === 'object' ? block.provenance : {};
    block.provenance.lastLocalEdit = { rel, target: objIri, via: 'ontology-local' };

    const newRaw = JSON.stringify(block, null, 2);
    fs.writeFileSync(subj.path, text.replace(cb.raw, newRaw + '\n'), 'utf8');
    idx = null; // force reindex
    return { backend: 'local-markdown', changed: true, subject: subj.iri, relation: rel, object: objIri, file: subj.file };
  }

  // propose() locally == a direct, provenance-tagged edit (write target: markdown)
  function propose(args) {
    const a = args || {};
    const axiom = a.axiom_type || (a.relation === 'subClassOf' ? 'SubClassOf' : 'ObjectPropertyAssertion');
    return axiomAdd({ axiom_type: axiom, subject: a.subject || a.subject_iri, object: a.object || a.object_iri });
  }

  // ── projections ─────────────────────────────────────────────────────────────
  function brief(r) { return { iri: r.iri, slug: r.slug, label: r.label, domain: r.domain, maturity: r.maturity }; }
  function full(r) {
    return {
      iri: r.iri, slug: r.slug, label: r.label, definition: r.definition, domain: r.domain,
      maturity: r.maturity, quality: r.quality, file: r.file,
      subClassOf: r.parents, relations: r.relations,
    };
  }

  return {
    backend: 'local-markdown', corpusDir,
    health, search, classGet, classList, nodeSearch, neighbors, pathfind,
    graphQuery, validate, ask, axiomAdd, propose, resolve,
  };
}

module.exports = { createLocalOntology, DEFAULT_CORPUS };
