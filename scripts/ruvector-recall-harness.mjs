#!/usr/bin/env node
// scripts/ruvector-recall-harness.mjs
//
// Recall-regression harness — the universal geometry gate (ADR-040 D2 / W-B,
// DDD-018 §4.3 RecallHarnessRun, PRD-020 §3.2). It is the mandatory pre/post
// check for every retrieval-geometry change in the v2 learning programme: no
// consumer that alters what a query returns (SONA apply, attention re-rank,
// param tuning, feed_retrieval re-rank, an embedding-model cutover, a
// graph-augmented orient) may flip its gate without a passing run here (I14).
//
// It runs a FROZEN, checked-in QuerySetFixture
// (scripts/recall-fixtures/recall-fixture.v1.json) against the live HNSW index
// and reports three class scores plus a PASS/FAIL against a no-regression band:
//
//   • self-recall@10  — 200 rows, own stored embedding is the query; pass = the
//                       row's own id survives in its own HNSW top-10. Stratified
//                       across the ≥50-row namespaces, ruvnet-kb capped at ~40%.
//   • true-recall@10  — 120 rows vs a forced exact (brute-force) scan as ground
//                       truth; the gated score counts queries whose own row
//                       survives the HNSW top-10 (the 119/120 framing), and the
//                       |HNSW∩exact|/min(10,|exact|) intersection recall is
//                       surfaced alongside. Restricted to ≥20-row namespaces.
//   • exact-token     — ~20-30 literal tokens known verbatim in a bounded
//                       namespace (error codes, CUDA_ARCH, HNSW, filenames,
//                       function names): the class pure-vector misses and hybrid
//                       exists to fix. Requirement: hybrid recall ≥ pure-vector
//                       recall (delta ≥ 0) — hybrid must never trade exact-token
//                       recall for semantic gains.
//
// The gate is a no-regression band taken as the MEDIAN OF 3 runs, to absorb
// HNSW's inherent ef_search entry-point jitter (an exact-match gate would flap):
//   PASS iff median(self) ≥ 175/200 AND median(true) ≥ 102/120 AND
//          median(exact-token hybrid delta) ≥ 0.
// A per-namespace self-recall breakdown is surfaced but NOT gated — it catches a
// regression localised to one namespace that a corpus-wide average would hide.
//
// The harness is READ-ONLY against the DB (no memory_store, no schema change —
// classes 1/2 issue only kNN SELECTs; class 3 calls the governed memSearch /
// memHybridSearch read paths). It NEVER writes an aggregate or a fixture row.
// Per-run evidence artifacts land on disk under
//   backups/ruvector-sidecar/recall-runs/<utc>.json
// (not the governed store — Phase 0 harness is a pure reader).
//
// Modes:
//   node ruvector-recall-harness.mjs                 run the frozen fixture (default)
//   node ruvector-recall-harness.mjs --runs 3 --k 10 override run count / top-k
//   node ruvector-recall-harness.mjs --fixture PATH  run a different fixture
//   node ruvector-recall-harness.mjs --json          print only the machine JSON
//   node ruvector-recall-harness.mjs --build-fixture ONE-SHOT: re-sample the live
//                                                    corpus, write the fixture, exit.
//                                                    (--force overwrites an existing one)
//
// The engine subcommand `agentbox.sh ruvector recall` resolves the governed MCP
// env (RUVECTOR_PG_CONNINFO, XINFERENCE_ENDPOINT, EMBEDDING_MODEL, the gate vars)
// from .mcp.json and invokes this file; see scripts/ruvector-sidecar-update.sh.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..');

// ── config ────────────────────────────────────────────────────────────────────
const EMBEDDING_DIM = 384;
const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
const WRITE_SOURCE_TYPE = 'agentbox';
const HNSW_INDEX = 'idx_memory_embedding_hnsw';

const DEFAULT_FIXTURE = join(REPO_DIR, 'scripts', 'recall-fixtures', 'recall-fixture.v1.json');
const RUN_ARTIFACT_DIR = join(REPO_DIR, 'backups', 'ruvector-sidecar', 'recall-runs');

// Fixture-build sizing (ADR-040 D2 / DDD-018 §4.3 / PRD-020 §3.2).
const SELF_TOTAL = 200;
const SELF_NS_MIN_ROWS = 50;        // a namespace is self-recall eligible at ≥50 embedded rows
const SELF_RUVNET_CAP = 80;         // dominant ruvnet-kb capped at ~40% so diversity survives
const TRUE_TOTAL = 120;
const TRUE_NS_MIN_ROWS = 20;        // true-recall restricted to ≥20-row namespaces
const TRUE_RUVNET_CAP = 48;         // ~40% cap on ruvnet-kb for diversity
const EXACT_TOKEN_TARGET_MAX = 26;  // keep at most this many verified exact tokens
const EXACT_TOKEN_MIN = 15;         // warn if fewer than this many verify
const EXACT_TOKEN_NS_CAP = 6000;    // bound the scoped scan cost (exclude the 131k-row ruvnet-kb)
const EXACT_TOKEN_GT_CAP = 300;     // cap ground-truth rows collected per token
const BUILD_SEED = 0.20260721;      // deterministic sampling seed (reproducible rebuilds)

// Curated exact-token candidates; the builder keeps only those with a verbatim
// hit (≥2 rows) inside a bounded (≤EXACT_TOKEN_NS_CAP) non-ruvnet-kb namespace.
const EXACT_TOKEN_CANDIDATES = [
  'HNSW', 'ef_construction', 'ef_search', 'pgvector', 'tsvector', 'CUDA_ARCH',
  'bge-small-en-v1.5', 'Micro-LoRA', 'Wilson', 'GraphSAGE', 'neuromorphic',
  'QuDAG', 'SHACL', 'Oxigraph', 'Whelk', 'SPARQL', 'GraphRAG', 'ReasoningBank',
  'Nostr', 'Taproot', 'provenance', 'trajectory_steps', 'memory_entries',
  'ColBERT', 'nDCG', 'ruvector_attention_score', 'maintenance_work_mem',
  'Byzantine', 'websocket', 'quantization',
];

function log(level, msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [recall-harness] ${msg}\n`);
}
function die(msg, code = 1) { log('ERROR', msg); process.exit(code); }

// ── pg loader (baked closures, never npm-install at runtime; mirrors the
//    aggregate-effectiveness / ruvnet-brain-ingest idiom) ─────────────────────
function loadPg() {
  const candidates = [
    '/opt/agentbox/mcp/ruvnet-brain/node_modules/pg',
    '/opt/agentbox/management-api/node_modules/pg',
    '/home/devuser/workspace/.claude-pg/node_modules/pg',
    ...(process.env.AGENTBOX_PG_NODE_PATH ? [join(process.env.AGENTBOX_PG_NODE_PATH, 'pg')] : []),
    'pg',
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`pg module not found in any baked closure: ${candidates.join(', ')}`);
}

function makePool() {
  const Pg = loadPg();
  const conninfo = process.env.RUVECTOR_PG_CONNINFO ||
    'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector';
  const parsed = {};
  for (const pair of conninfo.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) parsed[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return new Pg.Pool({
    host: parsed.host || 'ruvector-postgres',
    port: parseInt(parsed.port || '5432', 10),
    database: parsed.dbname || parsed.database || 'ruvector',
    user: parsed.user || parsed.username || 'ruvector',
    password: parsed.password || 'ruvector',
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

// ── xinference embedding transport (mirrors ruvector-mcp.cjs / aggregate-eff) ──
let xinferenceOk = false;
function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  return new Promise((resolve, reject) => {
    const url = new URL(XINFERENCE_URL + '/v1/embeddings');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.data && j.data[0] && j.data[0].embedding) {
            const emb = j.data[0].embedding;
            if (emb.length === EMBEDDING_DIM) { resolve(emb); return; }
            reject(new Error(`dimension mismatch: got ${emb.length}, expected ${EMBEDDING_DIM}`));
          } else { reject(new Error(`unexpected response: ${data.substring(0, 200)}`)); }
        } catch (e) { reject(new Error(`parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}
async function xinfEnsure() {
  if (xinferenceOk) return true;
  try { await getEmbedding('reconnect probe'); xinferenceOk = true; } catch { /* stays false */ }
  return xinferenceOk;
}
function vecToSql(arr) { return '[' + arr.join(',') + ']'; }
function entryId(namespace, key) { return `${WRITE_SOURCE_TYPE}:${namespace}:${key}`; }
function parseVal(v) { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; }

