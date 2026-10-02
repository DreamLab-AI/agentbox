'use strict';

/**
 * EXP-B8 — the bounded label-log experiment (docs/experiments/EXP-B8-label-log.md).
 *
 * The protocol is pre-registered; these tests hold the machinery to it:
 *
 *   • sample counting: only rows with a routable-or-none teacher label, a judge pick
 *     and a shadow BM25 pick count; `other` and unjoined rows never do;
 *   • stopping rule: 510 analysable rows OR the UTC date 2026-10-20, whichever first;
 *   • analysis: the copy ceiling sweeps every observed score breakpoint (ADR-2095
 *     rule 1), a zero score is a decline, and the one test is an exact McNemar;
 *   • verdicts map to the protocol's table;
 *   • report shape: the report and the forum post carry the numbers and the action,
 *     and never a prompt;
 *   • never posts twice: the post is at-most-once across ticks, even when the publish
 *     fails after the attempt was recorded;
 *   • hook registration from the checkout is idempotent and fully reversible.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const X = require(path.resolve(__dirname, '../../scripts/experiments/exp-b8-label-log.cjs'));

const row = (label, judge, bm25, score) => ({ label, router_pick: judge, bm25_pick: bm25, bm25_score: score });

describe('protocol constants', () => {
  test('the registered numbers', () => {
    expect(X.PROTOCOL).toMatchObject({ id: 'EXP-B8', targetN: 510, hardStop: '2026-10-20', alpha: 0.05, mde: 0.05, power: 0.8 });
    expect(X.PROTOCOL.psi).toBeCloseTo(14 / 86, 10);
  });

  test('the sample size follows from Connor (1987) and the target rounds it up', () => {
    const n = X.requiredSampleSize(X.PROTOCOL);
    expect(n).toBeGreaterThan(508);
    expect(n).toBeLessThanOrEqual(X.PROTOCOL.targetN);
  });
});

describe('sample counting', () => {
  test('only complete rows with a routable or none label count', () => {
    const rows = [
      row('none', 'none', 'alpha', 0),
      row('alpha', 'alpha', 'beta', 2.1),
      row('other', 'none', 'alpha', 1),          // teacher used an unroutable skill
      row('alpha', null, 'alpha', 1),            // route line never joined
      row('alpha', 'alpha', null, null),         // logged before the shadow arm existed
      row('alpha', 'alpha', 'alpha', Number.NaN),
      { label: 'beta', router_pick: 'beta' },
    ];
    expect(X.countAnalysable(rows)).toBe(2);
  });

  test('a plugin qualifier never splits a match', () => {
    expect(X.bare('anthropic-skills:docx')).toBe('docx');
    expect(X.bare('docx')).toBe('docx');
    expect(X.bare(null)).toBeNull();
  });
});

describe('stopping rule', () => {
  const at = (iso) => new Date(iso);

  test('runs on below the sample before the hard date', () => {
    expect(X.stoppingRule({ n: 509, now: at('2026-10-19T23:59:59Z') })).toEqual({ stop: false, reason: null });
  });

  test('stops on the sample', () => {
    expect(X.stoppingRule({ n: 510, now: at('2026-10-05T12:00:00Z') })).toEqual({ stop: true, reason: 'sample' });
  });

  test('stops on the hard date (UTC) whatever the count', () => {
    expect(X.stoppingRule({ n: 3, now: at('2026-10-20T00:00:00Z') })).toEqual({ stop: true, reason: 'date' });
    expect(X.stoppingRule({ n: 3, now: at('2026-11-01T00:00:00Z') })).toEqual({ stop: true, reason: 'date' });
  });

  test('the sample wins when both hold', () => {
    expect(X.stoppingRule({ n: 600, now: at('2026-10-21T00:00:00Z') }).reason).toBe('sample');
  });
});

describe('analysis', () => {
  test('exact McNemar matches hand values', () => {
    expect(X.mcnemarExact(11, 3)).toBeCloseTo(0.057373046875, 12);
    expect(X.mcnemarExact(0, 0)).toBe(1);
    expect(X.mcnemarExact(5, 5)).toBe(1);
    expect(X.mcnemarExact(0, 10)).toBeCloseTo(2 / 1024, 12);
  });

  test('the copy ceiling sweeps observed breakpoints and reads a zero score as a decline', () => {
    const rows = [
      row('none', 'none', 'alpha', 0.5),   // a low score: best declined
      row('alpha', 'alpha', 'alpha', 4),
      row('beta', 'beta', 'beta', 3),
      row('none', 'none', 'gamma', 0),     // no overlap: always a decline
    ];
    const c = X.copyCeiling(rows);
    expect(c.threshold).toBe(3);
    expect(c.correct).toEqual([true, true, true, true]);
    expect(c.accuracy).toBe(1);
  });

  test('a fixed grid would miss this breakpoint; the sweep does not', () => {
    const rows = [row('alpha', 'x', 'alpha', 1.2345), row('none', 'x', 'beta', 1.2344)];
    expect(X.copyCeiling(rows).threshold).toBe(1.2345);
  });

  test('ties in ceiling accuracy resolve to the lowest threshold (deterministic)', () => {
    const rows = [row('alpha', 'x', 'beta', 2), row('none', 'x', 'beta', 1)];
    // t=1: [wrong, wrong]; t=2: [wrong, right]; t=Inf: [wrong, right] → 2 wins.
    expect(X.copyCeiling(rows).threshold).toBe(2);
  });

  test('analyse counts discordant pairs against the teacher', () => {
    const rows = [
      row('alpha', 'alpha', 'beta', 5),     // judge right, ceiling wrong → b
      row('none', 'beta', 'alpha', 0),      // ceiling declines (right), judge wrong → c
      row('beta', 'plugin:beta', 'beta', 5),// both right
      row('other', 'none', 'none', 0),      // excluded
    ];
    const a = X.analyse(rows, { targetN: 510 });
    expect(a).toMatchObject({ n: 3, b: 1, c: 1, underpowered: true });
    expect(a.judgeAccuracy).toBeCloseTo(2 / 3, 10);
    expect(a.p).toBe(1);
    expect(a.verdict).toBe('INCONCLUSIVE');
  });
});

describe('verdict → action', () => {
  const v = (o) => X.verdictOf({ alpha: 0.05, targetN: 510, ...o });
  test('the protocol table', () => {
    expect(v({ p: 0.01, b: 40, c: 15, n: 510 })).toBe('KEEP');
    expect(v({ p: 0.01, b: 40, c: 15, n: 200 })).toBe('KEEP');
    expect(v({ p: 0.01, b: 15, c: 40, n: 510 })).toBe('WITHDRAW');
    expect(v({ p: 0.3, b: 30, c: 22, n: 510 })).toBe('WITHDRAW');
    expect(v({ p: 0.3, b: 30, c: 22, n: 200 })).toBe('INCONCLUSIVE');
    expect(v({ p: 1, b: 0, c: 0, n: 0 })).toBe('INCONCLUSIVE');
  });

  test('only KEEP keeps ADR-2110', () => {
    expect(X.ACTIONS.KEEP.decision_status).toBe('accepted');
    expect(X.ACTIONS.WITHDRAW.decision_status).toBe('rejected');
    expect(X.ACTIONS.INCONCLUSIVE.decision_status).toBe('rejected');
    for (const k of Object.keys(X.ACTIONS)) expect(X.ACTIONS[k].activation_status).toBe('inactive');
  });
});

describe('report shape', () => {
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push(row('none', 'none', 'alpha', 0));
  for (let i = 0; i < 150; i++) rows.push(row('alpha', 'alpha', 'beta', 2));
  for (let i = 0; i < 60; i++) rows.push(row('beta', 'none', 'beta', 6));
  const a = X.analyse(rows, { targetN: 510 });
  const meta = { date: '2026-10-11', reason: 'sample', generatedAt: '2026-10-11T10:00:00Z' };

  test('the report carries the pre-registered sections and numbers', () => {
    const md = X.composeReport(a, meta);
    for (const h of ['# EXP-B8 report', '## Verdict', '## Numbers', '## What happens next', '## Protocol']) expect(md).toContain(h);
    expect(md).toContain(`n = ${a.n}`);
    expect(md).toContain(`b = ${a.b}`);
    expect(md).toContain(`c = ${a.c}`);
    expect(md).toContain(a.verdict);
    expect(md).toContain('docs/experiments/EXP-B8-label-log.md');
    expect(md).not.toMatch(/undefined|NaN/);
  });

  test('the forum post is plain English, short, and says the log is off', () => {
    const post = X.composeForumPost(a, meta);
    expect(post.length).toBeLessThanOrEqual(1500);
    expect(post).toMatch(/switched off/i);
    expect(post).toContain(String(a.n));
    expect(post).not.toMatch(/undefined|NaN|McNemar/);
  });

  test('the ADR verdict edit sets the statuses and appends a Disposition', () => {
    const adr = '---\nid: ADR-2110\ndecision_status: accepted\nimplementation_status: partial\nactivation_status: live\n---\n\n# x\n';
    const out = X.applyAdrVerdict(adr, a, { ...meta, prUrl: null });
    expect(out).toMatch(/^activation_status: inactive$/m);
    expect(out).toMatch(new RegExp(`^decision_status: ${X.ACTIONS[a.verdict].decision_status}$`, 'm'));
    expect(out).toMatch(/## Disposition — 2026-10-11 \(EXP-B8 verdict\)/);
  });

  test('the manifest flip touches only [skills.routing].label_log', () => {
    const toml = '[a]\nlabel_log = true\n\n[skills.routing]\nrouter = "jev"\nlabel_log = true   # c\n\n[b]\nx = 1\n';
    expect(X.manifestLabelLog(toml)).toBe(true);
    const off = X.flipManifestOff(toml);
    expect(X.manifestLabelLog(off)).toBe(false);
    expect(off).toContain('[a]\nlabel_log = true\n');
    expect(off.split('\n').length).toBe(toml.split('\n').length);
  });
});

describe('never posts twice', () => {
  test('a second call is a no-op', async () => {
    const state = {};
    const publish = jest.fn().mockResolvedValue('ev1');
    const save = jest.fn();
    expect(await X.postOnce(state, publish, save)).toMatchObject({ posted: true, eventId: 'ev1' });
    expect(await X.postOnce(state, publish, save)).toMatchObject({ posted: false, reason: 'already-attempted' });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test('the attempt is saved BEFORE the send, so a failed or crashed send is never retried', async () => {
    const state = {};
    const saved = [];
    const save = (s) => saved.push(JSON.parse(JSON.stringify(s)));
    const publish = jest.fn(async (_content, markSent) => { markSent(); throw new Error('relay dropped the socket'); });
    const r = await X.postOnce(state, publish, save);
    expect(r).toMatchObject({ posted: false, reason: 'publish-failed' });
    expect(saved[0].post.attempted_at).toBeTruthy();
    expect(saved[0].post.event_id).toBeUndefined();
    await X.postOnce(state, publish, save);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test('a refusal before any send (no zone key yet) is not an attempt: retried, then posted once', async () => {
    const state = {};
    const save = jest.fn();
    const publish = jest.fn()
      .mockImplementationOnce(async () => { throw new Error('no zone key held for encrypted zone zone4; not posted in plaintext'); })
      .mockImplementation(async (_c, markSent) => { markSent(); return 'ev2'; });
    expect(await X.postOnce(state, publish, save)).toMatchObject({ posted: false, reason: 'not-sent' });
    expect(state.post && state.post.attempted_at).toBeFalsy();
    expect(await X.postOnce(state, publish, save)).toMatchObject({ posted: true, eventId: 'ev2' });
    expect(await X.postOnce(state, publish, save)).toMatchObject({ posted: false, reason: 'already-attempted' });
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe('the no-post check', () => {
  test('a plan summary never carries key material', () => {
    const key = { pubkey: 'ab'.repeat(32), sk: 'cd'.repeat(32), secret: new Uint8Array(32) };
    const enc = X.planSummary({ type: 'encrypt', key });
    expect(enc).toEqual({ type: 'encrypt' });
    expect(JSON.stringify(enc)).not.toMatch(/abab|cdcd/);
    expect(X.planSummary({ type: 'plain' })).toEqual({ type: 'plain' });
    expect(X.planSummary({ type: 'refuse', reason: 'no zone key held for encrypted zone zone4', key }))
      .toEqual({ type: 'refuse', reason: 'no zone key held for encrypted zone zone4' });
    expect(X.planSummary(null)).toEqual({ type: 'unknown' });
  });
});

describe('hook registration from the checkout', () => {
  const HOOKS = '/w/agentbox/config/hooks';
  const BAKED = '/opt/agentbox/config/hooks';
  const ROUTER = 'AGENTBOX_SKILL_ROUTER=jev AGENTBOX_SKILL_ROUTE_MODEL=jev-latest AGENTBOX_SKILL_ROUTE_TIMEOUT_MS=4000 AGENTBOX_SKILL_ROUTE_MIN_CHARS=24 node /opt/agentbox/config/hooks/skill-route.cjs || true';
  const base = () => ({
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: ROUTER, timeout: 8 }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node /x/other-stop.cjs', timeout: 5 }] }],
    },
    other: 1,
  });
  const opts = { checkoutHooks: HOOKS, bakedHooks: BAKED, embedUrl: 'http://192.168.2.132:9997/v1/embeddings', minChars: 24 };

  test('on: the router logs the shadow and runs from the checkout; the recorder is on Stop', () => {
    const r = X.applyRegistration(base(), { ...opts, on: true });
    expect(r.changed).toBe(true);
    const cmd = r.settings.hooks.UserPromptSubmit[0].hooks[0].command;
    expect(cmd).toContain(' AGENTBOX_SKILL_ROUTE_LABEL_LOG=1 ');
    expect(cmd).toContain(`node ${HOOKS}/skill-route.cjs`);
    const stop = r.settings.hooks.Stop.flatMap((g) => g.hooks).map((h) => h.command);
    expect(stop).toContain('node /x/other-stop.cjs');
    const rec = stop.filter((c) => c.includes('routing-label-recorder.cjs'));
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatch(/^AGENTBOX_ROUTING_LABELS=1 /);
    expect(rec[0]).toContain(`node ${HOOKS}/routing-label-recorder.cjs`);
    expect(rec[0]).not.toMatch(/password/);
  });

  test('on is idempotent, and replaces a recorder the entrypoint registered', () => {
    const once = X.applyRegistration(base(), { ...opts, on: true }).settings;
    const twice = X.applyRegistration(JSON.parse(JSON.stringify(once)), { ...opts, on: true });
    expect(twice.changed).toBe(false);
    const s = base();
    s.hooks.Stop.push({ hooks: [{ type: 'command', command: `AGENTBOX_ROUTING_LABELS=1 node ${BAKED}/routing-label-recorder.cjs || true`, timeout: 15 }] });
    const r = X.applyRegistration(s, { ...opts, on: true }).settings;
    expect(r.hooks.Stop.flatMap((g) => g.hooks).filter((h) => h.command.includes('routing-label-recorder')).length).toBe(1);
  });

  test('off restores the baked router command exactly and removes the recorder', () => {
    const on = X.applyRegistration(base(), { ...opts, on: true }).settings;
    const off = X.applyRegistration(on, { ...opts, on: false });
    expect(off.settings).toEqual(base());
    expect(X.applyRegistration(base(), { ...opts, on: false }).changed).toBe(false);
  });

  test('with no router hook registered nothing is added to UserPromptSubmit', () => {
    const s = { hooks: {} };
    const r = X.applyRegistration(s, { ...opts, on: true });
    expect(r.routerFound).toBe(false);
    expect(r.settings.hooks.UserPromptSubmit).toBeUndefined();
  });
});

describe('tick (injected dependencies)', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-b8-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function deps(over = {}) {
    let settings = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'AGENTBOX_SKILL_ROUTER=jev node /opt/agentbox/config/hooks/skill-route.cjs || true' }] }] } };
    const rows = [];
    for (let i = 0; i < 510; i++) rows.push(row('none', 'none', 'a', 0));
    return {
      stateDir: dir,
      now: () => new Date('2026-10-08T10:00:00Z'),
      manifestOn: () => true,
      readSettings: () => settings,
      writeSettings: (s) => { settings = s; },
      settings: () => settings,
      countRows: jest.fn().mockResolvedValue(12),
      fetchRows: jest.fn().mockResolvedValue(rows),
      publish: jest.fn().mockResolvedValue('evid'),
      openPr: jest.fn().mockResolvedValue('https://github.com/x/y/pull/1'),
      log: () => {},
      ...over,
    };
  }

  test('below the sample: registers, counts, does not stop', async () => {
    const d = deps();
    const r = await X.tick(d);
    expect(r).toMatchObject({ phase: 'running', n: 12 });
    expect(d.publish).not.toHaveBeenCalled();
    expect(d.settings().hooks.Stop).toHaveLength(1);
  });

  test('at the sample: stops collecting, analyses, posts once, opens one PR; later ticks do nothing more', async () => {
    const d = deps({ countRows: jest.fn().mockResolvedValue(510) });
    const r = await X.tick(d);
    expect(r.phase).toBe('done');
    expect(d.settings().hooks.Stop || []).toHaveLength(0);
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.openPr).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(dir, 'report.md'))).toBe(true);
    const again = await X.tick(d);
    expect(again.phase).toBe('done');
    expect(d.publish).toHaveBeenCalledTimes(1);
    expect(d.openPr).toHaveBeenCalledTimes(1);
  });

  test('a post refused before sending keeps the phase at stopped until it goes out once', async () => {
    const publish = jest.fn()
      .mockRejectedValueOnce(new Error('no zone key held'))
      .mockImplementation(async (_c, markSent) => { markSent(); return 'ev'; });
    const d = deps({ countRows: jest.fn().mockResolvedValue(510), publish });
    expect((await X.tick(d)).phase).toBe('stopped');
    expect((await X.tick(d)).phase).toBe('done');
    expect((await X.tick(d)).phase).toBe('done');
    expect(publish).toHaveBeenCalledTimes(2);
    expect(d.openPr).toHaveBeenCalledTimes(1);
  });

  test('a failed PR is retried on the next tick; the post is not', async () => {
    const openPr = jest.fn().mockRejectedValueOnce(new Error('push refused')).mockResolvedValue('https://pr/2');
    const d = deps({ countRows: jest.fn().mockResolvedValue(510), openPr });
    expect((await X.tick(d)).phase).toBe('stopped');
    expect((await X.tick(d)).phase).toBe('done');
    expect(openPr).toHaveBeenCalledTimes(2);
    expect(d.publish).toHaveBeenCalledTimes(1);
  });

  test('manifest off before any stop: de-registers and does nothing else', async () => {
    const d = deps({ manifestOn: () => false });
    await X.tick(d);
    const r = await X.tick(d);
    expect(r.phase).toBe('off');
    expect(d.countRows).not.toHaveBeenCalled();
    expect(d.settings().hooks.Stop).toBeUndefined();
  });

  test('after the stop, a manifest still saying true never re-registers', async () => {
    const d = deps({ countRows: jest.fn().mockResolvedValue(510) });
    await X.tick(d);
    await X.tick(d);
    expect((d.settings().hooks.Stop || []).length).toBe(0);
    expect(d.settings().hooks.UserPromptSubmit[0].hooks[0].command).not.toContain('LABEL_LOG');
  });

  test('dry run composes but never posts, opens a PR, or records a stop', async () => {
    const d = deps({ countRows: jest.fn().mockResolvedValue(510), dryRun: true });
    const r = await X.tick(d);
    expect(r.phase).toBe('dry-run');
    expect(d.publish).not.toHaveBeenCalled();
    expect(d.openPr).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(false);
  });
});
