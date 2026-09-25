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
 *   • the hook ranks only skills/registered-skills.txt (fail-open to the whole
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
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

  test('a non-boolean cascade and an out-of-range cutoff are E076', () => {
    expect(validate('[skills.routing]\nrouter = "jev"\ncascade = "yes"\n')).toMatch(/E076: \[skills\.routing\]\.cascade must be/);
    expect(validate('[skills.routing]\nrouter = "jev"\ncascade_cutoff = 1.5\n')).toMatch(/E076: \[skills\.routing\]\.cascade_cutoff/);
  });

  test('the shipped values (off, 0.3718) are clean', () => {
    expect(validate('[skills.routing]\nrouter = "jev"\ncascade = false\ncascade_cutoff = 0.3718\n')).not.toMatch(/E076|W074/);
  });

  test('openjev as the judge under a 4000 ms budget is W074; 6000 clears it', () => {
    expect(validate(`[skills.routing]\nrouter = "jev"\ntimeout_ms = 4000\n${OPENJEV}`)).toMatch(/W074.*consider cascade = true/);
    expect(validate(`[skills.routing]\nrouter = "jev"\ntimeout_ms = 6000\n${OPENJEV}`)).not.toMatch(/W074/);
  });
});
