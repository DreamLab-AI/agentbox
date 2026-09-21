// SSO contract §2 — consumer compatibility, proved rather than asserted.
//
// The claim under test is narrow and load-bearing: `config/hooks/lib/skill-route.cjs`
// — the shipped ADR-2091 router library, UNCHANGED, not a copy — behaves identically
// when the judge is the local SSO façade instead of TypeSafe's cloud. If any of this
// suite needs a change to that file, the façade is not a drop-in and the contract's
// central promise ("consumers keep speaking Jev") is false.
//
// Everything is driven through a stub HTTP server on 127.0.0.1 replying with the
// golden fixtures, so nothing leaves the machine and every outcome is deliberate.
//
// Run: node --test tests/system-one/consumer-compat.test.mjs
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const LIB = path.join(REPO, 'config/hooks/lib/skill-route.cjs');
const require = createRequire(import.meta.url);
const lib = require(LIB);
const golden = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'golden', f), 'utf8'));

/** A small, honest candidate map. The full 115 live in the golden fixtures. */
const CANDIDATES = {
  'cost-estimation': 'Estimate the cost of a change before committing to it. Use when asked what something will cost.',
  'deep-research': 'Multi-agent cited research. Use for questions needing sources.',
  toprank: 'Rank a list of items against one definition.',
  blender: 'Drive Blender through its Python API.',
};

let server, port, behaviour, seen;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: safeJson(body), raw: body });
      const b = behaviour;
      if (b.hang) return;
      res.writeHead(b.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(typeof b.reply === 'string' ? b.reply : JSON.stringify(b.reply));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { seen = []; behaviour = { reply: golden('sso-choice-router-shortlisted.json') }; });

const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
const cfg = (over = {}) => ({
  ...lib.config({
    AGENTBOX_SKILL_ROUTER: 'jev',
    AGENTBOX_SKILL_ROUTE_API: `http://127.0.0.1:${port}/v1/systemone`,
    AGENTBOX_SKILL_ROUTE_MODEL: 'laya-typed-decisions',
    AGENTBOX_SKILL_ROUTE_TIMEOUT_MS: '600',
    TYPESAFE_API_KEY: 'local-key',
    AGENTBOX_SKILL_ROUTE_LOG: '0',
  }),
  ...over,
});
const PROMPT = 'Work out roughly what it would cost us to run this router locally for a month.';
const go = (prompt = PROMPT, over = {}) => lib.route(prompt, cfg(over), { candidates: CANDIDATES });

describe('the library is genuinely unchanged — compatibility, not accommodation', () => {
  test('skill-route.cjs knows nothing of SSO, laya or a façade', () => {
    const src = fs.readFileSync(LIB, 'utf8');
    for (const word of [/\bsso\b/i, /\blaya\b/i, /\bfa[cç]ade\b/i, /\bsystem-one-facade\b/]) {
      assert.equal(word.test(src), false, `${word} appears in the shipped router library`);
    }
    assert.match(src, /DEFAULT_API = 'https:\/\/api\.typesafe\.ai\/v1\/systemone'/,
      'the cloud default must stay the default; SSO is selected by configuration, never by code');
  });

  test('the request the router sends is the frozen §2 wire format, whoever answers it', async () => {
    await go();
    assert.equal(seen.length, 1);
    const { body, headers, url } = seen[0];
    assert.equal(url, '/v1/systemone');
    assert.equal(headers.authorization, 'Bearer local-key', 'Bearer auth is accepted even when unenforced (§2)');
    assert.equal(body.model, 'laya-typed-decisions');
    assert.equal(body.state.user_request, PROMPT);
    assert.equal(body.questions.skill.type, 'choice');
    assert.equal(typeof body.questions.skill.instructions, 'string');
    assert.deepEqual(Object.keys(body.questions.skill.criteria).sort(),
      [...Object.keys(CANDIDATES), 'none'].sort(), '`none` must always be offered so the judge can decline');
  });
});

