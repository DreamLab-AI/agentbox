'use strict';
/**
 * WHAT THIS IS
 *   The offline suite for review-cadence.cjs: the Gemini gate (interval, changed topics,
 *   high-severity escalation, budget refusal), the pack-hash skip, ledger appends, the triage
 *   candidate computation against a real git repository, and the subcommands end to end with
 *   the model calls replaced by fakes. Run with `node --test`.
 * WHY IT IS THIS WAY
 *   The cadence exists to keep the expensive review rare. A gate that opens one condition too
 *   early costs real money; one that stays shut hides drift. Every decision is a pure function
 *   over a ledger, so each condition is pinned here with a ledger fixture and a clock, and no
 *   test touches the network.
 * WHAT IT MEANS FOR THE CLIENT
 *   When the cadence is described as capped, throttled and escalating on evidence, this suite
 *   is what makes that statement true.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('./review-cadence.cjs');

const NOW = new Date('2026-10-20T06:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const CFG = { ...C.DEFAULTS, enabled: true, glm_model: 'glm-test' };

function sh(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim(); }

/** A repo with a two-topic corpus; topic A cites src/a.rs and src/shared.rs, B cites src/b.rs. */
function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@example.invalid');
  sh(dir, 'config', 'user.name', 't');
  put('src/a.rs', 'fn a() {}\n'); put('src/b.rs', 'fn b() {}\n'); put('src/shared.rs', 'fn s() {}\n'); put('src/c.rs', 'fn c() {}\n');
  put('docs/diagrams/README.md', '# index\n');
  put('docs/diagrams/core/01-a.md', '---\nid: CO-01\ntitle: A\narea: core\nsources:\n  - src/a.rs\n  - src/shared.rs\n  - ../other/x.rs\nverified_commit: abc1234\n---\n\n# A\nA calls B.\n');
  put('docs/diagrams/core/02-b.md', '---\nid: CO-02\ntitle: B\narea: core\nsources: [src/b.rs]\nverified_commit: abc1234\n---\n\n# B\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
function commitChange(dir, rel, text) {
  fs.writeFileSync(path.join(dir, rel), text);
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', `change ${rel}`);
  return sh(dir, 'rev-parse', 'HEAD');
}

// ── manifest ────────────────────────────────────────────────────────────────────────────────

test('readSection reads strings, numbers, booleans and multi-line arrays, ignoring comments and other tables', () => {
  const s = C.readSection([
    '[other]', 'enabled = true',
    '[diagram_review]  # the cadence',
    'enabled = true', 'repos = [', '  "/a/b",  # first', '  "/c d",', ']',
    'glm_triage_cron = "17 5 * * 1-6"', 'gemini_monthly_usd = 12.5', 'weekly_window = false',
    '[next]', 'enabled = false',
  ].join('\n'), 'diagram_review');
  assert.deepEqual(s, { enabled: true, repos: ['/a/b', '/c d'], glm_triage_cron: '17 5 * * 1-6', gemini_monthly_usd: 12.5, weekly_window: false });
});

test('loadConfig is disabled with the spec defaults when the manifest has no section or no file', () => {
  const cfg = C.loadConfig('/nonexistent/agentbox.toml');
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.repos, []);
  assert.equal(cfg.gemini_min_interval_days, 7);
  assert.equal(cfg.gemini_min_changed_topics, 3);
  assert.equal(cfg.gemini_monthly_usd, 10);
  assert.equal(cfg.weekly_window, true);
});

// ── ledger ──────────────────────────────────────────────────────────────────────────────────

test('ledger is append-only: lines accumulate in order and earlier lines are untouched', () => {
  const repo = fixtureRepo();
  C.appendLedger(repo, { kind: 'triage', reviewer: 'glm', commit: 'a' });
  const before = fs.readFileSync(C.ledgerPath(repo), 'utf8');
  C.appendLedger(repo, { kind: 'review', reviewer: 'glm', pack_sha256: 'x', skipped: 'why' });
  const after = fs.readFileSync(C.ledgerPath(repo), 'utf8');
  assert.ok(after.startsWith(before));
  const rows = C.readLedger(repo);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.kind), ['triage', 'review']);
  for (const k of ['ts', 'kind', 'reviewer', 'pack_sha256', 'tokens', 'est_usd', 'findings', 'skipped']) assert.ok(k in rows[1], k);
  fs.appendFileSync(C.ledgerPath(repo), 'not json\n');
  assert.equal(C.readLedger(repo).length, 2, 'a torn line is skipped');
});

