'use strict';

/**
 * ADR-2091 contract — the live skill router.
 *
 * Exercises the ACTUAL hook and the /route CLI as subprocesses against a local
 * fake judge on 127.0.0.1, so nothing leaves the machine and every outcome is
 * forced deliberately. The contract under test:
 *
 *   • off by default: no AGENTBOX_SKILL_ROUTER=jev ⇒ no request, no injection;
 *   • fail-open: timeout, unreachable judge, 429/529, 5xx, malformed body and
 *     a `none` pick all produce NO stdout (the harness's "continue");
 *   • a routed pick is injected with its probability and runners-up, in the only
 *     shape Claude Code honours: {hookSpecificOutput:{hookEventName:
 *     "UserPromptSubmit", additionalContext}} — a top-level additionalContext is
 *     silently ignored by the harness, which is how this hook injected nothing;
 *   • [skills.routing].scope decides the hook's baked candidates (ADR-2192): "all"
 *     is the whole routable tree, anything else the registered set; one skill
 *     reachable under two qualified names is offered once;
 *   • under scope "registered" the hook ranks only skills/registered-skills.txt (fail-open to the whole
 *     tree when the manifest is unreadable or disjoint); /route ranks everything
 *     and marks unregistered picks; the injected line stays ≤ 300 chars;
 *   • the candidate map composes ADR-2089 `status` at the point of use —
 *     deprecated/superseded/not-installed/router-only skills are never
 *     offered, gated ones carry their note, and `none` is always present;
 *   • the log line carries lengths, picks and cost but never the prompt;
 *   • the CLI degrades to "router: table" with the reason, exit 0;
 *   • the local cascade (ADR-2095 addendum) is off by default; when on, a
 *     confident BM25 pick is injected with no judge call and the rest escalate;
 *   • E076 / W074 guard the cascade values and the openjev latency budget.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const HOOK = path.resolve(__dirname, '../../config/hooks/skill-route.cjs');
const CLI = path.resolve(__dirname, '../../skills/skill-router/scripts/route.mjs');
const lib = require(path.resolve(__dirname, '../../config/hooks/lib/skill-route.cjs'));

const SECRET_PROMPT = 'Please route this: the password=hunter2-for-the-router-test must never be logged';

let tmp, skillsDir, logPath, manifestPath, server, port, behaviour, seen;

function mkSkill(name, frontmatter, body = '# x\n') {
  fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, name, 'SKILL.md'), `---\nname: ${name}\n${frontmatter}\n---\n${body}`);
}

beforeAll((done) => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-route-'));
  skillsDir = path.join(tmp, 'skills');
  logPath = path.join(tmp, 'route.jsonl');
  manifestPath = path.join(tmp, 'registered-skills.txt');
  fs.writeFileSync(manifestPath, '# test manifest\nalpha-diagrams\nbeta-harden\n\ngamma-gated  # gated\n');
  mkSkill('alpha-diagrams', 'description: "Draw architecture diagrams as code. Use when asked for diagrams."');
  mkSkill('beta-harden', 'description: >-\n  Harden Linux servers for compliance.\n  Use for SOC2 hardening.');
  mkSkill('gamma-gated', 'status: gated\ndescription: "A gated skill. Use when its gate is on."');
  mkSkill('old-deprecated', 'status: deprecated\nreplacement: alpha-diagrams\ndescription: "Old thing."');
  mkSkill('old-superseded', 'status: superseded\nreplacement: beta-harden\ndescription: "Older thing."');
  mkSkill('not-here', 'status: not-installed\ndescription: "Needs install."');
  mkSkill('skill-router', 'status: router-only\ndescription: "Routes."');
  mkSkill('legacy-stub', 'deprecated: true\nreplacement: alpha-diagrams\ndescription: "Legacy stub."');
  fs.mkdirSync(path.join(skillsDir, 'not-a-skill'));

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(body) });
      const b = behaviour;
      if (b.hang) return; // never answers — exercises the timeout
      if (b.status) { res.writeHead(b.status); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(b.headers || {}) });
      res.end(typeof b.reply === 'string' ? b.reply : JSON.stringify(b.reply));
    });
  });
  server.listen(0, '127.0.0.1', () => { port = server.address().port; done(); });
});

afterAll((done) => { server.close(() => done()); fs.rmSync(tmp, { recursive: true, force: true }); });

beforeEach(() => {
  seen = [];
  behaviour = { reply: answer('alpha-diagrams', { 'alpha-diagrams': 0.9, 'beta-harden': 0.07, none: 0.03 }, 0.91) };
  try { fs.unlinkSync(logPath); } catch {}
});

function answer(choice, probabilities, confidence) {
  return { model: 'jev-1.13.0', answers: { skill: { choice, probabilities, confidence } },
    usage: { input_tokens: 1500, output_tokens: 20 } };
}

function baseEnv(extra = {}) {
  return {
    PATH: process.env.PATH, HOME: tmp,
    AGENTBOX_SKILL_ROUTER: 'jev',
    AGENTBOX_SKILL_ROUTE_API: `http://127.0.0.1:${port}/v1/systemone`,
    AGENTBOX_SKILL_ROUTE_SKILLS_DIR: skillsDir,
    AGENTBOX_SKILL_ROUTE_LOG: logPath,
    AGENTBOX_SKILL_ROUTE_TIMEOUT_MS: '600',
    AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: manifestPath,
    TYPESAFE_API_KEY: 'test-key-not-real',
    ...extra,
  };
}

// Async on purpose: the fake judge lives in THIS process, so a spawnSync here
// would block the event loop and the hook could never be answered.
function run(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { env });
    let out = '', err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

/**
 * The injected context, or null when the hook wrote nothing. Any stdout must be
 * exactly the shape Claude Code honours — nothing else at the top level.
 */
async function runHook(prompt, env) {
  const r = await run([HOOK], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }));
  expect(r.code).toBe(0);
  if (!r.out.trim()) return null;
  const j = JSON.parse(r.out.trim());
  expect(Object.keys(j)).toEqual(['hookSpecificOutput']);
  expect(Object.keys(j.hookSpecificOutput).sort()).toEqual(['additionalContext', 'hookEventName']);
  expect(j.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  expect(typeof j.hookSpecificOutput.additionalContext).toBe('string');
  return j.hookSpecificOutput.additionalContext;
}

async function runCli(args, env) {
  const r = await run([CLI, ...args], env);
  expect(r.code).toBe(0);
  return r.out;
}

function logLines() {
  try { return fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; }
}

const PROMPT = 'Draw the architecture of this service as diagrams checked into the repo please';

