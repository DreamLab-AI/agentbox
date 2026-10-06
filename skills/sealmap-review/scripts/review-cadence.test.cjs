'use strict';
/**
 * WHAT THIS IS
 *   The offline suite for review-cadence.cjs: repo discovery, the Gemini gate (interval, changed
 *   topics, high-severity escalation, budget refusal), the per-shard pack-hash skip, ledger
 *   appends, sharding by token budget, and change detection across several git repositories
 *   (symlinked spellings of one path, a nested submodule, a missing sibling, a dangling link),
 *   plus the subcommands end to end with the model calls replaced by fakes. Run with `node --test`.
 * WHY IT IS THIS WAY
 *   The cadence exists to keep the expensive review rare and to see change wherever it lands.
 *   A gate that opens one condition too early costs money; a change read from the wrong
 *   repository's history is invisible, so an estate corpus would rot unseen. Every decision is a
 *   pure function over a ledger or a fixture repository, so each is pinned here without a network.
 * WHAT IT MEANS FOR THE CLIENT
 *   When the cadence is described as capped, throttled, escalating on evidence and watching every
 *   linked repository once, this suite is what makes that statement true.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('./review-cadence.cjs');
const ER = require('./external-review.cjs');

const NOW = new Date('2026-10-20T06:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const CFG = { ...C.DEFAULTS, enabled: true, glm_model: 'glm-test' };
const rp = (p) => fs.realpathSync(p);

function sh(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim(); }
function put(root, relp, text) { fs.mkdirSync(path.dirname(path.join(root, relp)), { recursive: true }); fs.writeFileSync(path.join(root, relp), text); }
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@example.invalid');
  sh(dir, 'config', 'user.name', 't');
}
function commitAll(dir, msg) { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); return sh(dir, 'rev-parse', 'HEAD'); }
function change(dir, relp, text) { put(dir, relp, text); return commitAll(dir, `change ${relp}`); }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-'));

const topic = (id, sources) => `---\nid: ${id}\ntitle: ${id}\narea: x\nsources:\n${sources.map((s) => `  - ${s}`).join('\n')}\nverified_commit: abc1234\n---\n\n# ${id}\nProse for ${id}.\n`;

/**
 * An estate: a corpus repo `estate` citing its siblings with ../ paths.
 *   alpha, beta        plain repos; alpha-link is a symlink to alpha (the workspace convention)
 *   outer              a repo that contains `inner`, a separate repo committed as a gitlink; ln -> outer/inner
 *   gone               not there at all; dang -> /nonexistent (a dangling link)
 */
function estate() {
  const ws = rp(tmp());
  for (const r of ['alpha', 'beta', 'outer']) initRepo(path.join(ws, r));
  put(ws, 'alpha/src/a.rs', 'fn a() {}\n'); commitAll(path.join(ws, 'alpha'), 'init');
  put(ws, 'beta/src/b.rs', 'fn b() {}\n'); commitAll(path.join(ws, 'beta'), 'init');
  const inner = path.join(ws, 'outer', 'inner');
  initRepo(inner); put(inner, 'i.rs', 'fn i() {}\n'); commitAll(inner, 'init');
  put(ws, 'outer/src/o.rs', 'fn o() {}\n');
  commitAll(path.join(ws, 'outer'), 'init with a gitlink');
  fs.symlinkSync(path.join(ws, 'alpha'), path.join(ws, 'alpha-link'));
  fs.symlinkSync(path.join(ws, 'outer', 'inner'), path.join(ws, 'ln'));
  fs.symlinkSync('/nonexistent/nowhere', path.join(ws, 'dang'));
  const est = path.join(ws, 'estate');
  initRepo(est);
  put(est, 'docs/diagrams/README.md', '# index\n');
  put(est, 'docs/diagrams/core/01-a.md', topic('CO-01', ['../alpha/src/a.rs', '../alpha-link/src/a.rs', '../gone/x.rs', '../dang/x.rs']));
  put(est, 'docs/diagrams/core/02-b.md', topic('CO-02', ['../beta/src/b.rs']));
  put(est, 'docs/diagrams/edge/01-c.md', topic('ED-01', ['../outer/inner/i.rs', '../ln/i.rs', '../outer/src/o.rs']));
  commitAll(est, 'init');
  return { ws, est, alpha: path.join(ws, 'alpha'), beta: path.join(ws, 'beta'), outer: path.join(ws, 'outer'), inner };
}

// ── manifest ────────────────────────────────────────────────────────────────────────────────

