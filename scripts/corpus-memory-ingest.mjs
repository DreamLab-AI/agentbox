#!/usr/bin/env node
// visionGraph corpus memory ingest (agentbox).
//
// Re-ingests the visionGraph vaults into RuVector namespace `knowledge/pages`
// IN PLACE: same keys, same row shape as the 20,119 rows already there, so an
// upsert overwrites rather than duplicates. Embedded client-side through
// Xinference bge-small-en-v1.5 384-dim (ADR-2019), the same pipeline and model
// as the governed memory MCP (ADR-2014), via the helpers it shares with
// scripts/ruvnet-brain-ingest.mjs (scripts/lib/ruvector-bulk.mjs).
//
//   node scripts/corpus-memory-ingest.mjs                  # dry-run (default): print the plan, write nothing
//   node scripts/corpus-memory-ingest.mjs --yes            # write; needs RUVECTOR_ADMIN_WRITE=true
//   node scripts/corpus-memory-ingest.mjs --yes --prune    # also delete rows no longer generated (see below)
//
// Flags
//   --yes               perform writes (otherwise a dry-run). --dry-run always wins.
//   --include-working   also ingest the PRIVATE `working/` vault (default OFF; public
//                       `knowledge/` is always ingested)
//   --prune             delete `knowledge`-sourced rows the corpus no longer generates:
//                       rows of vanished pages and stale sections of surviving pages.
//                       Rows of pages that live only in a vault excluded by this run are
//                       kept. Off by default. The deleted keys are written to a receipt
//                       (JSONL) BEFORE the delete so a tombstone consumer can replay them.
//   --force             re-embed everything, ignore the manifest fast path
//   --vault-root DIR    visionGraph checkout (default /home/devuser/workspace/visionGraph)
//   --namespace NS      default knowledge/pages
//   --max-failed N      abort before the prune when more chunks fail (default 1000)
//   --receipt-dir DIR   prune receipts and the last plan (default
//                       /home/devuser/workspace/.tmp/corpus-memory-ingest)
//   --json              print the plan summary as JSON on stdout
//
// Key scheme: scripts/lib/corpus-chunker.mjs (reverse-engineered from the live rows;
// docs/reference/corpus-memory-ingest.md). Idempotent: a row whose content hash
// matches and that already has an embedding is never re-embedded; its metadata is
// refreshed only when the page metadata or the generation changed. Metadata gains
// `generation` (visionGraph HEAD sha, "+dirty" when the vault has uncommitted
// changes) and `corpus_version`. A `_manifest` row stamps generation, row counts
// and failures; when its generation equals the checkout's and it recorded no
// failures, a re-run is a no-op.
//
// Authorisation (ADR-2014 amendment, "Sanctioned bulk ingesters"): writes bypass
// the memory MCP, so --yes is refused unless RUVECTOR_ADMIN_WRITE=true. Not wired
// into boot. Prune and erasure: ADR-2060 (cross-store erasure) is deferred and has
// no orchestration to call; pruning corpus-derived reference rows is reconciliation,
// not subject erasure, and is receipted instead.
//
// After a write run the HNSW index is churned. Rebuild it (ADR-2133, serial,
// non-concurrent, recall-gated) from the host-side checkout:
//   scripts/ruvector-sidecar-update.sh reindex --yes

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMB_DIM, makeLog, loadPg, poolConfig, createEmbedder, embedText, vecToSql, sha12,
  processBatch,
} from './lib/ruvector-bulk.mjs';
import { chunkPage } from './lib/corpus-chunker.mjs';

export const SOURCE_TYPE = 'knowledge';              // matches the existing rows
export const MANIFEST_SOURCE_TYPE = 'corpus-memory-ingest';
export const MANIFEST_KEY = '_manifest';
const SKIP_DIRS = new Set(['assets', 'templates', 'bases', 'node_modules']);
const log = makeLog('corpus-memory-ingest');

// ── Corpus walk ──────────────────────────────────────────────────────────────

/** Vault-relative `.md` names (dot-folders and non-page folders skipped). */
export function listVault(root, { fs = { readdirSync } } = {}) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name); continue; }
      if (e.isFile() && e.name.endsWith('.md')) out.push(rel ? `${rel}/${e.name}` : e.name);
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * Pages to ingest plus the set of every page name present on disk in either
 * vault. A name in both vaults is ingested from the public `knowledge/` vault
 * only. `known` lets the prune keep rows of pages that exist but were excluded.
 */
