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
// matching tag + non-empty corpus + zero recorded failures → fast no-op (a
// manifest carrying failed chunks triggers an incremental healing re-run).
// Downloads are verified against the release's published .sha256 digest
// before extraction (mismatch = fatal; absent digest = warn, or fatal with
// RUVNET_BRAIN_REQUIRE_DIGEST=1). Chunks are content-addressed
// (key = ruvnet/<repo>/<sha256-12>), so re-ingest only embeds NEW/changed
// chunks; unchanged rows get a metadata version bump; rows absent from the
// new corpus are pruned. Embed/upsert failures retry with backoff, then
// bisect to isolate poison passages; the prune is skipped entirely if
// failures exceed RUVNET_BRAIN_MAX_FAILED_CHUNKS (default 1000). Safe to
// re-run at every boot / after every build — this IS the "bleeding edge at
// build time" reconciliation.
//
// Content-addressed generations (upstream since 2026-10-03): release tags are
// `corpus-sha256-<archive digest>`. For those the published .zip.sha256 MUST
// equal the tag digest (checked before the download) and the downloaded bytes
// must hash to it. The detached .zip.sig and corpus-receipt.json are fetched
// beside the zip; the receipt's archive digest must equal the zip digest and,
// when the release body states a "Receipt SHA-256", the receipt must hash to
// it. The signature is RECORDED (sig_present) but never claimed verified:
// upstream publishes no public key, and we do not guess one
// (signature_verified=false, signature_reason="no published public key").
// Upstream's own delivery (`npx ruvnet-brain` → RVF files in ~/.cache) is
// not this path; agentbox ingests the zip's passages into ruvector-postgres.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, realpathSync, createReadStream, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {
  makeLog, loadPg as loadPgShared, poolConfig, httpJson, createEmbedder,
  wellFormed, embedText, sha12, processBatch as processBatchShared, upsertRows,
} from './lib/ruvector-bulk.mjs';

// ── Config ───────────────────────────────────────────────────────────────────
const NAMESPACE   = process.env.RUVNET_BRAIN_NAMESPACE || 'ruvnet-kb';
const SOURCE_TYPE = 'ruvnet-brain-ingest';
const CONNINFO    = process.env.RUVECTOR_PG_CONNINFO || '';
const XINFERENCE  = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMB_MODEL   = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
const RELEASE_URL = process.env.RUVNET_BRAIN_RELEASE_URL
  || 'https://github.com/stuinfla/ruvnet-brain/releases/latest/download/ruvnet-brain.zip';
// Transient download/extract staging only — the corpus itself is persisted in
// ruvector-postgres, so this needs a writable path, not a persistent volume.
// Default under the persistent workspace volume. The general cache root is a
// bounded tmpfs and /var/lib/agentbox is read-only except for named submounts;
// neither can safely hold the roughly 512 MiB zip plus extraction scratch.
const STAGING     = process.env.RUVNET_BRAIN_STAGING || '/home/devuser/workspace/.tmp/ruvnet-brain-staging';
const BATCH       = Math.max(8, Math.min(Number(process.env.RUVNET_BRAIN_EMBED_BATCH) || 32, 128));

const FORCE  = process.argv.includes('--force');
const STATUS = process.argv.includes('--status');

const log = makeLog('ruvnet-brain-ingest');
const die = (m, code = 1) => { log(`FATAL: ${m}`); process.exit(code); };

// ── pg + Xinference: shared with corpus-memory-ingest (scripts/lib/ruvector-bulk.mjs) ──
const loadPg = () => loadPgShared(die, ['/opt/agentbox/mcp/ruvnet-brain/node_modules/pg']);
const { embedBatch, waitReady: waitXinference } = createEmbedder({ endpoint: XINFERENCE, model: EMB_MODEL });

// ── Release provenance (pure helpers, unit-tested) ──────────────────────────
const HEX64 = /\b[0-9a-f]{64}\b/i;
export const SIGNATURE_UNVERIFIED_REASON = 'no published public key';

