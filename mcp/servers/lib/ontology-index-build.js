'use strict';
// ontology-index-build.js — WS-2 corpus parser (PRD-020 / ADR-113/114).
// Deterministically extracts the v2 `@type:Class` JSON-LD block from every
// logseq page into a compact class record. Fast, complete, no LLM. The Haiku
// condensation mesh + RuVector storage run as a separate parallel pass over
// this output; this script is also the refresh-on-GitHubSync entry point.
//
// Usage: node ontology-index-build.js [pagesDir] [outFile]

const fs = require('fs');
const path = require('path');

const PAGES_DIR = process.argv[2]
  || process.env.ONTOLOGY_PAGES_DIR
  || '/home/devuser/workspace/logseq/mainKnowledgeGraph/pages';
const OUT = process.argv[3] || '/tmp/onto-classes.json';

function extractJsonLdBlocks(md) {
  const blocks = [];
  const re = /```json-ld\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    try { blocks.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return blocks;
}

function relLabels(relations) {
  // relations: { uses:[{@id,label}], enables:[...], relatedTo:[...] }
  const out = [];
  if (relations && typeof relations === 'object') {
    for (const [rel, arr] of Object.entries(relations)) {
      if (Array.isArray(arr)) for (const t of arr) {
        if (t && t.label) out.push({ type: rel, label: t.label });
      }
    }
  }
  return out;
}

function terms(label, rels, domain, definition) {
  const bag = new Set();
  const add = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).forEach((w) => { if (w.length > 2) bag.add(w); });
  add(label); add(domain);
  for (const r of rels) add(r.label);
  // a few salient words from the definition (first ~30 words)
  add(String(definition || '').split(/\s+/).slice(0, 30).join(' '));
  return Array.from(bag).slice(0, 24);
}

function main() {
  const files = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.md'));
  const records = [];
  let noClass = 0;
  for (const f of files) {
    let md;
    try { md = fs.readFileSync(path.join(PAGES_DIR, f), 'utf8'); } catch { continue; }
    const blocks = extractJsonLdBlocks(md);
    const cls = blocks.find((b) => b && (b['@type'] === 'Class' || b['@type'] === 'owl:Class'));
    if (!cls) { noClass++; continue; }
    const iri = cls['@id'];
    if (!iri) continue;
    const rels = relLabels(cls.relations);
    const parents = Array.isArray(cls.subClassOf)
      ? cls.subClassOf.map((p) => (p && p.label) || '').filter(Boolean) : [];
    const definition = cls.definition || '';
    records.push({
      iri,
      slug: cls['vc:slug'] || iri.split(':').pop(),
      label: cls.label || f.replace(/\.md$/, ''),
      definition,
      domain: cls.domain || '',
      maturity: cls.maturity || '',
      parents,
      relations: rels,
      terms: terms(cls.label, rels, cls.domain, definition),
      file: f,
    });
  }
  fs.writeFileSync(OUT, JSON.stringify(records));

  // Also (re)write the PUSH-channel Class-Summary cache so this script is the
  // single startup/refresh entry point. ~/.claude-flow/data is ephemeral and is
  // wiped on rebuild, so the entrypoint MUST run this on boot (PRD-020 WS-2) —
  // the breadcrumb no-ops without it. Optional alias merge from ONTOLOGY_ALIASES
  // (a durable {iri:[aliases]} JSON the condensation mesh can persist).
  const CACHE = process.env.ONTOLOGY_PUSH_CACHE
    || path.join(process.env.HOME || '/home/devuser', '.claude-flow/data/ontology-classes-cache.json');
  let aliases = {};
  if (process.env.ONTOLOGY_ALIASES) {
    try { aliases = JSON.parse(fs.readFileSync(process.env.ONTOLOGY_ALIASES, 'utf8')); } catch { /* base cache only */ }
  }
  const cache = records.map((r) => {
    const t = new Set(r.terms || []);
    for (const a of (aliases[r.iri] || [])) for (const w of String(a).toLowerCase().replace(/-/g, ' ').split(/\s+/)) if (w.length > 2) t.add(w);
    return { iri: r.iri, label: r.label, domain: r.domain, maturity: r.maturity, terms: [...t].slice(0, 40) };
  });
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify({ classes: cache }));

  const withDef = records.filter((r) => r.definition && r.definition.length > 40).length;
  console.log(JSON.stringify({
    pages: files.length,
    classes: records.length,
    no_class_block: noClass,
    with_substantial_definition: withDef,
    out: OUT,
    push_cache: CACHE,
    aliases_merged: Object.keys(aliases).length,
    sample: records.slice(0, 2).map((r) => ({ iri: r.iri, label: r.label, domain: r.domain, maturity: r.maturity, def_len: r.definition.length, rels: r.relations.length, terms: r.terms.slice(0, 6) })),
  }, null, 2));
}

main();
