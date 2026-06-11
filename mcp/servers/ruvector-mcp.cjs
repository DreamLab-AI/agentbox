#!/usr/bin/env node
'use strict';
/**
 * ruvector-mcp.cjs — claude-flow MCP server with ruvector-postgres memory
 *
 * Replaces `claude-flow mcp start` so that memory_store/search/list/retrieve
 * route to ruvector-postgres instead of the bundled sql.js fallback.
 *
 * Backed by: pg module (searched in workspace, management-api, or global)
 * Embeddings: xinference /v1/embeddings (bge-small-en-v1.5, 384-dim)
 * Connection: $RUVECTOR_PG_CONNINFO or defaults to docker service name
 */

const readline = require('readline');
const { createMemoryTools } = require('./lib/memory-tools');

// ── PostgreSQL pool ───────────────────────────────────────────────────────────

const PG_SEARCH_PATHS = [
  '/home/devuser/workspace/.claude-pg/node_modules/pg',
  '/opt/agentbox/management-api/node_modules/pg',
  'pg',
];
let pool = null;
let pgOk = false;

try {
  let PgModule;
  for (const p of PG_SEARCH_PATHS) {
    try { PgModule = require(p); break; } catch {}
  }
  if (!PgModule) throw new Error('pg not found in any search path');
  const { Pool } = PgModule;
  const conninfo = process.env.RUVECTOR_PG_CONNINFO ||
    'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector';
  const parsed = {};
  for (const pair of conninfo.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) parsed[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  pool = new Pool({
    host:     parsed.host     || 'ruvector-postgres',
    port:     parseInt(parsed.port || '5432', 10),
    database: parsed.dbname   || parsed.database || 'ruvector',
    user:     parsed.user     || parsed.username || 'ruvector',
    password: parsed.password || 'ruvector',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pgOk = true;
} catch (e) {
  process.stderr.write(`[FATAL] [cf-mcp-ruvector] pg module unavailable — cannot start.\n`);
  process.stderr.write(`  Searched: ${PG_SEARCH_PATHS.join(', ')}\n`);
  process.stderr.write(`  NODE_PATH: ${process.env.NODE_PATH || '(unset)'}\n`);
  process.stderr.write(`  Error: ${e.message}\n`);
  process.stderr.write(`  Fix: npm install --prefix /home/devuser/workspace/.claude-pg pg\n`);
  process.exit(1);
}

const WRITE_SOURCE_TYPE = 'agentbox';
const VERSION = '2.3.0-ruvector';

// Fire-and-forget RuVector-access → VisionClaw memory-flash beacon. Defensive
// require: if the notifier (or its require path) is unavailable, memory ops
// proceed silently — the beacon is best-effort and never load-bearing.
let notifyMemoryFlash = () => {};
let notifyMemoryFlashBatch = () => {};
try {
  const mf = require('../../management-api/lib/memory-flash-notifier');
  notifyMemoryFlash = mf.notifyMemoryFlash;
  notifyMemoryFlashBatch = mf.notifyMemoryFlashBatch;
} catch { /* notifier unavailable — RuVector ops run without visual beacons */ }

// ── Xinference embedding client ───────────────────────────────────────────────
const http = require('http');
const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
const EMBEDDING_DIM = 384;
let xinferenceOk = false;

async function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  return new Promise((resolve, reject) => {
    const url = new URL(XINFERENCE_URL + '/v1/embeddings');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.data && j.data[0] && j.data[0].embedding) {
            const emb = j.data[0].embedding;
            if (emb.length === EMBEDDING_DIM) { resolve(emb); return; }
            reject(new Error(`dimension mismatch: got ${emb.length}, expected ${EMBEDDING_DIM}`));
          } else {
            reject(new Error(`unexpected response: ${data.substring(0, 200)}`));
          }
        } catch (e) { reject(new Error(`parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function vecToSql(arr) { return '[' + arr.join(',') + ']'; }

function entryId(namespace, key) { return `${WRITE_SOURCE_TYPE}:${namespace}:${key}`; }
function log(level, msg) { process.stderr.write(`[${new Date().toISOString()}] ${level} [cf-mcp-ruvector] ${msg}\n`); }

// Lazy xinference recovery, throttled to one probe per 60s so a down
// embedding service doesn't add latency to every call. Without this the
// startup probe was the only check: if xinference (or its model) came up
// after the MCP server, semantic search stayed degraded for the whole
// session even though embeddings were available.
let xinfLastProbe = 0;
async function xinfEnsure() {
  if (xinferenceOk) return true;
  const now = Date.now();
  if (now - xinfLastProbe < 60000) return false;
  xinfLastProbe = now;
  try {
    const emb = await getEmbedding('reconnect probe');
    xinferenceOk = true;
    log('INFO', `xinference: reconnected (${XINFERENCE_URL}, model=${EMBEDDING_MODEL}, dim=${emb.length})`);
  } catch {}
  return xinferenceOk;
}

// Fail-closed: verify PG and xinference are reachable at startup
(async () => {
  try {
    await pool.query('SELECT 1');
    log('INFO', `pg: connected (${pool.options.host}:${pool.options.port}/${pool.options.database})`);
  } catch (err) {
    process.stderr.write(`[FATAL] [cf-mcp-ruvector] cannot reach ruvector-postgres: ${err.message}\n`);
    process.exit(1);
  }
  try {
    const emb = await getEmbedding('startup probe');
    xinferenceOk = true;
    log('INFO', `xinference: connected (${XINFERENCE_URL}, model=${EMBEDDING_MODEL}, dim=${emb.length})`);
  } catch (err) {
    log('WARN', `xinference unavailable (${XINFERENCE_URL}): ${err.message} — search will use ILIKE fallback, store will skip embeddings`);
  }
})();

function parseVal(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

// ── Memory operations ─────────────────────────────────────────────────────────
//
// Tool logic lives in the shared lib/memory-tools.js module (single source of
// truth across the two agentbox MCP servers). This server is the ADR-015
// mandated external-pg path; it injects its pool, embedding transport, notifier
// and helpers so the extracted logic behaves byte-for-byte as before.

const { memStore, memRetrieve, memList, memSearch } = createMemoryTools({
  backend: 'external-pg',
  deps: {
    pool,
    getPgOk: () => pgOk,
    getEmbedding,
    xinfEnsure,
    vecToSql,
    entryId,
    parseVal,
    notifyMemoryFlash: (...a) => notifyMemoryFlash(...a),
    notifyMemoryFlashBatch: (...a) => notifyMemoryFlashBatch(...a),
    log,
    writeSourceType: WRITE_SOURCE_TYPE,
  },
});

// ── Tool schemas (claude-flow compatible) ─────────────────────────────────────

const TOOLS = [
  {
    name: 'memory_store',
    description: 'Store persistent memory in ruvector-postgres with TTL and namespacing',
    inputSchema: {
      type: 'object',
      properties: {
        key:       { type: 'string' },
        value:     { type: 'string' },
        namespace: { type: 'string', default: 'default' },
        ttl:       { type: 'number' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_retrieve',
    description: 'Retrieve a memory entry by key from ruvector-postgres',
    inputSchema: {
      type: 'object',
      properties: {
        key:       { type: 'string' },
        namespace: { type: 'string', default: 'default' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_list',
    description: 'List memory entries in a namespace from ruvector-postgres',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', default: 'default' },
        limit:     { type: 'number', default: 100 },
      },
    },
  },
  {
    name: 'memory_search',
    description: 'Semantic vector search over 2M+ memory entries via HNSW index in ruvector-postgres',
    inputSchema: {
      type: 'object',
      properties: {
        query:       { type: 'string' },
        namespace:   { type: 'string', default: 'default' },
        limit:       { type: 'number', default: 10 },
        source_type: { type: 'string', description: 'Filter by source_type. Omit or use "*" for all sources.' },
      },
      required: ['query'],
    },
  },
  // Swarm coordination stubs (the legacy mcp-server.js that carried the full
  // implementations was removed in the 2026-06-11 audit; these remain thin stubs)
  {
    name: 'swarm_init',
    description: 'Initialize a swarm with topology and configuration',
    inputSchema: { type: 'object', properties: { topology: { type: 'string' }, maxAgents: { type: 'number' }, strategy: { type: 'string' } }, required: ['topology'] },
  },
  {
    name: 'agent_spawn',
    description: 'Create specialized AI agents',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, capabilities: { type: 'array' }, swarmId: { type: 'string' } }, required: ['type'] },
  },
  {
    name: 'task_orchestrate',
    description: 'Orchestrate complex task workflows',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, strategy: { type: 'string' }, priority: { type: 'string' } }, required: ['task'] },
  },
  {
    name: 'swarm_status',
    description: 'Monitor swarm health and performance',
    inputSchema: { type: 'object', properties: { swarmId: { type: 'string' } } },
  },
  {
    name: 'neural_patterns',
    description: 'Analyze cognitive patterns',
    inputSchema: { type: 'object', properties: { action: { type: 'string' }, operation: { type: 'string' }, outcome: { type: 'string' } }, required: ['action'] },
  },
  {
    name: 'memory_usage',
    description: 'Store/retrieve persistent memory (action-based, alias for memory_store/retrieve)',
    inputSchema: {
      type: 'object',
      properties: {
        action:    { type: 'string', enum: ['store', 'retrieve', 'list', 'delete', 'search'] },
        key:       { type: 'string' },
        value:     { type: 'string' },
        namespace: { type: 'string', default: 'default' },
      },
      required: ['action'],
    },
  },
  {
    name: 'coordination_sync',
    description: 'Sync agent coordination',
    inputSchema: { type: 'object', properties: { swarmId: { type: 'string' } } },
  },
  {
    name: 'load_balance',
    description: 'Distribute tasks efficiently',
    inputSchema: { type: 'object', properties: { swarmId: { type: 'string' }, tasks: { type: 'array' } } },
  },
  {
    name: 'performance_report',
    description: 'Generate performance reports',
    inputSchema: { type: 'object', properties: { timeframe: { type: 'string' }, format: { type: 'string' } } },
  },
  {
    name: 'bottleneck_analyze',
    description: 'Identify performance bottlenecks',
    inputSchema: { type: 'object', properties: { component: { type: 'string' } } },
  },
  {
    name: 'github_repo_analyze',
    description: 'Repository analysis',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, analysis_type: { type: 'string' } }, required: ['repo'] },
  },
  {
    name: 'github_pr_manage',
    description: 'Pull request management',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, pr_number: { type: 'number' }, action: { type: 'string' } }, required: ['repo', 'action'] },
  },
  {
    name: 'workflow_create',
    description: 'Create custom workflows',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, steps: { type: 'array' } }, required: ['name', 'steps'] },
  },
  {
    name: 'workflow_execute',
    description: 'Execute predefined workflows',
    inputSchema: { type: 'object', properties: { workflowId: { type: 'string' }, params: { type: 'object' } }, required: ['workflowId'] },
  },
  {
    name: 'parallel_execute',
    description: 'Execute tasks in parallel',
    inputSchema: { type: 'object', properties: { tasks: { type: 'array' } }, required: ['tasks'] },
  },
  {
    name: 'sparc_mode',
    description: 'Run SPARC development modes',
    inputSchema: { type: 'object', properties: { mode: { type: 'string' }, task_description: { type: 'string' } }, required: ['mode', 'task_description'] },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(name, args = {}) {
  log('INFO', `tool: ${name}`);

  try {
    switch (name) {
      case 'memory_store':
        return await memStore(args.key, args.value, args.namespace || 'default');

      case 'memory_retrieve':
        return await memRetrieve(args.key, args.namespace || 'default');

      case 'memory_list':
        return await memList(args.namespace || 'default', args.limit || 100);

      case 'memory_search':
        return await memSearch(args.query, args.namespace || 'default', args.limit || 10, args.source_type || null);

      case 'memory_usage': {
        const ns = args.namespace || 'default';
        switch (args.action) {
          case 'store':    return await memStore(args.key, args.value, ns);
          case 'retrieve': return await memRetrieve(args.key, ns);
          case 'list':     return await memList(ns, 100);
          case 'search':   return await memSearch(args.value || args.key || '', ns, 50);
          case 'delete':   return { success: false, error: 'delete not implemented in ruvector-mcp' };
          default:         return { success: false, error: `unknown action: ${args.action}` };
        }
      }

      case 'swarm_init': {
        const swarmId = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        await memStore(`swarm:${swarmId}`, JSON.stringify({ id: swarmId, topology: args.topology, maxAgents: args.maxAgents || 8 }), 'swarms').catch(() => {});
        return { success: true, swarmId, topology: args.topology, maxAgents: args.maxAgents || 8, status: 'initialized', timestamp: new Date().toISOString() };
      }

      case 'agent_spawn': {
        const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        return { success: true, agentId, type: args.type, name: args.name || `${args.type}-${Date.now()}`, status: 'active', timestamp: new Date().toISOString() };
      }

      case 'task_orchestrate': {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        return { success: true, taskId, task: args.task, strategy: args.strategy || 'parallel', priority: args.priority || 'medium', status: 'pending', timestamp: new Date().toISOString() };
      }

      case 'swarm_status':
        return { success: true, swarmId: args.swarmId || 'unknown', topology: 'hierarchical', agentCount: 0, activeAgents: 0, taskCount: 0, timestamp: new Date().toISOString() };

      case 'neural_patterns':
        return { success: true, action: args.action, patterns: [], timestamp: new Date().toISOString() };

      default:
        return { success: true, tool: name, message: `${name} executed (ruvector-mcp stub)`, timestamp: new Date().toISOString() };
    }
  } catch (err) {
    log('ERROR', `tool ${name} failed: ${err.message}`);
    return { success: false, error: err.message, tool: name, timestamp: new Date().toISOString() };
  }
}

// ── MCP JSON-RPC stdio protocol ───────────────────────────────────────────────

const sessionId = `session-rv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      log('INFO', `initialize from client ${params && params.clientInfo && params.clientInfo.name}`);
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: false } },
          serverInfo: { name: 'claude-flow', version: VERSION },
        },
      };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const { name, arguments: args } = params;
      const result = await executeTool(name, args || {});
      return {
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      };
    }

    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } };

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // no response for notifications

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