/** Digest carried by a content-addressed tag `corpus-sha256-<64 hex>`, else null. */
export function tagDigest(tag) {
  const m = typeof tag === 'string' ? tag.match(/^corpus-sha256-([0-9a-f]{64})$/i) : null;
  return m ? m[1].toLowerCase() : null;
}

/** First 64-hex digest in a sha256sum-style asset body, lower-cased, else null. */
export function parseDigest(text) {
  const m = typeof text === 'string' ? text.match(HEX64) : null;
  return m ? m[0].toLowerCase() : null;
}

/**
 * Content-addressing proof. A `corpus-sha256-*` tag IS the archive digest, so
 * the release's published .sha256 must exist and equal it; anything else is
 * refused. Legacy tags (v4.x) are not content-addressed and pass through.
 */
export function checkContentAddress(tag, publishedDigest) {
  const want = tagDigest(tag);
  if (!want) return { contentAddressed: false, ok: true, reason: null };
  const got = publishedDigest ? String(publishedDigest).toLowerCase() : null;
  if (!got) return { contentAddressed: true, ok: false, reason: `content-addressed tag ${tag} but no published .sha256 digest` };
  if (got !== want) return { contentAddressed: true, ok: false, reason: `published .sha256 ${got} does not equal tag digest ${want}` };
  return { contentAddressed: true, ok: true, reason: null };
}

/** URL of another asset in the same release directory as `assetUrl`. */
export function siblingAssetUrl(assetUrl, name) {
  const u = new URL(assetUrl);
  u.pathname = u.pathname.replace(/[^/]*$/, encodeURIComponent(name));
  u.search = ''; u.hash = '';
  return u.toString();
}

/** Upstream runtime the corpus shipped with: receipt first, then release body. */
export function shippedRuntime(receipt, releaseBody) {
  if (receipt && typeof receipt === 'object') {
    if (typeof receipt.archiveManifestReleaseTag === 'string' && receipt.archiveManifestReleaseTag) return receipt.archiveManifestReleaseTag;
    if (typeof receipt.archiveManifestVersion === 'string' && receipt.archiveManifestVersion) {
      return receipt.archiveManifestVersion.startsWith('v') ? receipt.archiveManifestVersion : `v${receipt.archiveManifestVersion}`;
    }
  }
  const m = typeof releaseBody === 'string' ? releaseBody.match(/^\s*Shipped runtime:\s*(\S+)/mi) : null;
  return m ? m[1] : null;
}

/**
 * Evaluate the detached signature and corpus receipt against the downloaded
 * archive digest. Returns the manifest provenance fields plus ok/reason; a
 * receipt that names a different archive, does not parse, or does not hash to
 * the release body's "Receipt SHA-256" is refused. The signature is recorded
 * only — there is no published key to verify it against.
 */
export function evaluateProvenance({ zipSha256, receiptText, sigBytes, releaseBody }) {
  const out = {
    ok: true, reason: null,
    sig_present: Boolean(sigBytes && sigBytes.length),
    sig_bytes: sigBytes ? sigBytes.length : 0,
    signature_verified: false,
    signature_reason: SIGNATURE_UNVERIFIED_REASON,
    receipt_sha256: null, receipt_archive_sha256: null, receipt_matches_archive: null,
    shipped_runtime: null,
  };
  const refuse = (reason) => { out.ok = false; out.reason = reason; return out; };
  let receipt = null;
  if (receiptText != null) {
    out.receipt_sha256 = createHash('sha256').update(receiptText).digest('hex');
    try { receipt = JSON.parse(receiptText); } catch (e) { return refuse(`corpus receipt does not parse (${e.message})`); }
    const archived = parseDigest(receipt?.archive?.sha256 ?? receipt?.archiveSha256 ?? '');
    out.receipt_archive_sha256 = archived;
    out.receipt_matches_archive = Boolean(archived && zipSha256 && archived === String(zipSha256).toLowerCase());
    if (!out.receipt_matches_archive) {
      return refuse(`receipt archive sha256 ${archived || 'missing'} does not equal downloaded zip sha256 ${zipSha256}`);
    }
    const stated = typeof releaseBody === 'string' ? releaseBody.match(/Receipt SHA-256:\s*([0-9a-f]{64})/i) : null;
    if (stated && stated[1].toLowerCase() !== out.receipt_sha256) {
      return refuse(`receipt sha256 ${out.receipt_sha256} does not equal the release body's Receipt SHA-256 ${stated[1].toLowerCase()}`);
    }
  }
  out.shipped_runtime = shippedRuntime(receipt, releaseBody);
  return out;
}