// ── pure helpers (exported for the unit test; no DB) ───────────────────────────
function sha12(s) { return createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12); }

// Median of a numeric array (middle element for odd length, mean of the two
// middle for even). Empty → null.
function median(nums) {
  const a = (nums || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Fraction of ground truth recovered in the retrieved top-k: |retrieved∩gt| /
// min(k, |gt|). gt is a Set; retrieved is an ordered id/key list.
function intersectionRecall(retrieved, groundTruth, k) {
  const gt = groundTruth instanceof Set ? groundTruth : new Set(groundTruth || []);
  if (!gt.size) return null;
  const top = (retrieved || []).slice(0, k);
  let hit = 0;
  for (const r of top) if (gt.has(r)) hit++;
  return hit / Math.min(k, gt.size);
}

// D'Hondt-style proportional allocation of `total` units across namespaces,
// honouring a per-namespace floor and cap (and never exceeding a namespace's
// own row count). Deterministic. Used only at fixture-build time.
function allocateStratified(total, sizesObj, { cap = {}, floor = 1 } = {}) {
  const names = Object.keys(sizesObj);
  const ceilOf = (n) => Math.min(sizesObj[n], cap[n] ?? Infinity);
  const alloc = {};
  for (const n of names) alloc[n] = Math.min(floor, ceilOf(n));
  let assigned = names.reduce((s, n) => s + alloc[n], 0);
  while (assigned < total) {
    const room = names.filter((n) => alloc[n] < ceilOf(n));
    if (!room.length) break;
    // Highest quotient size/(alloc+1) wins the next seat; ties broken by name
    // for determinism.
    room.sort((a, b) => (sizesObj[b] / (alloc[b] + 1)) - (sizesObj[a] / (alloc[a] + 1)) || (a < b ? -1 : 1));
    alloc[room[0]]++;
    assigned++;
  }
  return alloc;
}

// PASS/FAIL against the frozen band from the three per-class medians.
function verdictFromMedians(medians, band) {
  const reasons = [];
  const selfOk = medians.self_recall >= band.self_recall_min;
  const trueOk = medians.true_recall >= band.true_recall_min;
  // A null exact-token delta (class degraded/empty) is treated as a FAIL cause
  // surfaced honestly, never a silent pass.
  const exactOk = medians.exact_token_delta !== null && medians.exact_token_delta >= band.exact_token_hybrid_delta_min;
  if (!selfOk) reasons.push(`self-recall median ${medians.self_recall} < ${band.self_recall_min}/${band.self_recall_of}`);
  if (!trueOk) reasons.push(`true-recall median ${medians.true_recall} < ${band.true_recall_min}/${band.true_recall_of}`);
  if (!exactOk) reasons.push(`exact-token hybrid delta median ${medians.exact_token_delta} < ${band.exact_token_hybrid_delta_min}`);
  return { pass: selfOk && trueOk && exactOk, reasons };
}

// Hash over the load-bearing fixture fields (id lists + exact-token queries +
// baseline + band) — detects drift/tampering between build and run.
function fixtureHash(fx) {
  const canon = JSON.stringify({
    self: fx.self_recall.ids,
    true: fx.true_recall.ids,
    exact: fx.exact_token,
    baseline: fx.baseline,
    band: fx.band,
  });
  return 'sha256-' + createHash('sha256').update(canon, 'utf8').digest('hex');
}

// ── memory tool wiring (governed read paths, injected deps — same discipline as
//    aggregate-effectiveness.js) ────────────────────────────────────────────────
function makeMemoryTools(pool) {
  const { createMemoryTools } = require(join(REPO_DIR, 'mcp', 'servers', 'lib', 'memory-tools.js'));
  const { createHybridTools } = require(join(REPO_DIR, 'mcp', 'servers', 'lib', 'memory-hybrid.js'));
  const deps = {
    pool,
    getPgOk: () => true,
    getEmbedding,
    xinfEnsure,
    vecToSql,
    entryId,
    parseVal,
    notifyMemoryFlash: () => {},
    notifyMemoryFlashBatch: () => {},
    log,
    writeSourceType: WRITE_SOURCE_TYPE,
  };
  const memTools = createMemoryTools({ backend: 'external-pg', deps });
  const hybridTools = createHybridTools({ ...deps, memSearch: memTools.memSearch });
  return { memTools, hybridTools };
}

// ── kNN primitives ─────────────────────────────────────────────────────────────
// HNSW top-k on a client whose session GUCs force the index path
// (`enable_seqscan=off`, matching docs/ruvector-system-reference.md §7's recall
// snippet). Forcing the index is load-bearing: without it the planner could
// silently choose a sequential scan for a LIMIT-10 kNN and report a falsely
// PERFECT recall — the exact silent-pass the harness exists to prevent. No WHERE
// on the kNN order — ruvector's HNSW post-filters its candidate set so a WHERE
// can silently truncate; all indexed rows carry a non-null embedding anyway.
async function hnswTopK(client, vecText, k) {
  const r = await client.query(
    `SELECT id FROM memory_entries ORDER BY embedding <=> $1::ruvector(384) LIMIT $2`,
    [vecText, k],
  );
  return r.rows.map((x) => x.id);
}

// Acquire a client pinned to the HNSW index path for every self/true-recall kNN.
async function acquireHnswClient(pool) {
  const client = await pool.connect();
  await client.query('SET enable_seqscan = off');
  await client.query('SET enable_bitmapscan = off');
  return client;
}

// Brute-force ground truth: force a sequential scan (bypass HNSW) inside a txn
// so the SET LOCAL planner GUCs are scoped and reverted automatically.
async function exactTopK(pool, vecText, k) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_indexscan = off');
    await client.query('SET LOCAL enable_bitmapscan = off');
    await client.query('SET LOCAL enable_indexonlyscan = off');
    await client.query('SET LOCAL enable_seqscan = on');
    const r = await client.query(
      `SELECT id FROM memory_entries WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::ruvector(384) LIMIT $2`,
      [vecText, k],
    );
    await client.query('COMMIT');
    return r.rows.map((x) => x.id);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── ADR-2018/2019 closeout (2026-09-05): bind the run to WHAT IT MEASURED ─────
//
// A verdict is only evidence if you can say what it was a verdict ABOUT. The
// review's finding was that the run reported `hnsw-xinference` and a PASS
// without recording the model identity, the preprocessing, the corpus/index
// revision or the effective filters — so a later reader cannot tell whether the
// receipt still applies. These helpers collect exactly those, and the receipt
// they feed is what the release gate consumes.

// Corpus + index revision. Row counts and the newest write date identify the
// corpus; the index definition identifies the geometry it is searched with. A
// rebuilt index with different parameters changes recall without changing a
// single row, so both halves are needed.
async function corpusRevision(pool) {
  const totals = await pool.query(
    `SELECT count(*)::bigint AS rows,
            count(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded,
            count(DISTINCT namespace)::bigint AS namespaces,
            max(updated_at) AS newest
       FROM memory_entries`);
  const t = totals.rows[0] || {};
  let indexDef = null;
  try {
    const idx = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [HNSW_INDEX]);
    indexDef = (idx.rows[0] && idx.rows[0].indexdef) || null;
  } catch { /* index metadata unavailable — recorded as null, never guessed */ }
  const rev = {
    memory_entries: Number(t.rows) || 0,
    embedded: Number(t.embedded) || 0,
    // ADR-2014: rows awaiting embedding repair are unsearchable, so they are
    // part of the corpus revision a recall number must be read against.
    pending_embeddings: (Number(t.rows) || 0) - (Number(t.embedded) || 0),
    namespaces: Number(t.namespaces) || 0,
    newest_entry: t.newest instanceof Date ? t.newest.toISOString() : (t.newest || null),
    hnsw_index: HNSW_INDEX,
    hnsw_indexdef: indexDef,
  };
  rev.revision = 'corpus-' + sha12(JSON.stringify([rev.memory_entries, rev.embedded, rev.namespaces, rev.newest_entry, indexDef]));
  return rev;
}

// Effective model identity — the ADR-2019 fingerprint, not just the configured
// name. Two different 384-dim models share a dimension and share nothing else.
async function embeddingIdentity() {
  try {
    const ident = require(join(REPO_DIR, 'mcp', 'servers', 'lib', 'embedding-identity.js'));
    const verdict = await ident.verifyEmbeddingIdentity(getEmbedding);
    return {
      state: verdict.state,
      ok: verdict.ok,
      model: verdict.effective.model,
      fingerprint: verdict.effective.fingerprint,
      preprocessing: verdict.effective.preprocessing,
      pinned_fingerprint: verdict.pin ? verdict.pin.fingerprint : null,
      message: verdict.message || null,
    };
  } catch (e) {
    return { state: 'unavailable', ok: null, model: EMBEDDING_MODEL, fingerprint: null, error: e.message };
  }
}

// The effective filters the run actually exercised — the namespaces the fixture
// touches and the scoped/unfiltered split. The review noted scoped searches
// report the same `hnsw-xinference` method as unfiltered ones, so the receipt
// records which plan each class used rather than trusting the label.
function effectiveFilters(fixture) {
  const selfNs = fixture.self_recall.allocation ? Object.keys(fixture.self_recall.allocation) : [];
  const trueNs = fixture.true_recall.allocation ? Object.keys(fixture.true_recall.allocation) : [];
  const tokenNs = [...new Set(fixture.exact_token.map((q) => q.namespace))];
  return {
    self_recall: { namespaces: selfNs, plan: 'unfiltered kNN over the whole index (no namespace predicate)' },
    true_recall: { namespaces: trueNs, plan: 'unfiltered kNN vs a forced exact scan' },
    exact_token: { namespaces: tokenNs, source_type: null, plan: 'namespace-scoped memSearch / memHybridSearch (materialised subset, exact rank)' },
  };
}

// Every RUVECTOR_* gate observed at run time — a recall number measured with a
// consumer on is not evidence for the same corpus with it off.
function observedGates() {
  const out = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('RUVECTOR_') && !/CONNINFO|PASSWORD/.test(k)) out[k] = process.env[k];
  }
  return out;
}

