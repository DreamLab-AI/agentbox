#!/usr/bin/env node
// RuvNet Brain corpus ingest playbook (agentbox).
//
// Loads the upstream ruvnet-brain passage corpus (~90k source chunks across
// 21+ RuvNet ecosystem repos) into the shared ruvector-postgres sidecar under
// namespace `ruvnet-kb`, embedded client-side via Xinference
// bge-small-en-v1.5 384-dim (ADR-015) — the SAME embedding space and the SAME
// memory_entries table as all other agent memory. We deliberately discard the
// upstream retrieval stack (@ruvector/rvf file stores + @xenova/transformers
// in-process embedder): the corpus is the value, the substrate is ours.
//
// Runs automatically at boot (backgrounded, after Xinference readiness) when
// [skills.ruvnet_brain].auto_ingest = true, and manually via
//   ./agentbox.sh ruvnet-brain ingest [--force]
//   ./agentbox.sh ruvnet-brain status
//
// Idempotence: the corpus release tag is stamped in a `ruvnet/manifest` row;
// matching tag + non-empty corpus → fast no-op. Chunks are content-addressed
// (key = ruvnet/<repo>/<sha256-12>), so re-ingest only embeds NEW/changed
// chunks; unchanged rows get a metadata version bump; rows absent from the
// new corpus are pruned. Safe to re-run at every boot / after every build —
// this IS the "bleeding edge at build time" reconciliation.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, createReadStream, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

// ── Config ───────────────────────────────────────────────────────────────────
const NAMESPACE   = process.env.RUVNET_BRAIN_NAMESPACE || 'ruvnet-kb';
const SOURCE_TYPE = 'ruvnet-brain-ingest';
const CONNINFO    = process.env.RUVECTOR_PG_CONNINFO || '';
const XINFERENCE  = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMB_MODEL   = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
const EMB_DIM     = 384;
const RELEASE_URL = process.env.RUVNET_BRAIN_RELEASE_URL
  || 'https://github.com/stuinfla/ruvnet-brain/releases/latest/download/ruvnet-brain.zip';
const STAGING     = process.env.RUVNET_BRAIN_STAGING || '/var/lib/agentbox/ruvnet-brain';
const BATCH       = Math.max(8, Math.min(Number(process.env.RUVNET_BRAIN_EMBED_BATCH) || 32, 128));
const EMBED_TRUNC = 2000; // chars fed to the embedder (full text kept in value)

const FORCE  = process.argv.includes('--force');
const STATUS = process.argv.includes('--status');

const log = (m) => process.stderr.write(`[${new Date().toISOString()}] [ruvnet-brain-ingest] ${m}\n`);
const die = (m, code = 1) => { log(`FATAL: ${m}`); process.exit(code); };

// ── pg: resolve from baked closures, never npm-install at runtime ────────────
function loadPg() {
  const req = createRequire(import.meta.url);
  const candidates = [
    '/opt/agentbox/mcp/ruvnet-brain/node_modules/pg',
    ...(process.env.AGENTBOX_PG_NODE_PATH ? [join(process.env.AGENTBOX_PG_NODE_PATH, 'pg')] : []),
    '/opt/agentbox/management-api/node_modules/pg',
    'pg',
  ];
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  die('pg module not found in any baked closure');
}
const { Pool } = loadPg();

// ── Xinference client (batch) ────────────────────────────────────────────────
function httpJson(url, { method = 'GET', body = null, timeout = 60000, headers = {} } = {}) {
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

async function embedBatch(texts) {
  const j = await httpJson(`${XINFERENCE}/v1/embeddings`, {
    method: 'POST',
    body: { model: EMB_MODEL, input: texts },
    timeout: 120000,
  });
  const embs = (j.data || []).map((d) => d.embedding);
  if (embs.length !== texts.length) throw new Error(`embed count mismatch: ${embs.length}/${texts.length}`);
  for (const e of embs) if (!Array.isArray(e) || e.length !== EMB_DIM) throw new Error('bad embedding dim');
  return embs;
}

async function waitXinference(maxSecs = 180) {
  const deadline = Date.now() + maxSecs * 1000;
  while (Date.now() < deadline) {
    try { await embedBatch(['ready-probe']); return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

// ── Release version discovery ────────────────────────────────────────────────
// The /releases/latest/download/ URL 302s through /releases/download/<tag>/…;
// the tag in the Location header is the corpus version.
function discoverVersion(url) {
  return new Promise((resolvePromise) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'HEAD', timeout: 15000 }, (res) => {
      const loc = res.headers.location || '';
      const m = loc.match(/\/releases\/download\/([^/]+)\//);
      res.resume();
      resolvePromise(m ? decodeURIComponent(m[1]) : null);
    });
    req.on('error', () => resolvePromise(null));
    req.on('timeout', () => { req.destroy(); resolvePromise(null); });
    req.end();
  });
}

// ── SQL helpers (mirror ruvector-mcp.cjs conventions) ────────────────────────
const vecToSql = (arr) => '[' + arr.join(',') + ']';
const entryId  = (key) => `${SOURCE_TYPE}:${NAMESPACE}:${key}`;
const sha12    = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

// ── Passage field mapping (defensive against upstream format drift) ──────────
function mapPassage(p, fileRepo) {
  const text = p.text ?? p.body ?? p.content ?? p.chunk ?? p.passage ?? null;
  if (!text || typeof text !== 'string' || text.trim().length < 10) return null;
  const repo = String(p.repo ?? p.repository ?? fileRepo ?? 'unknown').toLowerCase();
  const path = String(p.path ?? p.file ?? p.source ?? p.loc ?? '');
  return { text: text.trim(), repo, path };
}

async function* streamJsonl(file) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try { yield JSON.parse(t); } catch { /* skip malformed line */ }
  }
}