test('month-to-date counts only Gemini spend in the same UTC month, across ledgers', () => {
  const l1 = [
    { reviewer: 'gemini', est_usd: 2.5, ts: '2026-10-02T00:00:00Z' },
    { reviewer: 'gemini', est_usd: 9, ts: '2026-09-30T23:59:00Z' },
    { reviewer: 'glm', est_usd: 5, ts: '2026-10-03T00:00:00Z' },
  ];
  const l2 = [{ reviewer: 'gemini', est_usd: 1.25, ts: '2026-10-19T00:00:00Z', skipped: 'error: timeout' }];
  assert.equal(C.monthToDateUsd([l1, l2], NOW), 3.75);
});

// ── Gemini gate ─────────────────────────────────────────────────────────────────────────────

const gate = (o) => C.decideGemini({ cfg: CFG, lastAudit: null, changedTopics: 5, glmHighSeverity: 0, mtdUsd: 0, estUsd: 1, now: NOW, ...o });

test('gate opens with enough changed topics, a clear interval and budget', () => {
  assert.equal(gate({ lastAudit: { ts: daysAgo(8) } }).run, true);
  assert.equal(gate({}).run, true, 'a first audit has no interval to wait out');
});

test('gate refuses inside the minimum interval, even with a high-severity finding', () => {
  const r = gate({ lastAudit: { ts: daysAgo(6.9) }, glmHighSeverity: 2, changedTopics: 50 });
  assert.equal(r.run, false);
  assert.match(r.reason, /^interval/);
  assert.equal(gate({ lastAudit: { ts: daysAgo(7.01) } }).run, true);
});

test('gate needs min changed topics OR a high-severity GLM finding', () => {
  const quiet = gate({ lastAudit: { ts: daysAgo(10) }, changedTopics: 2 });
  assert.equal(quiet.run, false);
  assert.match(quiet.reason, /^no cause/);
  assert.equal(gate({ lastAudit: { ts: daysAgo(10) }, changedTopics: 3 }).run, true);
  const escalated = gate({ lastAudit: { ts: daysAgo(10) }, changedTopics: 0, glmHighSeverity: 1 });
  assert.equal(escalated.run, true);
  assert.match(escalated.reason, /high-severity/);
});

test('gate refuses when month-to-date plus the estimate would pass the monthly cap', () => {
  const r = gate({ mtdUsd: 9.5, estUsd: 0.6 });
  assert.equal(r.run, false);
  assert.match(r.reason, /^budget/);
  assert.equal(gate({ mtdUsd: 9.4, estUsd: 0.6 }).run, true, 'exactly at the cap is allowed');
  assert.equal(gate({ glmHighSeverity: 3, mtdUsd: 10, estUsd: 0.01 }).run, false, 'escalation never overrides the budget');
});

test('cost estimate prices the pack once, the cache for later lenses, and the replies', () => {
  const usd = C.estimateGeminiUsd(200000, 2);
  const expected = (200000 * 0.75 + 200000 * 0.075 + 2 * 30000 * 3.75) / 1e6;
  assert.ok(Math.abs(usd - expected) < 1e-9);
  const actual = C.actualGeminiUsd([{ prompt_tokens: 200000, cached_tokens: 0, thinking_tokens: 10000, output_tokens: 5000 },
    { prompt_tokens: 200000, cached_tokens: 190000, thinking_tokens: 8000, output_tokens: 4000 }]);
  const want = ((200000 * 0.75 + 15000 * 3.75) + (10000 * 0.75 + 190000 * 0.075 + 12000 * 3.75)) / 1e6;
  assert.ok(Math.abs(actual - want) < 1e-6);
});

test('high severity: explicit Severity wins; otherwise high confidence on a defect the authors had not marked', () => {
  assert.equal(C.isHighSeverity({ severity: 'High', confidence: 'low' }), true);
  assert.equal(C.isHighSeverity({ severity: 'medium', confidence: 'high', marked_by_authors: 'no' }), false);
  assert.equal(C.isHighSeverity({ confidence: 'high', marked_by_authors: 'no' }), true);
  assert.equal(C.isHighSeverity({ confidence: 'high', marked_by_authors: 'yes (Debt)' }), false);
  assert.equal(C.isHighSeverity({ confidence: 'medium', marked_by_authors: 'no' }), false);
});

// ── pack hash skip ──────────────────────────────────────────────────────────────────────────