// ── fixture builder (--build-fixture, one-shot, read-only) ─────────────────────
async function sampleIds(pool, namespace, n) {
  if (n <= 0) return [];
  const r = await pool.query(
    `SELECT id FROM memory_entries
      WHERE namespace = $1 AND embedding IS NOT NULL
      ORDER BY random() LIMIT $2`,
    [namespace, n],
  );
  return r.rows.map((x) => x.id);
}

async function buildFixture(pool) {
  log('INFO', 'building fixture (read-only sample of the live corpus)…');
  // Deterministic sampling seed so a rebuild reproduces the same draw.
  await pool.query('SELECT setseed($1)', [BUILD_SEED]);

  const nsRows = (await pool.query(
    `SELECT namespace, count(*)::int AS c FROM memory_entries
      WHERE embedding IS NOT NULL GROUP BY namespace`,
  )).rows;
  const sizes = Object.fromEntries(nsRows.map((r) => [r.namespace, r.c]));
  const totals = (await pool.query(
    `SELECT count(*)::int AS n, count(embedding)::int AS emb,
            count(DISTINCT namespace)::int AS ns FROM memory_entries`,
  )).rows[0];

  // ── self-recall: ≥50-row namespaces, ruvnet-kb capped ──
  const selfSizes = Object.fromEntries(Object.entries(sizes).filter(([, c]) => c >= SELF_NS_MIN_ROWS));
  const selfAlloc = allocateStratified(SELF_TOTAL, selfSizes, { cap: { 'ruvnet-kb': SELF_RUVNET_CAP }, floor: 1 });
  const selfIds = [];
  const selfAllocFinal = {};
  for (const ns of Object.keys(selfAlloc)) {
    const got = await sampleIds(pool, ns, selfAlloc[ns]);
    for (const id of got) selfIds.push(id);
    if (got.length) selfAllocFinal[ns] = got.length;
  }

  // ── true-recall: ≥20-row namespaces, ruvnet-kb capped ──
  const trueSizes = Object.fromEntries(Object.entries(sizes).filter(([, c]) => c >= TRUE_NS_MIN_ROWS));
  const trueAlloc = allocateStratified(TRUE_TOTAL, trueSizes, { cap: { 'ruvnet-kb': TRUE_RUVNET_CAP }, floor: 1 });
  const trueIds = [];
  const trueAllocFinal = {};
  for (const ns of Object.keys(trueAlloc)) {
    const got = await sampleIds(pool, ns, trueAlloc[ns]);
    for (const id of got) trueIds.push(id);
    if (got.length) trueAllocFinal[ns] = got.length;
  }

  // ── exact-token: keep candidates with a verbatim hit in a bounded namespace ──
  const exactToken = [];
  for (const token of EXACT_TOKEN_CANDIDATES) {
    if (exactToken.length >= EXACT_TOKEN_TARGET_MAX) break;
    const hits = (await pool.query(
      `SELECT namespace, count(*)::int AS c FROM memory_entries
        WHERE embedding IS NOT NULL AND value::text ILIKE '%' || $1 || '%'
        GROUP BY namespace HAVING count(*) >= 2 ORDER BY c DESC`,
      [token],
    )).rows;
    const bounded = hits.filter((h) => h.namespace !== 'ruvnet-kb' && (sizes[h.namespace] || Infinity) <= EXACT_TOKEN_NS_CAP);
    if (bounded.length) {
      exactToken.push({ token, namespace: bounded[0].namespace, ground_truth_hits: bounded[0].c });
    }
  }
  if (exactToken.length < EXACT_TOKEN_MIN) {
    log('WARN', `only ${exactToken.length} exact-token queries verified (< ${EXACT_TOKEN_MIN}); the class signal will be thin`);
  }

  const fixture = {
    version: 1,
    built_at: new Date().toISOString(),
    builder: 'ruvector-recall-harness.mjs --build-fixture',
    embedding: { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM },
    hnsw: { index: HNSW_INDEX, op: '<=>', dim: EMBEDDING_DIM },
    corpus_snapshot: {
      memory_entries: totals.n,
      embedded: totals.emb,
      namespaces: totals.ns,
      built_against: 'live sidecar (ruvector-postgres)',
    },
    // Documented v1 reference (docs/ruvector-system-reference.md §7). NOT an
    // asserted pass record for this freshly-sampled fixture: the operative
    // baseline is frozen by the queen in the ops phase after reviewing a live
    // run. Carried here so the band structure is self-contained.
    baseline: {
      self_recall: [188, 200],
      true_recall: [119, 120],
      status: 'provisional-spec-reference',
      note: 'v1 documented baseline; the operative baseline for THIS fixture is frozen in the ops phase, not asserted at build time.',
    },
    band: {
      self_recall_min: 175,
      self_recall_of: 200,
      true_recall_min: 102,
      true_recall_of: 120,
      exact_token_hybrid_delta_min: 0,
      median_of: 3,
      k: 10,
    },
    self_recall: { count: selfIds.length, allocation: selfAllocFinal, ids: selfIds },
    true_recall: { count: trueIds.length, allocation: trueAllocFinal, ids: trueIds },
    exact_token: exactToken,
  };
  fixture.fixture_hash = fixtureHash(fixture);
  return fixture;
}

function writeFixture(fixture, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
}

// ── preload (read-only): fetch every fixture embedding once, hard-error on a
//    missing id (fixture drift — never a silent pass; R-B1). Embeddings are
//    stable across the 3 runs, so this halves the query volume. ───────────────
async function preloadEmbeddings(pool, ids) {
  const map = new Map();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const r = await pool.query(
      `SELECT id, namespace, embedding::text AS vec FROM memory_entries
        WHERE id = ANY($1) AND embedding IS NOT NULL`,
      [slice],
    );
    for (const row of r.rows) map.set(row.id, { vec: row.vec, namespace: row.namespace });
  }
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) {
    throw new Error(
      `fixture drift: ${missing.length}/${ids.length} id(s) no longer resolve to an embedded row ` +
      `(e.g. ${missing.slice(0, 3).map((m) => JSON.stringify(m)).join(', ')}). ` +
      `Rebuild the fixture (--build-fixture) — a missing id is drift, never a pass.`,
    );
  }
  return map;
}

async function preloadExactTokenGroundTruth(pool, exactToken) {
  const out = [];
  for (const q of exactToken) {
    const r = await pool.query(
      `SELECT key FROM memory_entries
        WHERE namespace = $1 AND embedding IS NOT NULL AND value::text ILIKE '%' || $2 || '%'
        LIMIT $3`,
      [q.namespace, q.token, EXACT_TOKEN_GT_CAP],
    );
    out.push({ token: q.token, namespace: q.namespace, gt: new Set(r.rows.map((x) => x.key)) });
  }
  return out;
}

