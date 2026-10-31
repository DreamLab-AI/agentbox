// node --test tests for scripts/corpus-memory-ingest.mjs, scripts/lib/corpus-chunker.mjs
// and the shared scripts/lib/ruvector-bulk.mjs. No database, no network: the pool and
// the embedder are in-memory fakes.
//
//   node --test tests/corpus-memory-ingest.spec.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { slugify, pageSlug, chunkPage, splitParts, splitSections, contentHash, parseFrontmatter, wikilinksOf, SECTION_MAX, OVERLAP } from '../scripts/lib/corpus-chunker.mjs';
import { processBatch, createEmbedder, EMB_DIM, embedText, wellFormed } from '../scripts/lib/ruvector-bulk.mjs';
import { planIngest, run, parseArgs, applyPlan, MANIFEST_KEY } from '../scripts/corpus-memory-ingest.mjs';

const live = JSON.parse(readFileSync(new URL('./fixtures/corpus-memory-live-rows.json', import.meta.url), 'utf8'));

// ── Key scheme: slugs ────────────────────────────────────────────────────────
test('slugify: page slugs seen in the live namespace', () => {
  const cases = {
    'Hardware-_Platform-Agnostic': 'hardware-platform-agnostic',
    'COMPLETION_REPORT': 'completionreport',
    'AI Ethics Checklist_ENHANCED': 'ai-ethics-checklistenhanced',
    'Ethics & Law Layer': 'ethics--law-layer',
    'ETSI_Domain_AI___Creative_Media': 'etsidomainai/creativemedia',
    "Dr O'Hare Writing for LogSeq": 'dr-ohare-writing-for-logseq',
    '3D Content Generation': '3d-content-generation',
  };
  for (const [stem, want] of Object.entries(cases)) assert.equal(pageSlug(`${stem}.md`), want, stem);
});

test('slugify: section slugs keep ":" and "/" (even trailing: a split part is "x:::p0") and keep a leading "-" for an emoji', () => {
  assert.equal(slugify('Real-World Examples [Updated 2025]'), 'real-world-examples-updated-2025');
  assert.equal(slugify('ISO/IEC 23894:2023 Framework'), 'iso/iec-23894:2023-framework');
  assert.equal(slugify('Academic and Industry Research Reports:'), 'academic-and-industry-research-reports:');
  assert.equal(slugify('🎓 Technical & Educational Resources'), '-technical--educational-resources');
  assert.equal(slugify('Research & Literature'), 'research--literature');
});

// ── Key scheme: reproduction over rows sampled from the live namespace ───────
test('live rows: every sampled unsplit section regenerates its exact key, title and content hash', () => {
  assert.ok(live.sections.length >= 30, `fixture has ${live.sections.length} sections`);
  let exact = 0;
  for (const s of live.sections) {
    const { chunks } = chunkPage({ fileName: s.file_name, text: s.content });
    const c = chunks.find((x) => x.key === s.key);
    assert.ok(c, `${s.key} not regenerated from ${s.file_name}; got ${chunks.map((x) => x.key)}`);
    assert.equal(c.contentHash, s.content_hash, s.key);
    assert.equal(c.title, s.title, s.key);
    exact++;
  }
  assert.equal(exact, live.sections.length);
});

test('live rows: split sections regenerate every part key, hash and title (paragraph packing + 128-char overlap)', () => {
  assert.ok(live.split.length >= 8);
  for (const sp of live.split) {
    const { chunks } = chunkPage({ fileName: sp.file_name, text: sp.text });
    const got = chunks.filter((c) => c.key.startsWith(`${sp.base}::p`));
    assert.deepEqual(got.map((c) => c.key), sp.parts.map((p) => p.key), sp.base);
    assert.deepEqual(got.map((c) => c.contentHash), sp.parts.map((p) => p.content_hash), `${sp.base} hashes`);
    assert.deepEqual(got.map((c) => c.title), sp.parts.map((p) => p.title), `${sp.base} titles`);
    assert.deepEqual(got.map((c) => c.meta.sub_index), sp.parts.map((p) => p.sub_index));
  }
});

