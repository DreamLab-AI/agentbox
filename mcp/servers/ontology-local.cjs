#!/usr/bin/env node
'use strict';
// ontology-local.cjs — shell-native front-end to the LOCAL ontology route.
//
// Drives lib/ontology-local.js directly against the raw markdown corpus, with no
// VisionClaw and no MCP round-trip. This is the internal development path: use it
// to search / navigate / ground / write the ontology while the production
// VisionClaw service is down (or just for fast offline iteration).
//
//   node ontology-local.cjs health
//   node ontology-local.cjs search "gaussian splatting" [--limit 10]
//   node ontology-local.cjs get <iri|slug>
//   node ontology-local.cjs list [--domain artificial-intelligence] [--limit 50]
//   node ontology-local.cjs neighbors <iri|slug> [--depth 2]
//   node ontology-local.cjs path <src> <tgt>
//   node ontology-local.cjs ask "<query>" [--mode menu|expand] [--depth N]
//   node ontology-local.cjs validate
//   node ontology-local.cjs add <subject> <SubClassOf|relatedTo|contrastsWith|requires|partOf|sameAs> <object>
//
// Corpus path: AGENTBOX_ONTOLOGY_LOCAL_PATH (default: the logseq working tree).
// Output is JSON on stdout. Prefer the repo lib (source of truth) over /opt.

const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  path.resolve(__dirname, 'lib/ontology-local.js'),
  '/home/devuser/workspace/project/agentbox/mcp/servers/lib/ontology-local.js',
  '/opt/agentbox/mcp/servers/lib/ontology-local.js',
];
let createLocalOntology;
for (const p of CANDIDATES) {
  try { if (fs.existsSync(p)) { ({ createLocalOntology } = require(p)); break; } } catch { /* next */ }
}
if (!createLocalOntology) {
  console.error('ERROR: ontology-local.js not found in:\n  ' + CANDIDATES.join('\n  '));
  process.exit(2);
}

const argv = process.argv.slice(2);
function opt(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const RELATION_TO_AXIOM = {
  SubClassOf: 'SubClassOf', subclassof: 'SubClassOf',
  relatedTo: 'ObjectPropertyAssertion', contrastsWith: 'DisjointWith',
  requires: 'SomeValuesFrom', partOf: 'SubPropertyOf', sameAs: 'EquivalentClass',
};

function main() {
  const onto = createLocalOntology(process.env.AGENTBOX_ONTOLOGY_LOCAL_PATH);
  const cmd = positional[0];
  let out;
  switch (cmd) {
    case 'health': out = onto.health(); break;
    case 'search': out = onto.search({ query: positional[1] || '', limit: +opt('limit', 20) }); break;
    case 'get': out = onto.classGet({ iri: positional[1] }); break;
    case 'list': out = onto.classList({ domain: opt('domain'), limit: +opt('limit', 50) }); break;
    case 'neighbors': out = onto.neighbors({ node_id: positional[1], depth: +opt('depth', 1) }); break;
    case 'path': out = onto.pathfind({ source_id: positional[1], target_id: positional[2] }); break;
    case 'ask': out = onto.ask({ query: positional[1] || '', mode: opt('mode', 'menu'), depth: +opt('depth', 1) }); break;
    case 'validate': out = onto.validate(); break;
    case 'add': {
      const [, subject, relation, object] = positional;
      const axiom_type = RELATION_TO_AXIOM[relation] || relation;
      out = onto.axiomAdd({ axiom_type, subject, object });
      break;
    }
    default:
      console.error('Unknown command. See header for usage.');
      process.exit(2);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main();