// ── per-run measurement ─────────────────────────────────────────────────────────
async function runSelfRecall(hnswClient, embMap, selfIds, k) {
  let count = 0;
  const perNs = {}; // ns → { hits, total }
  for (const id of selfIds) {
    const { vec, namespace } = embMap.get(id);
    const top = await hnswTopK(hnswClient, vec, k);
    const hit = top.includes(id);
    perNs[namespace] = perNs[namespace] || { hits: 0, total: 0 };
    perNs[namespace].total++;
    if (hit) { count++; perNs[namespace].hits++; }
  }
  return { count, of: selfIds.length, per_namespace: perNs };
}

async function runTrueRecall(hnswClient, embMap, exactGroundTruth, trueIds, k) {
  // exactGroundTruth here is the per-id exact top-k, precomputed once (deterministic).
  let ownCount = 0;
  const interRecalls = [];
  const perNs = {};
  for (const id of trueIds) {
    const { vec, namespace } = embMap.get(id);
    const hnsw = await hnswTopK(hnswClient, vec, k);
    const exact = exactGroundTruth.get(id);
    const ownHit = hnsw.includes(id);
    perNs[namespace] = perNs[namespace] || { hits: 0, total: 0 };
    perNs[namespace].total++;
    if (ownHit) { ownCount++; perNs[namespace].hits++; }
    const ir = intersectionRecall(hnsw, new Set(exact), k);
    if (ir !== null) interRecalls.push(ir);
  }
  const meanInter = interRecalls.length ? interRecalls.reduce((s, x) => s + x, 0) / interRecalls.length : null;
  return { count: ownCount, of: trueIds.length, mean_intersection_recall: meanInter, per_namespace: perNs };
}

async function runExactToken(memTools, hybridTools, gtList, k) {
  const perToken = [];
  const deltas = [];
  for (const { token, namespace, gt } of gtList) {
    let pureHits = 0; let hybridHits = 0; let error = null;
    try {
      const pure = await memTools.memSearch(token, namespace, k);
      const hybrid = await hybridTools.memHybridSearch(token, namespace, k);
      const pureKeys = (pure.results || []).map((r) => r.key);
      const hybridKeys = (hybrid.results || []).map((r) => r.key);
      for (const kk of pureKeys) if (gt.has(kk)) pureHits++;
      for (const kk of hybridKeys) if (gt.has(kk)) hybridHits++;
      if (pure.degraded || hybrid.degraded) error = 'degraded (xinference unavailable → ILIKE fallback)';
    } catch (e) {
      error = e.message;
    }
    const delta = hybridHits - pureHits;
    perToken.push({ token, namespace, gt_size: gt.size, pure_hits: pureHits, hybrid_hits: hybridHits, delta, error });
    if (!error) deltas.push(delta);
  }
  return { median_delta: deltas.length ? median(deltas) : null, deltas, per_token: perToken };
}

// ── harness driver ──────────────────────────────────────────────────────────────
async function runHarness(pool, fixture, { runs, k }) {
  const { memTools, hybridTools } = makeMemoryTools(pool);

  // Fixture-hash integrity check (informational; a mismatch means the checked-in
  // fixture was hand-edited without re-hashing).
  const recomputed = fixtureHash(fixture);
  const hashOk = recomputed === fixture.fixture_hash;
  if (!hashOk) log('WARN', `fixture_hash mismatch (stored ${fixture.fixture_hash} vs recomputed ${recomputed}); fixture may have been hand-edited`);

  // Preload (read-only). A missing id hard-errors here (fixture drift).
  const allIds = [...fixture.self_recall.ids, ...fixture.true_recall.ids];
  const embMap = await preloadEmbeddings(pool, allIds);

  // Precompute the deterministic exact-scan ground truth for true-recall ONCE
  // (it does not vary run-to-run — only the HNSW path jitters).
  log('INFO', `computing brute-force ground truth for ${fixture.true_recall.ids.length} true-recall queries (forced seq scan)…`);
  const exactGT = new Map();
  for (const id of fixture.true_recall.ids) {
    const { vec } = embMap.get(id);
    exactGT.set(id, await exactTopK(pool, vec, k));
  }

  // Exact-token ground truth (deterministic) — verbatim-hit key sets per token.
  const xinfUp = await xinfEnsure();
  if (!xinfUp) log('WARN', `xinference unreachable (${XINFERENCE_URL}); exact-token class will report degraded (ILIKE fallback) and cannot pass honestly`);
  const exactTokenGT = await preloadExactTokenGroundTruth(pool, fixture.exact_token);

  const runResults = [];
  const hnswClient = await acquireHnswClient(pool);
  try {
    for (let i = 0; i < runs; i++) {
      const self = await runSelfRecall(hnswClient, embMap, fixture.self_recall.ids, k);
      const tru = await runTrueRecall(hnswClient, embMap, exactGT, fixture.true_recall.ids, k);
      const exact = await runExactToken(memTools, hybridTools, exactTokenGT, k);
      runResults.push({ run: i + 1, self_recall: self, true_recall: tru, exact_token: exact });
      log('INFO', `run ${i + 1}/${runs}: self ${self.count}/${self.of}, true ${tru.count}/${tru.of}, exact-token median Δ ${exact.median_delta}`);
    }
  } finally {
    hnswClient.release();
  }

  const selfCounts = runResults.map((r) => r.self_recall.count);
  const trueCounts = runResults.map((r) => r.true_recall.count);
  const exactDeltas = runResults.map((r) => r.exact_token.median_delta);
  const medians = {
    self_recall: median(selfCounts),
    true_recall: median(trueCounts),
    exact_token_delta: median(exactDeltas.filter((x) => x !== null)),
  };
  const verdict = verdictFromMedians(medians, fixture.band);

  // ADR-2018/2019: the run binding. Collected AFTER the runs so it describes the
  // state the measurement actually saw.
  const binding = {
    embedding: await embeddingIdentity(),
    corpus: await corpusRevision(pool),
    filters: effectiveFilters(fixture),
    gates: observedGates(),
  };

  // Per-namespace breakdown from the run whose self count equals the median
  // (surfaced, not gated).
  const medSelfIdx = selfCounts.indexOf(medians.self_recall) >= 0
    ? selfCounts.indexOf(medians.self_recall) : 0;
  const perNsSelf = runResults[medSelfIdx].self_recall.per_namespace;

  return {
    schema: 'ruvector-recall-harness/run@1',
    ran_at: new Date().toISOString(),
    fixture: {
      path_version: fixture.version,
      built_at: fixture.built_at,
      fixture_hash: fixture.fixture_hash,
      hash_ok: hashOk,
      sizes: {
        self_recall: fixture.self_recall.ids.length,
        true_recall: fixture.true_recall.ids.length,
        exact_token: fixture.exact_token.length,
      },
    },
    config: {
      runs, k,
      embedding_model: EMBEDDING_MODEL,
      xinference: xinfUp ? 'up' : 'DOWN',
      gates: {
        RUVECTOR_FEED_RETRIEVAL: process.env.RUVECTOR_FEED_RETRIEVAL || 'unset',
        RUVECTOR_HYBRID_SEARCH: process.env.RUVECTOR_HYBRID_SEARCH || 'unset',
      },
    },
    // ADR-2018 closeout: what this verdict is a verdict ABOUT.
    binding,
    baseline: fixture.baseline,
    band: fixture.band,
    medians,
    verdict,
    per_namespace_self_recall: perNsSelf,
    runs_detail: runResults,
  };
}