/** Manifest row value. corpus_version is always the full release tag. */
export function buildManifest({ version, stats, source, archiveSha256, provenance, urn = null, now = new Date().toISOString() }) {
  const p = provenance || {};
  return {
    corpus_version: version,
    ingested_at: now,
    chunks: stats.chunks, embedded: stats.embedded, unchanged: stats.unchanged,
    pruned: stats.pruned, failed_chunks: stats.failed_chunks,
    source,
    content_addressed: Boolean(tagDigest(version)),
    archive_sha256: archiveSha256 || null,
    sig_present: Boolean(p.sig_present),
    sig_bytes: p.sig_bytes || 0,
    signature_verified: false,
    signature_reason: p.signature_reason || SIGNATURE_UNVERIFIED_REASON,
    receipt_sha256: p.receipt_sha256 ?? null,
    receipt_matches_archive: p.receipt_matches_archive ?? null,
    shipped_runtime: p.shipped_runtime ?? null,
    ...(urn ? { dataset_urn: urn } : {}),
  };
}

// ── Release asset fetches (curl; absent asset → null) ────────────────────────
function fetchText(url) {
  try { return execFileSync('curl', ['-fsSL', '--retry', '2', '--max-time', '60', url], { encoding: 'utf8' }); } catch { return null; }
}
function fetchBytes(url, dest) {
  try {
    execFileSync('curl', ['-fsSL', '--retry', '2', '--max-time', '120', '-o', dest, url], { stdio: ['ignore', 'ignore', 'ignore'] });
    return readFileSync(dest);
  } catch { rmSync(dest, { force: true }); return null; }
}