export function collectCorpus(vaultRoot, { includeWorking = false, read = (p) => readFileSync(p, 'utf8'), list = listVault } = {}) {
  const kn = list(join(vaultRoot, 'knowledge'));
  const wk = list(join(vaultRoot, 'working'));
  const known = new Set([...kn, ...wk]);
  const pages = kn.map((fileName) => ({ fileName, vault: 'knowledge', path: join(vaultRoot, 'knowledge', fileName) }));
  const shadowed = [];
  if (includeWorking) {
    const have = new Set(kn);
    for (const fileName of wk) {
      if (have.has(fileName)) shadowed.push(fileName);
      else pages.push({ fileName, vault: 'working', path: join(vaultRoot, 'working', fileName) });
    }
  }
  return { pages: pages.map((p) => ({ ...p, text: read(p.path) })), known, shadowed };
}

/** visionGraph HEAD sha, with "+dirty" when the ingested vault dirs have local changes. */
export function vaultGeneration(vaultRoot, { includeWorking = false, git = (args) => execFileSync('git', ['-C', vaultRoot, ...args], { encoding: 'utf8' }) } = {}) {
  const head = git(['rev-parse', 'HEAD']).trim();
  const dirty = git(['status', '--porcelain', '--', 'knowledge', ...(includeWorking ? ['working'] : [])]).trim() !== '';
  return { head, generation: dirty ? `${head}+dirty` : head, corpusVersion: `visiongraph@${head.slice(0, 12)}${dirty ? '+dirty' : ''}`, dirty };
}

// ── Plan (pure) ──────────────────────────────────────────────────────────────

const metaHashOf = (meta) => sha12(JSON.stringify(meta));

/**
 * Compare the generated chunks with the rows already in the namespace.
 *
 * @param {object[]} pages [{ fileName, vault, text }]
 * @param {object[]} existing rows: { key, source_type, source_file, content_hash, meta_hash, generation, embedded }
 * @param {object} o { generation, corpusVersion, known:Set<string>, prune:boolean }
 * @returns plan: { chunks[], counts, prune[], conflicts[], collisions[] }
 */
export function planIngest(pages, existing, { generation, corpusVersion, known, prune = false, embedModel = 'bge-small-en-v1.5' }) {
  const rows = new Map(existing.map((r) => [r.key, r]));
  const byKey = new Map(); // a key generated twice (two files, one slug) is last-wins, like the upsert
  const conflicts = [];
  const collisions = [];
  const generated = new Set();
  const scanned = new Set(pages.map((p) => p.fileName));
  const counts = { pages: pages.length, chunks: 0, new: 0, changed: 0, unchanged: 0, metadata_refresh: 0, generation_bump: 0, conflict: 0, collisions: 0, prune_vanished: 0, prune_stale: 0 };
  for (const page of pages) {
    const cp = chunkPage({ fileName: page.fileName, text: page.text, vault: page.vault });
    for (const k of cp.collisions) collisions.push(`${page.fileName}: ${k}`);
    for (const c of cp.chunks) {
      if (byKey.has(c.key)) collisions.push(`${page.fileName}: ${c.key} (cross-page)`);
      const meta = { ...c.meta, content_hash: c.contentHash, embed_model: embedModel };
      const metaHash = metaHashOf(meta);
      const row = rows.get(c.key);
      let action;
      if (row && row.source_type !== SOURCE_TYPE && row.source_type !== MANIFEST_SOURCE_TYPE) {
        conflicts.push(c.key); counts.conflict++; continue;
      }
      if (!row) action = 'new';
      // A row without our embed_model stamp (legacy writer) is re-embedded once: its stored
      // vector does not reproduce under the current pipeline (cosine ~0.27-0.30 on 2 sampled rows).
      else if (row.content_hash !== c.contentHash || !row.embedded || row.embed_model !== embedModel) action = 'changed';
      else if (row.meta_hash !== metaHash) action = 'metadata';
      else if (row.generation !== generation) action = 'generation';
      else action = 'unchanged';
      generated.add(c.key);
      byKey.set(c.key, { ...c, metaHash, action, metadata: { ...meta, meta_hash: metaHash, generation, corpus_version: corpusVersion } });
    }
  }
  const chunks = [...byKey.values()];
  for (const c of chunks) {
    counts.chunks++;
    if (c.action === 'new') counts.new++;
    else if (c.action === 'changed') counts.changed++;
    else if (c.action === 'metadata') { counts.unchanged++; counts.metadata_refresh++; }
    else if (c.action === 'generation') { counts.unchanged++; counts.generation_bump++; }
    else counts.unchanged++;
  }
  counts.collisions = collisions.length;
  // Prune candidates: knowledge-sourced rows that carry a source_file, are no
  // longer generated, and whose page is gone (vanished) or was scanned but lost
  // the section (stale). A page that exists only in an excluded vault is kept.
  const pruneList = [];
  for (const r of existing) {
    if (r.key === MANIFEST_KEY || r.source_type !== SOURCE_TYPE || !r.source_file || generated.has(r.key)) continue;
    if (!known.has(r.source_file)) { pruneList.push({ key: r.key, reason: 'vanished', source_file: r.source_file }); counts.prune_vanished++; }
    else if (scanned.has(r.source_file)) { pruneList.push({ key: r.key, reason: 'stale-section', source_file: r.source_file }); counts.prune_stale++; }
  }
  return { chunks, counts, prune: prune ? pruneList : [], pruneCandidates: pruneList, conflicts, collisions };
}

