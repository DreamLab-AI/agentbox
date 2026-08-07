#!/usr/bin/env node
// substrate-tools.js — MCP server exposing the prime-agent-inspired substrate
// capabilities as first-class tools:
//
//   continual-harness (candidate 1) — refine / refine_validate / refine_rollback
//                                      / refine_history / refine_list
//   ontology working set (candidate 2) — ws_note / ws_get / ws_list / ws_drop
//                                        / ws_revalidate
//   typed spawn (candidate 4) — spawn_child / spawn_ready / spawn_complete
//
// The heavy logic lives in the CJS libs under ./lib/; this file is a thin MCP
// adapter over them (loaded via createRequire, same trick harness-bridge uses
// for Ajv). Every call constructs its backend fresh so external edits are seen
// immediately, matching the other agentbox bridges.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { createHarness } = _require('./lib/continual-harness.js');
const { createWorkingSet } = _require('./lib/ontology-workingset.js');
const { createSpawnContext } = _require('./lib/typed-spawn.js');

// ── tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  // continual-harness (candidate 1)
  {
    name: 'refine',
    description: 'Evidence-anchored, signed, git-rollbackable refine of the mutable harness layer. Never touches the immutable base (CLAUDE.md tiers). layer ∈ supplemental-prompt|memory|skill-spec|subagent-spec. Evidence is REQUIRED — cite the transcript span / commit / test that justifies the change.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['supplemental-prompt', 'memory', 'skill-spec', 'subagent-spec'] },
        key: { type: 'string', description: 'slug [a-z0-9-], <=128 chars' },
        value: { type: 'string', description: 'the refined content' },
        evidence: { type: 'string', description: 'transcript span / commit / test justifying the refine' },
        reason: { type: 'string' },
        actor: { type: 'string' },
      },
      required: ['layer', 'key', 'value', 'evidence'],
      additionalProperties: false,
    },
  },
  {
    name: 'refine_validate',
    description: 'Guard: does a ref (default HEAD) touch ONLY the mutable harness layer and never the immutable base? Returns { compliant, violations }.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'refine_rollback',
    description: 'Roll back a specific refine via git revert (history preserved).',
    inputSchema: { type: 'object', properties: { commit: { type: 'string' } }, required: ['commit'], additionalProperties: false },
  },
  {
    name: 'refine_history',
    description: 'Commit log for the harness, a layer, or a single key.',
    inputSchema: {
      type: 'object',
      properties: { layer: { type: 'string' }, key: { type: 'string' }, limit: { type: 'integer' } },
      additionalProperties: false,
    },
  },
  {
    name: 'refine_list',
    description: 'Current contents of the mutable harness layer, by layer.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  // ontology working set (candidate 2)
  {
    name: 'ws_note',
    description: 'Bring an ontology class (IRI or slug) into the session working set as a compacted, fingerprinted digest (not raw triples). Carried across turns.',
    inputSchema: {
      type: 'object',
      properties: { iri: { type: 'string' }, session: { type: 'string' } },
      required: ['iri'], additionalProperties: false,
    },
  },
  {
    name: 'ws_get',
    description: 'Get a digest back from the working set (slug resolves to canonical IRI).',
    inputSchema: { type: 'object', properties: { iri: { type: 'string' }, session: { type: 'string' } }, required: ['iri'], additionalProperties: false },
  },
  {
    name: 'ws_list',
    description: 'List the session working set (IRI-keyed digests).',
    inputSchema: { type: 'object', properties: { session: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'ws_drop',
    description: 'Remove an entry from the working set.',
    inputSchema: { type: 'object', properties: { iri: { type: 'string' }, session: { type: 'string' } }, required: ['iri'], additionalProperties: false },
  },
  {
    name: 'ws_revalidate',
    description: 'Drift guard: recompute each entry fingerprint from the live corpus; flag drifted/missing classes before reuse.',
    inputSchema: { type: 'object', properties: { session: { type: 'string' } }, additionalProperties: false },
  },

  // typed spawn (candidate 4)
  {
    name: 'spawn_child',
    description: 'Spawn a typed, DID-owned child under a parent epic: mint a child bead (work-DAG), validate typed input IRIs against the corpus, register blocking deps. Creates the epic if epic_id omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        skill: { type: 'string' },
        input_iris: { type: 'array', items: { type: 'string' } },
        blocked_by: { type: 'array', items: { type: 'string' } },
        epic_id: { type: 'string' },
        epic_title: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['title'], additionalProperties: false,
    },
  },
  {
    name: 'spawn_ready',
    description: 'Children ready to run under an epic — unblocked in the work-DAG (all blockers closed).',
    inputSchema: { type: 'object', properties: { epic_id: { type: 'string' }, owner: { type: 'string' } }, required: ['epic_id'], additionalProperties: false },
  },
  {
    name: 'spawn_complete',
    description: 'Complete a child: validate typed output IRIs, then close the bead.',
    inputSchema: {
      type: 'object',
      properties: {
        bead_id: { type: 'string' },
        epic_id: { type: 'string' },
        output_iris: { type: 'array', items: { type: 'string' } },
        outcome: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['bead_id', 'epic_id'], additionalProperties: false,
    },
  },
];

// ── tool handlers ───────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    // continual-harness
    case 'refine': {
      const h = createHarness();
      return h.refine(args);
    }
    case 'refine_validate': return createHarness().validate(args.ref || 'HEAD');
    case 'refine_rollback': return createHarness().rollback(args.commit);
    case 'refine_history': return { history: createHarness().history(args) };
    case 'refine_list': { const h = createHarness(); return { harnessDir: h.harnessDir, operator: h.operator, layers: h.list() }; }

    // working set
    case 'ws_note': return createWorkingSet({ sessionId: args.session }).note(args.iri);
    case 'ws_get': { const ws = createWorkingSet({ sessionId: args.session }); return ws.get(args.iri) || { error: 'not_in_working_set', iri: args.iri }; }
    case 'ws_list': { const ws = createWorkingSet({ sessionId: args.session }); return { sessionId: ws.sessionId, count: ws.keys().length, entries: ws.entries() }; }
    case 'ws_drop': return createWorkingSet({ sessionId: args.session }).drop(args.iri);
    case 'ws_revalidate': return createWorkingSet({ sessionId: args.session }).revalidate();

    // typed spawn (persistent beads.db so ready/complete see prior state)
    case 'spawn_child': {
      const ctx = await createSpawnContext({ epicId: args.epic_id, epicTitle: args.epic_title, owner: args.owner, dbPath: process.env.AGENTBOX_BEADS_DB });
      const child = await ctx.spawnChild({ title: args.title, skill: args.skill, inputIris: args.input_iris, blockedBy: args.blocked_by });
      return { ...child, epicId: ctx.epicId };
    }
    case 'spawn_ready': {
      const ctx = await createSpawnContext({ epicId: args.epic_id, owner: args.owner, dbPath: process.env.AGENTBOX_BEADS_DB });
      return { epicId: ctx.epicId, ready: await ctx.ready() };
    }
    case 'spawn_complete': {
      const ctx = await createSpawnContext({ epicId: args.epic_id, owner: args.owner, dbPath: process.env.AGENTBOX_BEADS_DB });
      return ctx.completeChild(args.bead_id, { outputIris: args.output_iris, outcome: args.outcome });
    }

    default:
      return { error: 'unknown_tool', message: `Tool ${name} not found` };
  }
}

// ── MCP server wiring ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'substrate-tools', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  let result;
  try {
    result = await handleTool(name, args || {});
  } catch (err) {
    result = { error: 'tool_error', message: err && err.message ? err.message : String(err) };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[substrate-tools] Connected to MCP — continual-harness + working-set + typed-spawn');