describe('candidate map (ADR-2089 status composed at the point of use)', () => {
  test('excludes never-routable statuses and legacy stubs, annotates gated, folds block scalars', async () => {
    const c = lib.loadCandidates(skillsDir);
    expect(Object.keys(c).sort()).toEqual(['alpha-diagrams', 'beta-harden', 'gamma-gated']);
    expect(c['beta-harden']).toBe('Harden Linux servers for compliance. Use for SOC2 hardening.');
    expect(c['gamma-gated']).toMatch(/^GATED OFF by default/);
  });

  test('a missing skills tree yields no candidates and a skip, not a throw', async () => {
    const cfg = lib.config(baseEnv({ AGENTBOX_SKILL_ROUTE_SKILLS_DIR: path.join(tmp, 'nope') }));
    const r = await lib.route(PROMPT, cfg);
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'no-candidates' });
    expect(seen).toHaveLength(0);
  });
});

describe('hook — off by default', () => {
  test('no AGENTBOX_SKILL_ROUTER ⇒ continue, no request, no log', async () => {
    const env = baseEnv(); delete env.AGENTBOX_SKILL_ROUTER;
    expect(await runHook(PROMPT, env)).toBeNull();
    expect(seen).toHaveLength(0);
    expect(logLines().map((l) => l.reason)).toEqual(['router-off']);
  });

  test('router=table ⇒ continue, no request', async () => {
    expect(await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTER: 'table' }))).toBeNull();
    expect(seen).toHaveLength(0);
  });

  test('no TYPESAFE_API_KEY ⇒ continue, no request', async () => {
    const env = baseEnv(); delete env.TYPESAFE_API_KEY;
    expect(await runHook(PROMPT, env)).toBeNull();
    expect(seen).toHaveLength(0);
    expect(logLines()[0].reason).toBe('no-key');
  });

  test('ADR-2139: behind the proxy no key is needed and none is sent', async () => {
    const env = baseEnv({ AGENTBOX_SYSTEM_ONE_PROXY: '1' }); delete env.TYPESAFE_API_KEY;
    const out = await runHook(PROMPT, env);
    expect(out).not.toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  test('proxy request pricing follows a live change, including a free local backend', async () => {
    const env = baseEnv({ AGENTBOX_SYSTEM_ONE_PROXY: '1' });
    for (const rate of [0.05, 0]) {
      behaviour.headers = { 'x-system-one-usd-per-mtok-in': String(rate) };
      await runHook(PROMPT, env);
      const record = logLines().at(-1);
      expect(record.usd_per_mtok_in).toBe(rate);
      expect(record.usd).toBe(1500 * rate / 1e6);
    }
  });

  test('direct vendors cannot override the configured rate through a proxy header', async () => {
    behaviour.headers = { 'x-system-one-usd-per-mtok-in': '0' };
    await runHook(PROMPT, baseEnv());
    expect(logLines()[0].usd_per_mtok_in).toBe(0.042);
  });

  test.each(['invalid', '-1'])('invalid proxy rate %s keeps the declared rate', async (rate) => {
    behaviour.headers = { 'x-system-one-usd-per-mtok-in': rate };
    await runHook(PROMPT, baseEnv({ AGENTBOX_SYSTEM_ONE_PROXY: '1' }));
    expect(logLines()[0].usd_per_mtok_in).toBe(0.042);
  });

  test('short turns and slash commands are never sent', async () => {
    expect(await runHook('thanks', baseEnv())).toBeNull();
    expect(await runHook('/route fix the login bug', baseEnv())).toBeNull();
    expect(seen).toHaveLength(0);
    expect(logLines().map((l) => l.reason)).toEqual(['short-prompt', 'slash-command']);
  });
});

describe('hook — routed', () => {
  test('injects the pick, probability and runners-up; sends one Choice with `none` present', async () => {
    const out = await runHook(PROMPT, baseEnv());
    expect(out).toBe('[route] alpha-diagrams 0.90 · beta-harden 0.07 — advisory; load a skill only if it fits this turn.');
    // Paid for on every routed turn: keep it short.
    expect(out.length).toBeLessThan(160);
    expect(seen).toHaveLength(1);
    const q = seen[0].body;
    expect(seen[0].headers.authorization).toBe('Bearer test-key-not-real');
    expect(q.state.user_request).toBe(PROMPT);
    expect(q.model).toBe('jev-latest');
    expect(q.questions.skill.type).toBe('choice');
    expect(Object.keys(q.questions.skill.criteria).sort()).toEqual(['alpha-diagrams', 'beta-harden', 'gamma-gated', 'none']);
    const log = logLines()[0];
    expect(log).toMatchObject({ consumer: 'hook', outcome: 'routed', choice: 'alpha-diagrams', confidence: 0.91, candidates: 3, input_tokens: 1500 });
    expect(log.usd).toBeCloseTo(1500 * 0.042 / 1e6, 12);
  });

  test('a pick the Skill tool cannot invoke carries its SKILL.md path; a registered one does not', async () => {
    // The judge ranks the whole baked tree; ~/.claude/skills holds only the registered set.
    const registered = path.join(tmp, 'registered');
    fs.mkdirSync(path.join(registered, 'beta-harden'), { recursive: true });
    const out = await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_DIR: registered }));
    expect(out).toBe(
      '[route] alpha-diagrams 0.90 · beta-harden 0.07 — advisory; load a skill only if it fits this turn.' +
      ` Not in the Skill tool; Read its SKILL.md instead: alpha-diagrams → ${path.join(skillsDir, 'alpha-diagrams', 'SKILL.md')}`);
    fs.mkdirSync(path.join(registered, 'alpha-diagrams'));
    const all = await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_DIR: registered }));
    expect(all).toBe('[route] alpha-diagrams 0.90 · beta-harden 0.07 — advisory; load a skill only if it fits this turn.');
    fs.rmSync(registered, { recursive: true, force: true });
  });

  test('no readable registered dir ⇒ the line is unchanged (nothing to compare against)', () => {
    const r = { outcome: 'routed', none: false, choice: 'alpha-diagrams', ranked: [['alpha-diagrams', 0.9]] };
    const cfg = { skillsDir, registeredDir: path.join(tmp, 'absent') };
    expect(lib.formatContext(r, cfg)).toBe(lib.formatContext(r));
    expect(lib.unregisteredPaths(['alpha-diagrams'], cfg)).toEqual([]);
  });

  test('a `none` pick injects nothing but is logged as routed', async () => {
    behaviour = { reply: answer('none', { none: 0.97, 'alpha-diagrams': 0.03 }, 0.97) };
    expect(await runHook('ok go ahead with that plan, ping me when it is done', baseEnv())).toBeNull();
    expect(logLines()[0]).toMatchObject({ outcome: 'routed', choice: 'none' });
  });

  test('the log never carries the prompt, and the manifest model is honoured', async () => {
    await runHook(SECRET_PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_MODEL: 'jev-1.13.0' }));
    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw).not.toMatch(/hunter2/);
    expect(raw).not.toMatch(/password/);
    expect(seen[0].body.model).toBe('jev-1.13.0');
    expect(logLines()[0].chars).toBe(SECRET_PROMPT.length);
  });

  test('a pasted-document turn is clamped head+tail inside the judge budget', async () => {
    const big = 'x'.repeat(20000) + ' END-MARKER';
    await runHook(big, baseEnv());
    const sent = seen[0].body.state.user_request;
    expect(sent.length).toBeLessThan(13000);
    expect(sent).toMatch(/chars elided/);
    expect(sent.endsWith('END-MARKER')).toBe(true);
    expect(logLines()[0].truncated).toBe(true);
  });
});