// ── Chunker rules ────────────────────────────────────────────────────────────
const PAGE = `---
type: Class
title: Demo Page
legacy-term-id: RB-0042
status: stable
domain: robotics
tags:
- one
- two
---
Opening paragraph with [[Alpha]] and [[Beta|alias]].

### Relationships
- related-to:: [[Alpha]]

## Features

\`\`\`
## not a heading
\`\`\`

#### Deep heading stays inside
text

# Level one stays inside

## Features
second one
`;

test('chunkPage: Section 0 is the pre-heading text; ## and ### split; #, #### and fenced headings do not', () => {
  const { chunks, collisions, pageSlug: slug } = chunkPage({ fileName: 'Demo Page.md', text: PAGE });
  assert.equal(slug, 'demo-page');
  assert.deepEqual(chunks.map((c) => c.key), ['demo-page::section-0', 'demo-page::relationships', 'demo-page::features']);
  assert.deepEqual(chunks.map((c) => c.chunkIndex), [0, 1, 3], 'the duplicate keeps its own (later) index');
  assert.deepEqual(collisions, ['demo-page::features'], 'duplicate heading: last wins, collision reported');
  assert.equal(chunks[2].content, '## Features\nsecond one');
  assert.equal(chunks[0].title, 'Demo Page > Section 0');
  assert.equal(chunks[1].title, 'Demo Page > Relationships');
  assert.equal(chunks[1].contentHash, contentHash('### Relationships\n- related-to:: [[Alpha]]'));
});

test('chunkPage: metadata shape (the existing rows plus source vault)', () => {
  const { chunks } = chunkPage({ fileName: 'Demo Page.md', text: PAGE, vault: 'working' });
  const m = chunks[0].meta;
  assert.deepEqual(m.tags, ['one', 'two']);
  assert.equal(m.title, 'Demo Page');
  assert.equal(m.term_id, 'RB-0042');
  assert.equal(m.status, 'stable');
  assert.equal(m.source_domain, 'rb');
  assert.equal(m.source_file, 'Demo Page.md');
  assert.equal(m.section, 'Section 0');
  assert.equal(m.chunk_index, 0);
  assert.equal(m.vault, 'working');
  assert.deepEqual(m.wikilinks, ['Alpha', 'Beta']);
  assert.ok(!('sub_index' in m));
});

test('chunkPage: an empty pre-heading section is skipped but still counts for chunk_index', () => {
  const { chunks } = chunkPage({ fileName: 'X.md', text: '## One\nbody\n## Two\nbody2\n' });
  assert.deepEqual(chunks.map((c) => [c.key, c.chunkIndex]), [['x::one', 1], ['x::two', 2]]);
});

test('splitParts: <= SECTION_MAX stays whole; longer packs paragraphs and repeats the last OVERLAP chars', () => {
  assert.deepEqual(splitParts('a'.repeat(SECTION_MAX)), ['a'.repeat(SECTION_MAX)]);
  const para = (n, ch) => ch.repeat(n);
  const text = [para(1000, 'a'), para(900, 'b'), para(900, 'c')].join('\n\n');
  const parts = splitParts(text);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], `${para(1000, 'a')}\n\n${para(900, 'b')}`);
  assert.ok(parts[1].startsWith(para(OVERLAP, 'b') + '\n\n'), 'overlap = last 128 chars of the previous part');
  assert.ok(parts[1].endsWith(para(900, 'c')));
});

test('splitParts: a single oversized paragraph is never cut', () => {
  const big = 'x'.repeat(5000);
  assert.deepEqual(splitParts(big), [big]);
  assert.equal(splitParts(`${big}\n\nshort`).length, 2);
});

test('chunkPage: split sections are keyed ::p0.. with sub_index and "(part N)" titles', () => {
  const body = ['## Big', 'a'.repeat(1500), 'b'.repeat(1500)].join('\n\n');
  const { chunks } = chunkPage({ fileName: 'Big Page.md', text: body });
  assert.deepEqual(chunks.map((c) => c.key), ['big-page::big::p0', 'big-page::big::p1']);
  assert.deepEqual(chunks.map((c) => c.meta.sub_index), [0, 1]);
  assert.equal(chunks[1].title, 'Big Page > Big (part 2)');
});