test('readSection reads strings, numbers, booleans and multi-line arrays, ignoring comments and other tables', () => {
  const s = C.readSection([
    '[other]', 'enabled = true',
    '[diagram_review]  # the cadence',
    'enabled = true', 'repos = [', '  "/a/b",  # first', '  "/c d",', ']',
    'glm_triage_cron = "17 5 * * *"', 'gemini_monthly_usd = 12.5', 'weekly_window = false',
    '[next]', 'enabled = false',
  ].join('\n'), 'diagram_review');
  assert.deepEqual(s, { enabled: true, repos: ['/a/b', '/c d'], glm_triage_cron: '17 5 * * *', gemini_monthly_usd: 12.5, weekly_window: false });
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

// ── discovery ───────────────────────────────────────────────────────────────────────────────

/** A workspace tree: corpora at several depths, a symlink to a corpus, and skipped directories. */
function workspaceTree() {
  const ws = rp(tmp());
  const corpus = (dir, topicName = '01-t.md') => put(ws, `${dir}/docs/diagrams/area/${topicName}`, '# t\n');
  corpus('estate');                       // depth 1
  corpus('co-created/campaignbuilder');   // depth 2, the real directory
  fs.symlinkSync(path.join(ws, 'co-created', 'campaignbuilder'), path.join(ws, 'campaignbuilder'));
  corpus('project/agentbox');             // depth 2, inside a non-corpus repo
  put(ws, 'project/docs/diagrams/README.md', '# only an index: not a corpus\n');
  corpus('a/b/c');                        // depth 3: included
  corpus('a/b/c/d');                      // depth 4: out of range
  corpus('.tmp/hidden'); corpus('node_modules/pkg'); corpus('target/debug'); corpus('.dotdir/repo');
  corpus('noprefix', 'notes.md');         // a topic file must be NN-*.md
  return ws;
}

test('discovery: depth 3, skips .tmp / node_modules / target / dot-directories, one entry per realpath', () => {
  const ws = workspaceTree();
  const found = C.discoverRepos(ws);
  assert.deepEqual(found, [
    path.join(ws, 'a/b/c'), path.join(ws, 'co-created/campaignbuilder'), path.join(ws, 'estate'), path.join(ws, 'project/agentbox'),
  ].sort());
  assert.equal(found.filter((p) => p.endsWith('campaignbuilder')).length, 1, 'the symlink and its target are one repository');
  assert.ok(!found.some((p) => /hidden|pkg|debug|\.dotdir|noprefix|c\/d$/.test(p)));
});

test('discovery: a symlink cycle terminates', () => {
  const ws = rp(tmp());
  put(ws, 'x/docs/diagrams/area/01-t.md', '# t\n');
  fs.symlinkSync(ws, path.join(ws, 'x', 'loop'));
  assert.deepEqual(C.discoverRepos(ws), [path.join(ws, 'x')]);
});

test('resolveRepos: empty manifest list discovers; a non-empty one replaces discovery; the local file adds and excludes', () => {
  const ws = workspaceTree();
  const local = path.join(ws, 'diagram-review.local');
  const extra = rp(tmp()); put(extra, 'docs/diagrams/area/01-t.md', '# t\n');
  const none = path.join(ws, 'absent.local');

  const auto = C.resolveRepos({ ...CFG, repos: [] }, { workspace: ws, localFile: none });
  assert.match(auto.source, /^discovered under /);
  assert.equal(auto.repos.length, 4);

  const manifest = C.resolveRepos({ ...CFG, repos: [path.join(ws, 'estate')] }, { workspace: ws, localFile: none });
  assert.equal(manifest.source, 'manifest');
  assert.deepEqual(manifest.repos, [path.join(ws, 'estate')]);

  fs.writeFileSync(local, `# private corpora\n${extra}\n\n!${path.join(ws, 'a/b/c')}  # not this one\n!${path.join(ws, 'campaignbuilder')}\n/does/not/exist\n`);
  const merged = C.resolveRepos({ ...CFG, repos: [] }, { workspace: ws, localFile: local });
  assert.deepEqual(merged.repos, [path.join(ws, 'estate'), extra, path.join(ws, 'project/agentbox')].sort());
  assert.equal(merged.added, 2);
  assert.equal(merged.excluded, 2, 'an exclusion by symlink path removes the real directory');
});

// ── ledger ──────────────────────────────────────────────────────────────────────────────────

test('ledger is append-only: lines accumulate in order and earlier lines are untouched', () => {
  const { est } = estate();
  C.appendLedger(est, { kind: 'triage', reviewer: 'glm', commit: 'a' });
  const before = fs.readFileSync(C.ledgerPath(est), 'utf8');
  C.appendLedger(est, { kind: 'review', reviewer: 'glm', shard: 'core', pack_sha256: 'x', skipped: 'why' });
  const after = fs.readFileSync(C.ledgerPath(est), 'utf8');
  assert.ok(after.startsWith(before));
  const rows = C.readLedger(est);
  assert.deepEqual(rows.map((r) => r.kind), ['triage', 'review']);
  for (const k of ['ts', 'kind', 'reviewer', 'shard', 'commits', 'pack_sha256', 'tokens', 'est_usd', 'findings', 'skipped']) assert.ok(k in rows[1], k);
  fs.appendFileSync(C.ledgerPath(est), 'not json\n');
  assert.equal(C.readLedger(est).length, 2, 'a torn line is skipped');
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

test('pack hash: unchanged per shard since its last real GLM review; a skipped or failed run does not count', () => {
  const ledger = [
    { kind: 'review', reviewer: 'glm', shard: 'core', pack_sha256: 'aaa', ts: daysAgo(9) },
    { kind: 'review', reviewer: 'glm', shard: 'core', pack_sha256: 'bbb', ts: daysAgo(8), skipped: 'error: boom', error: 'boom' },
    { kind: 'review', reviewer: 'glm', shard: 'edge', pack_sha256: 'ccc', ts: daysAgo(8) },
  ];
  assert.equal(C.packUnchanged(ledger, 'core', 'aaa'), true);
  assert.equal(C.packUnchanged(ledger, 'core', 'bbb'), false);
  assert.equal(C.packUnchanged(ledger, 'core', 'ccc'), false, 'another shard\'s hash is not this shard\'s');
  assert.equal(C.packUnchanged(ledger, 'edge', 'ccc'), true);
  assert.equal(C.packUnchanged([], 'core', 'aaa'), false);
});

// ── sources, repositories and change detection ──────────────────────────────────────────────

test('sources frontmatter: block and inline forms parse, ../ paths are kept as written', () => {
  assert.deepEqual(C.parseSources(topic('X', ['../a/b.rs', 'src/c.rs'])), ['../a/b.rs', 'src/c.rs']);
  assert.deepEqual(C.parseSources('---\nid: X\nsources: [../a/b.rs, "src/c d.rs"]\n---\n'), ['../a/b.rs', 'src/c d.rs']);
  assert.deepEqual(C.parseSources('no frontmatter'), []);
});

test('two spellings of one file (symlinked sibling and real path) are one source in one repository', () => {
  const e = estate();
  const r = C.createResolver();
  const real1 = r.resolve(e.est, '../alpha/src/a.rs');
  const viaLink = r.resolve(e.est, '../alpha-link/src/a.rs');
  assert.deepEqual(real1, { top: e.alpha, rel: 'src/a.rs' });
  assert.deepEqual(viaLink, real1);
  const t = C.loadTopics(e.est).find((x) => x.rel === 'core/01-a.md');
  assert.equal(t.srcs.length, 1, 'counted once');
});

test('a file in a nested repository belongs to the nested repository, not to its parent', () => {
  const e = estate();
  const r = C.createResolver();
  assert.deepEqual(r.resolve(e.est, '../outer/inner/i.rs'), { top: e.inner, rel: 'i.rs' });
  assert.deepEqual(r.resolve(e.est, '../ln/i.rs'), { top: e.inner, rel: 'i.rs' }, 'and so does a symlink into it');
  assert.deepEqual(r.resolve(e.est, '../outer/src/o.rs'), { top: e.outer, rel: 'src/o.rs' });
});

test('a missing sibling and a dangling link are logged skips; a deleted file is still attributed', () => {
  const e = estate();
  const r = C.createResolver();
  assert.match(r.resolve(e.est, '../gone/x.rs').skip, /no git repository/);
  assert.equal(r.resolve(e.est, '../dang/x.rs').skip, 'dangling link');
  assert.equal(r.resolve(e.est, '../dang').skip, 'dangling link');
  assert.deepEqual(r.resolve(e.est, '../alpha/src/removed.rs'), { top: e.alpha, rel: 'src/removed.rs' });
  const topics = C.loadTopics(e.est);
  assert.equal(topics.find((t) => t.rel === 'core/01-a.md').skips.length, 2);
  assert.deepEqual(C.reposOf(topics), [e.alpha, e.beta, e.inner, e.outer].sort());
});

test('change is read from each source repository\'s own history, once per file', () => {
  const e = estate();
  const topics = C.loadTopics(e.est);
  const since = C.headsOf(C.reposOf(topics));
  change(e.alpha, 'src/a.rs', 'fn a() { 1 }\n');
  change(e.inner, 'i.rs', 'fn i() { 2 }\n');           // moves inner's HEAD; outer's HEAD does not move
  const { changed, baseline } = C.changedByRepo(C.reposOf(topics), since);
  assert.deepEqual(baseline, []);
  assert.deepEqual([...changed.get(e.alpha)], ['src/a.rs']);
  assert.deepEqual([...changed.get(e.inner)], ['i.rs']);
  assert.equal(changed.get(e.outer).size, 0, 'the outer repository sees nothing: the change is not a gitlink bump there');
  const cands = C.triageCandidates(topics, changed);
  assert.deepEqual(cands.map((t) => t.rel), ['core/01-a.md', 'edge/01-c.md']);
  assert.equal(cands[0].changedSources.length, 1, 'both spellings of a.rs are one detected change');
  assert.equal(cands[1].changedSources.length, 1);
  assert.equal(cands[1].changedSources[0].top, e.inner);
});

test('a repository with no recorded commit is a baseline, never a flag', () => {
  const e = estate();
  const topics = C.loadTopics(e.est);
  const heads = C.headsOf(C.reposOf(topics));
  delete heads[e.beta];
  change(e.beta, 'src/b.rs', 'fn b() { 3 }\n');
  const { changed, baseline } = C.changedByRepo(C.reposOf(topics), heads);
  assert.deepEqual(baseline, [e.beta]);
  assert.deepEqual(C.triageCandidates(topics, changed), []);
});

// ── sharding ────────────────────────────────────────────────────────────────────────────────

test('shards are per area; an area over the token budget splits in path order; each topic is in exactly one shard', () => {
  const e = estate();
  const big = 'x'.repeat(3300 * 4); // ~4000 tokens each
  for (const n of ['01', '02', '03']) put(e.est, `docs/diagrams/wide/${n}-w.md`, topic(`WD-${n}`, ['../beta/src/b.rs']) + big);
  const whole = C.buildShards(e.est, 1000000);
  assert.deepEqual(whole.map((s) => s.name), ['core', 'edge', 'wide']);
  const split = C.buildShards(e.est, 5000);
  assert.deepEqual(split.map((s) => s.name), ['core', 'edge', 'wide', 'wide#2', 'wide#3']);
  assert.deepEqual(split.filter((s) => s.area === 'wide').map((s) => s.files), [['wide/01-w.md'], ['wide/02-w.md'], ['wide/03-w.md']]);
  const all = split.flatMap((s) => s.files).sort();
  assert.deepEqual(all, [...new Set(all)], 'no topic twice');
  assert.equal(all.length, 6);
  for (const s of split) assert.equal(s.sha, require('node:crypto').createHash('sha256').update(s.pack).digest('hex'));
  assert.deepEqual(C.buildShards(e.est, 5000).map((s) => s.sha), split.map((s) => s.sha), 'hashes are stable');
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

test('triage: the first run baselines every repository and spends nothing; the next flags across repositories and records a commit map', async () => {
  const e = estate();
  const seen = [];
  const post = fakePost((b) => (b.messages[0].content.includes('core/01-a.md') ? 'VERDICT: NO\nREASON: still fine' : 'VERDICT: YES\nREASON: callee changed'), seen);
  assert.deepEqual(await C.triage(e.est, ctxFor({ post })), { skipped: 'baseline recorded', repos: 5 });
  assert.equal(seen.length, 0);
  const first = C.readLedger(e.est).at(-1);
  assert.equal(Object.keys(first.commits).length, 5);
  assert.equal(first.unresolved.count, 2, 'the missing sibling and the dangling link are logged');

  change(e.alpha, 'src/a.rs', 'fn a() { x() }\n');
  change(e.inner, 'i.rs', 'fn i() { y() }\n');
  const res = await C.triage(e.est, ctxFor({ post }));
  assert.equal(res.checked, 2);
  assert.equal(res.flagged, 1);
  const md = fs.readFileSync(path.join(e.est, res.findings), 'utf8');
  assert.match(md, /`edge\/01-c\.md`: callee changed/);
  assert.match(md.split('## Still accurate')[1], /core\/01-a\.md/);
  assert.match(seen[0].url, /\/v1\/messages$/);
  assert.equal(seen[0].headers.authorization, 'Bearer secret-key-value');
  const prompts = seen.map((s) => s.body.messages[0].content).join('\n');
  assert.match(prompts, /fn a\(\) \{ x\(\) \}/, 'the diff comes from alpha\'s history');
  assert.match(prompts, /fn i\(\) \{ y\(\) \}/, 'and from the nested repository\'s history');
  const row = C.readLedger(e.est).at(-1);
  assert.equal(row.commits[e.inner], sh(e.inner, 'rev-parse', 'HEAD'));
  assert.equal(row.commits[e.alpha], sh(e.alpha, 'rev-parse', 'HEAD'));
  assert.equal(row.findings, res.findings);

  const before = seen.length;
  assert.deepEqual(await C.triage(e.est, ctxFor({ post })), { skipped: 'no topic sources changed' });
  assert.equal(seen.length, before);
});

test('triage: unsure means yes — an unparseable reply and a failed call both list the topic', async () => {
  const e = estate();
  await C.triage(e.est, ctxFor({ post: fakePost(() => '') }));
  change(e.alpha, 'src/a.rs', 'fn a() { 9 }\n');
  change(e.beta, 'src/b.rs', 'fn b() { 9 }\n');
  let n = 0;
  const post = async () => { if (n++ === 0) return { status: 200, json: { content: [{ type: 'text', text: 'It depends.' }], usage: {} } }; throw new Error('socket hang up'); };
  const res = await C.triage(e.est, ctxFor({ post }));
  assert.equal(res.flagged, 2);
  assert.match(fs.readFileSync(path.join(e.est, res.findings), 'utf8'), /GLM call failed/);
});

test('triage: a repository that appears after the first run is baselined; the others still flag', async () => {
  const e = estate();
  const post = fakePost(() => 'VERDICT: YES\nREASON: r');
  await C.triage(e.est, ctxFor({ post }));
  const last = C.readLedger(e.est).at(-1);
  delete last.commits[e.beta];
  fs.writeFileSync(C.ledgerPath(e.est), `${JSON.stringify(last)}\n`);
  change(e.beta, 'src/b.rs', 'fn b() { 4 }\n');
  change(e.alpha, 'src/a.rs', 'fn a() { 4 }\n');
  const res = await C.triage(e.est, ctxFor({ post }));
  assert.equal(res.checked, 1);
  assert.match(fs.readFileSync(path.join(e.est, res.findings), 'utf8'), /baselined only: beta/);
});

test('triage: recorded commits that are not in their repositories re-baseline instead of failing', async () => {
  const e = estate();
  C.appendLedger(e.est, { kind: 'triage', reviewer: 'glm', commits: { [e.alpha]: 'f'.repeat(40) } });
  assert.deepEqual((await C.triage(e.est, ctxFor({ post: fakePost(() => 'VERDICT: NO') }))).skipped, 'baseline recorded');
  assert.match(C.readLedger(e.est).at(-1).skipped, /^baseline/);
});

test('review-glm: reviews each shard, records high severity per shard, skips unchanged shards, re-reviews only the edited one', async () => {
  const e = estate();
  const seen = [];
  const reply = () => ['### F-01 — a contradiction', '- Topics: CO-01', '- Evidence: x', '- Failure: y', '- Confidence: high', '- Severity: high', '- Marked by authors: no',
    '', '### F-02 — a smell', '- Topics: CO-02', '- Confidence: low', '- Severity: low', '- Marked by authors: no'].join('\n');
  const post = fakePost(reply, seen);
  const res = await C.reviewGlm(e.est, ctxFor({ post }));
  assert.equal(seen.length, 4, 'two shards x critical and premortem');
  assert.match(seen[0].body.messages[0].content, /=== FILE: core\/01-a\.md ===/);
  assert.doesNotMatch(seen[0].body.messages[0].content, /edge\/01-c\.md/, 'a shard pack holds only its own area');
  assert.match(seen[0].body.messages[0].content, /Severity: high, medium or low/);
  assert.equal(res.shards, 2);
  assert.equal(res.count, 8);
  assert.equal(res.high, 4);
  const rows = C.readLedger(e.est).filter((r) => r.kind === 'review');
  assert.deepEqual(rows.map((r) => r.shard), ['core', 'edge']);
  assert.ok(rows.every((r) => r.high_severity === 2 && r.pack_sha256 && !r.skipped));
  const json = JSON.parse(fs.readFileSync(path.join(e.est, res.findings.replace(/\.md$/, '.json')), 'utf8'));
  assert.ok(json.every((f) => f.status === 'unverified' && f.id.includes(':')));

  assert.deepEqual(await C.reviewGlm(e.est, ctxFor({ post })), { skipped: 'pack unchanged', shards: 2 });
  assert.equal(seen.length, 4, 'no further call');
  assert.equal(C.readLedger(e.est).filter((r) => r.skipped).length, 2, 'one skip line per shard');

  fs.appendFileSync(path.join(e.est, 'docs/diagrams/edge/01-c.md'), '\nmore prose\n');
  const again = await C.reviewGlm(e.est, ctxFor({ post }));
  assert.equal(again.shards, 1);
  assert.equal(again.unchanged, 1);
  assert.equal(seen.length, 6, 'only the edited shard is sent again');
});

test('nightly ticks do not repeat themselves: an identical skip is ledgered once, a changed reason is ledgered again', async () => {
  const e = estate();
  const post = fakePost(() => '### F-01 — t\n- Confidence: low\n- Marked by authors: no');
  await C.reviewGlm(e.est, ctxFor({ post }));
  for (let i = 0; i < 3; i++) await C.reviewGlm(e.est, ctxFor({ post }));
  assert.equal(C.readLedger(e.est).filter((r) => r.kind === 'review' && r.skipped).length, 2, 'one "unchanged" line per shard, not one per night');

  const head = C.headsOf(C.reposOf(C.loadTopics(e.est)));
  for (const shard of ['core', 'edge']) C.appendLedger(e.est, { ts: daysAgo(3), kind: 'audit', reviewer: 'gemini', shard, commits: head, est_usd: 1 });
  process.env.GEMINI_API_KEY = 'gem-secret';
  try {
    for (let i = 0; i < 3; i++) await C.auditGemini(e.est, ctxFor({ runExternal: fakeExternal([]) }));
  } finally { delete process.env.GEMINI_API_KEY; }
  const skips = C.readLedger(e.est).filter((r) => r.kind === 'audit' && r.skipped);
  assert.equal(skips.length, 2, 'one interval refusal per shard across three nights');
  // Once the interval has passed the reason changes ("no cause"), and that is worth a line.
  process.env.GEMINI_API_KEY = 'gem-secret';
  try { await C.auditGemini(e.est, ctxFor({ now: new Date(NOW.getTime() + 8 * 86400000), runExternal: fakeExternal([]) })); } finally { delete process.env.GEMINI_API_KEY; }
  assert.equal(C.readLedger(e.est).filter((r) => r.kind === 'audit' && /^no cause/.test(r.skipped ?? '')).length, 2);
});

test('review-glm: a failing shard is recorded and the others still complete', async () => {
  const e = estate();
  let n = 0;
  const post = async (url, h, body) => {
    if (body.messages[0].content.includes('edge/01-c.md')) throw new Error('glm 500: boom');
    n++;
    return { status: 200, json: { content: [{ type: 'text', text: '### F-01 — t\n- Confidence: low\n- Marked by authors: no' }], usage: {} } };
  };
  await assert.rejects(C.reviewGlm(e.est, ctxFor({ post })), /1 shard\(s\) failed: edge/);
  assert.equal(n, 2);
  const rows = C.readLedger(e.est);
  assert.ok(rows.some((r) => r.shard === 'core' && !r.skipped));
  assert.ok(rows.some((r) => r.shard === 'edge' && r.error));
});

/** Fake external review that writes a plausible manifest; counts what it was asked for. */
function fakeExternal(calls) {
  return async (corpus, out, files) => {
    calls.push(files);
    fs.writeFileSync(path.join(out, 'critical.md'), '### F-01 — t\n- Confidence: high\n');
    fs.writeFileSync(path.join(out, 'premortem.md'), '### R-1 — t\n');
    fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify([{ id: 'critical:F-01', status: 'unverified' }]));
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ model: 'gemini-test', lenses: [
      { name: 'critical', prompt_tokens: 100000, cached_tokens: 0, thinking_tokens: 10000, output_tokens: 2000 },
      { name: 'premortem', prompt_tokens: 100000, cached_tokens: 100000, thinking_tokens: 10000, output_tokens: 2000 }] }));
  };
}
const ACTUAL_ONE_SHARD = (100000 * 0.75 + 12000 * 3.75 + 100000 * 0.075 + 12000 * 3.75) / 1e6; // $0.1725 booked per shard; the pre-flight estimate for one is $0.3075

async function withGemini(fn) {
  process.env.GEMINI_API_KEY = 'gem-secret';
  const real = ER.gemini;
  ER.gemini = async () => ({ totalTokens: 100000 });
  try { return await fn(); } finally { ER.gemini = real; delete process.env.GEMINI_API_KEY; }
}

test('audit-gemini: refusals are per shard, logged with their reason, and never reach the network', async () => {
  const e = estate();
  const calls = [];
  const head = C.headsOf(C.reposOf(C.loadTopics(e.est)));
  for (const shard of ['core', 'edge']) C.appendLedger(e.est, { ts: daysAgo(3), kind: 'audit', reviewer: 'gemini', shard, commits: head, est_usd: 1 });
  process.env.GEMINI_API_KEY = 'gem-secret';
  try {
    const res = await C.auditGemini(e.est, ctxFor({ runExternal: fakeExternal(calls) }));
    assert.equal(res.skipped, 'no shard passed the gate');
  } finally { delete process.env.GEMINI_API_KEY; }
  assert.equal(calls.length, 0);
  const skips = C.readLedger(e.est).filter((r) => r.skipped);
  assert.deepEqual(skips.map((r) => r.shard), ['core', 'edge']);
  assert.ok(skips.every((r) => /^interval/.test(r.skipped) && r.est_usd === 0));
});

test('audit-gemini: without a key it logs one skip and does nothing', async () => {
  const e = estate();
  delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_GEMINI_API_KEY;
  assert.deepEqual(await C.auditGemini(e.est, ctxFor({ runExternal: fakeExternal([]) })), { skipped: 'no GEMINI_API_KEY in the environment' });
  assert.equal(C.readLedger(e.est).at(-1).shard, null);
});

test('audit-gemini: picks the changed shards most-changed first and stops at the budget', async () => {
  const e = estate();
  // 'wide' has more topics than 'core' and 'edge', so with no audit yet it is the most changed.
  for (const n of ['01', '02', '03', '04']) put(e.est, `docs/diagrams/wide/${n}-w.md`, topic(`WD-${n}`, ['../beta/src/b.rs']));
  commitAll(e.est, 'wide');
  const calls = [];
  // Estimate $0.3075, booked $0.1725: after the first shard 0.1725 + 0.3075 > 0.4, so exactly one fits.
  const cfg = { ...CFG, gemini_min_changed_topics: 1, gemini_monthly_usd: 0.4 };
  const res = await withGemini(() => C.auditGemini(e.est, ctxFor({ cfg, runExternal: fakeExternal(calls) })));
  assert.deepEqual(res.shards, ['wide'], 'the most-changed shard went first and used the budget');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['wide/01-w.md', 'wide/02-w.md', 'wide/03-w.md', 'wide/04-w.md'], 'external review was given exactly the shard\'s topics');
  const rows = C.readLedger(e.est);
  const booked = rows.find((r) => r.kind === 'audit' && !r.skipped);
  assert.equal(booked.shard, 'wide');
  assert.ok(Math.abs(booked.est_usd - ACTUAL_ONE_SHARD) < 1e-6);
  assert.ok(booked.commits[e.beta], 'the per-repository commit map is recorded');
  const refused = rows.filter((r) => r.skipped);
  assert.deepEqual(refused.map((r) => r.shard).sort(), ['core', 'edge']);
  assert.ok(refused.every((r) => /^budget/.test(r.skipped)));
  assert.ok(Math.abs(C.monthToDateUsd([rows], NOW) - booked.est_usd) < 1e-9);
  assert.ok(fs.readFileSync(path.join(e.est, res.findings), 'utf8').includes('wide / critical'));
});

test('audit-gemini: after an audit, only shards whose sources changed since qualify; the per-shard interval then blocks the rest', async () => {
  const e = estate();
  const cfg = { ...CFG, gemini_min_changed_topics: 1, gemini_min_interval_days: 7 };
  const calls = [];
  await withGemini(() => C.auditGemini(e.est, ctxFor({ cfg, runExternal: fakeExternal(calls) })));
  assert.equal(calls.length, 2, 'first audit: every shard counts as changed');
  const later = new Date(NOW.getTime() + 8 * 86400000);
  change(e.alpha, 'src/a.rs', 'fn a() { 5 }\n');   // only the core area cites alpha
  calls.length = 0;
  const res = await withGemini(() => C.auditGemini(e.est, ctxFor({ cfg, now: later, runExternal: fakeExternal(calls) })));
  assert.deepEqual(res.shards, ['core']);
  assert.deepEqual(calls[0], ['core/01-a.md', 'core/02-b.md']);
  const row = C.readLedger(e.est).filter((r) => r.skipped).find((r) => r.shard === 'edge' && r.ts === later.toISOString());
  assert.match(row.skipped, /^no cause: 0 topics changed/);
});

test('audit-gemini: a high-severity GLM finding opens a quiet shard once, and only after the last audit', async () => {
  const e = estate();
  const cfg = { ...CFG, gemini_min_changed_topics: 5 };
  const head = C.headsOf(C.reposOf(C.loadTopics(e.est)));
  C.appendLedger(e.est, { ts: daysAgo(10), kind: 'audit', reviewer: 'gemini', shard: 'edge', commits: head, est_usd: 1 });
  C.appendLedger(e.est, { ts: daysAgo(9), kind: 'review', reviewer: 'glm', shard: 'edge', pack_sha256: 'x', high_severity: 2 });
  C.appendLedger(e.est, { ts: daysAgo(10), kind: 'audit', reviewer: 'gemini', shard: 'core', commits: head, est_usd: 1 });
  C.appendLedger(e.est, { ts: daysAgo(9), kind: 'review', reviewer: 'glm', shard: 'core', pack_sha256: 'y', high_severity: 0 });
  const calls = [];
  const res = await withGemini(() => C.auditGemini(e.est, ctxFor({ cfg, runExternal: fakeExternal(calls) })));
  assert.deepEqual(res.shards, ['edge']);
  // The escalation is consumed: a new audit of edge now needs a new reason.
  const later = new Date(NOW.getTime() + 8 * 86400000);
  const again = await withGemini(() => C.auditGemini(e.est, ctxFor({ cfg, now: later, runExternal: fakeExternal(calls) })));
  assert.equal(again.skipped, 'no shard passed the gate');
});

test('audit-gemini: a failed generation is booked at its estimate, because it may have been billed', async () => {
  const e = estate();
  const cfg = { ...CFG, gemini_min_changed_topics: 1 };
  await assert.rejects(withGemini(() => C.auditGemini(e.est, ctxFor({ cfg, runExternal: async () => { throw new Error('timed out after 1800 s'); } }))), /timed out/);
  const rows = C.readLedger(e.est).filter((r) => r.error);
  assert.equal(rows.length, 2, 'each shard that was tried');
  assert.ok(rows.every((r) => r.est_usd > 0 && /^error/.test(r.skipped)));
  assert.ok(C.monthToDateUsd([C.readLedger(e.est)], NOW) > 0.5);
});

test('status prints the resolved repos, ledger lines, overlap with sibling corpora and month-to-date spend', () => {
  const e = estate();
  put(e.alpha, 'docs/diagrams/area/01-t.md', topic('AL-01', ['src/a.rs']));
  commitAll(e.alpha, 'own corpus');
  C.appendLedger(e.est, { ts: daysAgo(2), kind: 'audit', reviewer: 'gemini', shard: 'core', est_usd: 3.1, findings: 'docs/review/x-gemini.md' });
  C.appendLedger(e.est, { ts: daysAgo(1), kind: 'review', reviewer: 'glm', skipped: 'pack unchanged since the last GLM review of this shard' });
  const { text, mtd } = C.statusOf([e.alpha, e.est], NOW, { source: 'discovered under /ws', added: 0, excluded: 0 });
  assert.equal(mtd, 3.1);
  assert.match(text, /^Repos \(discovered under \/ws\): 2\n  .*alpha\n  .*estate\n/);
  assert.match(text, /Gemini spend 2026-10: \$3\.10/);
  assert.match(text, /audit\/gemini: last run .*\(core\).*docs\/review\/x-gemini\.md/);
  assert.match(text, /review\/glm: never run; latest skip: pack unchanged/);
  assert.match(text, /cites 4 other repo\(s\): .*alpha \(has its own corpus, reviewed separately/);
  assert.match(text, /2 cited path\(s\) not attributable: 1 no git repository.*1 dangling link/);
});

test('the GLM key never appears in a ledger line or findings file', async () => {
  const e = estate();
  await C.triage(e.est, ctxFor({ post: fakePost(() => 'VERDICT: NO') }));
  change(e.alpha, 'src/a.rs', 'fn a() { 7 }\n');
  await C.triage(e.est, ctxFor({ post: async () => { throw new Error('glm 401: bad'); } }));
  const all = [fs.readFileSync(C.ledgerPath(e.est), 'utf8'),
    ...fs.readdirSync(path.join(e.est, 'docs/review')).map((f) => fs.readFileSync(path.join(e.est, 'docs/review', f), 'utf8'))].join('\n');
  assert.doesNotMatch(all, /secret-key-value/);
});

test('main: discovers repos with no manifest paths, honours disabled, reports a usage error', async () => {
  const e = estate();
  const manifest = path.join(e.ws, 'm.toml');
  fs.writeFileSync(manifest, '[diagram_review]\nenabled = true\nrepos = []\n');
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(await C.main(['status', '--manifest', manifest, '--workspace', e.ws], { localFile: path.join(e.ws, 'none.local') }), 0);
    assert.match(logs.join('\n'), new RegExp(`Repos \\(discovered under ${e.ws.replace(/[/.]/g, '\\$&')}\\): 1\\n  ${e.est.replace(/[/.]/g, '\\$&')}`));
    logs.length = 0;
    fs.writeFileSync(manifest, '[diagram_review]\nenabled = false\n');
    assert.equal(await C.main(['triage', '--manifest', manifest, '--workspace', e.ws], { localFile: path.join(e.ws, 'none.local') }), 0);
    assert.match(logs.join('\n'), /enabled is false/);
  } finally { console.log = realLog; }
  await assert.rejects(C.main(['bogus']), /usage:/);
});