// ── console rendering ────────────────────────────────────────────────────────────
function printReport(report) {
  const w = process.stdout;
  const b = report.band;
  const m = report.medians;
  const v = report.verdict;
  w.write(`\nRecall-regression harness — ${report.ran_at}\n`);
  w.write(`fixture ${report.fixture.fixture_hash}${report.fixture.hash_ok ? '' : ' (HASH MISMATCH)'}  |  ` +
          `runs=${report.config.runs} k=${report.config.k} model=${report.config.embedding_model} xinference=${report.config.xinference}\n\n`);
  const pf = (ok) => ok ? 'PASS' : 'FAIL';
  const selfOk = m.self_recall >= b.self_recall_min;
  const trueOk = m.true_recall >= b.true_recall_min;
  const exactOk = m.exact_token_delta !== null && m.exact_token_delta >= b.exact_token_hybrid_delta_min;
  w.write(`  self-recall@${b.k}   median ${m.self_recall}/${b.self_recall_of}   (band ≥ ${b.self_recall_min})   ${pf(selfOk)}\n`);
  w.write(`  true-recall@${b.k}   median ${m.true_recall}/${b.true_recall_of}   (band ≥ ${b.true_recall_min})   ${pf(trueOk)}\n`);
  w.write(`  exact-token Δ     median ${m.exact_token_delta === null ? 'n/a' : m.exact_token_delta}   (band ≥ ${b.exact_token_hybrid_delta_min}, hybrid−pure)   ${pf(exactOk)}\n`);
  w.write(`  baseline (v1 ref) self ${report.baseline.self_recall.join('/')}, true ${report.baseline.true_recall.join('/')} [${report.baseline.status}]\n\n`);

  // per-namespace breakdown (surfaced, not gated)
  const perNs = report.per_namespace_self_recall;
  const nsNames = Object.keys(perNs).sort((a, c) => perNs[c].total - perNs[a].total);
  if (nsNames.length) {
    w.write('  per-namespace self-recall (surfaced, not gated):\n');
    for (const ns of nsNames) {
      const e = perNs[ns];
      const flag = e.hits < e.total ? '  <-- misses' : '';
      w.write(`    ${String(ns).padEnd(34).slice(0, 34)} ${String(e.hits).padStart(3)}/${String(e.total).padStart(3)}${flag}\n`);
    }
    w.write('\n');
  }

  w.write(`  VERDICT: ${v.pass ? 'PASS' : 'FAIL'}`);
  if (!v.pass) w.write(`  (${v.reasons.join('; ')})`);
  w.write('\n\n');
}

function writeRunArtifact(report) {
  mkdirSync(RUN_ARTIFACT_DIR, { recursive: true });
  const ts = report.ran_at.replace(/[:.]/g, '-');
  const path = join(RUN_ARTIFACT_DIR, `${ts}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return path;
}

// ── ADR-2018 closeout: the RECEIPT the release gate consumes ─────────────────
//
// The full run artifact is a diagnostic record; the receipt is the compact,
// checkable claim. It is written to a STABLE path so the gate has something to
// read without knowing the run timestamp, and it is self-describing: every
// identity the verdict depends on travels with the verdict. `receipt_hash`
// covers the whole claim so a hand-edited receipt is detectable.
const RECEIPT_PATH = join(RUN_ARTIFACT_DIR, 'latest-receipt.json');

function buildReceipt(report) {
  const claim = {
    schema: 'ruvector-recall-harness/receipt@1',
    adr: 'ADR-2018',
    ran_at: report.ran_at,
    verdict: report.verdict.pass ? 'PASS' : 'FAIL',
    reasons: report.verdict.reasons || [],
    medians: report.medians,
    band: report.band,
    runs: report.config.runs,
    k: report.config.k,
    bound_to: {
      // The four identities the acceptance condition names, plus the gates.
      model: {
        name: report.binding.embedding.model,
        fingerprint: report.binding.embedding.fingerprint,
        pinned_fingerprint: report.binding.embedding.pinned_fingerprint || null,
        identity_state: report.binding.embedding.state,
      },
      preprocessing: report.binding.embedding.preprocessing || null,
      corpus: report.binding.corpus,
      fixture: {
        hash: report.fixture.fixture_hash,
        hash_ok: report.fixture.hash_ok,
        built_at: report.fixture.built_at,
        sizes: report.fixture.sizes,
      },
      filters: report.binding.filters,
      gates: report.binding.gates,
      xinference: report.config.xinference,
    },
    // Honesty flags a gate must refuse on, stated rather than implied.
    degraded: report.config.xinference !== 'up',
    identity_ok: report.binding.embedding.ok !== false,
  };
  claim.receipt_hash = 'sha256-12-' + sha12(JSON.stringify(claim));
  return claim;
}

function writeReceipt(report) {
  mkdirSync(RUN_ARTIFACT_DIR, { recursive: true });
  const receipt = buildReceipt(report);
  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return { path: RECEIPT_PATH, receipt };
}

// ══ FIXTURE v2 (ADR-2018 amendment, 2026-10-31) ═══════════════════════════════
//
// v2 is a NEW file and schema (scripts/recall-fixtures/recall-fixture.v2.json,
// schema "ruvector-recall-fixture/v2"); v1 and its hash binding are untouched
// and every v1 code path above is byte-for-byte as before. A v2 fixture is a
// list of TEXT QUERY CASES judged on the path an agent actually uses
// (memSearch -> shapeSearchResponse with the relevance floor), not the
// self-embedding probes of v1:
//
//   positive case  { id, query, namespace?, min_docs?, gold:[{namespace,key,doc?}] }
//       passes iff >= min_docs (default 1) DISTINCT gold source pages (`doc`,
//       default = the entry itself) appear in the top-k with score >= floor.
//   negative case  { id, query, namespace?, negative:true }
//       the right answer is "nothing relevant": passes iff NO top-k result
//       clears the relevance floor. A degraded (ILIKE) or errored search is
//       never a pass.
//
// RELEVANCE FLOOR: the one the agent path already applies, the cosine floor
// RUVECTOR_SEARCH_MIN_SCORE (default 0.55, memory-tools.js DEFAULT_MIN_SCORE,
// calibrated 2026-09-25 on bge-small-en-v1.5). The fixture freezes its own copy
// (`relevance_floor`, hash-bound) and the gate refuses if the deployed floor
// differs from it.
//
// STALE GOLD: before measuring, every gold (namespace,key) is checked against
// memory_entries (read-only). Missing gold is counted and reported separately
// and EXCLUDED from the hit denominators rather than silently lowering them.
// A positive case whose surviving gold cannot satisfy min_docs is excluded
// whole. The verdict (and the gate) FAIL when stale gold exceeds
// band.max_stale_gold_fraction, so corpus drift is loud, never absorbed.
const FIXTURE_V2_SCHEMA = 'ruvector-recall-fixture/v2';
const DEFAULT_FIXTURE_V2 = join(REPO_DIR, 'scripts', 'recall-fixtures', 'recall-fixture.v2.json');
// v2 receipts NEVER go to latest-receipt.json: that file is what the release gate
// reads by default, and the ADR-2018 v1 band must keep being what it judges. A v2
// receipt is judged only when named: recall-gate.mjs --receipt <this path>.
const RECEIPT_PATH_V2 = join(RUN_ARTIFACT_DIR, 'latest-receipt.v2.json');
const V2_DEFAULT_BAND = {
  positive_hit_rate_min: 0.7,
  negative_pass_rate_min: 0.8,
  max_stale_gold_fraction: 0.1,
  median_of: 3,
  k: 10,
};

function goldKey(g) { return `${g.namespace}\u0000${g.key}`; }
function goldDoc(g) { return g.doc === undefined || g.doc === null || g.doc === '' ? goldKey(g) : `${g.namespace}\u0000${g.doc}`; }
function caseNamespace(c) { return c.namespace || '*'; }

// Hash over the load-bearing v2 fields. `baseline` is deliberately NOT bound:
// it is the OUTPUT of measuring this fixture, so binding it would make the hash
// change at the moment of measurement. The band, floor, embedding model and the
// cases are bound, so loosening a threshold or editing a case changes the hash.
function fixtureHashV2(fx) {
  const canon = JSON.stringify({
    schema: fx.schema,
    floor: fx.relevance_floor,
    model: fx.embedding && fx.embedding.model,
    cases: fx.cases,
    band: fx.band,
  });
  return 'sha256-' + createHash('sha256').update(canon, 'utf8').digest('hex');
}

// Structural validation; returns a list of error strings (empty = valid).
function validateFixtureV2(fx) {
  const errs = [];
  if (!fx || fx.schema !== FIXTURE_V2_SCHEMA || fx.version !== 2) errs.push(`not a ${FIXTURE_V2_SCHEMA} fixture`);
  if (!fx || !Array.isArray(fx.cases) || !fx.cases.length) { errs.push('cases[] missing or empty'); return errs; }
  if (!Number.isFinite(fx.relevance_floor)) errs.push('relevance_floor must be a number');
  if (!fx.band || typeof fx.band !== 'object') errs.push('band missing');
  const seen = new Set();
  for (const c of fx.cases) {
    const where = `case ${JSON.stringify(c && c.id)}`;
    if (!c || typeof c.id !== 'string' || !c.id) { errs.push('case without a string id'); continue; }
    if (seen.has(c.id)) errs.push(`${where}: duplicate id`);
    seen.add(c.id);
    if (typeof c.query !== 'string' || !c.query.trim()) errs.push(`${where}: empty query`);
    if (c.negative === true) {
      if (c.gold && c.gold.length) errs.push(`${where}: a negative case must not carry gold`);
      if (c.min_docs !== undefined) errs.push(`${where}: a negative case must not set min_docs`);
    } else {
      if (!Array.isArray(c.gold) || !c.gold.length) { errs.push(`${where}: positive case needs gold[]`); continue; }
      for (const g of c.gold) if (!g || typeof g.namespace !== 'string' || typeof g.key !== 'string') errs.push(`${where}: gold entries need {namespace,key}`);
      const docs = new Set(c.gold.filter((g) => g && g.namespace && g.key).map(goldDoc));
      const need = c.min_docs === undefined ? 1 : c.min_docs;
      if (!Number.isInteger(need) || need < 1) errs.push(`${where}: min_docs must be an integer >= 1`);
      else if (docs.size < need) errs.push(`${where}: min_docs ${need} exceeds the ${docs.size} distinct gold doc(s)`);
    }
  }
  return errs;
}

// READ-ONLY existence check of every distinct gold (namespace,key). Returns the
// Set of goldKey()s that still exist in memory_entries. Existence only: a row
// whose embedding is still pending is NOT stale (it is a real retrieval miss,
// surfaced via the corpus pending_embeddings count, and must stay in the
// denominator).
async function checkGoldExistence(pool, fixture) {
  const uniq = new Map();
  for (const c of fixture.cases) for (const g of c.gold || []) uniq.set(goldKey(g), g);
  const all = [...uniq.values()];
  const existing = new Set();
  const CHUNK = 500;
  for (let i = 0; i < all.length; i += CHUNK) {
    const slice = all.slice(i, i + CHUNK);
    const r = await pool.query(
      `SELECT namespace, key FROM memory_entries
        WHERE (namespace, key) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [slice.map((g) => g.namespace), slice.map((g) => g.key)],
    );
    for (const row of r.rows) existing.add(goldKey(row));
  }
  return existing;
}