describe('an SSO-shaped answer is read exactly as a TypeSafe one', () => {
  test('a shortlisted answer routes, and every ORIGINAL option is still ranked', async () => {
    const r = await go();
    assert.equal(r.outcome, 'routed');
    assert.equal(r.choice, 'cost-estimation');
    assert.equal(r.none, false);
    assert.equal(r.confidence, 0.51);
    assert.equal(r.model, 'laya-typed-decisions');
    assert.equal(r.ranked.length, 116, 'shortlisting must not narrow what the consumer sees');
    assert.deepEqual(r.ranked[0], ['cost-estimation', 0.51]);
    assert.equal(r.ranked.filter(([, v]) => v === 0).length, 108);
  });

  test('the advisory line is the same line the cloud path produces', async () => {
    // Sequential on purpose: the stub's behaviour is one shared variable, and two
    // in-flight requests would both see whichever was set last.
    behaviour = { reply: golden('sso-choice-router-shortlisted.json') };
    const ssoLine = lib.formatContext(await go());
    behaviour = { reply: golden('typesafe-choice-router.json') };
    const cloudLine = lib.formatContext(await go());
    assert.match(ssoLine, /^\[route\] cost-estimation 0\.51 · /);
    assert.match(ssoLine, /advisory; load a skill only if it fits this turn\.$/);
    assert.equal(ssoLine.split('\n').length, 1);
    // Same skills, same ordering, different numbers: the shape a consumer depends on is identical.
    const names = (l) => l.replace(/ \d\.\d\d/g, '').replace(/ —.*$/, '');
    assert.equal(names(ssoLine), names(cloudLine));
  });

  test('usage is what the ENGINE consumed, and the consumer reports it without inventing anything', async () => {
    const r = await go();
    assert.deepEqual(r.usage, { input_tokens: 486, output_tokens: 0 });
    // The unit price is configuration, and defaults to the metered one, so an
    // unconfigured deployment over-states cost rather than silently reporting zero.
    assert.equal(r.usd, 486 * lib.JEV_USD_PER_MTOK_IN / 1e6);
    assert.equal(r.usdPerMTokIn, lib.JEV_USD_PER_MTOK_IN, 'the price is reported with the cost it produced');
  });

  test('a declared unit price is what the cost column uses — a free endpoint costs nothing', async () => {
    // The finding this closes: a cloud price applied to local tokens is a correct
    // calculation of a meaningless quantity, and a flattering one, because a cheaper
    // endpoint also consumes far fewer tokens. Declared, never inferred from the URL.
    const r = await lib.route(PROMPT, cfg({ usdPerMTokIn: 0 }), { candidates: CANDIDATES });
    assert.equal(r.usage.input_tokens, 486);
    assert.equal(r.usd, 0);
    assert.equal(r.usdPerMTokIn, 0);
  });

  test('a `none` pick injects nothing, on either backend', async () => {
    behaviour = { reply: golden('typesafe-choice-none.json') };
    const cloud = await go();
    assert.equal(cloud.none, true);
    assert.equal(lib.formatContext(cloud), '');
    behaviour = { reply: { ...golden('sso-choice-router-shortlisted.json'), answers: golden('typesafe-choice-none.json').answers } };
    const local = await go();
    assert.equal(local.none, true);
    assert.equal(lib.formatContext(local), '', 'an sso block must not turn a decline into an injection');
  });

  test('the additive `sso` block is ignored, not tripped over', async () => {
    const withBlock = golden('sso-choice-router-shortlisted.json');
    const without = { ...withBlock }; delete without.sso;
    behaviour = { reply: withBlock };
    const a = await go();
    behaviour = { reply: without };
    const b = await go();
    const strip = ({ ms, ...rest }) => rest;
    assert.deepEqual(strip(a), strip(b), 'the honesty channel must cost the consumer nothing');
  });
});

describe('zero-probability runners-up still produce a sane advisory line', () => {
  // The degenerate distribution the façade can legitimately return: one option takes
  // the whole mass and the other 115 are re-expanded at exactly 0.0. `formatContext`
  // slices the top three blind, so this is the case that would break it.
  beforeEach(() => { behaviour = { reply: golden('sso-choice-zero-probability-runners-up.json') }; });

  test('one line, the pick first with its real probability, the advisory caveat intact', async () => {
    const line = lib.formatContext(await go());
    assert.ok(line.length > 0, 'a confident local pick must still be advertised');
    assert.equal(line.split('\n').length, 1);
    assert.match(line, /^\[route\] blender 1\.00\b/);
    assert.match(line, /advisory; load a skill only if it fits this turn\.$/);
    assert.ok(line.length < 200, `the injected line is paid for every turn: ${line.length} chars`);
  });

  test('the line is deterministic for the same response — no map-order surprise', async () => {
    const a = lib.formatContext(await go());
    const b = lib.formatContext(await go());
    assert.equal(a, b);
  });

  test('zero-probability runners-up are dropped, not printed as 0.00', async () => {
    // Was: a finding. `ranked.slice(0, 3)` sliced before filtering, so two options the
    // judge gave no mass at all were injected into every routed turn. Now filtered ahead
    // of the slice, which is a no-op on a metered backend (every option carries some
    // mass there) and drops exactly the set-aside padding on a shortlisting one.
    const line = lib.formatContext(await go());
    assert.equal((line.match(/ 0\.00/g) || []).length, 0, 'no mass, no mention');
    assert.equal(line, '[route] blender 1.00 — advisory; load a skill only if it fits this turn.');
  });

  test('a uniform-zero distribution still names the pick, without a meaningless number', async () => {
    // Pathological but reachable if an engine returns a uniform-zero distribution. The
    // The pick is still advertised — that is what the router is for — but printing
    // `blender 0.00` would dress a non-answer as a measurement. The previous behaviour
    // was an advisory line with an empty slot in it, which reads as a bug in a transcript.
    const body = golden('sso-choice-zero-probability-runners-up.json');
    const flat = { ...body, answers: { skill: { ...body.answers.skill, confidence: 0,
      probabilities: Object.fromEntries(Object.keys(body.answers.skill.probabilities).map((k) => [k, 0])) } } };
    behaviour = { reply: flat };
    const r = await go();
    assert.equal(r.outcome, 'routed');
    assert.equal(r.choice, 'blender');
    assert.equal(lib.formatContext(r), '[route] blender — advisory; load a skill only if it fits this turn.');
  });
});

