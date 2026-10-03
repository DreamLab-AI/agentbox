// node --test unit tests for scripts/ruvnet-brain-ingest.mjs — the release
// provenance helpers for upstream's content-addressed corpus generations
// (tags `corpus-sha256-<archive digest>`, with .zip.sig + corpus-receipt.json).
// Pure functions only: NO DB, NO network. Importing the script is side-effect
// free (main() runs only when invoked directly; pg loads inside main()).
//
//   node --test tests/ruvnet-brain-ingest.spec.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  tagDigest, parseDigest, checkContentAddress, siblingAssetUrl,
  shippedRuntime, evaluateProvenance, buildManifest, pickRelease,
} from '../scripts/ruvnet-brain-ingest.mjs';

const D  = '832bae01c40f0dc695d4ce12eefdf1a297c2bb663437fac8566f6497d7457ec7';
const D2 = '473a83aa6c443b6f7d18d030e1223dc89ce1074d53e8db1d9247e0e7736c777d';
const TAG = `corpus-sha256-${D}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const receipt = (archiveDigest, extra = {}) => JSON.stringify({
  schemaVersion: 3, kind: 'ruvnet-brain-corpus-candidate',
  archive: { file: 'ruvnet-brain.zip', sha256: archiveDigest, bytes: 679040573 },
  archiveManifestVersion: '4.5.2', archiveManifestReleaseTag: 'v4.5.2', ...extra,
});

// ── (a) content-addressing proof ─────────────────────────────────────────────
test('tagDigest: extracts the digest from a content-addressed tag only', () => {
  assert.equal(tagDigest(TAG), D);
  assert.equal(tagDigest(TAG.toUpperCase().replace('CORPUS-SHA256-', 'corpus-sha256-')), D);
  assert.equal(tagDigest('v4.5.1'), null);
  assert.equal(tagDigest(`corpus-sha256-${D.slice(1)}`), null);
  assert.equal(tagDigest(null), null);
});

test('parseDigest: reads the hex digest from a sha256sum-style asset', () => {
  assert.equal(parseDigest(`${D}  ruvnet-brain.zip\n`), D);
  assert.equal(parseDigest('not a digest'), null);
  assert.equal(parseDigest(''), null);
});

test('checkContentAddress: content-addressed tag requires .sha256 == tag digest', () => {
  assert.deepEqual(checkContentAddress(TAG, D), { contentAddressed: true, ok: true, reason: null });
  const mismatch = checkContentAddress(TAG, D2);
  assert.equal(mismatch.contentAddressed, true);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /does not equal/);
  const absent = checkContentAddress(TAG, null);
  assert.equal(absent.ok, false);
  assert.match(absent.reason, /no published \.sha256/);
});

test('checkContentAddress: legacy v-tags are not content-addressed and pass through', () => {
  assert.deepEqual(checkContentAddress('v4.5.1', D), { contentAddressed: false, ok: true, reason: null });
  assert.deepEqual(checkContentAddress('v4.5.1', null), { contentAddressed: false, ok: true, reason: null });
});

test('siblingAssetUrl: resolves receipt/sig beside the zip', () => {
  const url = `https://github.com/stuinfla/ruvnet-brain/releases/download/${TAG}/ruvnet-brain.zip`;
  assert.equal(siblingAssetUrl(url, 'corpus-receipt.json'),
    `https://github.com/stuinfla/ruvnet-brain/releases/download/${TAG}/corpus-receipt.json`);
  assert.equal(siblingAssetUrl(url, 'ruvnet-brain.zip.sig'), `${url}.sig`);
});

// ── (b) signature + receipt recorded, never "verified" without a key ────────
test('evaluateProvenance: sig present, receipt matches archive, signature unverified', () => {
  const r = receipt(D);
  const p = evaluateProvenance({ zipSha256: D, receiptText: r, sigBytes: Buffer.alloc(64, 7), releaseBody: '' });
  assert.equal(p.ok, true);
  assert.equal(p.sig_present, true);
  assert.equal(p.sig_bytes, 64);
  assert.equal(p.signature_verified, false);
  assert.equal(p.signature_reason, 'no published public key');
  assert.equal(p.receipt_sha256, sha(r));
  assert.equal(p.receipt_archive_sha256, D);
  assert.equal(p.receipt_matches_archive, true);
});

test('evaluateProvenance: receipt archive digest != zip digest is refused', () => {
  const p = evaluateProvenance({ zipSha256: D, receiptText: receipt(D2), sigBytes: Buffer.alloc(64), releaseBody: '' });
  assert.equal(p.ok, false);
  assert.equal(p.receipt_matches_archive, false);
  assert.match(p.reason, /receipt archive sha256/);
});

test('evaluateProvenance: accepts the flat archiveSha256 receipt shape too', () => {
  const r = JSON.stringify({ archiveSha256: D });
  const p = evaluateProvenance({ zipSha256: D, receiptText: r, sigBytes: null, releaseBody: '' });
  assert.equal(p.ok, true);
  assert.equal(p.receipt_archive_sha256, D);
  assert.equal(p.sig_present, false);
  assert.equal(p.sig_bytes, 0);
  assert.equal(p.signature_verified, false);
});