// ── Execution ────────────────────────────────────────────────────────────────

const rowId = (ns, key) => `${ns}/${key}`;

/** Read the namespace into the shape planIngest wants (read-only). */
export async function loadExisting(pool, namespace) {
  const r = await pool.query(
    `SELECT key, source_type, metadata->>'source_file' AS source_file, value->>'content_hash' AS content_hash,
            metadata->>'meta_hash' AS meta_hash, metadata->>'embed_model' AS embed_model, metadata->>'generation' AS generation,
            (embedding IS NOT NULL) AS embedded
       FROM memory_entries WHERE namespace = $1`, [namespace]);
  return r.rows;
}

/** Read the `_manifest` value, or null. */
export async function loadManifest(pool, namespace) {
  const r = await pool.query(`SELECT value FROM memory_entries WHERE namespace = $1 AND key = $2 LIMIT 1`, [namespace, MANIFEST_KEY]);
  if (!r.rows.length) return null;
  const v = r.rows[0].value;
  try { return typeof v === 'object' ? v : JSON.parse(v); } catch { return null; }
}

/**
 * Apply a plan. Every dependency is injected so tests run without a database.
 * @param {object} d { pool, embedder:{embedBatch}, namespace, generation, corpusVersion, batch, maxFailed, receiptDir, sleepFn, now }
 */