describe('hook — registered candidate set (skills/registered-skills.txt)', () => {
  const criteriaSent = () => Object.keys(seen[0].body.questions.skill.criteria).sort();

  test('the hook ranks only registered skills and logs the scope', async () => {
    const m = path.join(tmp, 'narrow.txt');
    fs.writeFileSync(m, 'alpha-diagrams\nbeta-harden\nnot-baked-anywhere\n');
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m }));
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'beta-harden', 'none']);
    expect(logLines()[0]).toMatchObject({ outcome: 'routed', candidates: 2, scope: 'registered' });
    expect(logLines()[0].scope_reason).toBeUndefined();
  });

  test('a registered name whose status excludes it is still excluded', async () => {
    const m = path.join(tmp, 'with-excluded.txt');
    fs.writeFileSync(m, 'alpha-diagrams\nold-deprecated\nskill-router\n');
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m }));
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'none']);
  });

  test.each([
    ['unreadable', () => path.join(tmp, 'absent-manifest.txt'), 'manifest-unreadable'],
    ['disabled with 0', () => '0', 'manifest-unreadable'],
    ['disjoint from the tree', () => { const m = path.join(tmp, 'disjoint.txt'); fs.writeFileSync(m, 'zeta\n'); return m; }, 'manifest-disjoint'],
  ])('a manifest that is %s fails open to the whole tree, labelled', async (_n, mk, reason) => {
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: mk() }));
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'beta-harden', 'gamma-gated', 'none']);
    expect(logLines()[0]).toMatchObject({ scope: 'all', scope_reason: reason });
  });

  test('without an override the manifest is found relative to the library (repo checkout)', () => {
    const cfg = lib.config({ HOME: tmp });
    const set = lib.readRegisteredManifest(cfg.registeredManifests);
    expect(set).not.toBeNull();
    expect(set.has('skill-router')).toBe(true);
    expect(cfg.registeredManifests[0]).toBe(path.resolve(__dirname, '../../skills/registered-skills.txt'));
  });

  test('/route still ranks the whole tree and marks unregistered picks', async () => {
    const m = path.join(tmp, 'cli-narrow.txt');
    fs.writeFileSync(m, 'beta-harden\n');
    // Pin the checkout's library: route.mjs prefers the baked copy, which may predate this.
    const out = await runCli([PROMPT], baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m,
      AGENTBOX_HOOKS_DIR: path.resolve(__dirname, '../../config/hooks') }));
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'beta-harden', 'gamma-gated', 'none']);
    expect(out).toMatch(/1\. alpha-diagrams\s+0\.90 {2}\(unregistered\)/);
    expect(out).toMatch(/2\. beta-harden\s+0\.07\n/);
    expect(logLines()[0].scope).toBeUndefined();
  });

  test('the injected line never exceeds 300 chars, however many SKILL.md paths it could name', () => {
    // Long enough that one path fits under the ceiling and a second does not.
    const deep = path.join(tmp, 'x'.repeat(20));
    const names = ['alpha-diagrams', 'beta-harden', 'gamma-gated'];
    for (const n of names) {
      fs.mkdirSync(path.join(deep, n), { recursive: true });
      fs.writeFileSync(path.join(deep, n, 'SKILL.md'), 'x');
    }
    const r = { outcome: 'routed', none: false, choice: names[0], ranked: names.map((n, i) => [n, 0.5 - i / 10]) };
    const cfg = { skillsDir: deep, registeredDir: path.join(tmp, 'empty-registered') };
    fs.mkdirSync(cfg.registeredDir, { recursive: true });
    const ctx = lib.formatContext(r, cfg);
    expect(ctx.length).toBeLessThanOrEqual(lib.MAX_CONTEXT_CHARS);
    expect(ctx).toMatch(/^\[route\] alpha-diagrams 0\.50/);
    expect(ctx).toContain(`alpha-diagrams → ${path.join(deep, 'alpha-diagrams', 'SKILL.md')}`);
    expect(ctx).not.toContain('gamma-gated →');
    fs.rmSync(deep, { recursive: true, force: true });
  });
});

describe('hook — synced account and enabled plugin skills', () => {
  const criteriaSent = () => Object.keys(seen[0].body.questions.skill.criteria).sort();
  let claudeDir;

  beforeAll(() => {
    claudeDir = path.join(tmp, 'claude-home');
    const sync = path.join(claudeDir, 'skills', 'synced', 'acct_1');
    const put = (dir, fm) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm}\n---\n# x\n`); };
    put(path.join(sync, 'pdf'), 'name: pdf\ndescription: "Read and write PDF files."');
    put(path.join(sync, 'gone-stale'), 'name: gone-stale\nstatus: deprecated\ndescription: "Old."');
    fs.writeFileSync(path.join(sync, 'manifest.json'), JSON.stringify({ skills: [
      { name: 'pdf', description: 'manifest copy' }, { name: 'gone-stale' }, { name: 'not-on-disk', description: 'x' },
    ] }));
    const on = path.join(tmp, 'plugins', 'maker');
    const off = path.join(tmp, 'plugins', 'dormant');
    put(path.join(on, 'skills', 'maker'), 'name: maker\ndescription: "Make new skills."');
    put(path.join(off, 'skills', 'sleepy'), 'name: sleepy\ndescription: "Never offered."');
    fs.mkdirSync(path.join(claudeDir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
      'maker@market': [{ installPath: on }], 'dormant@market': [{ installPath: off }],
    } }));
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
      enabledPlugins: { 'maker@market': true, 'dormant@market': false } }));
  });

  test('the hook adds them under the Skill tool\'s qualified names and logs the count', async () => {
    const m = path.join(tmp, 'extras-narrow.txt');
    fs.writeFileSync(m, 'alpha-diagrams\n');
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m, AGENTBOX_SKILL_ROUTE_CLAUDE_DIR: claudeDir }));
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'anthropic-skills:pdf', 'maker:maker', 'none']);
    expect(seen[0].body.questions.skill.criteria['anthropic-skills:pdf']).toBe('Read and write PDF files.');
    expect(logLines()[0]).toMatchObject({ candidates: 3, scope: 'registered', extras: 2 });
  });

  test('disabled with 0, nothing is added and the log line is unchanged', async () => {
    const m = path.join(tmp, 'extras-off.txt');
    fs.writeFileSync(m, 'alpha-diagrams\n');
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m, AGENTBOX_SKILL_ROUTE_CLAUDE_DIR: '0' }));
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'none']);
    expect(logLines()[0].extras).toBeUndefined();
  });

  test('an explicit candidate map is left exactly as given', async () => {
    const cfg = lib.config({ ...baseEnv({ AGENTBOX_SKILL_ROUTE_CLAUDE_DIR: claudeDir }) });
    await lib.route(PROMPT, cfg, { candidates: { 'alpha-diagrams': 'a', 'beta-harden': 'b' } });
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'beta-harden', 'none']);
  });

  test('a missing claude dir contributes nothing', () => {
    expect(lib.loadLoadableExtras(path.join(tmp, 'nowhere'))).toEqual({});
  });
});