test('evaluateProvenance: release body Receipt SHA-256 must match the downloaded receipt', () => {
  const r = receipt(D);
  const good = evaluateProvenance({ zipSha256: D, receiptText: r, sigBytes: null, releaseBody: `Receipt SHA-256: ${sha(r)}\n` });
  assert.equal(good.ok, true);
  const bad = evaluateProvenance({ zipSha256: D, receiptText: r, sigBytes: null, releaseBody: `Receipt SHA-256: ${D2}\n` });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /release body/);
});

test('evaluateProvenance: unparseable receipt is refused; absent receipt is recorded as null', () => {
  const bad = evaluateProvenance({ zipSha256: D, receiptText: '{not json', sigBytes: null, releaseBody: '' });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /receipt/);
  const none = evaluateProvenance({ zipSha256: D, receiptText: null, sigBytes: null, releaseBody: '' });
  assert.equal(none.ok, true);
  assert.equal(none.receipt_sha256, null);
  assert.equal(none.receipt_matches_archive, null);
});

// ── (c) manifest: full tag kept, shipped_runtime recorded ────────────────────
test('shippedRuntime: receipt first, then release body, else null', () => {
  assert.equal(shippedRuntime(JSON.parse(receipt(D)), ''), 'v4.5.2');
  assert.equal(shippedRuntime({ archiveManifestVersion: '4.5.2' }, ''), 'v4.5.2');
  assert.equal(shippedRuntime(null, 'Stores: 199\nShipped runtime: v4.5.2\n'), 'v4.5.2');
  assert.equal(shippedRuntime(null, ''), null);
});

test('buildManifest: keeps the full corpus tag and records provenance fields', () => {
  const r = receipt(D);
  const prov = evaluateProvenance({ zipSha256: D, receiptText: r, sigBytes: Buffer.alloc(64), releaseBody: '' });
  const m = buildManifest({
    version: TAG, stats: { chunks: 10, embedded: 3, unchanged: 7, pruned: 2, failed_chunks: 0 },
    source: 'https://example/ruvnet-brain.zip', archiveSha256: D, provenance: prov, now: '2026-10-03T13:00:00.000Z',
  });
  assert.equal(m.corpus_version, TAG);
  assert.equal(m.content_addressed, true);
  assert.equal(m.archive_sha256, D);
  assert.equal(m.sig_present, true);
  assert.equal(m.signature_verified, false);
  assert.equal(m.signature_reason, 'no published public key');
  assert.equal(m.receipt_sha256, sha(r));
  assert.equal(m.shipped_runtime, 'v4.5.2');
  assert.equal(m.ingested_at, '2026-10-03T13:00:00.000Z');
  assert.equal(m.embedded, 3);
  assert.equal(m.pruned, 2);
});

test('buildManifest: legacy tag without provenance still produces a valid manifest', () => {
  const m = buildManifest({
    version: 'v4.5.1', stats: { chunks: 1, embedded: 1, unchanged: 0, pruned: 0, failed_chunks: 0 },
    source: 's', archiveSha256: null, provenance: null, now: '2026-10-03T13:00:00.000Z',
  });
  assert.equal(m.corpus_version, 'v4.5.1');
  assert.equal(m.content_addressed, false);
  assert.equal(m.sig_present, false);
  assert.equal(m.signature_verified, false);
  assert.equal(m.receipt_sha256, null);
  assert.equal(m.shipped_runtime, null);
});

// ── release selection: GitHub's designated latest wins over list order ──────
const rel = (tag, assets, extra = {}) => ({
  tag_name: tag, draft: false, body: `body of ${tag}`,
  assets: assets.map((name) => ({ name, browser_download_url: `https://dl/${tag}/${name}` })), ...extra,
});

test('pickRelease: designated latest with the asset wins even when the list puts another release first', () => {
  // Observed 2026-10-03: list API ordered v4.5.2 (same created_at) before the
  // corpus-sha256 release that /releases/latest designates.
  const latest = rel(TAG, ['ruvnet-brain.zip', 'ruvnet-brain.zip.sig']);
  const list = [rel('v4.5.2', ['ruvnet-brain.zip']), rel('v4.5.1', ['ruvnet-brain.zip']), latest];
  const r = pickRelease(latest, list, 'ruvnet-brain.zip');
  assert.equal(r.version, TAG);
  assert.equal(r.url, `https://dl/${TAG}/ruvnet-brain.zip`);
  assert.equal(r.body, `body of ${TAG}`);
  assert.equal(r.fallback, false);
});

test('pickRelease: designated latest without the asset falls back to newest complete release', () => {
  const latest = rel('v4.3.1', []); // asset upload not finished
  const list = [latest, rel('v4.3.0', ['ruvnet-brain.zip'])];
  const r = pickRelease(latest, list, 'ruvnet-brain.zip');
  assert.equal(r.version, 'v4.3.0');
  assert.equal(r.fallback, true);
});

test('pickRelease: drafts skipped; nothing usable yields nulls', () => {
  const r = pickRelease(null, [rel('v9', ['ruvnet-brain.zip'], { draft: true }), rel('v8', ['other.zip'])], 'ruvnet-brain.zip');
  assert.deepEqual(r, { url: null, version: null, body: '', fallback: true });
});