export async function applyPlan(plan, d) {
  const { pool, embedder, namespace, generation, corpusVersion } = d;
  const batchSize = d.batch || 32;
  const maxFailed = d.maxFailed ?? 1000;
  const stats = { embedded: 0, metadata_updated: 0, pruned: 0, failed_chunks: 0, failed_keys: [], aborted: null };

  const upsert = async (items, embs) => {
    const cols = []; const params = [];
    items.forEach((it, i) => {
      const base = params.length;
      params.push(rowId(namespace, it.key), namespace, it.key,
        JSON.stringify({ title: it.title, content: it.content, content_hash: it.contentHash }),
        SOURCE_TYPE, JSON.stringify(it.metadata), vecToSql(embs[i]));
      cols.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${base + 5}, $${base + 6}::jsonb, $${base + 7}::ruvector(${EMB_DIM}))`);
    });
    await pool.query(
      `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
       VALUES ${cols.join(', ')}
       ON CONFLICT (id) DO UPDATE
         SET value = EXCLUDED.value, metadata = EXCLUDED.metadata,
             embedding = EXCLUDED.embedding, updated_at = NOW()`, params);
  };

  const todo = plan.chunks.filter((c) => c.action === 'new' || c.action === 'changed');
  for (let i = 0; i < todo.length; i += batchSize) {
    await processBatch(todo.slice(i, i + batchSize), {
      log: d.log || log, sleepFn: d.sleepFn,
      run: async (items) => upsert(items, await embedder.embedBatch(items.map((b) => embedText(b.content)))),
      onInserted: (n) => { stats.embedded += n; },
      onFailure: (item) => { stats.failed_chunks++; stats.failed_keys.push(item.key); },
    });
    if (stats.failed_chunks > maxFailed) {
      stats.aborted = `${stats.failed_chunks} failed chunks exceeds --max-failed ${maxFailed}; stopped before metadata refresh, prune and manifest`;
      return stats;
    }
  }

  // Unchanged content: metadata-only refresh (no re-embed).
  const refresh = plan.chunks.filter((c) => c.action === 'metadata' || c.action === 'generation');
  for (let i = 0; i < refresh.length; i += 500) {
    const part = refresh.slice(i, i + 500);
    await pool.query(
      `UPDATE memory_entries AS m SET metadata = u.metadata, updated_at = NOW()
         FROM (SELECT unnest($2::text[]) AS key, unnest($3::jsonb[]) AS metadata) AS u
        WHERE m.namespace = $1 AND m.key = u.key`,
      [namespace, part.map((c) => c.key), part.map((c) => JSON.stringify(c.metadata))]);
    stats.metadata_updated += part.length;
  }

  // Prune (only when requested and the write phase stayed within the failure cap).
  if (plan.prune.length) {
    const dir = d.receiptDir;
    mkdirSync(dir, { recursive: true });
    const receipt = join(dir, `prune-${(d.now || new Date().toISOString()).replace(/[:.]/g, '-')}.jsonl`);
    writeFileSync(receipt, plan.prune.map((p) => JSON.stringify({ namespace, ...p, generation })).join('\n') + '\n');
    stats.prune_receipt = receipt;
    for (let i = 0; i < plan.prune.length; i += 500) {
      const keys = plan.prune.slice(i, i + 500).map((p) => p.key);
      const r = await pool.query(
        `DELETE FROM memory_entries WHERE namespace = $1 AND source_type = $2 AND key = ANY($3)`, [namespace, SOURCE_TYPE, keys]);
      stats.pruned += r.rowCount;
    }
  }
  return stats;
}

/** The `_manifest` row value. */
export function buildManifest({ generation, corpusVersion, counts, stats, includeWorking, prune, now = new Date().toISOString() }) {
  return {
    generation, corpus_version: corpusVersion, ingested_at: now,
    pages: counts.pages, chunks: counts.chunks, new: counts.new, changed: counts.changed, unchanged: counts.unchanged,
    embedded: stats.embedded, metadata_updated: stats.metadata_updated, pruned: stats.pruned,
    failed_chunks: stats.failed_chunks, collisions: counts.collisions,
    include_working: includeWorking, prune_enabled: prune,
    script: 'scripts/corpus-memory-ingest.mjs',
  };
}

async function writeManifest(d, value) {
  const text = `knowledge/pages corpus manifest ${value.corpus_version}`;
  const [emb] = await d.embedder.embedBatch([text]);
  await d.pool.query(
    `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::ruvector(${EMB_DIM}))
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, metadata = EXCLUDED.metadata,
       embedding = EXCLUDED.embedding, updated_at = NOW()`,
    [rowId(d.namespace, MANIFEST_KEY), d.namespace, MANIFEST_KEY, JSON.stringify(value), MANIFEST_SOURCE_TYPE,
     JSON.stringify({ memory_type: 'semantic', tags: ['knowledge-pages', 'manifest'], generation: value.generation, corpus_version: value.corpus_version }),
     vecToSql(emb)]);
}

/** Human summary of a plan. */
export function summarise(plan, { generation, namespace, existingRows }) {
  const c = plan.counts;
  return [
    `namespace ${namespace} @ ${generation}`,
    `pages ${c.pages}, chunks ${c.chunks} (existing rows ${existingRows})`,
    `new ${c.new}, changed ${c.changed} (re-embed), unchanged ${c.unchanged} (metadata refresh ${c.metadata_refresh}, generation bump ${c.generation_bump})`,
    `prune candidates ${plan.pruneCandidates.length} (vanished pages ${c.prune_vanished}, stale sections ${c.prune_stale}); ${plan.prune.length ? 'WILL prune' : 'not pruning (no --prune)'}`,
    `key collisions (last wins) ${c.collisions}, foreign-key conflicts skipped ${c.conflict}`,
  ];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = { yes: false, dryRun: false, includeWorking: false, prune: false, force: false, json: false,
    vaultRoot: '/home/devuser/workspace/visionGraph', namespace: 'knowledge/pages', maxFailed: 1000,
    receiptDir: '/home/devuser/workspace/.tmp/corpus-memory-ingest' };
  const val = (i, f) => { if (i + 1 >= argv.length) throw new Error(`${f} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') o.yes = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--include-working') o.includeWorking = true;
    else if (a === '--prune') o.prune = true;
    else if (a === '--force') o.force = true;
    else if (a === '--json') o.json = true;
    else if (a === '--vault-root') o.vaultRoot = val(i++, a);
    else if (a === '--namespace') o.namespace = val(i++, a);
    else if (a === '--receipt-dir') o.receiptDir = val(i++, a);
    else if (a === '--max-failed') o.maxFailed = Math.max(0, Number(val(i++, a)) || 0);
    else throw new Error(`unknown option ${a}`);
  }
  o.write = o.yes && !o.dryRun;
  return o;
}

/**
 * Whole run with injected deps (tests) or real ones (CLI). Returns
 * { plan, stats, mode, skipped }.
 */