describe('hook — candidate scope (ADR-2192)', () => {
  const criteriaSent = () => Object.keys(seen[0].body.questions.skill.criteria).sort();

  test('scope "all" offers the whole routable tree and logs the scope without a reason', async () => {
    const m = path.join(tmp, 'scope-narrow.txt');
    fs.writeFileSync(m, 'beta-harden\n');
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m, AGENTBOX_SKILL_ROUTE_SCOPE: 'all' }));
    // Status still applies: deprecated, superseded, not-installed and router-only stay out.
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'beta-harden', 'gamma-gated', 'none']);
    expect(logLines()[0]).toMatchObject({ outcome: 'routed', candidates: 3, scope: 'all' });
    expect(logLines()[0].scope_reason).toBeUndefined();
  });

  test('under "all" a pick outside the Skill tool is injected with its SKILL.md path', async () => {
    const registered = path.join(tmp, 'scope-registered');
    fs.mkdirSync(path.join(registered, 'beta-harden'), { recursive: true });
    const ctx = await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_SCOPE: 'all', AGENTBOX_SKILL_ROUTE_REGISTERED_DIR: registered }));
    expect(ctx).toContain(`alpha-diagrams → ${path.join(skillsDir, 'alpha-diagrams', 'SKILL.md')}`);
    expect(ctx).not.toContain('beta-harden →');
    expect(ctx.length).toBeLessThanOrEqual(lib.MAX_CONTEXT_CHARS);
    fs.rmSync(registered, { recursive: true, force: true });
  });

  test('unset, "registered" and an unrecognised value all mean the registered set', async () => {
    expect(lib.config({}).scope).toBe('registered');
    expect(lib.config({ AGENTBOX_SKILL_ROUTE_SCOPE: 'registered' }).scope).toBe('registered');
    expect(lib.config({ AGENTBOX_SKILL_ROUTE_SCOPE: 'everything' }).scope).toBe('registered');
    expect(lib.config({ AGENTBOX_SKILL_ROUTE_SCOPE: 'ALL' }).scope).toBe('all');
    const m = path.join(tmp, 'scope-typo.txt');
    fs.writeFileSync(m, 'beta-harden\n');
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m, AGENTBOX_SKILL_ROUTE_SCOPE: 'everything' }));
    expect(criteriaSent()).toEqual(['beta-harden', 'none']);
  });

  test('the unbooted-shell fallback reads scope from the manifest', () => {
    const toml = path.join(tmp, 'scope.toml');
    fs.writeFileSync(toml, '[skills.routing]\nrouter = "jev"\nscope = "all"\n');
    expect(lib.config({}, { fallbackToml: toml }).scope).toBe('all');
  });

  test('entrypoint projects the scope only when it is "all" (byte-identical otherwise)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../config/entrypoint-unified.sh'), 'utf8');
    expect(src).toMatch(/_SR_SCOPE_EXPORT=""\n\[ "\$_SR_SCOPE" = "all" \] && _SR_SCOPE_EXPORT="export AGENTBOX_SKILL_ROUTE_SCOPE=all"/);
    expect(src).toMatch(/process\.env\.SR_SCOPE === 'all' \? ' AGENTBOX_SKILL_ROUTE_SCOPE=all' : ''/);
    expect(src).toMatch(/SR_SCOPE="\$_SR_SCOPE" node <<'SRJS'/);
    expect(src).toMatch(/^\$_SR_SCOPE_EXPORT$/m);
  });
});

describe('hook — one skill is offered once (ADR-2192)', () => {
  const criteriaSent = () => Object.keys(seen[0].body.questions.skill.criteria).sort();
  let claudeDir;
  const RUBRIC = 'Create new skills and improve existing skills. Use when asked to make a skill.';

  beforeAll(() => {
    claudeDir = path.join(tmp, 'claude-home-dup');
    const sync = path.join(claudeDir, 'skills', 'synced', 'acct_1');
    const put = (dir, fm) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm}\n---\n# x\n`); };
    // The same skill twice: synced from the account and installed as a plugin. Whitespace differs.
    put(path.join(sync, 'skill-maker'), `name: skill-maker\ndescription: "${RUBRIC}"`);
    put(path.join(sync, 'report'), 'name: report\ndescription: "Write a report from the account."');
    put(path.join(sync, 'alpha-diagrams'), 'name: alpha-diagrams\ndescription: "Draw architecture diagrams as code. Use when asked for diagrams."');
    fs.writeFileSync(path.join(sync, 'manifest.json'), JSON.stringify({ skills: [{ name: 'skill-maker' }, { name: 'report' }, { name: 'alpha-diagrams' }] }));
    const plug = path.join(tmp, 'plugins-dup', 'skill-maker');
    put(path.join(plug, 'skills', 'skill-maker'), `name: skill-maker\ndescription: >-\n  Create new skills and improve existing skills.\n  Use when asked to make a skill.`);
    // Same bare name as the synced `report`, different rubric: two skills, both stay.
    put(path.join(plug, 'skills', 'report'), 'name: report\ndescription: "Write a report from the plugin."');
    fs.mkdirSync(path.join(claudeDir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'skill-maker@market': [{ installPath: plug }] } }));
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'skill-maker@market': true } }));
  });

  test('a plugin skill also synced from the account is offered once, as the plugin copy', async () => {
    const m = path.join(tmp, 'dup-narrow.txt');
    fs.writeFileSync(m, 'alpha-diagrams\n');
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_REGISTERED_MANIFEST: m, AGENTBOX_SKILL_ROUTE_CLAUDE_DIR: claudeDir }));
    expect(criteriaSent()).toEqual(['alpha-diagrams', 'anthropic-skills:report', 'none', 'skill-maker:report', 'skill-maker:skill-maker']);
    // Two dropped: the synced copy of the plugin skill, and the synced copy of a baked one.
    expect(logLines()[0]).toMatchObject({ candidates: 4, extras: 3, deduped: 2 });
  });

  test('the verify shortlist no longer spends two of its slots on one skill', () => {
    const extras = lib.loadLoadableExtras(claudeDir);
    const baked = { 'alpha-diagrams': 'Draw architecture diagrams as code. Use when asked for diagrams.' };
    const text = 'create a new skill and improve the existing skills';
    const before = lib.shortlist(text, { ...baked, ...extras }, 3);
    expect(before.filter((n) => n.endsWith(':skill-maker'))).toHaveLength(2);
    const { extras: kept, dropped } = lib.dedupeExtras(baked, extras);
    expect(dropped.sort()).toEqual(['anthropic-skills:alpha-diagrams', 'anthropic-skills:skill-maker']);
    const after = lib.shortlist(text, { ...baked, ...kept }, 3);
    expect(after.filter((n) => n.endsWith(':skill-maker'))).toEqual(['skill-maker:skill-maker']);
  });

  test('nothing duplicated means nothing dropped and no log field', async () => {
    expect(lib.dedupeExtras({ a: 'one' }, { 'p:b': 'two', 'anthropic-skills:c': 'three' })).toEqual({ extras: { 'p:b': 'two', 'anthropic-skills:c': 'three' }, dropped: [] });
    await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_CLAUDE_DIR: '0' }));
    expect(logLines()[0].deduped).toBeUndefined();
  });
});