test('helpers: frontmatter, wikilinks cap, sections', () => {
  assert.deepEqual(parseFrontmatter('title: A\ntags: [x, y]\nis-a:\n- \'[[B]]\'\ngenerated:\n  by: z'), { title: 'A', tags: ['x', 'y'], 'is-a': ['[[B]]'] });
  const many = Array.from({ length: 40 }, (_, i) => `[[L${i}]]`).join(' ');
  assert.equal(wikilinksOf(many).length, 20);
  assert.equal(splitSections('no headings').length, 1);
});

// ── Shared bulk helpers ──────────────────────────────────────────────────────
test('processBatch: retries, bisects to isolate a poison item, reports it once', async () => {
  const batch = ['a', 'b', 'POISON', 'd'].map((key) => ({ key }));
  const landed = []; const failed = []; const logs = [];
  await processBatch(batch, {
    log: (m) => logs.push(m), sleepFn: async () => {},
    run: async (items) => { if (items.some((i) => i.key === 'POISON')) throw new Error('boom'); landed.push(...items.map((i) => i.key)); },
    onInserted: () => {}, onFailure: (it) => failed.push(it.key),
  });
  assert.deepEqual(landed.sort(), ['a', 'b', 'd']);
  assert.deepEqual(failed, ['POISON']);
  assert.ok(logs.some((l) => /bisecting/.test(l)));
});

test('createEmbedder: validates count and dimension; waitReady polls', async () => {
  const ok = createEmbedder({ endpoint: 'http://x', model: 'm', post: async (_u, o) => ({ data: o.body.input.map(() => ({ embedding: new Array(EMB_DIM).fill(0.1) })) }) });
  assert.equal((await ok.embedBatch(['a', 'b'])).length, 2);
  const badDim = createEmbedder({ endpoint: 'http://x', model: 'm', post: async () => ({ data: [{ embedding: [1, 2] }] }) });
  await assert.rejects(badDim.embedBatch(['a']), /bad embedding dim/);
  const badCount = createEmbedder({ endpoint: 'http://x', model: 'm', post: async () => ({ data: [] }) });
  await assert.rejects(badCount.embedBatch(['a']), /count mismatch/);
  let n = 0;
  const flaky = createEmbedder({ endpoint: 'http://x', model: 'm', sleepFn: async () => {},
    post: async () => { if (n++ < 2) throw new Error('down'); return { data: [{ embedding: new Array(EMB_DIM).fill(0) }] }; } });
  assert.equal(await flaky.waitReady(5), true);
});

test('embedText truncates to 2000 chars and sanitises a split surrogate; wellFormed strips NUL', () => {
  assert.equal(embedText('a'.repeat(5000)).length, 2000);
  assert.ok(!/[\uD800-\uDBFF]$/.test(embedText('a'.repeat(1999) + '😀')));
  assert.equal(wellFormed('a\u0000b'), 'ab');
});

// ── Plan ─────────────────────────────────────────────────────────────────────
const GEN = 'a'.repeat(40);
const OPTS = { generation: GEN, corpusVersion: 'visiongraph@aaaaaaaaaaaa', known: new Set(['Demo Page.md', 'Gone Soon.md', 'Private.md']), embedModel: 'bge-small-en-v1.5' };
const pagesOf = (...names) => names.map((n) => ({ fileName: n, vault: 'knowledge', text: n === 'Demo Page.md' ? PAGE : `## Only\nbody of ${n}\n` }));

