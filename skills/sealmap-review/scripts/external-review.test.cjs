'use strict';
/**
 * WHAT THIS IS
 *   The offline suite for external-review.cjs: which files are packed, what register
 *   stripping removes and keeps, how lens prompts load, how findings are parsed out of a
 *   review, and that a dry run writes a pack without touching the network. Run with
 *   `node --test`.
 * WHY IT IS THIS WAY
 *   The model call itself is not testable offline and not deterministic; everything around
 *   it is. A pack that silently drops a topic, or a strip that leaves the authors' Tension
 *   paragraphs in, would make a "blind" review read the answers.
 * WHAT IT MEANS FOR THE CLIENT
 *   When the outside reviewer is said to have seen the whole map, or to have worked without
 *   the authors' own list of known problems, this suite is what makes that statement true.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = require('./external-review.cjs');

function corpus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-review-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('README.md', '# root readme\n');
  put('REGISTER.md', '# register\n');
  put('control-plane/01-boot.md', [
    '# CP-01 Boot', '',
    'The server boots in order.', '',
    '**Tension (header vs code):** the header says X, the code does Y.', '',
    '**Invariant:** boot refuses an unknown slot.', '',
    '```mermaid', 'flowchart TB', '  A --> B', '  B --- N["TENSION: unkeyed chain"]', '  B --- M["INVARIANT: fail closed"]', '```', '',
  ].join('\n'));
  put('control-plane/README.md', '# area readme\n');
  put('enclosure/02-compose.md', '# EN-02 Compose\n\n**Debt:** two inventories by hand.\n\nKept prose.\n');
  put('rendered/control-plane/01-boot/x.md', 'should be skipped\n');
  put('legacy/09-old.md', 'skipped by config\n');
  return dir;
}

test('packs only area topic files, sorted, honouring default and configured skip dirs', () => {
  const dir = corpus();
  assert.deepEqual(R.listTopics(dir), ['control-plane/01-boot.md', 'enclosure/02-compose.md', 'legacy/09-old.md']);
  assert.deepEqual(R.listTopics(dir, { skipDirs: ['legacy'] }), ['control-plane/01-boot.md', 'enclosure/02-compose.md']);
  assert.deepEqual(R.listTopics(dir, { only: 'enclosure/', skipDirs: ['legacy'] }), ['enclosure/02-compose.md']);
});

test('strip removes Tension/Debt paragraphs and marker lines but keeps invariants and prose', () => {
  const dir = corpus();
  const full = R.buildPack(dir, ['control-plane/01-boot.md', 'enclosure/02-compose.md']);
  const blind = R.buildPack(dir, ['control-plane/01-boot.md', 'enclosure/02-compose.md'], { register: 'strip' });
  assert.match(full, /\*\*Tension \(header vs code\):\*\*/);
  assert.doesNotMatch(blind, /Tension|TENSION|Debt/);
  assert.match(blind, /\*\*Invariant:\*\* boot refuses/);
  assert.match(blind, /INVARIANT: fail closed/);
  assert.match(blind, /A --> B/);
  assert.match(blind, /Kept prose\./);
  assert.match(blind, /=== FILE: enclosure\/02-compose\.md ===/);
});

test('both shipped lenses load and substitute the finding count', () => {
  for (const lens of ['critical', 'premortem']) {
    const text = R.loadLens(lens, 7);
    assert.doesNotMatch(text, /\{\{COUNT\}\}/);
    assert.match(text, /\b7\b/);
    assert.match(text, /### F-01/);
  }
  assert.throws(() => R.loadLens('flattering', 5), /unknown lens 'flattering'/);
});

test('findings and root causes are parsed with their fields and marked unverified', () => {
  const review = [
    '### R-1 — Audit copy lost on restart',
    '- Topics: CP-03.2',
    '- Chain of events: queue in memory, restart, gap',
    '- Confidence: high',
    '',
    '### F-01 – Shared network bypasses header strip',
    '- Topics: EN-02.2, ES-03.1',
    '- Evidence: compose.pod.yaml:1066 puts every tenant on pod-net',
    '- Failure: tenant code calls a sibling on port 3000',
    '- Confidence: medium (inferred)',
    '- Marked by authors: no',
    '',
    '## Not judgeable from this material',
    '1. kernel hardening',
  ].join('\n');
  const f = R.parseFindings(review, 'premortem');
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => [x.id, x.kind]), [['premortem:R-1', 'root-cause'], ['premortem:F-01', 'finding']]);
  assert.equal(f[0].failure, 'queue in memory, restart, gap');
  assert.equal(f[1].marked_by_authors, 'no');
  assert.equal(f[1].topics, 'EN-02.2, ES-03.1');
  assert.ok(f.every((x) => x.status === 'unverified'));
  assert.ok(!f[1].evidence.includes('kernel'), 'trailing section must not leak into the last finding');
});

test('argument errors are usage errors', () => {
  assert.throws(() => R.parseArgs([]), /exactly one corpus/);
  assert.throws(() => R.parseArgs(['d', '--register', 'maybe']), /include or strip/);
  assert.throws(() => R.parseArgs(['d', '--count', '0']), /positive integer/);
  assert.throws(() => R.parseArgs(['d', '--frobnicate']), /unknown option/);
  assert.deepEqual(R.parseArgs(['d', '--lens', 'critical']).lens, ['critical']);
});

test('dry run writes the pack and manifest and needs no key', () => {
  const dir = corpus();
  fs.writeFileSync(path.join(dir, 'diagrams.config.json'), JSON.stringify({ skipDirs: ['legacy'] }));
  const out = path.join(dir, '.out');
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; delete env.GOOGLE_GEMINI_API_KEY;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'external-review.cjs'), dir, '--register', 'strip', '--out', out, '--dry-run'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.topics, 2);
  assert.equal(manifest.register, 'strip');
  assert.match(manifest.pack_sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'pack.txt'), 'utf8'), /Tension/);
});