test('pack hash: unchanged since the last real GLM review, but a skipped or failed run does not count', () => {
  const ledger = [
    { kind: 'review', reviewer: 'glm', pack_sha256: 'aaa', ts: daysAgo(9) },
    { kind: 'review', reviewer: 'glm', pack_sha256: 'bbb', ts: daysAgo(8), skipped: 'error: boom', error: 'boom' },
  ];
  assert.equal(C.packUnchanged(ledger, 'aaa'), true);
  assert.equal(C.packUnchanged(ledger, 'bbb'), false);
  assert.equal(C.packUnchanged([], 'aaa'), false);
});

// ── triage candidates ───────────────────────────────────────────────────────────────────────

test('sources frontmatter: block and inline forms parse, and a ../ source is not attributed', () => {
  const repo = fixtureRepo();
  const topics = C.loadTopics(repo);
  assert.deepEqual(topics.map((t) => [t.rel, t.sources]), [
    ['core/01-a.md', ['src/a.rs', 'src/shared.rs']],
    ['core/02-b.md', ['src/b.rs']],
  ]);
});

test('triage candidates are the union, over the window, of topics whose sources changed', () => {
  const repo = fixtureRepo();
  const base = sh(repo, 'rev-parse', 'HEAD');
  commitChange(repo, 'src/b.rs', 'fn b() { 1 }\n');
  commitChange(repo, 'src/c.rs', 'fn c() { 2 }\n');         // cited by no topic
  commitChange(repo, 'src/shared.rs', 'fn s() { 3 }\n');
  const changed = new Set(sh(repo, 'diff', '--name-only', base, 'HEAD').split('\n'));
  const cands = C.triageCandidates(C.loadTopics(repo), changed);
  assert.deepEqual(cands.map((t) => [t.rel, t.changedSources]), [
    ['core/01-a.md', ['src/shared.rs']],
    ['core/02-b.md', ['src/b.rs']],
  ]);
  assert.deepEqual(C.triageCandidates(C.loadTopics(repo), new Set(['src/c.rs'])), []);
});

// ── subcommands, model calls faked ──────────────────────────────────────────────────────────

/** Fake Z.AI Messages endpoint: answers each request from `reply(body)`. */
function fakePost(reply, seen = []) {
  return async (url, headers, body) => {
    seen.push({ url, headers, body });
    return { status: 200, json: { content: [{ type: 'text', text: reply(body) }], usage: { input_tokens: 100, output_tokens: 20 } } };
  };
}
const ctxFor = (extra = {}) => ({ now: NOW, cfg: CFG, dryRun: false, env: { ZAI_API_KEY: 'secret-key-value' }, mtd: 0, model: 'gemini-test', ...extra });

test('triage: the first run records a baseline and spends nothing; the next flags topics, writes the file, advances the window', async () => {
  const repo = fixtureRepo();
  const seen = [];
  const post = fakePost((b) => (b.messages[0].content.includes('core/01-a.md') ? 'VERDICT: NO\nREASON: still fine' : 'VERDICT: YES\nREASON: callee changed'), seen);
  assert.deepEqual(await C.triage(repo, ctxFor({ post })), { skipped: 'baseline recorded' });
  assert.equal(seen.length, 0);
  commitChange(repo, 'src/a.rs', 'fn a() { x() }\n');
  commitChange(repo, 'src/b.rs', 'fn b() { y() }\n');
  const res = await C.triage(repo, ctxFor({ post }));
  assert.equal(res.checked, 2);
  assert.equal(res.flagged, 1);
  const md = fs.readFileSync(path.join(repo, res.findings), 'utf8');
  assert.match(md, /`core\/02-b\.md`: callee changed/);
  assert.match(md.split('## Still accurate')[1], /core\/01-a\.md/);
  assert.match(seen[0].url, /\/v1\/messages$/);
  assert.equal(seen[0].headers.authorization, 'Bearer secret-key-value');
  assert.match(seen[0].body.messages[0].content, /fn a\(\) \{ x\(\) \}/, 'the prompt carries the diff of the topic sources');
  const rows = C.readLedger(repo);
  assert.equal(rows.at(-1).commit, sh(repo, 'rev-parse', 'HEAD'));
  assert.equal(rows.at(-1).findings, res.findings);
  // Nothing changed since: no call, a skip line, and the window still advances.
  const before = seen.length;
  assert.deepEqual(await C.triage(repo, ctxFor({ post })), { skipped: 'no topic sources changed' });
  assert.equal(seen.length, before);
  assert.equal(C.readLedger(repo).at(-1).skipped, 'no topic sources changed');
});

