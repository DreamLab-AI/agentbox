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
 *     a `none` pick all produce {result:"continue"} with no additionalContext;
 *   • a routed pick is injected with its probability and runners-up;
 *   • the candidate map composes ADR-2089 `status` at the point of use —
 *     deprecated/superseded/not-installed/router-only skills are never
 *     offered, gated ones carry their note, and `none` is always present;
 *   • the log line carries lengths, picks and cost but never the prompt;
 *   • the CLI degrades to "router: table" with the reason, exit 0.
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

let tmp, skillsDir, logPath, server, port, behaviour, seen;

function mkSkill(name, frontmatter, body = '# x\n') {
  fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, name, 'SKILL.md'), `---\nname: ${name}\n${frontmatter}\n---\n${body}`);
}

beforeAll((done) => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-route-'));
  skillsDir = path.join(tmp, 'skills');
  logPath = path.join(tmp, 'route.jsonl');
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

async function runHook(prompt, env) {
  const r = await run([HOOK], env, JSON.stringify({ prompt }));
  expect(r.code).toBe(0);
  return JSON.parse(r.out.trim());
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
    expect(await runHook(PROMPT, env)).toEqual({ result: 'continue' });
    expect(seen).toHaveLength(0);
    expect(logLines().map((l) => l.reason)).toEqual(['router-off']);
  });

  test('router=table ⇒ continue, no request', async () => {
    expect(await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTER: 'table' }))).toEqual({ result: 'continue' });
    expect(seen).toHaveLength(0);
  });

  test('no TYPESAFE_API_KEY ⇒ continue, no request', async () => {
    const env = baseEnv(); delete env.TYPESAFE_API_KEY;
    expect(await runHook(PROMPT, env)).toEqual({ result: 'continue' });
    expect(seen).toHaveLength(0);
    expect(logLines()[0].reason).toBe('no-key');
  });

  test('short turns and slash commands are never sent', async () => {
    expect(await runHook('thanks', baseEnv())).toEqual({ result: 'continue' });
    expect(await runHook('/route fix the login bug', baseEnv())).toEqual({ result: 'continue' });
    expect(seen).toHaveLength(0);
    expect(logLines().map((l) => l.reason)).toEqual(['short-prompt', 'slash-command']);
  });
});

describe('hook — routed', () => {
  test('injects the pick, probability and runners-up; sends one Choice with `none` present', async () => {
    const out = await runHook(PROMPT, baseEnv());
    expect(out.result).toBe('continue');
    expect(out.additionalContext).toBe('[route] alpha-diagrams 0.90 · beta-harden 0.07 — advisory; load a skill only if it fits this turn.');
    // Paid for on every routed turn: keep it short.
    expect(out.additionalContext.length).toBeLessThan(160);
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

  test('a `none` pick injects nothing but is logged as routed', async () => {
    behaviour = { reply: answer('none', { none: 0.97, 'alpha-diagrams': 0.03 }, 0.97) };
    expect(await runHook('ok go ahead with that plan, ping me when it is done', baseEnv())).toEqual({ result: 'continue' });
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
      expect(await runHook(PROMPT, baseEnv())).toEqual({ result: 'continue' });
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(logLines()[0]).toMatchObject({ outcome: 'failed', reason });
    });
  }

  test('unreachable judge ⇒ continue', async () => {
    expect(await runHook(PROMPT, baseEnv({ AGENTBOX_SKILL_ROUTE_API: 'http://127.0.0.1:1/v1/systemone' }))).toEqual({ result: 'continue' });
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