test('a live run without a key fails with a clear message, after packing', () => {
  const dir = corpus();
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; delete env.GOOGLE_GEMINI_API_KEY;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'external-review.cjs'), dir, '--out', path.join(dir, '.o')], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /set GEMINI_API_KEY/);
});

test('bold and plain field labels both parse, whichever side of the colon the bold sits', () => {
  const review = [
    '### F-01 — Bold after the colon',
    '- **Topics**: CP-01.2',
    '- **Evidence**: boot.rs:44 accepts any slot',
    '- **Failure**: an unknown slot boots silently',
    '- **Confidence**: high',
    '- **Marked by authors**: no',
    '',
    '### F-02 — Bold including the colon',
    '* **Evidence:** compose.yaml:12 shares pod-net',
    '* **Failure:** sibling reachable',
    '* __Confidence__: low',
    '',
    '### R-1 — Italic and plain mixed',
    '- *Chain of events*: queue, restart, gap',
    '- Topics: EN-02',
  ].join('\n');
  const [a, b, c] = R.parseFindings(review, 'critical');
  assert.equal(a.topics, 'CP-01.2');
  assert.equal(a.evidence, 'boot.rs:44 accepts any slot');
  assert.equal(a.failure, 'an unknown slot boots silently');
  assert.equal(a.confidence, 'high');
  assert.equal(a.marked_by_authors, 'no');
  assert.equal(b.evidence, 'compose.yaml:12 shares pod-net');
  assert.equal(b.failure, 'sibling reachable');
  assert.equal(b.confidence, 'low');
  assert.equal(c.failure, 'queue, restart, gap');
  assert.equal(c.topics, 'EN-02');
});

// ── transport: node:https with an overall deadline, never fetch/undici ──────────
const http = require('node:http');

function slowServer(handler) {
  return new Promise((resolve) => {
    const hits = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => { hits.push({ url: req.url, headers: req.headers, body }); handler(req, res, hits.length); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, api: `http://127.0.0.1:${srv.address().port}/v1beta/models` }));
  });
}
const reply = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

test('the default per-call deadline is at least 1,800 s and the script never uses fetch', () => {
  assert.ok(R.DEFAULT_TIMEOUT_MS >= 1_800_000, `default ${R.DEFAULT_TIMEOUT_MS} ms`);
  const src = fs.readFileSync(path.join(__dirname, 'external-review.cjs'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\(/, 'fetch (undici) aborts a silent response at 300 s');
});

test('a slow reply inside the deadline succeeds, with the key in a header and one request', async () => {
  const { srv, hits, api } = await slowServer((req, res) => setTimeout(() => reply(res, 200, { totalTokens: 42 }), 1200));
  try {
    const out = await R.gemini('countTokens', 'm', 'KEY', { contents: [] }, { api, timeoutMs: 10_000 });
    assert.equal(out.totalTokens, 42);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].url, '/v1beta/models/m:countTokens');
    assert.equal(hits[0].headers['x-goog-api-key'], 'KEY');
    assert.deepEqual(JSON.parse(hits[0].body), { contents: [] });
  } finally { srv.close(); }
});

test('a reply slower than the deadline fails with a timeout and is not retried', async () => {
  const { srv, hits, api } = await slowServer((req, res) => setTimeout(() => { if (!res.destroyed) reply(res, 200, {}); }, 3000));
  try {
    const t0 = Date.now();
    await assert.rejects(R.gemini('generateContent', 'm', 'KEY', {}, { api, timeoutMs: 400, retryDelayMs: 1 }), /timed out after 0\.4 s/);
    assert.ok(Date.now() - t0 < 2500, 'the deadline, not the server, ended the call');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(hits.length, 1, 'a timed-out generateContent may already be billed, so it is never resent');
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('generateContent is not retried on 5xx (it may have been billed); 429 is retried', async () => {
  const s5 = await slowServer((req, res) => reply(res, 503, { error: { message: 'overloaded' } }));
  try {
    await assert.rejects(R.gemini('generateContent', 'm', 'K', {}, { api: s5.api, retryDelayMs: 1 }), /generateContent 503/);
    assert.equal(s5.hits.length, 1);
  } finally { s5.srv.close(); }
  const s429 = await slowServer((req, res, n) => (n === 1 ? reply(res, 429, {}) : reply(res, 200, { ok: true })));
  try {
    assert.deepEqual(await R.gemini('generateContent', 'm', 'K', {}, { api: s429.api, retryDelayMs: 1 }), { ok: true });
    assert.equal(s429.hits.length, 2);
  } finally { s429.srv.close(); }
});

test('countTokens is free, so a 5xx there is retried', async () => {
  const { srv, hits, api } = await slowServer((req, res, n) => (n < 3 ? reply(res, 500, {}) : reply(res, 200, { totalTokens: 7 })));
  try {
    assert.equal((await R.gemini('countTokens', 'm', 'K', {}, { api, retryDelayMs: 1 })).totalTokens, 7);
    assert.equal(hits.length, 3);
  } finally { srv.close(); }
});

test('DIAGRAM_REVIEW_TIMEOUT_MS overrides the default deadline', () => {
  assert.equal(R.timeoutFromEnv({ DIAGRAM_REVIEW_TIMEOUT_MS: '2400000' }), 2_400_000);
  assert.equal(R.timeoutFromEnv({}), R.DEFAULT_TIMEOUT_MS);
  assert.throws(() => R.timeoutFromEnv({ DIAGRAM_REVIEW_TIMEOUT_MS: 'soon' }), /positive integer/);
});