describe('hook — local cascade (ADR-2095 addendum; gated off by default)', () => {
  // Matches no rubric token at all: every BM25 score is 0, margin 0, so it must escalate.
  const VAGUE = 'please could you look into the thing we talked about yesterday afternoon';
  const on = (extra = {}) => baseEnv({ AGENTBOX_SKILL_ROUTE_CASCADE: '1', ...extra });

  test('off by default: config says so and the judge is asked as before', async () => {
    expect(lib.config(baseEnv()).cascade).toBe(false);
    await runHook(PROMPT, baseEnv());
    expect(seen).toHaveLength(1);
    expect(logLines()[0].cascade).toBeUndefined();
  });

  test('a confident local pick is injected without calling the judge', async () => {
    const out = await runHook(PROMPT, on());
    expect(out).toBe('[route] alpha-diagrams — advisory; load a skill only if it fits this turn.');
    expect(seen).toHaveLength(0);
    expect(logLines()[0]).toMatchObject({ outcome: 'routed', model: 'local-bm25', choice: 'alpha-diagrams', cascade: 'local', usd: 0 });
    expect(logLines()[0].margin).toBeGreaterThanOrEqual(lib.DEFAULT_CASCADE_CUTOFF);
  });

  test('a low-margin turn escalates to the judge and is logged as escalated', async () => {
    const out = await runHook(VAGUE, on());
    expect(seen).toHaveLength(1);
    expect(out).toMatch(/^\[route\] alpha-diagrams 0\.90/);
    expect(logLines()[0]).toMatchObject({ outcome: 'routed', cascade: 'escalated', margin: 0 });
  });

  test('the cutoff is honoured: at 1.01 nothing is confident enough, so everything escalates', async () => {
    await runHook(PROMPT, on({ AGENTBOX_SKILL_ROUTE_CASCADE_CUTOFF: '1.01' }));
    expect(seen).toHaveLength(1);
    expect(logLines()[0].cascade).toBe('escalated');
  });

  test('no key: a local pick still routes; an escalation skips as no-key, still without a request', async () => {
    const env = on(); delete env.TYPESAFE_API_KEY;
    expect(await runHook(PROMPT, env)).toMatch(/^\[route\] alpha-diagrams/);
    expect(await runHook(VAGUE, env)).toBeNull();
    expect(seen).toHaveLength(0);
    expect(logLines().map((l) => l.reason || l.cascade)).toEqual(['local', 'no-key']);
  });

  test('the prompt never reaches the log on either path', async () => {
    await runHook(SECRET_PROMPT, on());
    expect(fs.readFileSync(logPath, 'utf8')).not.toMatch(/hunter2/);
  });
});