export async function run(opts, deps) {
  const { pool, embedder, env = process.env, out = (s) => process.stdout.write(s + '\n'), now = new Date().toISOString() } = deps;
  if (opts.write && env.RUVECTOR_ADMIN_WRITE !== 'true') {
    throw new Error('refusing to write: direct-pg ingest bypasses the memory MCP (ADR-2014). Set RUVECTOR_ADMIN_WRITE=true to authorise, or omit --yes for a dry-run.');
  }
  const gen = deps.generation || vaultGeneration(opts.vaultRoot, { includeWorking: opts.includeWorking });
  const { pages, known, shadowed } = deps.corpus || collectCorpus(opts.vaultRoot, { includeWorking: opts.includeWorking });
  const manifest = await loadManifest(pool, opts.namespace);
  if (opts.write && !opts.force && manifest && manifest.generation === gen.generation && !manifest.failed_chunks
      && manifest.include_working === opts.includeWorking && (!opts.prune || manifest.prune_enabled)) {
    log(`corpus up to date (${gen.generation}) — nothing to do`);
    return { plan: null, stats: null, mode: 'write', skipped: 'up-to-date' };
  }
  const existing = await loadExisting(pool, opts.namespace);
  const plan = planIngest(pages, opts.force ? existing.map((r) => ({ ...r, content_hash: null })) : existing,
    { generation: gen.generation, corpusVersion: gen.corpusVersion, known, prune: opts.prune, embedModel: deps.embedModel || env.EMBEDDING_MODEL || 'bge-small-en-v1.5' });
  const lines = summarise(plan, { generation: gen.generation, namespace: opts.namespace, existingRows: existing.length });
  if (shadowed.length) lines.push(`working pages shadowed by a same-named public page: ${shadowed.length}`);
  for (const l of lines) log(l);
  if (opts.json) out(JSON.stringify({ mode: opts.write ? 'write' : 'dry-run', generation: gen.generation, counts: plan.counts, existing_rows: existing.length,
    prune_candidates: plan.pruneCandidates.length, collisions: plan.collisions.slice(0, 20), conflicts: plan.conflicts }, null, 2));
  if (!opts.write) {
    log('DRY-RUN: nothing written. Add --yes (with RUVECTOR_ADMIN_WRITE=true) to apply.');
    return { plan, stats: null, mode: 'dry-run' };
  }
  if (!(await embedder.waitReady())) throw new Error('xinference not serving embeddings after 180s');
  const stats = await applyPlan(plan, { pool, embedder, namespace: opts.namespace, generation: gen.generation, corpusVersion: gen.corpusVersion,
    maxFailed: opts.maxFailed, receiptDir: opts.receiptDir, now, log, sleepFn: deps.sleepFn });
  if (stats.aborted) throw new Error(stats.aborted);
  await writeManifest({ pool, embedder, namespace: opts.namespace },
    buildManifest({ generation: gen.generation, corpusVersion: gen.corpusVersion, counts: plan.counts, stats, includeWorking: opts.includeWorking, prune: opts.prune, now }));
  log(`done: ${plan.counts.chunks} chunks (${stats.embedded} embedded, ${stats.metadata_updated} metadata-refreshed, ${stats.pruned} pruned, ${stats.failed_chunks} failed) @ ${gen.generation}`);
  log('NEXT: the HNSW index is stale after this write — rebuild it (ADR-2133): scripts/ruvector-sidecar-update.sh reindex --yes');
  return { plan, stats, mode: 'write' };
}

async function main() {
  const die = (m) => { log(`FATAL: ${m}`); process.exit(1); };
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { die(e.message); }
  const conninfo = process.env.RUVECTOR_PG_CONNINFO || '';
  if (!conninfo) die('RUVECTOR_PG_CONNINFO not set');
  const { Pool } = loadPg(die);
  // A dry-run must not be able to write even by mistake: read-only session.
  const pool = new Pool({ ...poolConfig(conninfo), max: 4, ...(opts.write ? {} : { options: '-c default_transaction_read_only=on' }) });
  const embedder = createEmbedder({
    endpoint: process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997',
    model: process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5',
  });
  try {
    const { plan } = await run(opts, { pool, embedder });
    if (plan) {
      mkdirSync(opts.receiptDir, { recursive: true });
      writeFileSync(join(opts.receiptDir, 'last-plan.json'), JSON.stringify({ counts: plan.counts, prune_candidates: plan.pruneCandidates.length }, null, 2));
    }
  } catch (e) { die(e.message); } finally { await pool.end(); }
}

const realOrSelf = (p) => { try { return realpathSync(p); } catch { return p; } };
const invokedDirectly = Boolean(process.argv[1])
  && realOrSelf(resolve(process.argv[1])) === realOrSelf(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