// ── Optional dataset URN (best-effort, minted through uris.js per ADR-013) ───
function mintCorpusUrn(version) {
  try {
    const req = createRequire(import.meta.url);
    const uris = req('/opt/agentbox/management-api/lib/uris.js');
    const pubkey = process.env.AGENTBOX_PUBKEY || '';
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
    return uris.mint({ kind: 'dataset', pubkey, localId: `ruvnet-kb-${version}` });
  } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────
// Conninfo arrives in either libpq key=value form or postgresql:// URL form —
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

async function main() {
  if (!CONNINFO) die('RUVECTOR_PG_CONNINFO not set');
  const pool = new Pool({ ...poolConfig(CONNINFO), max: 4 });

  const manifestRow = async () => {
    const r = await pool.query(
      `SELECT value FROM memory_entries WHERE namespace = $1 AND key = 'ruvnet/manifest' LIMIT 1`, [NAMESPACE]);
    if (!r.rows.length) return null;
    try { return typeof r.rows[0].value === 'object' ? r.rows[0].value : JSON.parse(r.rows[0].value); } catch { return null; }
  };
  const corpusCount = async () => (await pool.query(
    `SELECT count(*)::int AS n FROM memory_entries WHERE namespace = $1 AND key <> 'ruvnet/manifest'`, [NAMESPACE])).rows[0].n;

  if (STATUS) {
    const m = await manifestRow();
    const n = await corpusCount();
    process.stdout.write(JSON.stringify({ namespace: NAMESPACE, chunks: n, manifest: m }, null, 2) + '\n');
    await pool.end(); return;
  }

  // 1. Version reconciliation — the every-boot fast path.
  const remoteVersion = await discoverVersion(RELEASE_URL);
  const manifest = await manifestRow();
  const existingCount = await corpusCount();
  if (!FORCE && remoteVersion && manifest?.corpus_version === remoteVersion && existingCount > 0) {
    log(`corpus up to date (${remoteVersion}, ${existingCount} chunks) — nothing to do`);
    await pool.end(); return;
  }
  if (!remoteVersion && !FORCE && existingCount > 0) {
    log('release version undiscoverable (offline?) and corpus non-empty — keeping current corpus');
    await pool.end(); return;
  }
  const version = remoteVersion || `unversioned-${new Date().toISOString().slice(0, 10)}`;
  log(`ingesting corpus version ${version} (have: ${manifest?.corpus_version || 'none'}, ${existingCount} chunks)${FORCE ? ' [--force]' : ''}`);

  // 2. Xinference readiness — embeddings are mandatory for this corpus.
  if (!(await waitXinference())) die(`xinference not serving embeddings at ${XINFERENCE} after 180s`);

  // 3. Download + extract ONLY the passage files (the .rvf vector stores and
  //    ONNX models in the bundle are upstream's retrieval stack — not ours).
  mkdirSync(STAGING, { recursive: true });
  const zipPath = join(STAGING, 'ruvnet-brain.zip');
  const extractDir = join(STAGING, 'passages');
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  log(`downloading ${RELEASE_URL} → ${zipPath} (~512 MB, be patient)`);
  execFileSync('curl', ['-fSL', '--retry', '3', '--max-time', '1800', '-o', zipPath, RELEASE_URL], { stdio: ['ignore', 'ignore', 'inherit'] });
  log('extracting *.passages.jsonl');
  try {
    execFileSync('unzip', ['-oj', zipPath, '*.passages.jsonl', '-d', extractDir], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    // unzip exits 11 when no entries match — surface a clear error.
    die(`no *.passages.jsonl entries found in bundle (${e.message})`);
  }
  rmSync(zipPath, { force: true }); // DB is the destination; don't hoard 512 MB on the volume

  const files = readdirSync(extractDir).filter((f) => f.endsWith('.passages.jsonl'));
  if (!files.length) die('extraction produced no passage files');
  log(`${files.length} passage file(s): ${files.join(', ')}`);

  // 4. Preload existing keys → skip re-embedding unchanged content.
  const existing = new Set(
    (await pool.query(`SELECT key FROM memory_entries WHERE namespace = $1`, [NAMESPACE])).rows.map((r) => r.key));

  // 5. Stream, embed (new only), upsert. Content-addressed keys make this
  //    incremental: unchanged chunk → metadata version bump only.
  let seen = 0, inserted = 0, skipped = 0, failedBatches = 0;
  const seenKeys = new Set();
  const versionBumpKeys = [];

  const flushBump = async () => {
    if (!versionBumpKeys.length) return;
    await pool.query(
      `UPDATE memory_entries
          SET metadata = metadata || jsonb_build_object('corpus_version', $2::text), updated_at = NOW()
        WHERE namespace = $1 AND key = ANY($3)`,
      [NAMESPACE, version, versionBumpKeys.splice(0)],
    );
  };

  const insertBatch = async (items, embs) => {
    // Multi-row upsert, one statement per embed batch.
    const cols = [];
    const params = [];
    items.forEach((it, i) => {
      const base = params.length;
      params.push(
        entryId(it.key), NAMESPACE, it.key,
        JSON.stringify({ text: it.text, repo: it.repo, path: it.path }),
        SOURCE_TYPE,
        JSON.stringify({ memory_type: 'semantic', tags: ['ruvnet-kb', it.repo], repo: it.repo, path: it.path, corpus_version: version }),
        vecToSql(embs[i]),
      );
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
  };

  let pending = [];
  const flushPending = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0);
    try {
      const embs = await embedBatch(batch.map((b) => b.text.substring(0, EMBED_TRUNC)));
      await insertBatch(batch, embs);
      inserted += batch.length;
    } catch (e) {
      failedBatches++;
      log(`WARN: batch of ${batch.length} failed (${e.message}) — continuing`);
    }
    if (seen % 5000 < BATCH) log(`progress: ${seen} seen, ${inserted} embedded+upserted, ${skipped} unchanged`);
  };

  for (const f of files) {
    const fileRepo = f.replace(/\.passages\.jsonl$/, '').replace(/\.(big|sharp)$/, '');
    for await (const raw of streamJsonl(join(extractDir, f))) {
      const p = mapPassage(raw, fileRepo);
      if (!p) continue;
      seen++;
      const key = `ruvnet/${p.repo}/${sha12(`${p.repo}\0${p.path}\0${p.text}`)}`;
      if (seenKeys.has(key)) continue; // intra-corpus duplicate
      seenKeys.add(key);
      if (existing.has(key) && !FORCE) {
        skipped++;
        versionBumpKeys.push(key);
        if (versionBumpKeys.length >= 500) await flushBump();
        continue;
      }
      pending.push({ ...p, key });
      if (pending.length >= BATCH) await flushPending();
    }
  }
  await flushPending();
  await flushBump();

  if (!seenKeys.size) die('corpus parse produced zero usable passages — aborting before prune');
  if (failedBatches > 0 && inserted === 0 && skipped === 0) die(`all ${failedBatches} batches failed — aborting before prune`);

  // 6. Prune rows that vanished from the new corpus (stale version stamp).
  const pruned = await pool.query(
    `DELETE FROM memory_entries
      WHERE namespace = $1 AND key <> 'ruvnet/manifest'
        AND (metadata->>'corpus_version') IS DISTINCT FROM $2`,
    [NAMESPACE, version],
  );

  // 7. Manifest stamp (+ best-effort ADR-013 dataset URN).
  const urn = mintCorpusUrn(version);
  const manifestValue = {
    corpus_version: version,
    ingested_at: new Date().toISOString(),
    chunks: seenKeys.size, embedded: inserted, unchanged: skipped,
    pruned: pruned.rowCount, failed_batches: failedBatches,
    source: RELEASE_URL, ...(urn ? { dataset_urn: urn } : {}),
  };
  await pool.query(
    `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
     VALUES ($1, $2, 'ruvnet/manifest', $3::jsonb, $4, $5::jsonb, NULL)
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, metadata = EXCLUDED.metadata, updated_at = NOW()`,
    [entryId('ruvnet/manifest'), NAMESPACE, JSON.stringify(manifestValue), SOURCE_TYPE,
     JSON.stringify({ memory_type: 'semantic', tags: ['ruvnet-kb', 'manifest'], corpus_version: version })],
  );

  rmSync(extractDir, { recursive: true, force: true });
  writeFileSync(join(STAGING, 'last-ingest.json'), JSON.stringify(manifestValue, null, 2));
  log(`done: ${seenKeys.size} chunks (${inserted} embedded, ${skipped} unchanged, ${pruned.rowCount} pruned, ${failedBatches} failed batches) → namespace ${NAMESPACE} @ ${version}`);
  await pool.end();
}

main().catch((e) => die(e.stack || e.message));