test('triage: unsure means yes — an unparseable reply and a failed call both list the topic', async () => {
  const repo = fixtureRepo();
  await C.triage(repo, ctxFor({ post: fakePost(() => '') }));
  commitChange(repo, 'src/a.rs', 'fn a() { 9 }\n');
  commitChange(repo, 'src/b.rs', 'fn b() { 9 }\n');
  let n = 0;
  const post = async () => { if (n++ === 0) return { status: 200, json: { content: [{ type: 'text', text: 'It depends.' }], usage: {} } }; throw new Error('socket hang up'); };
  const res = await C.triage(repo, ctxFor({ post }));
  assert.equal(res.flagged, 2);
  assert.match(fs.readFileSync(path.join(repo, res.findings), 'utf8'), /GLM call failed/);
});

test('triage: a recorded commit that is not in the repository re-baselines instead of failing', async () => {
  const repo = fixtureRepo();
  C.appendLedger(repo, { kind: 'triage', reviewer: 'glm', commit: 'f'.repeat(40) });
  assert.deepEqual(await C.triage(repo, ctxFor({ post: fakePost(() => 'VERDICT: NO') })), { skipped: 'baseline recorded' });
  assert.match(C.readLedger(repo).at(-1).skipped, /not in this repository/);
});

test('review-glm: runs both lenses, records high-severity findings, then skips an identical pack', async () => {
  const repo = fixtureRepo();
  const seen = [];
  const reply = () => ['### F-01 — a contradiction', '- Topics: CO-01', '- Evidence: x', '- Failure: y', '- Confidence: high', '- Severity: high', '- Marked by authors: no',
    '', '### F-02 — a smell', '- Topics: CO-02', '- Confidence: low', '- Severity: low', '- Marked by authors: no'].join('\n');
  const post = fakePost(reply, seen);
  const res = await C.reviewGlm(repo, ctxFor({ post }));
  assert.equal(seen.length, 2, 'critical and premortem');
  assert.match(seen[0].body.messages[0].content, /=== FILE: core\/01-a\.md ===/);
  assert.match(seen[0].body.messages[0].content, /Severity: high, medium or low/);
  assert.equal(res.count, 4);
  assert.equal(res.high, 2);
  const row = C.readLedger(repo).at(-1);
  assert.equal(row.high_severity, 2);
  assert.equal(row.pack_sha256, C.corpusPack(repo).sha);
  assert.ok(fs.existsSync(path.join(repo, res.findings)));
  assert.ok(fs.existsSync(path.join(repo, res.findings.replace(/\.md$/, '.json'))));
  assert.ok(JSON.parse(fs.readFileSync(path.join(repo, res.findings.replace(/\.md$/, '.json')), 'utf8')).every((f) => f.status === 'unverified'));
  const again = await C.reviewGlm(repo, ctxFor({ post }));
  assert.deepEqual(again, { skipped: 'pack unchanged' });
  assert.equal(seen.length, 2, 'no further call');
  assert.equal(C.readLedger(repo).at(-1).skipped, 'pack unchanged since the last GLM review');
  fs.appendFileSync(path.join(repo, 'docs/diagrams/core/02-b.md'), '\nmore prose\n');
  assert.equal((await C.reviewGlm(repo, ctxFor({ post }))).skipped, undefined, 'an edited topic changes the hash and reviews again');
});

test('audit-gemini: refusals are logged with their reason and never reach the network or the key', async () => {
  const repo = fixtureRepo();
  let ran = 0;
  const runExternal = async () => { ran++; };
  C.appendLedger(repo, { ts: daysAgo(3), kind: 'audit', reviewer: 'gemini', commit: sh(repo, 'rev-parse', 'HEAD'), est_usd: 1 });
  const res = await C.auditGemini(repo, ctxFor({ runExternal }));
  assert.match(res.skipped, /^interval/);
  assert.equal(ran, 0);
  assert.equal(C.readLedger(repo).at(-1).skipped, res.skipped);
  assert.equal(C.readLedger(repo).at(-1).est_usd, 0);
});

