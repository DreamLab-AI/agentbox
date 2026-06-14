#!/usr/bin/env node
'use strict';
// ontology-ask.cjs — shell-native front-end to the ontology binding's PULL channel.
// Uses the SAME createDefaultRetrieval() brain as the ontology-bridge MCP tool and the
// consultant seam, so CLI output matches in-agent grounding exactly.
//
//   node ontology-ask.cjs "<query>" [--tier haiku|sonnet|opus] [--mode menu|expand]
//                                   [--full] [--domain ai|bc|mv|rb|tc|ngm]
//                                   [--depth N] [--sparql] [--json]
//
// Env (inherited from agentbox): VISIONCLAW_API_URL, VISIONCLAW_DEV_TOKEN,
// AGENTBOX_PUBKEY, ONTOLOGY_TIMEOUT_MS. Fail-open: backend down ⇒ empty result, exit 0.

const fs = require('fs');

// Resolve the retrieval lib. Prefer the repo checkout (source of truth, always
// current) over the baked /opt copy, which can lag behind un-rebuilt edits.
const CANDIDATES = [
  '/home/devuser/workspace/project/agentbox/mcp/servers/lib/ontology-retrieval.js',
  require('path').resolve(__dirname, '../../../mcp/servers/lib/ontology-retrieval.js'),
  '/opt/agentbox/mcp/servers/lib/ontology-retrieval.js',
];
let createDefaultRetrieval;
for (const p of CANDIDATES) {
  try { if (fs.existsSync(p)) { ({ createDefaultRetrieval } = require(p)); break; } } catch { /* next */ }
}
if (!createDefaultRetrieval) {
  console.error('ERROR: ontology-retrieval.js not found. Looked in:\n  ' + CANDIDATES.join('\n  '));
  process.exit(2);
}

function flag(name) { return process.argv.includes('--' + name); }
function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

// First non-flag arg (and not a flag's value) is the query.
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['tier', 'mode', 'domain', 'depth']);
let query = '';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { if (VALUE_FLAGS.has(a.slice(2))) i++; continue; }
  query = a; break;
}
if (!query) {
  console.error('Usage: ontology-ask.cjs "<query>" [--tier sonnet] [--mode expand] [--full] [--domain bc] [--sparql] [--json]');
  process.exit(2);
}

const req = {
  query,
  model_tier: opt('tier', 'sonnet'),
  mode: opt('mode'),
  domain: opt('domain'),
  depth: opt('depth') != null ? parseInt(opt('depth'), 10) : undefined,
  full: flag('full'),
};

if (flag('sparql')) {
  // Show the read-only SPARQL the binding would use to fetch seeds for this query.
  const PREFIXES = `PREFIX vc: <https://narrativegoldmine.com/ns/v1#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>`;
  const term = query.replace(/"/g, '\\"');
  console.log(`${PREFIXES}
SELECT ?c ?label WHERE {
  ?c a owl:Class ; rdfs:label ?label .
  FILTER(CONTAINS(LCASE(STR(?label)), LCASE("${term}")))
} LIMIT 50`);
  process.exit(0);
}

(async () => {
  const { ask } = createDefaultRetrieval();
  const r = await ask(req);
  if (flag('json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`query    : ${query}`);
  console.log(`tier=${req.model_tier} mode=${r.provenance ? (req.mode || 'auto') : '-'} seeds=${r.seed_iris.length} tokens=${r.tokens_used} truncated=${r.truncated} degraded=${r.degraded} full_denied=${r.full_denied} ${r.latency_ms}ms`);
  console.log(`breadcrumb: ${r.breadcrumb || '(none — below floor / no seeds)'}`);
  if (r.error) console.log(`error    : ${r.error}`);
  // Explicit hierarchy summary: children (subclasses) of the top seed are the
  // triples where the seed is the OBJECT of subClassOf; parents are where it's
  // the subject. Surface them plainly so "subclasses of X" is unambiguous.
  if (r.turtle && r.seed_iris && r.seed_iris.length) {
    const seed0 = r.seed_iris[0];
    const ln = (s) => s.replace(/[<>]/g, '').split(/[#/:]/).pop();
    const kids = [], parents = [];
    for (const l of r.turtle.split('\n')) {
      const m = l.match(/^<([^>]+)> <[^>]*subClassOf> <([^>]+)>/);
      if (!m) continue;
      if (m[2] === seed0) kids.push(ln('<' + m[1] + '>'));
      else if (m[1] === seed0) parents.push(ln('<' + m[2] + '>'));
    }
    if (kids.length) console.log(`SUBCLASSES (children) of ${ln('<' + seed0 + '>')}: ${[...new Set(kids)].join(', ')}`);
    if (parents.length) console.log(`parents of ${ln('<' + seed0 + '>')}: ${[...new Set(parents)].join(', ')}`);
  }
  if (r.turtle) { console.log('--- turtle ---'); console.log(r.turtle); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