// ── Release version discovery ────────────────────────────────────────────────
// The /releases/latest/download/ URL 302s through /releases/download/<tag>/…;
// the tag in the Location header is the corpus version. Pinned URLs already
// carry the tag in the path, so no network round-trip is needed for them.
function discoverVersion(url) {
  const pinned = url.match(/\/releases\/download\/([^/]+)\//);
  if (pinned) return Promise.resolve(decodeURIComponent(pinned[1]));
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

// Release selection. GitHub's designated latest (/releases/latest) is
// authoritative: upstream stages a content-addressed generation as a
// prerelease and promotes it to latest only after a clean customer install.
// The list API orders by creation time, NOT by that designation — on
// 2026-10-03 it put runtime release v4.5.2 ahead of the promoted
// corpus-sha256-832bae01… (same created_at), so "first in list" picked the
// wrong corpus. The list is only the fallback for when the designated release
// lacks the asset (v4.3.1 was marked latest before its zip finished uploading).
const assetOf = (release, assetName) => (release && !release.draft && release.tag_name && Array.isArray(release.assets)
  ? release.assets.find((a) => a?.name === assetName && a?.browser_download_url) || null
  : null);

export function pickRelease(latest, releases, assetName) {
  const hit = assetOf(latest, assetName);
  if (hit) return { url: hit.browser_download_url, version: latest.tag_name, body: typeof latest.body === 'string' ? latest.body : '', fallback: false };
  for (const release of Array.isArray(releases) ? releases : []) {
    const asset = assetOf(release, assetName);
    if (asset) return { url: asset.browser_download_url, version: release.tag_name, body: typeof release.body === 'string' ? release.body : '', fallback: true };
  }
  return { url: null, version: null, body: '', fallback: true };
}

async function resolveRelease(url) {
  const pinned = url.match(/\/releases\/download\/([^/]+)\//);
  if (pinned) return { url, version: decodeURIComponent(pinned[1]), body: '' };

  const latestUrl = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/download\/([^/?#]+)(?:[?#].*)?$/);
  if (latestUrl) {
    const [, owner, repo, encodedAsset] = latestUrl;
    const assetName = decodeURIComponent(encodedAsset);
    const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'agentbox-ruvnet-brain-ingest',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    try {
      let latest = null;
      try { latest = await httpJson(`${api}/latest`, { timeout: 30000, headers }); } catch (error) {
        log(`WARN: GitHub /releases/latest lookup failed (${error.message}); scanning the release list`);
      }
      const releases = assetOf(latest, assetName) ? [] : await httpJson(`${api}?per_page=20`, { timeout: 30000, headers });
      const picked = pickRelease(latest, releases, assetName);
      if (picked.version && picked.fallback) {
        log(`WARN: designated latest release ${latest?.tag_name || 'unknown'} has no ${assetName}; using newest complete release ${picked.version}`);
      }
      if (!picked.version) log(`WARN: no downloadable ${assetName} found in the designated latest or the 20 newest GitHub releases`);
      return picked;
    } catch (error) {
      log(`WARN: GitHub release API lookup failed (${error.message}); falling back to the configured URL`);
    }
  }

  return { url, version: await discoverVersion(url), body: '' };
}

// ── SQL helpers (mirror ruvector-mcp.cjs conventions) ────────────────────────
const entryId  = (key) => `${SOURCE_TYPE}:${NAMESPACE}:${key}`;

// ── Passage field mapping (defensive against upstream format drift) ──────────
function mapPassage(p, fileRepo) {
  const text = p.text ?? p.body ?? p.content ?? p.chunk ?? p.passage ?? null;
  if (!text || typeof text !== 'string' || text.trim().length < 10) return null;
  const repo = String(p.repo ?? p.repository ?? fileRepo ?? 'unknown').toLowerCase();
  const path = String(p.path ?? p.file ?? p.source ?? p.loc ?? '');
  return { text: wellFormed(text.trim()), repo, path: wellFormed(path) };
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
async function main() {
  if (!CONNINFO) die('RUVECTOR_PG_CONNINFO not set');
  const { Pool } = loadPg();
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

  // 1. Version reconciliation — the every-boot fast path. A manifest that
  //    recorded failures does NOT no-op: the incremental re-run only embeds
  //    the missing keys, healing the gap without a full --force re-embed.
  const release = await resolveRelease(RELEASE_URL);
  const remoteVersion = release.version;
  const manifest = await manifestRow();
  const existingCount = await corpusCount();
  const priorFailures = (manifest?.failed_chunks || 0) + (manifest?.failed_batches || 0);
  if (!FORCE && remoteVersion && manifest?.corpus_version === remoteVersion && existingCount > 0) {
    if (!priorFailures) {
      log(`corpus up to date (${remoteVersion}, ${existingCount} chunks) — nothing to do`);
      await pool.end(); return;
    }
    log(`corpus at ${remoteVersion} but manifest records ${priorFailures} failed batch(es)/chunk(s) — re-running incremental ingest to heal`);
  }
  if (!remoteVersion && !FORCE && existingCount > 0) {
    log('complete release undiscoverable (offline or upstream asset incomplete?) and corpus non-empty — keeping current corpus');
    await pool.end(); return;
  }
  if (!release.url) die('no complete downloadable corpus release found');
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
  // 3a. Published digest first: for a content-addressed tag it must equal the
  //     tag digest, so a mislabelled release is refused before 600+ MB moves.
  const publishedDigest = parseDigest(fetchText(`${release.url}.sha256`));
  const ca = checkContentAddress(version, publishedDigest);
  if (!ca.ok) die(`${ca.reason} — refusing to ingest`);
  if (ca.contentAddressed) log(`content-addressed release: published .sha256 equals tag digest (${publishedDigest.slice(0, 12)}…)`);
  if (!publishedDigest) {
    if (process.env.RUVNET_BRAIN_REQUIRE_DIGEST === '1') die(`no .sha256 digest at ${release.url}.sha256 and RUVNET_BRAIN_REQUIRE_DIGEST=1`);
    log('WARN: no .sha256 digest published for this release — skipping download verification');
  }
  log(`downloading ${release.url} → ${zipPath} (hundreds of MB, be patient)`);
  execFileSync('curl', ['-fSL', '--retry', '3', '--max-time', '1800', '-o', zipPath, release.url], { stdio: ['ignore', 'ignore', 'inherit'] });
  const zipSha256 = execFileSync('sha256sum', [zipPath], { encoding: 'utf8' }).split(/\s+/)[0].toLowerCase();
  if (publishedDigest && zipSha256 !== publishedDigest) {
    rmSync(zipPath, { force: true });
    die(`download sha256 mismatch: expected ${publishedDigest}, got ${zipSha256} — refusing to ingest`);
  }
  if (publishedDigest) log(`download digest verified (sha256 ${zipSha256.slice(0, 12)}…)`);

  // 3b. Detached signature + corpus receipt, kept beside the zip in staging.
  const sigBytes = fetchBytes(`${release.url}.sig`, join(STAGING, 'ruvnet-brain.zip.sig'));
  const receiptBytes = fetchBytes(siblingAssetUrl(release.url, 'corpus-receipt.json'), join(STAGING, 'corpus-receipt.json'));
  const provenance = evaluateProvenance({
    zipSha256, receiptText: receiptBytes ? receiptBytes.toString('utf8') : null, sigBytes, releaseBody: release.body,
  });
  if (!provenance.ok) { rmSync(zipPath, { force: true }); die(`${provenance.reason} — refusing to ingest`); }
  log(`provenance: sig ${provenance.sig_present ? `present (${provenance.sig_bytes} B, NOT verified: ${provenance.signature_reason})` : 'absent'}; `
    + `receipt ${provenance.receipt_sha256 ? `${provenance.receipt_sha256.slice(0, 12)}… matches archive` : 'absent'}; shipped runtime ${provenance.shipped_runtime || 'unknown'}`);
  log('extracting *.passages.jsonl');
  try {
    // Exclude macOS AppleDouble junk (__MACOSX/, ._*) — upstream zips are built
    // on macOS and ship binary resource forks matching *.passages.jsonl.
    execFileSync('unzip', ['-oj', zipPath, '*.passages.jsonl', '-x', '__MACOSX/*', '._*', '*/._*', '-d', extractDir], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    // unzip exits 11 when no entries match — surface a clear error.
    die(`no *.passages.jsonl entries found in bundle (${e.message})`);
  }
  rmSync(zipPath, { force: true }); // DB is the destination; don't hoard 512 MB on the volume

  const files = readdirSync(extractDir).filter((f) => f.endsWith('.passages.jsonl') && !f.startsWith('._'));
  if (!files.length) die('extraction produced no passage files');
  log(`${files.length} passage file(s): ${files.join(', ')}`);

  // 4. Preload existing keys → skip re-embedding unchanged content.
  const existing = new Set(
    (await pool.query(`SELECT key FROM memory_entries WHERE namespace = $1`, [NAMESPACE])).rows.map((r) => r.key));

  // 5. Stream, embed (new only), upsert. Content-addressed keys make this
  //    incremental: unchanged chunk → metadata version bump only.
  let seen = 0, inserted = 0, skipped = 0, failedChunks = 0;
  const MAX_FAILED = Math.max(0, Number(process.env.RUVNET_BRAIN_MAX_FAILED_CHUNKS) || 1000);
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

  const insertBatch = (items, embs) => upsertRows(pool, items.map((it, i) => ({
    id: entryId(it.key), namespace: NAMESPACE, key: it.key,
    value: { text: it.text, repo: it.repo, path: it.path },
    source_type: SOURCE_TYPE,
    metadata: { memory_type: 'semantic', tags: ['ruvnet-kb', it.repo], repo: it.repo, path: it.path, corpus_version: version },
    embedding: embs[i],
  })));

  // Embed+upsert with retry then bisection (shared helper). Exceeding
  // MAX_FAILED aborts before the prune, leaving the existing corpus intact.
  const processBatch = (batch) => processBatchShared(batch, {
    log,
    run: async (items) => {
      const embs = await embedBatch(items.map((b) => embedText(b.text)));
      await insertBatch(items, embs);
    },
    onInserted: (n) => { inserted += n; },
    onFailure: () => {
      failedChunks++;
      if (failedChunks > MAX_FAILED) die(`${failedChunks} failed chunks exceeds RUVNET_BRAIN_MAX_FAILED_CHUNKS=${MAX_FAILED} — aborting before prune (existing corpus left intact)`);
    },
  });

  let pending = [];
  const flushPending = async () => {
    if (!pending.length) return;
    await processBatch(pending.splice(0));
    if (seen % 5000 < BATCH) log(`progress: ${seen} seen, ${inserted} embedded+upserted, ${skipped} unchanged, ${failedChunks} failed`);
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
  if (failedChunks > 0 && inserted === 0 && skipped === 0) die(`all ${failedChunks} chunks failed — aborting before prune`);

  // 6. Prune rows that vanished from the new corpus (stale version stamp).
  const pruned = await pool.query(
    `DELETE FROM memory_entries
      WHERE namespace = $1 AND key <> 'ruvnet/manifest'
        AND (metadata->>'corpus_version') IS DISTINCT FROM $2`,
    [NAMESPACE, version],
  );

  // 7. Manifest stamp (+ best-effort ADR-013 dataset URN).
  const urn = mintCorpusUrn(version);
  const manifestValue = buildManifest({
    version,
    stats: { chunks: seenKeys.size, embedded: inserted, unchanged: skipped, pruned: pruned.rowCount, failed_chunks: failedChunks },
    source: RELEASE_URL, archiveSha256: zipSha256, provenance, urn,
  });
  await pool.query(
    `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
     VALUES ($1, $2, 'ruvnet/manifest', $3::jsonb, $4, $5::jsonb, NULL)
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, metadata = EXCLUDED.metadata, updated_at = NOW()`,
    [entryId('ruvnet/manifest'), NAMESPACE, JSON.stringify(manifestValue), SOURCE_TYPE,
     JSON.stringify({ memory_type: 'semantic', tags: ['ruvnet-kb', 'manifest'], corpus_version: version })],
  );

  rmSync(extractDir, { recursive: true, force: true });
  writeFileSync(join(STAGING, 'last-ingest.json'), JSON.stringify(manifestValue, null, 2));
  log(`done: ${seenKeys.size} chunks (${inserted} embedded, ${skipped} unchanged, ${pruned.rowCount} pruned, ${failedChunks} failed chunks) → namespace ${NAMESPACE} @ ${version}`);
  await pool.end();
}

// Entry guard: importing this module (unit tests) must not run an ingest.
const realOrSelf = (p) => { try { return realpathSync(p); } catch { return p; } };
const invokedDirectly = Boolean(process.argv[1])
  && realOrSelf(resolve(process.argv[1])) === realOrSelf(fileURLToPath(import.meta.url));
if (invokedDirectly) main().catch((e) => die(e.stack || e.message));