// Pure. Split every case into scorable / excluded and count stale gold.
// stale_fraction = distinct stale gold entries / distinct gold entries.
function partitionGold(fixture, existing) {
  const allGold = new Map();
  const staleGold = new Map();
  const cases = [];
  for (const c of fixture.cases) {
    if (c.negative === true) { cases.push({ case: c, status: 'scorable', live_gold: [], stale_gold: [] }); continue; }
    const live = []; const stale = [];
    for (const g of c.gold) {
      allGold.set(goldKey(g), g);
      if (existing.has(goldKey(g))) live.push(g); else { stale.push(g); staleGold.set(goldKey(g), g); }
    }
    const liveDocs = new Set(live.map(goldDoc)).size;
    const need = c.min_docs === undefined ? 1 : c.min_docs;
    cases.push({ case: c, status: liveDocs >= need ? 'scorable' : 'stale_excluded', live_gold: live, stale_gold: stale });
  }
  const total = allGold.size;
  return {
    cases,
    stale: {
      gold_total: total,
      stale_gold: staleGold.size,
      stale_fraction: total ? staleGold.size / total : 0,
      stale_cases: cases.filter((x) => x.status === 'stale_excluded').map((x) => x.case.id),
      stale_gold_entries: [...staleGold.values()].map((g) => ({ namespace: g.namespace, key: g.key })),
    },
  };
}

// Pure. Score one case from the (already floor-shaped, best-first) top-k rows
// and the unfloored rows. `res` = { floored:[{key,namespace,score}], unfloored:[...], error? }.
function scoreCaseV2(part, res) {
  const c = part.case;
  const base = { id: c.id, kind: c.negative === true ? 'negative' : 'positive' };
  if (res.error) return { ...base, pass: false, error: res.error };
  if (c.negative === true) {
    const offenders = res.floored.map((r) => ({ namespace: r.namespace, key: r.key, score: r.score }));
    return { ...base, pass: offenders.length === 0, offenders };
  }
  const goldDocOf = new Map(part.live_gold.map((g) => [goldKey(g), goldDoc(g)]));
  const docsIn = (rows) => new Set(rows.map((r) => goldDocOf.get(goldKey(r))).filter(Boolean));
  const need = c.min_docs === undefined ? 1 : c.min_docs;
  const found = docsIn(res.floored);
  const foundUnfloored = docsIn(res.unfloored);
  let bestRank = null;
  res.unfloored.forEach((r, i) => { if (bestRank === null && goldDocOf.has(goldKey(r))) bestRank = i + 1; });
  return {
    ...base, pass: found.size >= need, docs_found: found.size, docs_needed: need,
    docs_found_ignoring_floor: foundUnfloored.size, best_gold_rank: bestRank,
  };
}

// Pure. Per-run class counts from scored scorable cases.
function summariseRunV2(scored) {
  const pos = scored.filter((s) => s.kind === 'positive');
  const neg = scored.filter((s) => s.kind === 'negative');
  const hits = pos.filter((s) => s.pass).length;
  const passes = neg.filter((s) => s.pass).length;
  return {
    positive: { hits, of: pos.length, rate: pos.length ? hits / pos.length : null },
    negative: { passes, of: neg.length, rate: neg.length ? passes / neg.length : null },
  };
}

// PASS/FAIL. A class that is required (band min non-null) but has NO scorable
// cases fails: an empty denominator is never a silent pass.
function verdictV2(medians, band, stale, declared) {
  const reasons = [];
  const need = (min, rate, label, nDeclared) => {
    if (min === null || min === undefined) return;
    if (rate === null || rate === undefined) {
      if (nDeclared > 0) reasons.push(`${label}: no scorable case left (all ${nDeclared} excluded as stale) — a rate cannot be computed`);
      else reasons.push(`${label}: the fixture declares no such cases but the band requires ${min}`);
    } else if (rate < min) reasons.push(`${label} median ${rate.toFixed(3)} < ${min}`);
  };
  need(band.positive_hit_rate_min, medians.positive_hit_rate, 'positive hit rate', declared.positive);
  need(band.negative_pass_rate_min, medians.negative_pass_rate, 'negative pass rate', declared.negative);
  if (band.max_stale_gold_fraction !== null && band.max_stale_gold_fraction !== undefined
      && stale.stale_fraction > band.max_stale_gold_fraction) {
    reasons.push(`stale gold ${stale.stale_gold}/${stale.gold_total} (${(stale.stale_fraction * 100).toFixed(1)}%) exceeds the ${(band.max_stale_gold_fraction * 100).toFixed(1)}% bound — the corpus has drifted from the fixture; rebuild it`);
  }
  return { pass: reasons.length === 0, reasons };
}

function loadShape() {
  return require(join(REPO_DIR, 'mcp', 'servers', 'lib', 'memory-tools.js')).shapeSearchResponse;
}

// One case through the agent retrieval path: memSearch, then the same
// shapeSearchResponse the MCP tool applies (sort best-first, drop below floor,
// cap at k). `unfloored` is the same rows with the floor lowered, for diagnosis.
async function searchCaseV2(memTools, shape, c, k, floor) {
  let raw;
  try { raw = await memTools.memSearch(c.query, caseNamespace(c), k); }
  catch (e) { return { error: `search threw: ${e.message}` }; }
  if (!raw || raw.success !== true) return { error: `search failed: ${(raw && raw.error) || 'no response'}` };
  if (raw.degraded) return { error: 'degraded (xinference unavailable -> ILIKE fallback): scores are not similarities' };
  const floored = shape(raw, { full: true, minScore: floor, limit: k });
  const unfloored = shape(raw, { full: true, minScore: -1, limit: k });
  return { floored: floored.results || [], unfloored: unfloored.results || [] };
}