describe('fail-open is unchanged by the local backend (ADR-2090)', () => {
  const failures = [
    ['timeout', () => { behaviour = { hang: true }; }, 'timeout'],
    ['http-500', () => { behaviour = { status: 500, reply: golden('sso-error-engine-down.json') }; }, 'http-500'],
    ['http-503 engine down', () => { behaviour = { status: 503, reply: golden('sso-error-engine-down.json') }; }, 'http-503'],
    ['http-422 options_unfittable', () => { behaviour = { status: 422, reply: golden('sso-error-options-unfittable.json') }; }, 'http-422'],
    ['http-429', () => { behaviour = { status: 429, reply: {} }; }, 'http-429'],
    ['bad-json', () => { behaviour = { reply: '{"answers": ' }; }, 'bad-json'],
    ['bad-shape — an error body served with 200', () => { behaviour = { reply: golden('sso-error-options-unfittable.json') }; }, 'bad-shape'],
    ['bad-shape — answers without a choice', () => { behaviour = { reply: { model: 'laya-typed-decisions', answers: { skill: { probabilities: { none: 1 } } } } }; }, 'bad-shape'],
  ];

  for (const [name, arrange, reason] of failures) {
    test(`${name} ⇒ failed:${reason}, nothing injected, no throw`, async () => {
      arrange();
      const r = await go();
      assert.equal(r.outcome, 'failed');
      assert.equal(r.reason, reason);
      assert.equal(lib.formatContext(r), '');
    });
  }

  test('an unreachable façade fails open like any other judge', async () => {
    const r = await lib.route(PROMPT, cfg({ api: 'http://127.0.0.1:1/v1/systemone' }), { candidates: CANDIDATES });
    assert.equal(r.outcome, 'failed');
    assert.equal(r.reason, 'network');
    assert.equal(lib.formatContext(r), '');
  });

  test('the hook path never retries — one turn, at most one request, however the façade errors', async () => {
    behaviour = { status: 429, reply: {} };
    await go();
    assert.equal(seen.length, 1);
  });

  test('a missing probabilities map is tolerated: the pick is still named, without a number', async () => {
    behaviour = { reply: { model: 'laya-typed-decisions', answers: { skill: { choice: 'blender' } }, usage: { input_tokens: 400, output_tokens: 0 } } };
    const r = await go();
    assert.equal(r.outcome, 'routed');
    assert.equal(r.confidence, null);
    assert.deepEqual(r.ranked, []);
    // `probabilities` is optional in §2. With none to show, the line names the pick and
    // nothing else — previously it named nothing at all, which wasted the request.
    assert.equal(lib.formatContext(r), '[route] blender — advisory; load a skill only if it fits this turn.');
  });
});

describe('the skips that must never reach any judge, local or not', () => {
  test('no key ⇒ skipped:no-key, no request', async () => {
    const r = await go(PROMPT, { key: '' });
    assert.deepEqual(r, { outcome: 'skipped', reason: 'no-key' });
    assert.equal(seen.length, 0);
  });

  test('router off ⇒ skipped:router-off, no request — a local judge is still opt-in', async () => {
    const r = await go(PROMPT, { router: 'table' });
    assert.equal(r.reason, 'router-off');
    assert.equal(seen.length, 0);
  });

  test('a short turn is not worth a round trip, wherever the judge lives', async () => {
    const r = await go('thanks, ship it');
    assert.equal(r.outcome, 'skipped');
    assert.equal(r.reason, 'short-prompt');
    assert.equal(r.chars, 15);
    assert.equal(seen.length, 0);
  });

  test('a slash command is the user routing by hand', async () => {
    const r = await go('/route work out what this would cost us per month to run locally');
    assert.equal(r.reason, 'slash-command');
    assert.equal(seen.length, 0);
  });

  test('an empty candidate map skips rather than asking an empty question', async () => {
    const r = await lib.route(PROMPT, cfg(), { candidates: {} });
    assert.equal(r.reason, 'no-candidates');
    assert.equal(seen.length, 0);
  });

  test('a pasted document is clamped before it is sent, on a façade with a smaller context than the cloud', async () => {
    const huge = `${'a'.repeat(20000)} END`;
    const r = await go(huge);
    assert.equal(r.truncated, true);
    assert.ok(seen[0].body.state.user_request.length < huge.length);
    assert.match(seen[0].body.state.user_request, /chars elided/);
    assert.match(seen[0].body.state.user_request, / END$/, 'the tail carries the actual request; it must survive');
  });
});