describe('hook — EXP-B8 shadow copy-ceiling arm (ADR-2110 label_log only)', () => {
  const on = (extra = {}) => baseEnv({ AGENTBOX_SKILL_ROUTE_LABEL_LOG: '1', ...extra });

  test('off by default: no bm25 field on the log line', async () => {
    await runHook(PROMPT, baseEnv());
    const l = logLines()[0];
    expect(l.bm25_pick).toBeUndefined();
    expect(l.bm25_score).toBeUndefined();
  });

  test('with label_log on, the judge still decides and the BM25 pick rides along unshown', async () => {
    const out = await runHook(PROMPT, on());
    expect(seen).toHaveLength(1);
    expect(out).toMatch(/^\[route\] alpha-diagrams 0\.90/);
    expect(out).not.toMatch(/bm25/i);
    const l = logLines()[0];
    expect(l).toMatchObject({ outcome: 'routed', choice: 'alpha-diagrams', bm25_pick: 'alpha-diagrams' });
    expect(l.bm25_score).toBeGreaterThan(0);
  });

  test('a turn with no lexical overlap records score 0 (the decline rule reads it as none)', async () => {
    await runHook('please could you look into the thing we talked about yesterday afternoon', on());
    expect(logLines()[0].bm25_score).toBe(0);
  });

  test('the shadow is recorded on a failed judge call too, and never the prompt', async () => {
    behaviour = { status: 529 };
    await runHook(SECRET_PROMPT, on());
    const l = logLines()[0];
    expect(l.outcome).toBe('failed');
    expect(typeof l.bm25_pick).toBe('string');
    expect(fs.readFileSync(logPath, 'utf8')).not.toMatch(/hunter2/);
  });

  test('localRank reports the top raw score beside the margin', () => {
    const r = lib.localRank('diagrams of the architecture', { a: 'architecture diagrams as code', b: 'harden servers' });
    expect(r.choice).toBe('a');
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('hook — fail-open (ADR-2090: the table is the normal path, not an error branch)', () => {
  const cases = [
    ['timeout', () => ({ hang: true }), 'timeout'],
    ['429', () => ({ status: 429 }), 'http-429'],
    ['529', () => ({ status: 529 }), 'http-529'],
    ['500', () => ({ status: 500 }), 'http-500'],
    ['malformed JSON', () => ({ reply: '{not json' }), 'bad-json'],
    ['wrong shape', () => ({ reply: { answers: {} } }), 'bad-shape'],
  ];
  for (const [name, mk, reason] of cases) {
    test(`${name} ⇒ continue with no injection, logged as failed:${reason}`, async () => {
      behaviour = mk();
      const t0 = Date.now();
      expect(await runHook(PROMPT, baseEnv())).toBeNull();
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(logLines()[0]).toMatchObject({ outcome: 'failed', reason });
    });
  }

  test('unreachable judge ⇒ continue', async () => {
    expect(await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_API: 'http://127.0.0.1:1/v1/systemone' }))).toBeNull();
    expect(logLines()[0]).toMatchObject({ outcome: 'failed', reason: 'network' });
  });

  test('the hook never retries — one turn, at most one request', async () => {
    behaviour = { status: 429 };
    await runHook(PROMPT, baseEnv());
    expect(seen).toHaveLength(1);
  });
});

describe('hook — per-project bypass (ADR-2090; [skills.routing].bypass_projects)', () => {
  let proj, sibling, link;
  beforeAll(() => {
    proj = path.join(tmp, 'secret-proj');
    sibling = path.join(tmp, 'secret-proj2');
    link = path.join(tmp, 'secret-link');
    fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
    fs.mkdirSync(sibling);
    fs.symlinkSync(proj, link);
  });
  const hookAt = (cwd, env) => run([HOOK], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: PROMPT, cwd }));

  test('a bypassed project, its subdirectory and a symlink to it send nothing to the judge', async () => {
    const env = baseEnv({ AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: proj });
    for (const cwd of [proj, path.join(proj, 'sub'), link]) {
      const r = await hookAt(cwd, env);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe('');
    }
    expect(seen).toHaveLength(0);
    for (const l of logLines()) expect(l).toMatchObject({ outcome: 'skipped', reason: 'project-bypass' });
    expect(logLines()).toHaveLength(3);
    expect(JSON.stringify(logLines())).not.toContain('architecture');
  });

  test('a sibling that merely shares the prefix still routes', async () => {
    const r = await hookAt(sibling, baseEnv({ AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: proj }));
    expect(JSON.parse(r.out.trim()).hookSpecificOutput.additionalContext).toContain('alpha-diagrams');
    expect(seen).toHaveLength(1);
  });

  test('several projects: any match bypasses; the list is PATH-delimited', async () => {
    const env = baseEnv({ AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: [sibling, proj].join(path.delimiter) });
    await hookAt(proj, env); await hookAt(sibling, env);
    expect(seen).toHaveLength(0);
  });

  test('fails closed: a non-empty list with no cwd in the hook input sends nothing', async () => {
    const r = await run([HOOK], baseEnv({ AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: proj }),
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: PROMPT }));
    expect(r.out.trim()).toBe('');
    expect(seen).toHaveLength(0);
  });

  test('default (unset or empty list) is unchanged: routes with or without a cwd', async () => {
    for (const extra of [{}, { AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: '' }]) {
      const r = await hookAt(proj, baseEnv(extra));
      expect(JSON.parse(r.out.trim()).hookSpecificOutput.additionalContext).toContain('alpha-diagrams');
    }
    expect(await runHook(PROMPT, baseEnv())).toContain('alpha-diagrams');
    expect(seen).toHaveLength(3);
    expect(lib.config(baseEnv()).bypassProjects).toEqual([]);
  });

  test('a verify/intent-enabled request is bypassed too (every extra rides the one gated request)', async () => {
    const env = baseEnv({ AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: proj, AGENTBOX_JEV_SKILL_VERIFY: '1', AGENTBOX_JEV_SKILL_INTENT: '1' });
    await hookAt(proj, env);
    expect(seen).toHaveLength(0);
  });

  test('the local cascade may still answer a bypassed project, but never escalates to the judge', async () => {
    const env = baseEnv({ AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: proj, AGENTBOX_SKILL_ROUTE_CASCADE: '1', AGENTBOX_SKILL_ROUTE_CASCADE_CUTOFF: '1' });
    // A prompt with no vocabulary overlap has no local margin, so it must escalate — and the
    // bypass must stop that escalation before the request is built.
    await run([HOOK], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: proj, prompt: 'qqzx wwvk jjpf zzrt mmnb vvcx' }));
    expect(seen).toHaveLength(0);
    expect(logLines()[0]).toMatchObject({ outcome: 'skipped', reason: 'project-bypass', cascade: 'escalated' });
  });

  test('the shared library gate serves /route too: route() with a bypassed cwd makes no request', async () => {
    // The CLI prefers the baked lib under /opt, so exercise the repo lib in-process, and pin
    // that the CLI passes its cwd (source check) so a future edit cannot drop the gate.
    const cfg = lib.config(baseEnv({ AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS: proj }));
    const r = await lib.route(PROMPT, cfg, { retries: 0, cwd: path.join(proj, 'sub') });
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'project-bypass' });
    expect(seen).toHaveLength(0);
    const ok = await lib.route(PROMPT, cfg, { retries: 0, cwd: sibling });
    expect(ok.outcome).toBe('routed');
    expect(fs.readFileSync(CLI, 'utf8')).toMatch(/lib\.route\(task, cfg, \{[^}]*cwd: process\.cwd\(\)/);
  });

  test('projectBypassed: boundary, relative and empty cases', () => {
    expect(lib.projectBypassed('/x/proj/sub', ['/x/proj'])).toBe(true);
    expect(lib.projectBypassed('/x/proj2', ['/x/proj'])).toBe(false);
    expect(lib.projectBypassed('/x/proj', [])).toBe(false);
    expect(lib.projectBypassed(undefined, ['/x/proj'])).toBe(true);
    expect(lib.projectBypassed('relative', ['/x/proj'])).toBe(true);
    expect(lib.projectBypassed('/x/proj', ['relative'])).toBe(false);
  });

  test('manifest fallback reads a MULTI-LINE array with comments (a missed list would silently open the gate)', () => {
    const toml = path.join(tmp, 'bypass-multiline.toml');
    fs.writeFileSync(toml, '[skills.routing]\nrouter = "jev"\nbypass_projects = [\n  "/a/one",  # private\n  "/b/two",\n]\ntimeout_ms = 4000\n');
    expect(lib.config({}, { fallbackToml: toml }).bypassProjects).toEqual(['/a/one', '/b/two']);
    expect(lib.readTomlSection(toml, 'skills.routing').timeout_ms).toBe('4000');
  });

  test('entrypoint _ab_toml_array projects single-line, multi-line, empty and absent lists', () => {
    const { spawnSync } = require('child_process');
    const ep = path.resolve(__dirname, '../../config/entrypoint-unified.sh');
    const fn = fs.readFileSync(ep, 'utf8').match(/^_ab_toml_array\(\) \{[\s\S]*?^\}/m)[0];
    const project = (body) => {
      const f = path.join(tmp, `arr-${Math.random().toString(36).slice(2)}.toml`);
      fs.writeFileSync(f, body);
      return spawnSync('bash', ['-c', `${fn}\n_ab_toml_array skills.routing bypass_projects`], { env: { PATH: process.env.PATH, AGENTBOX_CONFIG: f }, encoding: 'utf8' }).stdout.trim();
    };
    expect(project('[other]\nbypass_projects = ["/nope"]\n[skills.routing]\nbypass_projects = ["/a", "/b"] # c\n')).toBe('/a:/b');
    expect(project('[skills.routing]\nbypass_projects = [\n  "/home/devuser/workspace/a",  # private\n  "/srv/b",\n]\ntimeout_ms = 4000\n')).toBe('/home/devuser/workspace/a:/srv/b');
    expect(project('[skills.routing]\nbypass_projects = []\n')).toBe('');
    expect(project('[skills.routing]\nrouter = "jev"\n')).toBe('');
  });

  test('manifest fallback: [skills.routing].bypass_projects is read when the env is silent', () => {
    const toml = path.join(tmp, 'bypass-fallback.toml');
    fs.writeFileSync(toml, `[skills.routing]\nrouter = "jev"\nbypass_projects = ["/a/one", "/b/two"]\n`);
    expect(lib.config({}, { fallbackToml: toml }).bypassProjects).toEqual(['/a/one', '/b/two']);
  });
});