async function runHarnessV2(deps, fixture, { runs, k }) {
  const { pool } = deps;
  const memTools = deps.memTools;
  const hybridTools = deps.hybridTools;
  const shape = deps.shape || loadShape();
  const ensure = deps.xinfEnsure || xinfEnsure;

  const errs = validateFixtureV2(fixture);
  if (errs.length) throw new Error(`invalid v2 fixture: ${errs.join('; ')}`);
  const recomputed = fixtureHashV2(fixture);
  const hashOk = recomputed === fixture.fixture_hash;
  if (!hashOk) log('WARN', `fixture_hash mismatch (stored ${fixture.fixture_hash} vs recomputed ${recomputed}); fixture may have been hand-edited`);

  // Stale-gold check first, once: gold existence does not vary between runs.
  const existing = await checkGoldExistence(pool, fixture);
  const part = partitionGold(fixture, existing);
  if (part.stale.stale_gold) log('WARN', `stale gold: ${part.stale.stale_gold}/${part.stale.gold_total} entries missing; ${part.stale.stale_cases.length} case(s) excluded from the denominators`);
  const scorable = part.cases.filter((p) => p.status === 'scorable');

  const xinfUp = await ensure();
  if (!xinfUp) log('WARN', `xinference unreachable (${XINFERENCE_URL}); every search degrades and no case can pass honestly`);
  const floor = fixture.relevance_floor;

  const runResults = [];
  for (let i = 0; i < runs; i++) {
    const scored = [];
    for (const p of scorable) {
      const res = await searchCaseV2(memTools, shape, p.case, k, floor);
      scored.push(scoreCaseV2(p, res));
    }
    const sum = summariseRunV2(scored);
    // Surfaced, never gated: how the hybrid path (whatever RUVECTOR_HYBRID_FUSION
    // selects) ranks gold on namespace-scoped positive cases, floor ignored since
    // hybrid scores are not cosines. This is the number a fusion comparison reads.
    let hybrid = null;
    if (hybridTools) {
      let hits = 0; let of = 0;
      for (const p of scorable) {
        if (p.case.negative === true || caseNamespace(p.case) === '*') continue;
        of++;
        try {
          const h = await hybridTools.memHybridSearch(p.case.query, caseNamespace(p.case), k);
          const docOf = new Map(p.live_gold.map((g) => [goldKey(g), goldDoc(g)]));
          const found = new Set((h.results || []).slice(0, k).map((r) => docOf.get(goldKey(r))).filter(Boolean));
          if (found.size >= (p.case.min_docs === undefined ? 1 : p.case.min_docs)) hits++;
        } catch { /* a failing hybrid case simply does not hit */ }
      }
      hybrid = { hits, of, rate: of ? hits / of : null, fusion: process.env.RUVECTOR_HYBRID_FUSION || 'blend' };
    }
    runResults.push({ run: i + 1, ...sum, hybrid_surfaced: hybrid, cases: scored });
    log('INFO', `run ${i + 1}/${runs}: positive ${sum.positive.hits}/${sum.positive.of}, negative ${sum.negative.passes}/${sum.negative.of}`);
  }

  const medians = {
    positive_hit_rate: median(runResults.map((r) => r.positive.rate)),
    negative_pass_rate: median(runResults.map((r) => r.negative.rate)),
  };
  const declared = {
    positive: fixture.cases.filter((c) => c.negative !== true).length,
    negative: fixture.cases.filter((c) => c.negative === true).length,
  };
  const verdict = verdictV2(medians, fixture.band, part.stale, declared);
  const binding = deps.collectBinding ? await deps.collectBinding() : {
    embedding: await embeddingIdentity(),
    corpus: await corpusRevision(pool),
    filters: {
      cases: { namespaces: [...new Set(fixture.cases.map(caseNamespace))], plan: 'memSearch + shapeSearchResponse (the agent retrieval path), relevance floor applied' },
    },
    gates: observedGates(),
  };

  return {
    schema: 'ruvector-recall-harness/run@2',
    ran_at: new Date().toISOString(),
    fixture: {
      path_version: fixture.version, built_at: fixture.built_at, fixture_hash: fixture.fixture_hash, hash_ok: hashOk,
      sizes: { positive: declared.positive, negative: declared.negative, scorable: scorable.length },
    },
    config: { runs, k, embedding_model: EMBEDDING_MODEL, xinference: xinfUp ? 'up' : 'DOWN', relevance_floor: floor },
    binding,
    baseline: fixture.baseline || null,
    band: fixture.band,
    stale_gold: part.stale,
    medians,
    verdict,
    runs_detail: runResults,
  };
}

function printReportV2(report) {
  const w = process.stdout;
  const m = report.medians; const b = report.band; const s = report.stale_gold;
  const pct = (x) => (x === null ? 'n/a' : (x * 100).toFixed(1) + '%');
  w.write(`\nRecall-regression harness (fixture v2) — ${report.ran_at}\n`);
  w.write(`fixture ${report.fixture.fixture_hash}${report.fixture.hash_ok ? '' : ' (HASH MISMATCH)'}  |  runs=${report.config.runs} k=${report.config.k} floor=${report.config.relevance_floor} xinference=${report.config.xinference}\n\n`);
  w.write(`  stale gold        ${s.stale_gold}/${s.gold_total} (${pct(s.stale_fraction)}; bound ${pct(b.max_stale_gold_fraction)}), ${s.stale_cases.length} case(s) excluded from denominators\n`);
  w.write(`  positive hit rate median ${pct(m.positive_hit_rate)}   (band >= ${pct(b.positive_hit_rate_min)}, over ${report.fixture.sizes.positive - s.stale_cases.length} scorable)\n`);
  w.write(`  negative pass rate median ${pct(m.negative_pass_rate)}  (band >= ${pct(b.negative_pass_rate_min)}, over ${report.fixture.sizes.negative})\n\n`);
  w.write(`  VERDICT: ${report.verdict.pass ? 'PASS' : 'FAIL'}`);
  if (!report.verdict.pass) w.write(`  (${report.verdict.reasons.join('; ')})`);
  w.write('\n\n');
}

function buildReceiptV2(report, fixtureFile) {
  const claim = {
    schema: 'ruvector-recall-harness/receipt@2',
    adr: 'ADR-2018',
    ran_at: report.ran_at,
    verdict: report.verdict.pass ? 'PASS' : 'FAIL',
    reasons: report.verdict.reasons || [],
    medians: report.medians,
    band: report.band,
    runs: report.config.runs,
    k: report.config.k,
    relevance_floor: report.config.relevance_floor,
    stale_gold: report.stale_gold && {
      gold_total: report.stale_gold.gold_total,
      stale_gold: report.stale_gold.stale_gold,
      stale_fraction: report.stale_gold.stale_fraction,
      stale_cases: report.stale_gold.stale_cases.length,
    },
    bound_to: {
      model: {
        name: report.binding.embedding.model,
        fingerprint: report.binding.embedding.fingerprint,
        pinned_fingerprint: report.binding.embedding.pinned_fingerprint || null,
        identity_state: report.binding.embedding.state,
      },
      preprocessing: report.binding.embedding.preprocessing || null,
      corpus: report.binding.corpus,
      fixture: {
        version: 2,
        file: fixtureFile || null,
        hash: report.fixture.fixture_hash,
        hash_ok: report.fixture.hash_ok,
        built_at: report.fixture.built_at,
        sizes: report.fixture.sizes,
      },
      filters: report.binding.filters,
      gates: report.binding.gates,
      xinference: report.config.xinference,
    },
    degraded: report.config.xinference !== 'up',
    identity_ok: report.binding.embedding.ok !== false,
  };
  claim.receipt_hash = 'sha256-12-' + sha12(JSON.stringify(claim));
  return claim;
}

// ── v2 builder (--build-fixture-v2, one-shot, READ-ONLY, never run in tests
//    against a live DB: the spec drives it with a fake pool) ───────────────────
//
// Input is a seeds file: { relevance_floor?, band?, cases:[...] } where a case
// carries explicit `gold`, or `gold_match:{namespace, ilike, limit?, doc_regex?}`
// resolved here by a bounded read-only scan (doc_regex's first capture group of
// the key names the source page, so chunks of one page count once), or
// `negative:true`. Every gold is verified to exist at build time; a seed that
// names missing gold is an error, never silently dropped.
async function buildFixtureV2(pool, seeds, { model = EMBEDDING_MODEL } = {}) {
  const cases = [];
  for (const s of seeds.cases || []) {
    const c = { id: s.id, query: s.query };
    if (s.namespace && s.namespace !== '*') c.namespace = s.namespace;
    if (s.negative === true) { c.negative = true; cases.push(c); continue; }
    let gold = (s.gold || []).map((g) => ({ namespace: g.namespace, key: g.key, ...(g.doc ? { doc: g.doc } : {}) }));
    if (s.gold_match) {
      const gm = s.gold_match;
      const r = await pool.query(
        `SELECT namespace, key FROM memory_entries
          WHERE namespace = $1 AND embedding IS NOT NULL AND value::text ILIKE '%' || $2 || '%'
          ORDER BY key LIMIT $3`,
        [gm.namespace, gm.ilike, Math.min(50, Math.max(1, gm.limit || 10))],
      );
      const rx = gm.doc_regex ? new RegExp(gm.doc_regex) : null;
      for (const row of r.rows) {
        const m = rx ? rx.exec(row.key) : null;
        gold.push({ namespace: row.namespace, key: row.key, ...(m && m[1] ? { doc: m[1] } : {}) });
      }
    }
    if (gold.length) c.gold = gold;
    if (s.min_docs !== undefined) c.min_docs = s.min_docs;
    cases.push(c);
  }
  const fixture = {
    schema: FIXTURE_V2_SCHEMA,
    version: 2,
    built_at: new Date().toISOString(),
    builder: 'ruvector-recall-harness.mjs --build-fixture-v2',
    embedding: { model, dim: EMBEDDING_DIM },
    relevance_floor: Number.isFinite(seeds.relevance_floor) ? seeds.relevance_floor : require(join(REPO_DIR, 'mcp', 'servers', 'lib', 'memory-tools.js')).DEFAULT_MIN_SCORE,
    band: { ...V2_DEFAULT_BAND, ...(seeds.band || {}) },
    baseline: null,
    cases,
  };
  const errs = validateFixtureV2(fixture);
  if (errs.length) throw new Error(`seeds do not make a valid fixture: ${errs.join('; ')}`);
  const existing = await checkGoldExistence(pool, fixture);
  const missing = [];
  for (const c of cases) for (const g of c.gold || []) if (!existing.has(goldKey(g))) missing.push(`${c.id}: ${g.namespace}/${g.key}`);
  if (missing.length) throw new Error(`seeded gold not present in memory_entries (${missing.length}): ${missing.slice(0, 5).join(', ')}`);
  fixture.fixture_hash = fixtureHashV2(fixture);
  return fixture;
}

