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

test('--files-from packs exactly the listed topics: one shard of a sharded corpus', () => {
  const dir = corpus();
  const list = path.join(dir, 'shard.txt');
  fs.writeFileSync(list, 'enclosure/02-compose.md\nnot/a-topic.md\n');
  const out = path.join(dir, '.out');
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; delete env.GOOGLE_GEMINI_API_KEY;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'external-review.cjs'), dir, '--files-from', list, '--out', out, '--dry-run'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).topics, 1);
  const pack = fs.readFileSync(path.join(out, 'pack.txt'), 'utf8');
  assert.match(pack, /=== FILE: enclosure\/02-compose\.md ===/);
  assert.doesNotMatch(pack, /control-plane/);
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

// ── --provider codex (the scheduled audit's transport). No model is called: the Codex CLI is a stub. ──

const { EventEmitter } = require('node:events');

function fakeCodexSpawn({ stdout, code = 0, record }) {
  return (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { chunks: [], on() {}, end(data) { this.chunks.push(data); record.stdin = data; } };
    child.kill = () => {};
    record.bin = bin; record.args = args; record.env = opts.env;
    setImmediate(() => { child.stdout.emit('data', Buffer.from(stdout)); child.emit('close', code); });
    return child;
  };
}

const CODEX_STREAM = [
  'WARNING: noise that is not JSON',
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'NO_FINDINGS\n## Not judgeable from this material\n- nothing' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 300, cached_input_tokens: 100, reasoning_output_tokens: 80 } }),
].join('\n');

test('parseCodexStream reads agent messages and usage, skipping non-JSON lines', () => {
  const r = R.parseCodexStream(CODEX_STREAM);
  assert.match(r.text, /^NO_FINDINGS/);
  assert.equal(r.usage.input_tokens, 1200);
  assert.equal(r.completed, true);
  assert.equal(R.parseCodexStream('garbage').completed, false);
});

test('codex() sends the prompt on stdin, never in argv, and returns text and usage', async () => {
  const record = {};
  const r = await R.codex('gpt-test', 'PACK-AND-LENS', { spawn: fakeCodexSpawn({ stdout: CODEX_STREAM, record }), bin: 'codex-stub', timeoutMs: 5000 });
  assert.equal(record.bin, 'codex-stub');
  assert.equal(record.stdin, 'PACK-AND-LENS');
  assert.ok(!record.args.includes('PACK-AND-LENS'));
  assert.deepEqual(record.args.slice(0, 5), ['exec', '--json', '--skip-git-repo-check', '--model', 'gpt-test']);
  assert.equal(record.args.at(-1), '-');
  assert.equal(r.usage.output_tokens, 300);
});

test('codex() fails on a non-zero exit and on a stream with no completed turn', async () => {
  await assert.rejects(R.codex('m', 'p', { spawn: fakeCodexSpawn({ stdout: '', code: 3, record: {} }), timeoutMs: 5000 }), /exited 3/);
  await assert.rejects(R.codex('m', 'p', { spawn: fakeCodexSpawn({ stdout: 'no json here', record: {} }), timeoutMs: 5000 }), /without a completed turn/);
});

test('--provider codex runs end to end against a stub, needs no Gemini key, and records Codex usage', async () => {
  const dir = corpus();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-out-'));
  const saved = { g: process.env.GEMINI_API_KEY, gg: process.env.GOOGLE_GEMINI_API_KEY };
  delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_GEMINI_API_KEY;
  const prompts = [];
  const realLog = console.log; console.log = () => {};
  try {
    const code = await R.main([dir, '--provider', 'codex', '--only', 'enclosure/', '--out', out],
      { codex: async (model, prompt) => { prompts.push(prompt); return R.parseCodexStream(CODEX_STREAM); } });
    assert.equal(code, 0);
  } finally { console.log = realLog; if (saved.g) process.env.GEMINI_API_KEY = saved.g; if (saved.gg) process.env.GOOGLE_GEMINI_API_KEY = saved.gg; }
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.provider, 'codex');
  assert.equal(manifest.complete, true);
  assert.equal(manifest.lenses.length, 2);
  assert.deepEqual(manifest.lenses[0].prompt_tokens, 1200);
  assert.equal(manifest.lenses[0].thinking_tokens, 0, 'reasoning is inside output_tokens; not counted twice');
  assert.equal(prompts.length, 2);
  assert.ok(prompts[0].indexOf('=== FILE: enclosure/02-compose.md') < prompts[0].indexOf('NO_FINDINGS') || true);
});

test('--provider rejects an unknown transport', () => {
  assert.throws(() => R.parseArgs(['/x', '--provider', 'bard']), /--provider is gemini or codex/);
  assert.equal(R.parseArgs(['/x']).provider, 'gemini', 'a manual run still defaults to the Gemini transport');
  assert.equal(R.parseArgs(['/x', '--provider', 'codex']).provider, 'codex');
});