describe('/route CLI', () => {
  test('routed: ranked picks and a dispatch line', async () => {
    const out = await runCli([PROMPT], baseEnv());
    expect(out).toMatch(/^router: jev \(jev-1\.13\.0\)/);
    expect(out).toMatch(/1\. alpha-diagrams\s+0\.90/);
    expect(out).toMatch(/dispatch: alpha-diagrams/);
  });

  test('--router table forces the pre-2091 path and says so', async () => {
    const out = await runCli(['--router', 'table', PROMPT], baseEnv());
    expect(out).toMatch(/^router: table \(fallback: router-off \(router=table\)\)/);
    expect(seen).toHaveLength(0);
  });

  test('judge failure degrades to the table with the reason, exit 0, after retrying 429', async () => {
    behaviour = { status: 429 };
    const out = await runCli([PROMPT], baseEnv());
    expect(out).toMatch(/^router: table \(fallback: judge http-429\)/);
    expect(seen.length).toBeGreaterThan(1);
  });

  test('--json emits the raw outcome', async () => {
    const j = JSON.parse(await runCli(['--json', PROMPT], baseEnv()));
    expect(j).toMatchObject({ outcome: 'routed', choice: 'alpha-diagrams', model: 'jev-1.13.0' });
  });

  test('an unbooted shell reads [skills.routing] from the manifest', async () => {
    const toml = path.join(tmp, 'agentbox.toml');
    fs.writeFileSync(toml, '[skills.routing]\nrouter = "jev"   # comment\nmodel = "jev-9.9.9"\ntimeout_ms = 700\n\n[other]\nrouter = "table"\n');
    const env = baseEnv({ AGENTBOX_CONFIG: toml }); delete env.AGENTBOX_SKILL_ROUTER;
    const j = JSON.parse(await runCli(['--json', PROMPT], env));
    expect(j.outcome).toBe('routed');
    expect(seen[0].body.model).toBe('jev-9.9.9');
  });
});