// ── main ─────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { mode: 'run', runs: 3, k: 10, fixture: DEFAULT_FIXTURE, json: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--build-fixture') opts.mode = 'build';
    else if (a === '--build-fixture-v2') opts.mode = 'build-v2';
    else if (a === '--seeds') opts.seeds = argv[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--runs') opts.runs = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (a === '--k' || a === '--top-k') opts.k = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (a === '--fixture') opts.fixture = argv[++i];
    else if (a === '-h' || a === '--help') opts.mode = 'help';
    else die(`unknown option: ${a}`);
  }
  return opts;
}

const HELP = `ruvector-recall-harness.mjs — recall-regression gate (ADR-040 D2 / W-B)

  (default)          run the frozen fixture, print class scores + PASS/FAIL,
                     write a run artifact under backups/ruvector-sidecar/recall-runs/
  --runs N           median-of-N runs (default 3)
  --k K              top-k for every class (default 10)
  --fixture PATH     use a different QuerySetFixture
  --json             print only the machine-readable run JSON
  --build-fixture    ONE-SHOT: re-sample the live corpus, write the fixture, exit
  --force            with --build-fixture[-v2], overwrite an existing fixture
  --build-fixture-v2 ONE-SHOT: build a v2 (text-query cases) fixture from --seeds FILE
                     (default output scripts/recall-fixtures/recall-fixture.v2.json via --fixture).
                     Read-only against the DB; never run it in tests.
  --seeds FILE       seed cases for --build-fixture-v2 (see the v2 block comment)
  A --fixture whose schema is ruvector-recall-fixture/v2 runs the v2 harness
  (negatives, min_docs, stale-gold exclusion); v1 fixtures behave exactly as before.
  A v2 run writes latest-receipt.v2.json, never latest-receipt.json (the v1 receipt
  the release gate reads by default); judge it with recall-gate.mjs --receipt PATH.
  -h, --help         this help

Exit code: 0 on PASS (or a successful build), non-zero on FAIL / error.
Read-only against the DB (no memory_store, no schema change).`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'help') { process.stdout.write(HELP + '\n'); process.exit(0); }

  const pool = makePool();
  try {
    if (opts.mode === 'build') {
      if (existsSync(opts.fixture) && !opts.force) {
        die(`fixture already exists: ${opts.fixture} (use --force to overwrite — the fixture is meant to be frozen once and committed)`);
      }
      const fixture = await buildFixture(pool);
      writeFixture(fixture, opts.fixture);
      log('INFO', `wrote fixture ${opts.fixture}`);
      process.stdout.write(
        `built fixture: self-recall ${fixture.self_recall.ids.length}, ` +
        `true-recall ${fixture.true_recall.ids.length}, exact-token ${fixture.exact_token.length}; ` +
        `hash ${fixture.fixture_hash}\n`,
      );
      process.exit(0);
    }

    if (opts.mode === 'build-v2') {
      const out = opts.fixture === DEFAULT_FIXTURE ? DEFAULT_FIXTURE_V2 : opts.fixture;
      if (!opts.seeds) die('--build-fixture-v2 needs --seeds FILE');
      if (existsSync(out) && !opts.force) die(`fixture already exists: ${out} (use --force to overwrite)`);
      const fixture = await buildFixtureV2(pool, JSON.parse(readFileSync(opts.seeds, 'utf8')));
      writeFixture(fixture, out);
      process.stdout.write(`built v2 fixture: ${fixture.cases.length} case(s) (${fixture.cases.filter((c) => c.negative).length} negative); hash ${fixture.fixture_hash}\n`);
      process.exit(0);
    }

    // run mode
    if (!existsSync(opts.fixture)) {
      die(`fixture not found: ${opts.fixture} — build it once with: node ${'ruvector-recall-harness.mjs'} --build-fixture`);
    }
    const fixture = JSON.parse(readFileSync(opts.fixture, 'utf8'));
    if (fixture.version === 2) {
      const { memTools, hybridTools } = makeMemoryTools(pool);
      const reportV2 = await runHarnessV2({ pool, memTools, hybridTools }, fixture, { runs: opts.runs, k: opts.k });
      reportV2.artifact = writeRunArtifact(reportV2);
      mkdirSync(RUN_ARTIFACT_DIR, { recursive: true });
      const receiptV2 = buildReceiptV2(reportV2, basename(opts.fixture));
      writeFileSync(RECEIPT_PATH_V2, JSON.stringify(receiptV2, null, 2) + '\n', 'utf8');
      if (opts.json) process.stdout.write(JSON.stringify(reportV2, null, 2) + '\n');
      else {
        printReportV2(reportV2);
        process.stdout.write(`  run artifact: ${reportV2.artifact}\n  receipt:      ${RECEIPT_PATH_V2}  (${receiptV2.receipt_hash})\n  judge it with: node scripts/recall-gate.mjs --receipt ${RECEIPT_PATH_V2}\n\n`);
      }
      process.exit(reportV2.verdict.pass ? 0 : 2);
    }
    const report = await runHarness(pool, fixture, { runs: opts.runs, k: opts.k });
    const artifactPath = writeRunArtifact(report);
    report.artifact = artifactPath;
    // ADR-2018: emit the receipt the release gate reads (scripts/recall-gate.mjs).
    const { path: receiptPath, receipt } = writeReceipt(report);
    report.receipt = receiptPath;

    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      printReport(report);
      const b = receipt.bound_to;
      process.stdout.write(
        `  bound to: model ${b.model.name} ${b.model.fingerprint || '(unprobed)'} [${b.model.identity_state}], ` +
        `corpus ${b.corpus.revision} (${b.corpus.embedded}/${b.corpus.memory_entries} embedded` +
        `${b.corpus.pending_embeddings ? `, ${b.corpus.pending_embeddings} PENDING repair` : ''}), ` +
        `fixture ${b.fixture.hash}\n`);
      process.stdout.write(`  run artifact: ${artifactPath}\n`);
      process.stdout.write(`  receipt:      ${receiptPath}  (${receipt.receipt_hash})\n\n`);
    }
    process.exit(report.verdict.pass ? 0 : 2);
  } finally {
    await pool.end().catch(() => {});
  }
}

// Only run main when executed directly (not when imported by the unit test).
// Compare real paths: the workspace reaches this checkout through a symlink
// (~/workspace/agentbox -> project/agentbox), and import.meta.url is always
// the resolved path, so a symlinked argv[1] would never match and the
// harness would exit 0 having measured nothing.
const sameFile = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
const invokedDirectly = Boolean(process.argv[1]) && sameFile(fileURLToPath(import.meta.url), process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => { die(e.stack || e.message); });
}

export {
  median,
  intersectionRecall,
  allocateStratified,
  verdictFromMedians,
  fixtureHash,
  sha12,
  RECEIPT_PATH,
  RECEIPT_PATH_V2,
  // fixture v2
  FIXTURE_V2_SCHEMA,
  fixtureHashV2,
  validateFixtureV2,
  checkGoldExistence,
  partitionGold,
  scoreCaseV2,
  summariseRunV2,
  verdictV2,
  runHarnessV2,
  buildReceiptV2,
  buildFixtureV2,
};
