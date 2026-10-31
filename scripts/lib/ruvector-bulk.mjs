// Shared bulk-ingest helpers for the two sanctioned direct-pg writers:
//   scripts/ruvnet-brain-ingest.mjs   (namespace ruvnet-kb)
//   scripts/corpus-memory-ingest.mjs  (namespace knowledge/pages)
//
// Both embed CLIENT-SIDE through the same Xinference bge-small-en-v1.5 384-dim
// pipeline as the governed memory MCP (ADR-2014 / ADR-2019 384-dim freeze), so
// every row they write is searchable. Extracted verbatim from
// ruvnet-brain-ingest.mjs; behaviour is unchanged. Pure helpers are exported
// for unit tests; nothing here touches a database or network at import time.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';

/** Embedding dimension — frozen by ADR-2019. */
export const EMB_DIM = 384;
/** Characters fed to the embedder (the full text is kept in the row value). */
export const EMBED_TRUNC = 2000;

/** Timestamped stderr logger with a fixed tag. */
export function makeLog(tag) {
  return (m) => process.stderr.write(`[${new Date().toISOString()}] [${tag}] ${m}\n`);
}

/**
 * Resolve `pg` from the baked closures, never npm-install at runtime.
 * `fail` is called with a message when nothing resolves (it should exit).
 */
export function loadPg(fail, extraCandidates = []) {
  const req = createRequire(import.meta.url);
  const candidates = [
    ...extraCandidates,
    ...(process.env.AGENTBOX_PG_NODE_PATH ? [join(process.env.AGENTBOX_PG_NODE_PATH, 'pg')] : []),
    '/opt/agentbox/management-api/node_modules/pg',
    'pg',
  ];
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  return fail('pg module not found in any baked closure');
}

/**
 * Conninfo arrives in either libpq key=value form or postgresql:// URL form.
 * Mirrors ruvector-mcp.cjs.
 */
export function poolConfig(conninfo) {
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

/** Minimal JSON-over-HTTP(S) client. */
export function httpJson(url, { method = 'GET', body = null, timeout = 60000, headers = {} } = {}) {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`)); return; }
        try { resolvePromise(JSON.parse(data)); } catch (e) { reject(new Error(`parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Xinference batch embedder. `post` is injectable for tests.
 * @returns {{ embedBatch: (texts: string[]) => Promise<number[][]>, waitReady: (maxSecs?: number) => Promise<boolean> }}
 */
export function createEmbedder({ endpoint, model, post = httpJson, sleepFn = sleep }) {
  async function embedBatch(texts) {
    const j = await post(`${endpoint}/v1/embeddings`, {
      method: 'POST', body: { model, input: texts }, timeout: 120000,
    });
    const embs = (j.data || []).map((d) => d.embedding);
    if (embs.length !== texts.length) throw new Error(`embed count mismatch: ${embs.length}/${texts.length}`);
    for (const e of embs) if (!Array.isArray(e) || e.length !== EMB_DIM) throw new Error('bad embedding dim');
    return embs;
  }
  async function waitReady(maxSecs = 180) {
    const deadline = Date.now() + maxSecs * 1000;
    while (Date.now() < deadline) {
      try { await embedBatch(['ready-probe']); return true; } catch { /* retry */ }
      await sleepFn(5000);
    }
    return false;
  }
  return { embedBatch, waitReady };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Unpaired-surrogate sanitiser. Chunkers can split surrogate pairs, which
 * breaks BOTH sinks: Xinference 500s the embed batch and Postgres rejects the
 * jsonb value. NUL is a valid scalar but Postgres text/jsonb cannot store it.
 */
export const wellFormed = (s) => {
  const t = s.toWellFormed ? s.toWellFormed() : s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '�')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
  return t.replace(/\u0000/g, '');
};

/** Embed input: first EMBED_TRUNC chars, re-sanitised after the cut. */
export const embedText = (s) => wellFormed(s.substring(0, EMBED_TRUNC));

/** pgvector/ruvector literal. */
export const vecToSql = (arr) => '[' + arr.join(',') + ']';

/** First 12 hex chars of sha256. */
export const sha12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/**
 * Embed+upsert one batch with retry (transient Xinference/pg hiccups) then
 * bisection (isolate poison passages instead of dropping the whole batch).
 *
 * @param {object[]} batch items to write
 * @param {object} o
 * @param {(batch: object[]) => Promise<void>} o.run embeds and upserts the batch; throws on failure
 * @param {(n: number) => void} o.onInserted called with the size of every batch that landed
 * @param {(item: object, err: Error) => void} o.onFailure called once per permanently failed item
 * @param {(m: string) => void} o.log
 * @param {number} [o.attempts=3]
 * @param {(ms: number) => Promise<void>} [o.sleepFn]
 */
export async function processBatch(batch, { run, onInserted, onFailure, log, attempts = 3, sleepFn = sleep }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run(batch);
      onInserted(batch.length);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < attempts) await sleepFn(attempt * 2000);
    }
  }
  if (batch.length > 1) {
    log(`WARN: batch of ${batch.length} failed ${attempts} attempts (${lastErr.message}) — bisecting`);
    const mid = Math.ceil(batch.length / 2);
    await processBatch(batch.slice(0, mid), { run, onInserted, onFailure, log, attempts, sleepFn });
    await processBatch(batch.slice(mid), { run, onInserted, onFailure, log, attempts, sleepFn });
    return;
  }
  log(`WARN: chunk ${batch[0].key} permanently failed (${lastErr.message}) — skipped`);
  onFailure(batch[0], lastErr);
}

/**
 * Multi-row upsert into memory_entries, one statement per call (the SAME
 * statement both bulk ingesters issue; mirrors ruvector-mcp.cjs conventions).
 * The vector is written in the same statement as the value, so a row never
 * exists with a vector that belongs to other text (ADR-2014).
 *
 * @param {{ query: Function }} pool
 * @param {{ id: string, namespace: string, key: string, value: object, source_type: string, metadata: object, embedding: number[] }[]} rows
 */
export async function upsertRows(pool, rows) {
  const cols = [];
  const params = [];
  rows.forEach((r) => {
    const base = params.length;
    params.push(r.id, r.namespace, r.key, JSON.stringify(r.value), r.source_type, JSON.stringify(r.metadata), vecToSql(r.embedding));
    cols.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${base + 5}, $${base + 6}::jsonb, $${base + 7}::ruvector(${EMB_DIM}))`);
  });
  await pool.query(
    `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
       VALUES ${cols.join(', ')}
       ON CONFLICT (id) DO UPDATE
         SET value = EXCLUDED.value, metadata = EXCLUDED.metadata,
             embedding = EXCLUDED.embedding, updated_at = NOW()`,
    params,
  );
}
