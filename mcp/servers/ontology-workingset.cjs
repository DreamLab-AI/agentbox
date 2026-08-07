#!/usr/bin/env node
'use strict';

/**
 * ontology-workingset CLI — a session-scoped, IRI-keyed working set of compacted
 * ontology-class digests carried across turns (prime-agent RLM candidate 2).
 *
 * Resolves the repo lib first, then the baked /opt copy (same pattern as
 * ontology-local.cjs / continual-harness.cjs).
 *
 *   ontology-workingset note <iri|slug> [--session <id>]   # digest + add
 *   ontology-workingset get  <iri|slug> [--session <id>]
 *   ontology-workingset list             [--session <id>]
 *   ontology-workingset drop <iri|slug>  [--session <id>]
 *   ontology-workingset clear            [--session <id>]
 *   ontology-workingset revalidate       [--session <id>]   # drift guard vs live corpus
 *
 * Session defaults to AGENTBOX_SESSION_ID (bind it to a beads epic / session URN).
 */

let mod;
try {
  mod = require('./lib/ontology-workingset.js');
} catch (_) {
  mod = require('/opt/agentbox/mcp/servers/lib/ontology-workingset.js');
}
const { createWorkingSet } = mod;

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      flags[k] = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    } else positional.push(a);
  }
  return { flags, positional };
}
function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function fail(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(1); }

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  const ws = createWorkingSet({ sessionId: typeof flags.session === 'string' ? flags.session : undefined });

  switch (cmd) {
    case 'note':
      if (!positional[0]) fail('usage: note <iri|slug>');
      out(ws.note(positional[0]));
      break;
    case 'get':
      if (!positional[0]) fail('usage: get <iri|slug>');
      out(ws.get(positional[0]) || { error: 'not_in_working_set', iri: positional[0] });
      break;
    case 'list':
      out({ sessionId: ws.sessionId, file: ws.file, count: ws.keys().length, entries: ws.entries() });
      break;
    case 'drop':
      if (!positional[0]) fail('usage: drop <iri|slug>');
      out(ws.drop(positional[0]));
      break;
    case 'clear':
      out(ws.clear());
      break;
    case 'revalidate':
      out(ws.revalidate());
      break;
    default:
      fail(`unknown command: ${cmd || '(none)'} — expected note|get|list|drop|clear|revalidate`);
  }
}

main();
