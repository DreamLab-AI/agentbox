#!/usr/bin/env node
// RuvNet Brain thin MCP wrapper for agentbox.
//
// search_ruvnet is a namespace-scoped semantic search over the `ruvnet-kb`
// corpus that scripts/ruvnet-brain-ingest.mjs loads into ruvector-postgres
// (the shared memory sidecar). Query embedding is computed client-side via
// Xinference bge-small-en-v1.5, 384-dim (ADR-015) — the SAME embedding space
// as every other memory_entries row, so the corpus is also reachable through
// mcp__claude-flow__memory_search({namespace: 'ruvnet-kb'}). This server only
// adds the well-known tool name + repo-affinity filtering + passage formatting.
//
// Fail modes mirror ruvector-mcp.cjs: pg unreachable → tool errors with a
// clear message (fail-closed, ADR-015); xinference unreachable → ILIKE
// lexical fallback (degraded, flagged in the result).

'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { Pool } = require('pg');
const http = require('http');

const NAMESPACE = process.env.RUVNET_BRAIN_NAMESPACE || 'ruvnet-kb';
const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
const EMBEDDING_DIM = 384;
const CONNINFO = process.env.RUVECTOR_PG_CONNINFO || '';

function log(level, msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [ruvnet-brain-mcp] ${msg}\n`);
}

// Conninfo arrives in either libpq key=value form (the .mcp.json claude-flow
// convention) or postgresql:// URL form (the agentbox.toml convention) —
// accept both, mirroring ruvector-mcp.cjs.
function poolConfig(conninfo) {
  if (/^postgres(ql)?:\/\//.test(conninfo)) return { connectionString: conninfo };
  const parsed = {};
  for (const pair of conninfo.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) parsed[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return {
    host: parsed.host || 'ruvector-postgres',
    port: parseInt(parsed.port || '5432', 10),
    database: parsed.dbname || parsed.database || 'ruvector',
    user: parsed.user || parsed.username || 'ruvector',
    password: parsed.password || 'ruvector',
  };
}

const pool = new Pool({ ...poolConfig(CONNINFO), max: 2, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
pool.on('error', (e) => log('WARN', `pg pool error: ${e.message}`));

function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  return new Promise((resolve, reject) => {
    const url = new URL(XINFERENCE_URL + '/v1/embeddings');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const emb = j?.data?.[0]?.embedding;
          if (Array.isArray(emb) && emb.length === EMBEDDING_DIM) { resolve(emb); return; }
          reject(new Error(emb ? `dimension mismatch: ${emb.length}` : `unexpected response: ${data.substring(0, 200)}`));
        } catch (e) { reject(new Error(`parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

const vecToSql = (arr) => '[' + arr.join(',') + ']';

function parseVal(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function formatHit(row) {
  const val = parseVal(row.value) || {};
  const meta = parseVal(row.metadata) || {};
  return {
    score: row.score != null ? Number(Number(row.score).toFixed(4)) : null,
    repo: meta.repo || val.repo || 'unknown',
    path: meta.path || val.path || '',
    key: row.key,
    text: typeof val === 'string' ? val : (val.text || JSON.stringify(val)),
  };
}

async function searchRuvnet({ query, k = 6, repo = null }) {
  if (!query || typeof query !== 'string') throw new Error('query (string) is required');
  const limit = Math.max(1, Math.min(Number(k) || 6, 25));

  // Named-repo affinity: an explicit repo arg wins; otherwise detect a repo
  // slug mentioned inside the query and prefer (not require) that segment.
  const repoFilter = repo ? String(repo).toLowerCase().trim() : null;

  let mode = 'vector';
  let rows = [];
  try {
    const emb = await getEmbedding(query.substring(0, 2000));
    const params = [vecToSql(emb), NAMESPACE];
    let filterClause = '';
    if (repoFilter) {
      params.push(repoFilter);
      filterClause = `AND lower(metadata->>'repo') = $3`;
    }
    const res = await pool.query(
      `SELECT key, value, metadata,
              1.0 - (embedding <=> $1::ruvector(${EMBEDDING_DIM})) AS score
         FROM memory_entries
        WHERE namespace = $2
          AND embedding IS NOT NULL
          AND key <> 'ruvnet/manifest'
          ${filterClause}
        ORDER BY embedding <=> $1::ruvector(${EMBEDDING_DIM})
        LIMIT ${limit}`,
      params,
    );
    rows = res.rows;
  } catch (e) {
    // Xinference down (or embedding failed) → lexical fallback so the tool
    // degrades instead of dying. pg errors will re-throw from this query too,
    // which is correct: no DB, no corpus.
    log('WARN', `vector search unavailable (${e.message}) — ILIKE fallback`);
    mode = 'lexical-fallback';
    const params = [NAMESPACE, `%${query.substring(0, 100)}%`];
    let filterClause = '';
    if (repoFilter) {
      params.push(repoFilter);
      filterClause = `AND lower(metadata->>'repo') = $3`;
    }
    const res = await pool.query(
      `SELECT key, value, metadata, 0.5 AS score
         FROM memory_entries
        WHERE namespace = $1
          AND key <> 'ruvnet/manifest'
          AND value::text ILIKE $2
          ${filterClause}
        ORDER BY updated_at DESC
        LIMIT ${limit}`,
      params,
    );
    rows = res.rows;
  }

  return {
    mode,
    namespace: NAMESPACE,
    repo_filter: repoFilter,
    count: rows.length,
    results: rows.map(formatHit),
    hint: rows.length === 0
      ? `No corpus hits. If the corpus is empty, run the ingest playbook (scripts/ruvnet-brain-ingest.mjs) or check ruvnet_brain_status. The same data is reachable via memory_search with namespace '${NAMESPACE}'.`
      : undefined,
  };
}

async function brainStatus() {
  const out = { namespace: NAMESPACE, xinference: XINFERENCE_URL, embedding_model: EMBEDDING_MODEL };
  const counts = await pool.query(
    `SELECT count(*)::int AS total,
            count(embedding)::int AS embedded,
            count(DISTINCT metadata->>'repo')::int AS repos
       FROM memory_entries WHERE namespace = $1 AND key <> 'ruvnet/manifest'`,
    [NAMESPACE],
  );
  out.corpus = counts.rows[0];
  const manifest = await pool.query(
    `SELECT value FROM memory_entries WHERE namespace = $1 AND key = 'ruvnet/manifest' LIMIT 1`,
    [NAMESPACE],
  );
  out.manifest = manifest.rows.length ? parseVal(manifest.rows[0].value) : null;
  if (!out.corpus.total) {
    out.hint = 'Corpus empty — run scripts/ruvnet-brain-ingest.mjs (auto-runs at boot when [skills.ruvnet_brain].auto_ingest = true).';
  }
  return out;
}

const server = new Server(
  { name: 'ruvnet-brain', version: '0.2.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_ruvnet',
      description:
        'Semantic search over the RuvNet ecosystem source corpus (21+ repos: ruflo, ruvector, safla, agentdb, agentic-flow, sparc, qudag, etc). ' +
        'Ground every RuvNet-specific assertion here before answering. Returns passages with repo + file attribution. ' +
        `Backed by the shared ruvector-postgres sidecar, namespace '${NAMESPACE}' — also reachable via memory_search with that namespace.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language or code question' },
          k: { type: 'number', description: 'Max results (default 6, cap 25)' },
          repo: { type: 'string', description: "Optional repo slug filter, e.g. 'ruflo', 'ruvector', 'agentdb'" },
        },
        required: ['query'],
      },
    },
    {
      name: 'ruvnet_brain_status',
      description: 'Corpus health: chunk counts, embedded coverage, distinct repos, ingest manifest (corpus version + timestamp).',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result;
    if (name === 'search_ruvnet') result = await searchRuvnet(args || {});
    else if (name === 'ruvnet_brain_status') result = await brainStatus();
    else throw new Error(`unknown tool: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `ruvnet-brain error: ${e.message}` }],
    };
  }
});

async function main() {
  if (!CONNINFO) log('WARN', 'RUVECTOR_PG_CONNINFO not set — queries will fail until configured');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('INFO', `ready (namespace=${NAMESPACE}, xinference=${XINFERENCE_URL})`);
}

main().catch((e) => { log('ERROR', e.message); process.exit(1); });
