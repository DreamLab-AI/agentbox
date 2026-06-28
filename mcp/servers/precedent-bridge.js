#!/usr/bin/env node
// precedent-bridge.js — MCP server providing precedent system tools for
// the governance harness improvement loop (PRD-harness M6).
//
// Agents use these tools to promote governance decisions into reusable
// precedents, match incoming ActionRequests against existing precedents,
// list active precedents, and retire precedents that are no longer valid.
//
// Precedents are stored as JSON files under $AGENTBOX_POD_ROOT/precedents/.
// In production, the PrecedentService can be wired to RuVector MCP tools
// for semantic vector search; this bridge uses a file-based store that
// provides deterministic word-overlap matching suitable for local and
// test environments.
//
// Environment:
//   AGENTBOX_POD_ROOT — pod root directory (default: /var/lib/agentbox)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

const { PrecedentService } = require('../../management-api/lib/precedent-service');

const POD_ROOT = process.env.AGENTBOX_POD_ROOT || '/var/lib/agentbox';
const PRECEDENTS_DIR = path.join(POD_ROOT, 'precedents');

// ── file-based memory store ────────────────────────────────────────────────
// Implements the memoryStore interface using JSON files on disk.
// Each key maps to a file: <PRECEDENTS_DIR>/<key>.json
// Search uses naive word-overlap similarity (same as the in-memory test store).

function createFileStore(baseDir) {
  function _ensureDir() {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  function _filePath(key) {
    // Sanitise key for filesystem safety
    const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(baseDir, `${safe}.json`);
  }

  function _readAll() {
    _ensureDir();
    const entries = [];
    let files;
    try {
      files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
    } catch {
      return entries;
    }
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(baseDir, file), 'utf-8');
        const key = file.replace(/\.json$/, '');
        entries.push({ key, value: raw });
      } catch {
        // skip unreadable files
      }
    }
    return entries;
  }

  function _wordSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : intersection / union;
  }

  return {
    async store(key, value, _namespace) {
      _ensureDir();
      const filePath = _filePath(key);
      const tmp = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, value);
      fs.renameSync(tmp, filePath);
    },

    async search(query, _namespace, limit = 10) {
      const entries = _readAll();
      const results = entries.map(({ key, value }) => ({
        key,
        value,
        similarity: _wordSimilarity(query, value),
      }));
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, limit);
    },

    async list(_namespace, limit = 100) {
      return _readAll().slice(0, limit);
    },

    async retrieve(key, _namespace) {
      const filePath = _filePath(key);
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch {
        return null;
      }
    },
  };
}

// ── service instantiation ──────────────────────────────────────────────────

const fileStore = createFileStore(PRECEDENTS_DIR);
const service = new PrecedentService({ memoryStore: fileStore });

// ── tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'precedent_match',
    description: 'Search for a matching governance precedent given a title, description, and optional category. Returns the best match if similarity exceeds the configured threshold.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'ActionRequest title to match against' },
        description: { type: 'string', description: 'ActionRequest description to match against' },
        category: { type: 'string', description: 'Optional decision category to narrow the search' },
      },
      required: ['title', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'precedent_list',
    description: 'List all active (non-retired) governance precedents.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 20)', default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'precedent_promote',
    description: 'Store a new governance precedent from a human decision. Once promoted, similar future ActionRequests can be auto-decided.',
    inputSchema: {
      type: 'object',
      properties: {
        case_id: { type: 'string', description: 'Unique case identifier for this precedent' },
        outcome: { type: 'string', description: 'Decision outcome (approve, reject, defer, etc.)' },
        reason: { type: 'string', description: 'Human-readable reason for the decision' },
        category: { type: 'string', description: 'Decision category for semantic matching' },
        decided_by: { type: 'string', description: 'Pubkey hex of the deciding human operator' },
        event_id: { type: 'string', description: 'Originating ActionResponse event ID' },
      },
      required: ['case_id', 'outcome', 'reason', 'category'],
      additionalProperties: false,
    },
  },
  {
    name: 'precedent_retire',
    description: 'Retire a governance precedent so it no longer auto-matches. Use when a precedent is outdated or a human override invalidates it.',
    inputSchema: {
      type: 'object',
      properties: {
        case_id: { type: 'string', description: 'Case ID of the precedent to retire' },
        reason: { type: 'string', description: 'Reason for retiring the precedent' },
      },
      required: ['case_id'],
      additionalProperties: false,
    },
  },
];

// ── tool handlers ──────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case 'precedent_match': {
      if (!args.title || typeof args.title !== 'string') {
        return { error: 'validation_error', message: 'title must be a non-empty string' };
      }
      if (!args.description || typeof args.description !== 'string') {
        return { error: 'validation_error', message: 'description must be a non-empty string' };
      }
      const result = await service.matchPrecedent({
        title: args.title,
        description: args.description,
        category: args.category || '',
      });
      return result;
    }

    case 'precedent_list': {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 200);
      const result = await service.listPrecedents({ limit });
      return result;
    }

    case 'precedent_promote': {
      if (!args.case_id || typeof args.case_id !== 'string') {
        return { error: 'validation_error', message: 'case_id must be a non-empty string' };
      }
      if (!args.outcome || typeof args.outcome !== 'string') {
        return { error: 'validation_error', message: 'outcome must be a non-empty string' };
      }
      if (!args.reason || typeof args.reason !== 'string') {
        return { error: 'validation_error', message: 'reason must be a non-empty string' };
      }
      if (!args.category || typeof args.category !== 'string') {
        return { error: 'validation_error', message: 'category must be a non-empty string' };
      }
      const result = await service.storePrecedent({
        caseId: args.case_id,
        outcome: args.outcome,
        reason: args.reason,
        category: args.category,
        decidedBy: args.decided_by || '',
        eventId: args.event_id || '',
      });
      return result;
    }

    case 'precedent_retire': {
      if (!args.case_id || typeof args.case_id !== 'string') {
        return { error: 'validation_error', message: 'case_id must be a non-empty string' };
      }
      try {
        const result = await service.retirePrecedent({
          caseId: args.case_id,
          reason: args.reason || '',
        });
        return result;
      } catch (err) {
        if (err.name === 'PrecedentError') {
          return { error: 'not_found', message: err.message };
        }
        throw err;
      }
    }

    default:
      return { error: 'unknown_tool', message: `Tool ${name} not found` };
  }
}

// ── MCP server wiring ──────────────────────────────────────────────────────

const server = new Server(
  { name: 'precedent-bridge', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler({ method: 'tools/list' }, async () => ({ tools: TOOLS }));

server.setRequestHandler({ method: 'tools/call' }, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleTool(name, args || {});
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[precedent-bridge] Connected to MCP, precedents_dir=${PRECEDENTS_DIR}`);