test('planIngest: new / changed / metadata / generation / unchanged, and foreign rows are never overwritten', () => {
  const first = planIngest(pagesOf('Demo Page.md'), [], OPTS);
  assert.equal(first.counts.new, 3);
  const row = (c, over = {}) => ({ key: c.key, source_type: 'knowledge', source_file: 'Demo Page.md', content_hash: c.contentHash, meta_hash: c.metaHash, generation: GEN, embed_model: 'bge-small-en-v1.5', embedded: true, ...over });
  const [a, b, c] = first.chunks;
  const existing = [
    row(a),                                            // unchanged
    row(b, { content_hash: 'deadbeef0000' }),          // changed content
    row(c, { meta_hash: 'old' }),                      // metadata refresh
    { ...row(a, { key: 'demo-page::zzz' }), source_type: 'claude' },
  ];
  const again = planIngest(pagesOf('Demo Page.md'), existing, OPTS);
  assert.deepEqual(again.chunks.map((x) => x.action), ['unchanged', 'changed', 'metadata']);
  const gen = planIngest(pagesOf('Demo Page.md'), [row(a, { generation: 'old' })], OPTS);
  assert.equal(gen.counts.generation_bump, 1);
  const legacy = planIngest(pagesOf('Demo Page.md'), [row(a, { embed_model: null })], OPTS);
  assert.equal(legacy.chunks[0].action, 'changed', 'a legacy row without our embed_model stamp is re-embedded once');
  const noVec = planIngest(pagesOf('Demo Page.md'), [row(a, { embedded: false })], OPTS);
  assert.equal(noVec.chunks[0].action, 'changed');
  const clash = planIngest(pagesOf('Demo Page.md'), [{ ...row(a), source_type: 'claude' }], OPTS);
  assert.deepEqual(clash.conflicts, [a.key]);
  assert.ok(!clash.chunks.some((x) => x.key === a.key));
  assert.equal(again.chunks[0].metadata.generation, GEN);
  assert.equal(again.chunks[0].metadata.corpus_version, 'visiongraph@aaaaaaaaaaaa');
  assert.equal(again.chunks[0].metadata.content_hash, a.contentHash);
});

test('planIngest: prune classes; excluded-vault pages and the manifest are kept; --prune gates the list', () => {
  const r = (key, source_file, source_type = 'knowledge') => ({ key, source_type, source_file, content_hash: 'x', embedded: true });
  const existing = [
    r('gone-soon::old-section', 'Gone Soon.md'),   // scanned page lost the section
    r('vanished::old', 'Deleted.md'),              // not on disk anywhere
    r('demo-page::stale-heading', 'Demo Page.md'), // scanned page lost the section
    r('private::x', 'Private.md'),                 // on disk only in the excluded working vault
    r('nosource::x', null),                        // no source_file: never pruned
    r(MANIFEST_KEY, null, 'corpus-memory-ingest'),
    r('flash', 'Demo Page.md', 'claude'),          // not knowledge-sourced
  ];
  const p = planIngest(pagesOf('Demo Page.md', 'Gone Soon.md'), existing, { ...OPTS, prune: true });
  const by = Object.fromEntries(p.prune.map((x) => [x.key, x.reason]));
  assert.deepEqual(by, { 'gone-soon::old-section': 'stale-section', 'vanished::old': 'vanished', 'demo-page::stale-heading': 'stale-section' });
  assert.equal(planIngest(pagesOf('Demo Page.md'), existing, { ...OPTS, prune: false }).prune.length, 0);
  assert.ok(planIngest(pagesOf('Demo Page.md'), existing, { ...OPTS, prune: false }).pruneCandidates.length > 0);
});

test('planIngest: two files with one slug collide last-wins without duplicate keys in the plan', () => {
  const p = planIngest([
    { fileName: 'Foo Bar.md', vault: 'knowledge', text: '## S\none\n' },
    { fileName: 'foo-bar.md', vault: 'knowledge', text: '## S\ntwo\n' },
  ], [], OPTS);
  assert.equal(p.chunks.length, 1);
  assert.match(p.chunks[0].content, /two/);
  assert.equal(p.counts.collisions, 1);
});