test('audit-gemini: with the gate open it runs external-review, books the actual cost and writes findings', async () => {
  const repo = fixtureRepo();
  const prev = { k: process.env.GEMINI_API_KEY };
  process.env.GEMINI_API_KEY = 'gem-secret';
  try {
    // A fake countTokens endpoint through the real transport is not worth a server here:
    // dry-run covers the decision path, and the run path is driven with a fake external review.
    const runExternal = async (corpus, out) => {
      fs.writeFileSync(path.join(out, 'critical.md'), '### F-01 — t\n- Confidence: high\n');
      fs.writeFileSync(path.join(out, 'premortem.md'), '### R-1 — t\n');
      fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify([{ id: 'critical:F-01', status: 'unverified' }]));
      fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ model: 'gemini-test', lenses: [
        { name: 'critical', prompt_tokens: 100000, cached_tokens: 0, thinking_tokens: 10000, output_tokens: 2000 },
        { name: 'premortem', prompt_tokens: 100000, cached_tokens: 100000, thinking_tokens: 10000, output_tokens: 2000 }] }));
    };
    const ER = require('./external-review.cjs');
    const real = ER.gemini;
    ER.gemini = async () => ({ totalTokens: 100000 });
    let res;
    try { res = await C.auditGemini(repo, ctxFor({ runExternal, cfg: { ...CFG, gemini_min_changed_topics: 2 } })); } finally { ER.gemini = real; }
    assert.equal(res.count, 1);
    const row = C.readLedger(repo).at(-1);
    assert.equal(row.reviewer, 'gemini');
    assert.equal(row.kind, 'audit');
    const want = (100000 * 0.75 + 12000 * 3.75 + 100000 * 0.075 + 12000 * 3.75) / 1e6;
    assert.ok(Math.abs(row.est_usd - want) < 1e-6);
    assert.equal(C.monthToDateUsd([C.readLedger(repo)], NOW), row.est_usd);
    assert.match(fs.readFileSync(path.join(repo, res.findings), 'utf8'), /Gemini audit/);
    // The audit just booked sets the interval: an immediate second attempt is refused.
    assert.match((await C.auditGemini(repo, ctxFor({ runExternal }))).skipped, /^interval/);
  } finally {
    if (prev.k === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prev.k;
  }
});

test('audit-gemini: a failed generation is booked at its estimate, because it may have been billed', async () => {
  const repo = fixtureRepo();
  process.env.GEMINI_API_KEY = 'gem-secret';
  const ER = require('./external-review.cjs');
  const real = ER.gemini;
  ER.gemini = async () => ({ totalTokens: 100000 });
  try {
    await assert.rejects(C.auditGemini(repo, ctxFor({ cfg: { ...CFG, gemini_min_changed_topics: 2 }, runExternal: async () => { throw new Error('timed out after 1800 s'); } })), /timed out/);
  } finally { ER.gemini = real; delete process.env.GEMINI_API_KEY; }
  const row = C.readLedger(repo).at(-1);
  assert.ok(row.est_usd > 0);
  assert.match(row.skipped, /^error/);
  assert.ok(C.monthToDateUsd([C.readLedger(repo)], NOW) > 0);
});

test('status reports each run kind and month-to-date Gemini spend', () => {
  const repo = fixtureRepo();
  C.appendLedger(repo, { ts: daysAgo(2), kind: 'audit', reviewer: 'gemini', est_usd: 3.1, findings: 'docs/review/x-gemini.md' });
  C.appendLedger(repo, { ts: daysAgo(1), kind: 'review', reviewer: 'glm', skipped: 'pack unchanged since the last GLM review' });
  const { text, mtd } = C.statusOf([repo], NOW);
  assert.equal(mtd, 3.1);
  assert.match(text, /Gemini spend 2026-10: \$3\.10/);
  assert.match(text, /audit\/gemini: last run .*docs\/review\/x-gemini\.md/);
  assert.match(text, /review\/glm: never run; latest skip: pack unchanged/);
});

test('the GLM key never appears in a ledger line or findings file', async () => {
  const repo = fixtureRepo();
  await C.triage(repo, ctxFor({ post: fakePost(() => 'VERDICT: NO') }));
  commitChange(repo, 'src/a.rs', 'fn a() { 7 }\n');
  await C.triage(repo, ctxFor({ post: async () => { throw new Error('glm 401: bad'); } }));
  const all = [fs.readFileSync(C.ledgerPath(repo), 'utf8'),
    ...fs.readdirSync(path.join(repo, 'docs/review')).map((f) => fs.readFileSync(path.join(repo, 'docs/review', f), 'utf8'))].join('\n');
  assert.doesNotMatch(all, /secret-key-value/);
});

test('main: disabled manifest does nothing; an unknown subcommand is a usage error', async () => {
  assert.equal(await C.main(['triage', '--manifest', '/nonexistent']), 0);
  await assert.rejects(C.main(['bogus']), /usage:/);
});
