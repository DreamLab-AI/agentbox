#!/usr/bin/env node
'use strict';
/**
 * ruflo-memory-cli.cjs — the governed `ruflo memory …` (ADR-2123).
 *
 * ruflo 3.51.1's own memory subsystem is a local store: sql.js SQLite under
 * `.swarm/`, an AgentDB mirror, the native engine's `./ruvector.db` in the
 * working directory, and a MiniLM ONNX embedder. Its `--backend` flag is a
 * label written into a metadata table; no value reaches Postgres, and no
 * setting selects an external embedding endpoint. In this image durable memory
 * is the ruvector-postgres sidecar, embedded by Xinference (bge-small-en-v1.5,
 * 384-dim, GPU) and served by `ruvector-mcp.cjs` (ADR-015, ADR-2014).
 *
 * The baked `ruflo` / `claude-flow` wrappers exec this file for the `memory`
 * subcommand. It reuses `lib/memory-tools.js` — the same store/retrieve/search/
 * delete logic the MCP server runs, with the same pool, embedding transport and
 * entry-id scheme — so a key written here is the same row the memory_* tools
 * read, and vice versa. The ruflo-console memory pane (which shells out to
 * `ruflo memory stats --format json` and `ruflo memory list --format json`)
 * therefore shows the governed corpus.
 *
 * Output shapes with `--format json` match ruflo 3.51.1's so the console's
 * parsers (plugins/ruflo-console/hooks/data/cli.ts) need no change:
 *   stats → { backend, entries:{total,vectors,text}, storage:{total,location},
 *             version, oldestEntry, newestEntry }
 *   list  → [ { id, key, namespace, size, accessCount, createdAt, updatedAt,
 *               hasEmbedding, provenanceType } ]
 *
 * Subcommands that would create or mutate a local store (init, configure,
 * backup, compress, cleanup, export, import, purge, distill, migrate, …) are
 * refused with exit 2: fail closed, never a second memory system.
 */

const http = require('http');
const path = require('path');

const {
  createExternalPgBackend,
  shapeSearchResponse,
  resolveSearchLimit,
  wildcardExcludedNamespaces,
  DEFAULT_MIN_SCORE,
} = require(path.join(__dirname, 'lib', 'memory-tools.js'));
const { notExpiredPredicate } = require(path.join(__dirname, 'lib', 'memory-metadata.js'));

// ── Constants mirrored from ruvector-mcp.cjs (single write-source so ids match) ──
const WRITE_SOURCE_TYPE = 'agentbox';
const EMBEDDING_DIM = 384;
const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
const PG_SEARCH_PATHS = [
  '/home/devuser/workspace/.claude-pg/node_modules/pg',
  '/opt/agentbox/management-api/node_modules/pg',
  'pg',
];
const NOT_EXPIRED = notExpiredPredicate('metadata');

const ALLOWED = new Set(['store', 'retrieve', 'get', 'search', 'list', 'ls', 'delete', 'rm', 'stats', 'help', '--help', '-h']);
// Everything ruflo's memory command exposes that would build or mutate a local store.
const REFUSED = new Set([
  'init', 'configure', 'config', 'cleanup', 'compress', 'export', 'import', 'purge',
  'distill', 'backup', 'classify', 'select-operator', 'migrate',
]);

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_REFUSED = 2;
const EXIT_USAGE = 64;