log('INFO', `(${sessionId}) ruvector-mcp starting — pg: ${pgOk ? 'ready' : 'UNAVAILABLE'}`);

// Probe pg connectivity (non-blocking)
if (pool) {
  pool.query('SELECT 1').then(() => {
    log('INFO', `(${sessionId}) ruvector-postgres connection OK`);
  }).catch(e => {
    log('WARN', `(${sessionId}) ruvector-postgres probe failed: ${e.message}`);
  });
}

// Send server.initialized notification (some clients expect this)
process.stdout.write(JSON.stringify({
  jsonrpc: '2.0',
  method: 'server.initialized',
  params: { serverInfo: { name: 'claude-flow', version: VERSION } },
}) + '\n');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch {
    log('WARN', `json parse failed: ${trimmed.slice(0, 80)}`);
    return;
  }
  try {
    const response = await handleMessage(msg);
    if (response !== null) process.stdout.write(JSON.stringify(response) + '\n');
  } catch (err) {
    log('ERROR', `handleMessage failed: ${err.message}`);
    if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'Internal error', data: err.message } }) + '\n');
    }
  }
});

rl.on('close', () => {
  log('INFO', `(${sessionId}) stdin closed, shutting down`);
  if (pool) pool.end().catch(() => {});
  process.exit(0);
});

process.on('SIGTERM', () => { if (pool) pool.end().catch(() => {}); process.exit(0); });
process.on('SIGINT',  () => { if (pool) pool.end().catch(() => {}); process.exit(0); });