// ── Run with an in-memory database ───────────────────────────────────────────
function fakeDb(initial = []) {
  const rows = new Map(initial.map((r) => [r.key, r]));
  const calls = [];
  return {
    rows, calls,
    async query(sql, params = []) {
      calls.push(sql.trim().split(/\s+/)[0]);
      if (/FROM memory_entries WHERE namespace = \$1 AND key = \$2 LIMIT 1/.test(sql)) {
        const m = rows.get(params[1]); return { rows: m ? [{ value: m.value }] : [] };
      }
      if (/SELECT key, source_type/.test(sql)) {
        return { rows: [...rows.values()].map((r) => ({
          key: r.key, source_type: r.source_type, source_file: r.metadata?.source_file ?? null,
          content_hash: r.value?.content_hash ?? null, meta_hash: r.metadata?.meta_hash ?? null,
          generation: r.metadata?.generation ?? null, embed_model: r.metadata?.embed_model ?? null, embedded: Boolean(r.embedding) })) };
      }
      if (/^\s*INSERT INTO memory_entries/.test(sql)) {
        const per = 7;
        for (let i = 0; i < params.length; i += per) {
          const [id, namespace, key, value, source_type, metadata, embedding] = params.slice(i, i + per);
          rows.set(key, { id, namespace, key, value: JSON.parse(value), source_type, metadata: JSON.parse(metadata), embedding });
        }
        return { rowCount: params.length / per };
      }
      if (/^\s*UPDATE memory_entries/.test(sql)) {
        const [, keys, metas] = params;
        keys.forEach((k, i) => { const r = rows.get(k); if (r) r.metadata = JSON.parse(metas[i]); });
        return { rowCount: keys.length };
      }
      if (/^\s*DELETE FROM memory_entries/.test(sql)) {
        const [, st, keys] = params; let n = 0;
        for (const k of keys) { const r = rows.get(k); if (r && r.source_type === st) { rows.delete(k); n++; } }
        return { rowCount: n };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    },
  };
}
function fakeEmbedder() {
  const seen = [];
  return { seen, async embedBatch(texts) { seen.push(...texts); return texts.map(() => new Array(EMB_DIM).fill(0.01)); }, async waitReady() { return true; } };
}
const gen = { head: GEN, generation: GEN, corpusVersion: 'visiongraph@aaaaaaaaaaaa', dirty: false };
const corpus = (names) => ({ pages: pagesOf(...names), known: new Set(names), shadowed: [] });
const base = { namespace: 'knowledge/pages', includeWorking: false, prune: false, force: false, json: false, maxFailed: 10, receiptDir: mkdtempSync(join(tmpdir(), 'cmi-')) };
const quiet = { out: () => {}, generation: gen, sleepFn: async () => {} };

test('run: dry-run (default) reads but never writes or embeds, even without the admin gate', async () => {
  const db = fakeDb(); const emb = fakeEmbedder();
  const r = await run({ ...base, write: false }, { pool: db, embedder: emb, env: {}, corpus: corpus(['Demo Page.md']), ...quiet });
  assert.equal(r.mode, 'dry-run');
  assert.equal(r.plan.counts.new, 3);
  assert.equal(emb.seen.length, 0);
  assert.ok(db.calls.every((c) => c === 'SELECT'), db.calls.join());
  assert.equal(db.rows.size, 0);
});

test('run: --yes without RUVECTOR_ADMIN_WRITE=true is refused before any read', async () => {
  const db = fakeDb(); const emb = fakeEmbedder();
  await assert.rejects(run({ ...base, write: true }, { pool: db, embedder: emb, env: {}, corpus: corpus(['Demo Page.md']), ...quiet }), /RUVECTOR_ADMIN_WRITE=true/);
  await assert.rejects(run({ ...base, write: true }, { pool: db, embedder: emb, env: { RUVECTOR_ADMIN_WRITE: '1' }, corpus: corpus(['Demo Page.md']), ...quiet }), /RUVECTOR_ADMIN_WRITE=true/);
  assert.equal(db.calls.length, 0);
  assert.equal(emb.seen.length, 0);
});

test('run: write, then an identical re-run embeds nothing (manifest no-op and plan-level idempotence)', async () => {
  const stale = { id: 'knowledge/pages/vanished::old', key: 'vanished::old', source_type: 'knowledge', value: { content_hash: 'q' }, metadata: { source_file: 'Deleted.md' }, embedding: '[0]' };
  const keep = { id: 'knowledge/pages/flash', key: 'flash', source_type: 'claude', value: {}, metadata: {}, embedding: '[0]' };
  const db = fakeDb([stale, keep]); const emb = fakeEmbedder();
  const env = { RUVECTOR_ADMIN_WRITE: 'true' };
  const opts = { ...base, write: true, prune: true };
  const r1 = await run(opts, { pool: db, embedder: emb, env, corpus: corpus(['Demo Page.md']), ...quiet });
  assert.equal(r1.stats.embedded, 3);
  assert.equal(r1.stats.pruned, 1);
  assert.ok(r1.stats.prune_receipt);
  assert.match(readFileSync(r1.stats.prune_receipt, 'utf8'), /"vanished::old".*"vanished"/);
  assert.ok(db.rows.has('demo-page::section-0') && db.rows.has('flash') && db.rows.has(MANIFEST_KEY));
  assert.equal(db.rows.has('vanished::old'), false);
  const row = db.rows.get('demo-page::features');
  assert.equal(row.source_type, 'knowledge');
  assert.equal(row.metadata.generation, GEN);
  assert.equal(row.metadata.source_file, 'Demo Page.md');
  assert.equal(row.value.content_hash, contentHash('## Features\nsecond one'));
  assert.equal(db.rows.get(MANIFEST_KEY).value.generation, GEN);
  assert.equal(db.rows.get(MANIFEST_KEY).value.chunks, 3);
  const embedded = emb.seen.length;

  const r2 = await run(opts, { pool: db, embedder: emb, env, corpus: corpus(['Demo Page.md']), ...quiet });
  assert.equal(r2.skipped, 'up-to-date');
  assert.equal(emb.seen.length, embedded);

  // Manifest gone (or --force off the fast path): the plan itself is still a no-op.
  db.rows.delete(MANIFEST_KEY);
  const r3 = await run(opts, { pool: db, embedder: emb, env, corpus: corpus(['Demo Page.md']), ...quiet });
  assert.equal(r3.plan.counts.unchanged, 3);
  assert.equal(r3.plan.counts.new + r3.plan.counts.changed, 0);
  assert.equal(emb.seen.length, embedded + 1, 'only the manifest probe is embedded');

  // New generation, same content: metadata is bumped, nothing is re-embedded.
  const before = emb.seen.length;
  const r4 = await run(opts, { pool: db, embedder: emb, env, corpus: corpus(['Demo Page.md']), ...quiet, generation: { ...gen, generation: 'b'.repeat(40), corpusVersion: 'visiongraph@bbbbbbbbbbbb' } });
  assert.equal(r4.plan.counts.generation_bump, 3);
  assert.equal(emb.seen.length, before + 1);
  assert.equal(db.rows.get('demo-page::features').metadata.generation, 'b'.repeat(40));
});

test('applyPlan: failures over the cap abort before metadata refresh, prune and manifest', async () => {
  const plan = planIngest(pagesOf('Demo Page.md'), [], OPTS);
  const db = fakeDb();
  const emb = { async embedBatch() { throw new Error('xinference down'); } };
  const s = await applyPlan(plan, { pool: db, embedder: emb, namespace: 'knowledge/pages', generation: GEN, corpusVersion: 'v', maxFailed: 1, receiptDir: base.receiptDir, sleepFn: async () => {}, log: () => {} });
  assert.match(s.aborted, /exceeds --max-failed/);
  assert.equal(s.pruned, 0);
  assert.equal(db.rows.size, 0);
});

test('parseArgs: dry-run is the default; --dry-run beats --yes', () => {
  assert.equal(parseArgs([]).write, false);
  assert.equal(parseArgs(['--yes']).write, true);
  assert.equal(parseArgs(['--yes', '--dry-run']).write, false);
  const o = parseArgs(['--include-working', '--prune', '--vault-root', '/x', '--max-failed', '5']);
  assert.deepEqual([o.includeWorking, o.prune, o.vaultRoot, o.maxFailed], [true, true, '/x', 5]);
  assert.equal(parseArgs([]).includeWorking, false);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
});