// ── Argument parsing (ruflo's flag spellings: -k/--key, --key=value, …) ─────────
const FLAG_ALIASES = {
  k: 'key', v: 'value', n: 'namespace', q: 'query', l: 'limit', t: 'type', s: 'smart',
};

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) { flags[name] = a.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { flags[name] = next; i++; }
      else flags[name] = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const short = a.slice(1);
      const name = FLAG_ALIASES[short] || short;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { flags[name] = next; i++; }
      else flags[name] = true;
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

function wantJson(flags) {
  return flags.format === 'json' || flags.json === true;
}

function usage() {
  return [
    'ruflo memory — governed by agentbox: the ruvector-postgres sidecar, embedded by Xinference (ADR-2123)',
    '',
    'SUBCOMMANDS:',
    '  store     -k <key> -v <value> [-n <namespace>] [--tags a,b] [--importance 0-1] [--type semantic|episodic|procedural|working|pattern] [--ttl <seconds>]',
    '  retrieve  -k <key> [-n <namespace>]                       (alias: get)',
    '  search    -q <query> [-n <namespace>|*] [-l <limit>] [--threshold 0-1]',
    '  list      [-n <namespace>|*] [--limit <n>]                 (alias: ls; default: every namespace, newest first)',
    '  delete    -k <key> [-n <namespace>]                       (alias: rm)',
    '  stats',
    '',
    'OPTIONS:',
    '  --format json      machine output (the shapes the ruflo-console memory pane reads)',
    '  --verbose          backend diagnostics on stderr',
    '',
    'Refused here (they would create a second, local memory store): init, configure, cleanup, compress,',
    'export, import, purge, distill, backup, classify, select-operator, migrate.',
    'Durable memory is MCP-first: prefer the memory_* tools of the claude-flow MCP server (ADR-2014).',
  ].join('\n');
}

// ── Backend wiring (the same shape ruvector-mcp.cjs injects) ─────────────────────
function makeLogger(verbose) {
  return (level, msg) => {
    if (level === 'DEBUG' && !verbose) return;
    if (level === 'INFO' && !verbose) return;
    process.stderr.write(`[ruflo-memory] [${level}] ${msg}\n`);
  };
}

function loadPg() {
  for (const p of PG_SEARCH_PATHS) {
    try { return require(p); } catch { /* next */ }
  }
  return null;
}

function parseConninfo(conninfo) {
  const parsed = {};
  for (const pair of String(conninfo).split(/\s+/)) {
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

function makePool(log) {
  const PgModule = loadPg();
  if (!PgModule) {
    log('ERROR', `pg module unavailable; searched ${PG_SEARCH_PATHS.join(', ')} and NODE_PATH=${process.env.NODE_PATH || '(unset)'}`);
    return null;
  }
  const conn = parseConninfo(process.env.RUVECTOR_PG_CONNINFO ||
    'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector');
  return {
    pool: new PgModule.Pool({ ...conn, max: 2, idleTimeoutMillis: 2000, connectionTimeoutMillis: 5000 }),
    location: `${conn.host}:${conn.port}/${conn.database}`,
  };
}

function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  return new Promise((resolve, reject) => {
    const url = new URL(XINFERENCE_URL + '/v1/embeddings');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const emb = j && j.data && j.data[0] && j.data[0].embedding;
          if (!emb) return reject(new Error(`unexpected response: ${data.substring(0, 200)}`));
          if (emb.length !== EMBEDDING_DIM) return reject(new Error(`dimension mismatch: got ${emb.length}, expected ${EMBEDDING_DIM}`));
          resolve(emb);
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
function parseVal(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

/**
 * Build the governed backend. `deps` lets tests inject a fake pool and embedder;
 * production passes nothing and gets the real sidecar wiring.
 */
function buildBackend({ verbose = false, deps = {} } = {}) {
  const log = deps.log || makeLogger(verbose);
  let pool = deps.pool || null;
  let location = deps.location || 'ruvector-postgres:5432/ruvector';
  // deps.pool === null is an explicit "no sidecar" (tests); undefined means
  // build the real pool.
  if (!pool && deps.pool !== null) {
    const made = makePool(log);
    if (made) { pool = made.pool; location = made.location; }
  }
  const pgOk = !!pool;
  const embed = deps.getEmbedding || getEmbedding;
  let xinfOk = null;
  const xinfEnsure = deps.xinfEnsure || (async () => {
    if (xinfOk !== null) return xinfOk;
    try { await embed('probe'); xinfOk = true; }
    catch (e) { xinfOk = false; log('WARN', `xinference unavailable at ${XINFERENCE_URL}: ${e.message}`); }
    return xinfOk;
  });
  const tools = createExternalPgBackend({
    pool,
    getPgOk: () => pgOk,
    getEmbedding: embed,
    xinfEnsure,
    vecToSql,
    entryId,
    parseVal,
    notifyMemoryFlash: () => {},
    notifyMemoryFlashBatch: () => {},
    log,
    writeSourceType: WRITE_SOURCE_TYPE,
  });
  return { tools, pool, pgOk, location, log, close: async () => { if (pool && pool.end && !deps.pool) await pool.end(); } };
}

// ── Shapes (ruflo 3.51.1 `--format json` compatible) ────────────────────────────
function toMs(v) {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}
function toIso(v) { const ms = toMs(v); return ms === null ? null : new Date(ms).toISOString(); }

function shapeStats(row, { location, version, namespaces }) {
  const total = Number(row.total) || 0;
  const vectors = Number(row.vectors) || 0;
  return {
    backend: `ruvector-postgres (hnsw, xinference ${EMBEDDING_MODEL})`,
    entries: { total, vectors, text: total - vectors },
    storage: { total: `${Number(row.bytes) || 0} B`, location },
    version: version || 'ruvector-postgres',
    oldestEntry: toIso(row.oldest),
    newestEntry: toIso(row.newest),
    namespaces,
    embedding: { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM, endpoint: XINFERENCE_URL },
  };
}

function shapeListRow(r) {
  return {
    id: r.id,
    key: r.key,
    namespace: r.namespace,
    size: Number(r.size) || 0,
    accessCount: Number(r.access_count) || 0,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
    hasEmbedding: r.has_embedding === true,
    provenanceType: 'unknown',
    sourceType: r.source_type || null,
  };
}

// ── Commands ────────────────────────────────────────────────────────────────────
async function cmdStats(be) {
  const { pool, location } = be;
  const excluded = wildcardExcludedNamespaces();
  const q = await pool.query(
    `SELECT count(*)::bigint AS total,
            count(embedding)::bigint AS vectors,
            min(created_at) AS oldest,
            max(created_at) AS newest,
            count(DISTINCT namespace)::int AS namespaces,
            pg_total_relation_size('memory_entries')::bigint AS bytes
       FROM memory_entries
      WHERE ${NOT_EXPIRED} AND NOT (namespace = ANY($1::text[]))`,
    [excluded],
  );
  let version = null;
  try {
    const v = await pool.query(`SELECT extversion FROM pg_extension WHERE extname = 'ruvector' LIMIT 1`);
    version = v.rows.length ? `ruvector-postgres ${v.rows[0].extversion}` : null;
  } catch { /* extension catalogue optional */ }
  return shapeStats(q.rows[0], { location, version, namespaces: Number(q.rows[0].namespaces) || 0 });
}

async function cmdList(be, flags) {
  const { pool } = be;
  const ns = flags.namespace ? String(flags.namespace) : '*';
  const limit = Math.max(1, Math.min(parseInt(flags.limit || '100', 10) || 100, 5000));
  const excluded = ns === '*' ? wildcardExcludedNamespaces() : [];
  const q = await pool.query(
    `SELECT id, key, namespace, length(value::text) AS size, access_count,
            created_at, updated_at, (embedding IS NOT NULL) AS has_embedding, source_type
       FROM memory_entries
      WHERE (namespace = $1 OR $1 = '*') AND ${NOT_EXPIRED}
        AND NOT (namespace = ANY($3::text[]))
      ORDER BY created_at DESC
      LIMIT $2`,
    [ns, limit, excluded],
  );
  return q.rows.map(shapeListRow);
}

async function cmdSearch(be, flags) {
  if (!flags.query) return { usage: 'search requires -q <query>' };
  const ns = flags.namespace ? String(flags.namespace) : '*';
  const limit = resolveSearchLimit(parseInt(flags.limit || '10', 10) || 10);
  const minScore = flags.threshold !== undefined ? Number(flags.threshold) : DEFAULT_MIN_SCORE;
  const t0 = Date.now();
  const raw = await be.tools.memSearch(String(flags.query), ns, limit, null, {});
  const shaped = shapeSearchResponse(raw, { minScore, limit });
  if (!shaped || shaped.success !== true) return { error: (shaped && shaped.error) || 'search failed', raw: shaped };
  return {
    query: String(flags.query),
    namespace: ns,
    results: shaped.results,
    total: shaped.results.length,
    searchTime: `${Date.now() - t0}ms`,
    backend: `ruvector-postgres (${shaped.method || 'hnsw-xinference'})`,
    ...(shaped.degraded ? { degraded: true, warning: shaped.warning } : {}),
  };
}

async function cmdStore(be, flags) {
  if (!flags.key || flags.value === undefined || flags.value === true) return { usage: 'store requires -k <key> -v <value>' };
  const ns = flags.namespace ? String(flags.namespace) : 'default';
  const options = {};
  if (flags.tags) options.tags = String(flags.tags).split(',').map(s => s.trim()).filter(Boolean);
  if (flags.importance !== undefined) options.importance = Number(flags.importance);
  if (flags.type && flags.type !== true) options.memory_type = String(flags.type);
  if (flags.ttl !== undefined) options.ttl_seconds = Number(flags.ttl);
  return be.tools.memStore(String(flags.key), String(flags.value), ns, options);
}

async function cmdRetrieve(be, flags) {
  if (!flags.key) return { usage: 'retrieve requires -k <key>' };
  const ns = flags.namespace ? String(flags.namespace) : 'default';
  return be.tools.memRetrieve(String(flags.key), ns);
}

async function cmdDelete(be, flags) {
  if (!flags.key) return { usage: 'delete requires -k <key>' };
  const ns = flags.namespace ? String(flags.namespace) : 'default';
  return be.tools.memDelete(String(flags.key), ns);
}

// ── Human rendering ─────────────────────────────────────────────────────────────
function renderHuman(sub, out) {
  if (sub === 'stats') {
    return [
      `Backend:    ${out.backend}`,
      `Location:   ${out.storage.location}`,
      `Entries:    ${out.entries.total} (${out.entries.vectors} embedded, ${out.entries.text} pending)`,
      `Namespaces: ${out.namespaces}`,
      `Storage:    ${out.storage.total}`,
      `Oldest:     ${out.oldestEntry || 'n/a'}`,
      `Newest:     ${out.newestEntry || 'n/a'}`,
      `Embedding:  ${out.embedding.model} (${out.embedding.dimensions}d) via ${out.embedding.endpoint}`,
    ].join('\n');
  }
  if (sub === 'list' || sub === 'ls') {
    if (!out.length) return '(no entries)';
    const w = Math.min(60, Math.max(...out.map(r => r.key.length)));
    return out.map(r => `${r.namespace.padEnd(20)} ${r.key.padEnd(w)} ${r.hasEmbedding ? 'vec' : '   '} ${new Date(r.createdAt).toISOString()}`).join('\n');
  }
  if (sub === 'search') {
    if (out.error) return `search failed: ${out.error}`;
    const head = `${out.total} result(s) for "${out.query}" in ${out.namespace} [${out.backend}, ${out.searchTime}]${out.degraded ? ' DEGRADED: ' + out.warning : ''}`;
    const rows = out.results.map(r => `  ${(Number(r.score) || 0).toFixed(3)}  ${r.namespace || ''}/${r.key}${r.snippet ? '\n         ' + String(r.snippet).replace(/\s+/g, ' ').slice(0, 160) : ''}`);
    return [head, ...rows].join('\n');
  }
  if (sub === 'retrieve' || sub === 'get') {
    if (!out.found) return `(not found) ${out.namespace}/${out.key}`;
    return typeof out.value === 'string' ? out.value : JSON.stringify(out.value, null, 2);
  }
  if (sub === 'store') {
    return out.success ? `stored ${out.namespace}/${out.key} (embedded=${out.embedded === true})` : `store failed: ${out.error}`;
  }
  if (sub === 'delete' || sub === 'rm') {
    return out.success ? `deleted ${out.deleted} row(s) at ${out.namespace}/${out.key}` : `delete failed: ${out.error}`;
  }
  return JSON.stringify(out, null, 2);
}

// ── Entry point ─────────────────────────────────────────────────────────────────
/**
 * Run the CLI. Returns { code, stdout, stderr } instead of exiting so tests can
 * drive it in-process with an injected backend.
 */
async function run(argv, { deps } = {}) {
  const { flags, positional } = parseArgs(argv);
  const sub = positional[0] || 'help';
  const json = wantJson(flags);
  const emit = (obj, text) => (json ? JSON.stringify(obj, null, 2) : text);

  if (REFUSED.has(sub)) {
    const msg = `ruflo memory ${sub} is refused in agentbox: it would create or mutate a local memory store. ` +
      'Durable memory is the ruvector-postgres sidecar (ADR-2014, ADR-2123); use the memory_* MCP tools, ' +
      'or this CLI\'s store/retrieve/search/list/delete/stats, which serve the sidecar.';
    return { code: EXIT_REFUSED, stdout: json ? JSON.stringify({ success: false, refused: sub, error: msg }) : '', stderr: json ? '' : msg + '\n' };
  }
  if (!ALLOWED.has(sub)) {
    return { code: EXIT_USAGE, stdout: '', stderr: `unknown subcommand: ${sub}\n\n${usage()}\n` };
  }
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    return { code: EXIT_OK, stdout: usage() + '\n', stderr: '' };
  }

  const be = buildBackend({ verbose: flags.verbose === true, deps });
  if (!be.pgOk) {
    const err = 'ruvector-postgres unavailable (pg module or connection missing) — fail closed (ADR-2014)';
    await be.close();
    return { code: EXIT_FAIL, stdout: json ? JSON.stringify({ success: false, error: err, backend: 'ruvector-postgres' }) : '', stderr: json ? '' : err + '\n' };
  }

  try {
    let out;
    switch (sub) {
      case 'stats': out = await cmdStats(be); break;
      case 'list': case 'ls': out = await cmdList(be, flags); break;
      case 'search': out = await cmdSearch(be, flags); break;
      case 'store': out = await cmdStore(be, flags); break;
      case 'retrieve': case 'get': out = await cmdRetrieve(be, flags); break;
      case 'delete': case 'rm': out = await cmdDelete(be, flags); break;
      default: out = null;
    }
    if (out && out.usage) return { code: EXIT_USAGE, stdout: '', stderr: `${out.usage}\n\n${usage()}\n` };
    const failed = out && typeof out === 'object' && !Array.isArray(out) && out.success === false;
    const code = failed ? EXIT_FAIL : EXIT_OK;
    return { code, stdout: emit(out, renderHuman(sub, out)) + '\n', stderr: '' };
  } catch (e) {
    const err = `${sub} failed: ${e && e.message ? e.message : String(e)}`;
    return { code: EXIT_FAIL, stdout: json ? JSON.stringify({ success: false, error: err }) + '\n' : '', stderr: json ? '' : err + '\n' };
  } finally {
    await be.close();
  }
}

module.exports = {
  run, parseArgs, shapeStats, shapeListRow, buildBackend, usage,
  ALLOWED, REFUSED, EXIT_OK, EXIT_FAIL, EXIT_REFUSED, EXIT_USAGE,
  WRITE_SOURCE_TYPE, EMBEDDING_DIM,
};

if (require.main === module) {
  // The wrapper passes everything after `memory`; a direct invocation may
  // still start with it.
  const argv = process.argv.slice(2);
  if (argv[0] === 'memory') argv.shift();
  run(argv).then(({ code, stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exitCode = code;
  }).catch(e => {
    process.stderr.write(`[ruflo-memory] fatal: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = EXIT_FAIL;
  });
}