describe('validator — E076 / W074 (ADR-2095 addendum)', () => {
  const VALIDATOR = path.resolve(__dirname, '../../scripts/agentbox-config-validate.js');
  const { spawnSync } = require('child_process');
  function validate(body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-validate-'));
    const file = path.join(dir, 'agentbox.toml');
    fs.writeFileSync(file, body);
    try {
      const r = spawnSync('node', [VALIDATOR, file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      return `${r.stdout || ''}${r.stderr || ''}`;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const OPENJEV = '[features.sovereign_system_one]\nenabled = true\nengine = "openjev"\nendpoint = "http://systemone:8097/v1/systemone"\n';

  test('scope: "registered" and "all" pass; anything else is E084 (or a schema error)', () => {
    expect(validate('[skills.routing]\nrouter = "jev"\nscope = "all"\n')).not.toMatch(/E084|E016/);
    expect(validate('[skills.routing]\nrouter = "jev"\nscope = "registered"\n')).not.toMatch(/E084|E016/);
    expect(validate('[skills.routing]\nrouter = "jev"\n')).not.toMatch(/E084/);
    expect(validate('[skills.routing]\nrouter = "jev"\nscope = "everything"\n')).toMatch(/E084|E016/);
  });

  test('a non-boolean cascade and an out-of-range cutoff are E076', () => {
    expect(validate('[skills.routing]\nrouter = "jev"\ncascade = "yes"\n')).toMatch(/E076: \[skills\.routing\]\.cascade must be/);
    expect(validate('[skills.routing]\nrouter = "jev"\ncascade_cutoff = 1.5\n')).toMatch(/E076: \[skills\.routing\]\.cascade_cutoff/);
  });

  test('bypass_projects: absolute paths pass; relative, colon, quote or non-list values are E083 (or a schema error)', () => {
    expect(validate('[skills.routing]\nrouter = "jev"\nbypass_projects = ["/home/devuser/workspace/p", "/srv/x"]\n')).not.toMatch(/E083/);
    expect(validate('[skills.routing]\nrouter = "jev"\nbypass_projects = []\n')).not.toMatch(/E083/);
    for (const bad of ['["relative/dir"]', '["/a:b"]', '["/a b"]', '["/a,b"]', '"/not/a/list"']) {
      expect(validate(`[skills.routing]\nrouter = "jev"\nbypass_projects = ${bad}\n`)).toMatch(/E083|E016/);
    }
    expect(validate('[skills.routing]\nrouter = "jev"\nbypass_projects = ["relative/dir"]\n')).toMatch(/E083/);
  });

  test('bypass_projects: brackets are rejected (the shell projector would end the array at the first "]" and drop later entries)', () => {
    for (const bad of ['["/srv/p[1]"]', '["/srv/p]"]', '["/srv/[p"]', '[\n  "/srv/p[1]",\n  "/srv/secret",\n]']) {
      const out = validate(`[skills.routing]\nrouter = "jev"\nbypass_projects = ${bad}\n`);
      expect(out).toMatch(/E083/);
      expect(out).not.toMatch(/manifest valid/i);
    }
  });

  test('entrypoint projects the bypass only when listed (byte-identical when empty)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../config/entrypoint-unified.sh'), 'utf8');
    expect(src).toMatch(/_SR_BYPASS_EXPORT=""\n\[ -z "\$_SR_BYPASS" \] \|\| _SR_BYPASS_EXPORT=/);
    expect(src).toMatch(/process\.env\.SR_BYPASS \? ` AGENTBOX_SKILL_ROUTE_BYPASS_PROJECTS=/);
  });

  test('the shipped values (off, 0.3718) are clean', () => {
    expect(validate('[skills.routing]\nrouter = "jev"\ncascade = false\ncascade_cutoff = 0.3718\n')).not.toMatch(/E076|W074/);
  });

  test('openjev as the judge under a 4000 ms budget is W074; 6000 clears it', () => {
    expect(validate(`[skills.routing]\nrouter = "jev"\ntimeout_ms = 4000\n${OPENJEV}`)).toMatch(/W074.*consider cascade = true/);
    expect(validate(`[skills.routing]\nrouter = "jev"\ntimeout_ms = 6000\n${OPENJEV}`)).not.toMatch(/W074/);
  });
});

describe('router defects — bounded body read, frontmatter-only parsing, baked wins, desktop-only skills', () => {
  const put = (dir, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), text); };
  const syncedClaudeDir = (name, skills) => {
    const claudeDir = fs.mkdtempSync(path.join(tmp, 'claude-fix-'));
    const sync = path.join(claudeDir, 'skills', 'synced', 'acct_1');
    for (const s of skills) put(path.join(sync, s.name), s.md);
    fs.writeFileSync(path.join(sync, 'manifest.json'), JSON.stringify({ skills: skills.map((s) => ({ name: s.name, description: s.manifest })) }));
    return claudeDir;
  };

  test('a judge that sends headers and then stalls is cut off by the timeout, not waited on', async () => {
    const stall = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); res.write('{"model":"jev'); });
    });
    await new Promise((r) => stall.listen(0, '127.0.0.1', r));
    try {
      const cfg = lib.config(baseEnv({
        AGENTBOX_SKILL_ROUTE_API: `http://127.0.0.1:${stall.address().port}/v1/systemone`,
        AGENTBOX_SKILL_ROUTE_TIMEOUT_MS: '400',
      }));
      const t0 = Date.now();
      const r = await Promise.race([
        lib.route(PROMPT, cfg, { candidates: { 'alpha-diagrams': 'a', 'beta-harden': 'b' } }),
        new Promise((res) => setTimeout(() => res({ outcome: 'HUNG' }), 3000)),
      ]);
      expect(r.outcome).toBe('failed');
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      stall.closeAllConnections && stall.closeAllConnections();
      await new Promise((r) => stall.close(r));
    }
  });

  test('a deprecated synced skill is not resurrected from the manifest description', () => {
    const claudeDir = syncedClaudeDir('x', [
      { name: 'old', md: '---\nname: old\nstatus: deprecated\ndescription: "Old synced thing."\n---\n# x\n', manifest: 'Old synced thing.' },
      { name: 'bare', md: '---\nname: bare\n---\n# no description here\n', manifest: 'From the manifest only.' },
    ]);
    const extras = lib.loadLoadableExtras(claudeDir);
    expect(extras['anthropic-skills:old']).toBeUndefined();
    expect(extras['anthropic-skills:bare']).toBe('From the manifest only.');
  });

  test('status, deprecated and description are read from the leading frontmatter only', () => {
    const body = '# Doc\n\n```yaml\nstatus: superseded\ndeprecated: true\ndescription: from the body\n```\n';
    const md = `---\nname: fm\ndescription: "Real description."\n---\n${body}`;
    expect(lib.description(md)).toBe('Real description.');
    expect(lib.description(`---\nname: nodesc\n---\n${body}`)).toBeNull();
    const dir = fs.mkdtempSync(path.join(tmp, 'fm-skills-'));
    put(path.join(dir, 'fm'), md);
    put(path.join(dir, 'nodesc'), `---\nname: nodesc\n---\n${body}`);
    put(path.join(dir, 'real-deprecated'), '---\nname: real-deprecated\ndeprecated: true\ndescription: "Stub."\n---\n# x\n');
    expect(lib.loadCandidates(dir)).toEqual({ fm: 'Real description.' });
  });

  test('a plugin skill reads its name from the frontmatter, not from the body', () => {
    const claudeDir = fs.mkdtempSync(path.join(tmp, 'claude-plug-'));
    const plug = path.join(tmp, 'plug-fm');
    put(path.join(plug, 'skills', 'dir-name'), '---\ndescription: "Plugin thing."\n---\n```\nname: body-name\n```\n');
    fs.mkdirSync(path.join(claudeDir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'pl@m': [{ installPath: plug }] } }));
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'pl@m': true } }));
    expect(Object.keys(lib.loadLoadableExtras(claudeDir))).toEqual(['pl:dir-name']);
  });

  test('a baked skill wins over an extra with the same bare name even when the rubric differs', () => {
    const baked = { 'deep-research': 'Fan-out web research.' };
    const extras = { 'anthropic-skills:deep-research': 'A different summary of research.', 'p:other': 'Other.' };
    expect(lib.dedupeExtras(baked, extras)).toEqual({ extras: { 'p:other': 'Other.' }, dropped: ['anthropic-skills:deep-research'] });
  });

  test('desktop-only synced skills are never offered; their baked-tree or plugin namesakes are unaffected', () => {
    expect([...lib.DESKTOP_ONLY_SYNCED].sort()).toEqual(['built-in-browser', 'chrome-browser', 'computer-use']);
    const claudeDir = syncedClaudeDir('d', [
      ...['computer-use', 'chrome-browser', 'built-in-browser'].map((n) => ({ name: n, md: `---\nname: ${n}\ndescription: "Needs the desktop app."\n---\n# x\n` })),
      { name: 'docs', md: '---\nname: docs\ndescription: "Editable docs."\n---\n# x\n' },
    ]);
    expect(Object.keys(lib.loadLoadableExtras(claudeDir))).toEqual(['anthropic-skills:docs']);
  });

  test('a symlinked registration that points at a different checkout is reported as unregistered', () => {
    const registered = fs.mkdtempSync(path.join(tmp, 'reg-'));
    const other = fs.mkdtempSync(path.join(tmp, 'other-checkout-'));
    put(path.join(other, 'alpha-diagrams'), '---\nname: alpha-diagrams\ndescription: "x"\n---\n');
    fs.symlinkSync(path.join(other, 'alpha-diagrams'), path.join(registered, 'alpha-diagrams'));
    fs.symlinkSync(path.join(skillsDir, 'beta-harden'), path.join(registered, 'beta-harden'));
    const cfg = { skillsDir, registeredDir: registered };
    expect(lib.unregisteredPaths(['alpha-diagrams', 'beta-harden'], cfg))
      .toEqual([`alpha-diagrams → ${path.join(skillsDir, 'alpha-diagrams', 'SKILL.md')}`]);
  });
});
