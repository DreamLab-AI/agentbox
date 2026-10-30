'use strict';

/**
 * AB-14-S1-01 — the Jev option on the pending-approvals listing. Advisory only: it adds a
 * `review_aid` and nothing else. Off by default, local-only only when AGENTBOX_JEV_APPROVAL_LOCAL_ONLY=1, per-request fallback, and the
 * decide route is never touched. Mocked transport throughout.
 */

const Fastify = require('../../management-api/node_modules/fastify');
const approvalsRoutes = require('../../management-api/routes/approvals');
const rv = require('../../management-api/lib/approval-review-jev');

// Hermetic: the container exports live System One settings (AGENTBOX_JEV_*,
// AGENTBOX_SYSTEM_ONE_*, TYPESAFE_API_KEY). The default-path tests below must not
// reach the real proxy, so strip them for this file and restore afterwards.
const SYSTEM_ONE_ENV = /^(AGENTBOX_JEV_|AGENTBOX_SYSTEM_ONE_|AGENTBOX_SKILL_ROUTE_|TYPESAFE_API_KEY$|SUBQ_API_KEY$)/;
const savedEnv = {};
beforeAll(() => {
  for (const k of Object.keys(process.env)) if (SYSTEM_ONE_ENV.test(k)) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterAll(() => { Object.assign(process.env, savedEnv); });

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const LOCAL = {
  AGENTBOX_JEV_APPROVAL_REVIEW: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1',
  AGENTBOX_SKILL_ROUTE_API: 'http://lan/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1',
};
const item = (id, reasoning) => ({
  request_event_id: id, panel_id: `p-${id}`, case_id: null, requester_pubkey: 'e'.repeat(64),
  title: `Authorise zero-tolerance action ${id}`, priority: 'critical', created_at: 1,
  content: { fields: { action_class: 'deploy', authority_class: 'zero-tolerance', task_properties: { reversible: false }, operation: { argv: ['deploy', id] }, operation_sha256: 'ab' }, reasoning, context_url: null },
});
const pending = () => [item('r1', 'Release the hotfix for the login outage'), item('r2', null)];
const noul = (p) => ({ type: 'noul', noul: p });
const score = (n) => ({ type: 'score', score: n, confidence: 0.9, legend: { 0: 'a', 1: 'b', 2: 'c' } });
const answers = (p = 0.9, urgency = 1) => ({ ob_purpose: noul(p), ob_scope: noul(p), ob_impact: noul(p), urgency: score(urgency) });
const ok = (a) => async () => ({ ok: true, status: 200, json: async () => ({ model: 'local', answers: a, usage: {} }) });
const run = (items, env, fetchImpl) => rv.annotate(items, { env, fetchImpl, log: () => {} });

describe('fallback equivalence — the SAME array comes back', () => {
  const strict = LOCAL;
  const misses = {
    'flag off': [{ ...LOCAL, AGENTBOX_JEV_APPROVAL_REVIEW: '0' }, ok(answers())],
    'flag unset': [{}, ok(answers())],
    'cloud key only (local-only consumer)': [{ AGENTBOX_JEV_APPROVAL_REVIEW: '1', AGENTBOX_JEV_APPROVAL_LOCAL_ONLY: '1', TYPESAFE_API_KEY: 'k' }, ok(answers())],
    'proxy not declared local': [{ AGENTBOX_JEV_APPROVAL_REVIEW: '1', AGENTBOX_JEV_APPROVAL_LOCAL_ONLY: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://p' }, ok(answers())],
    'transport error': [strict, async () => { throw new Error('down'); }],
    timeout: [strict, async () => { const e = new Error('a'); e.name = 'AbortError'; throw e; }],
    'http 500': [strict, async () => ({ ok: false, status: 500, json: async () => ({}) })],
    'http 429': [strict, async () => ({ ok: false, status: 429, json: async () => ({}) })],
    'unparseable body': [strict, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })],
    'answers missing': [strict, ok({})],
    'an obligation answer missing': [strict, ok({ ob_purpose: noul(0.9), ob_scope: noul(0.9), urgency: score(1) })],
    'urgency out of shape': [strict, ok({ ...answers(), urgency: { type: 'score' } })],
  };
  for (const [name, [env, fetchImpl]] of Object.entries(misses)) {
    it(`${name}`, async () => {
      const input = pending();
      const snapshot = JSON.stringify(input);
      const out = await run(input, env, fetchImpl);
      expect(out).toBe(input);
      expect(JSON.stringify(out)).toBe(snapshot);
    });
  }
  it('an empty list is returned as is', async () => {
    const empty = [];
    expect(await run(empty, LOCAL, ok(answers()))).toBe(empty);
  });
});

describe('not local-only (flag unset)', () => {
  it('uses the proxy for a cloud backend, with no Authorization header', async () => {
    const seen = [];
    const inner = ok(answers());
    const fetchImpl = async (url, init) => { seen.push({ url, headers: init.headers }); return inner(); };
    const env = { AGENTBOX_JEV_APPROVAL_REVIEW: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SYSTEM_ONE_ENDPOINT: 'http://127.0.0.1:8094/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '0' };
    await run(pending(), env, fetchImpl);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].url).toBe('http://127.0.0.1:8094/v1/systemone');
    expect(seen[0].headers.Authorization).toBeUndefined();
  });
});

describe('wire shape and accept path', () => {
  it('one Noul per obligation (string instructions, no criteria) and one 3-level Score; evidence in state', () => {
    const { state, questions } = rv.buildRequest(item('r1', 'Release the hotfix'));
    expect(Object.keys(questions)).toEqual(['ob_purpose', 'ob_scope', 'ob_impact', 'urgency']);
    for (const o of rv.OBLIGATIONS) {
      expect(questions[`ob_${o.id}`].type).toBe('noul');
      expect(typeof questions[`ob_${o.id}`].instructions).toBe('string');
      expect(questions[`ob_${o.id}`].criteria).toBeUndefined();
    }
    expect(questions.urgency.type).toBe('score');
    expect(Array.isArray(questions.urgency.criteria)).toBe(true);
    expect(questions.urgency.criteria).toHaveLength(3);
    expect(state.rationale).toBe('Release the hotfix');
    expect(state.operation).toEqual({ argv: ['deploy', 'r1'] });
    expect(state.task_properties).toEqual({ reversible: false });
    expect(state.authority_class).toBe('zero-tolerance');
  });

  it('annotates with an advisory review_aid, copies instead of mutating, keeps order and every other field', async () => {
    const input = pending();
    const out = await run(input, { ...LOCAL, AGENTBOX_JEV_APPROVAL_ADDRESSED_AT: '0.5' }, ok({
      ob_purpose: noul(0.95), ob_scope: noul(0.9), ob_impact: noul(0.1), urgency: score(2),
    }));
    expect(out).not.toBe(input);
    expect(out.map((r) => r.request_event_id)).toEqual(['r1', 'r2']);
    expect(out[0].review_aid).toEqual({ set: rv.QUESTION_SET, advisory: true, addressed: { purpose: 0.95, scope: 0.9, impact: 0.1 }, unaddressed: ['impact'], urgency: 1 });
    const { review_aid, ...rest } = out[0];
    expect(rest).toEqual(input[0]);
    expect(input[0].review_aid).toBeUndefined();
  });

  it('judges each request independently: one failure leaves only that request unannotated', async () => {
    let n = 0;
    const out = await run(pending(), LOCAL, async () => (n++ === 0 ? ok(answers())() : { ok: false, status: 500, json: async () => ({}) }));
    expect(out[0].review_aid).toBeDefined();
    expect(out[1].review_aid).toBeUndefined();
  });
});

describe('GET /v1/approvals and the decision gate', () => {
  function app(consumer, extra = {}) {
    const a = Fastify();
    a.addHook('onRequest', async (request) => {
      const raw = request.headers['x-test-auth'];
      if (raw) { try { request.auth = JSON.parse(raw); } catch (_) { /* unset */ } }
    });
    a.register(approvalsRoutes, { logger, manifest: {}, authorityConsumer: consumer, ...extra });
    return a;
  }
  const consumer = () => ({ listPending: () => pending(), getPending: () => null, isDecided: () => false });

  it('option off: the listing equals the pre-change listing and carries no review_aid', async () => {
    const base = app(consumer());
    const res = await base.inject({ method: 'GET', url: '/v1/approvals' });
    expect(res.json().approvals).toEqual(pending());
    expect(res.json().approvals[0].review_aid).toBeUndefined();
    await base.close();
  });

  it('option on: review_aid reaches the listing, count and order are unchanged', async () => {
    const a = app(consumer(), { annotateApprovals: (items) => rv.annotate(items, { env: LOCAL, fetchImpl: ok(answers(0.2, 2)), log: () => {} }) });
    const res = await a.inject({ method: 'GET', url: '/v1/approvals' });
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.approvals.map((r) => r.request_event_id)).toEqual(['r1', 'r2']);
    expect(body.approvals[0].review_aid.unaddressed).toEqual(['purpose', 'scope', 'impact']);
    await a.close();
  });

  it('the decide route neither consults the option nor changes its gates', async () => {
    let calls = 0;
    const a = app(consumer(), { annotateApprovals: async (i) => { calls++; return i; } });
    const res = await a.inject({ method: 'POST', url: '/v1/approvals/r1/decide', headers: { 'x-test-auth': JSON.stringify({ mode: 'bearer' }) }, payload: { outcome: 'approve' } });
    expect(res.statusCode).toBe(401);
    expect(calls).toBe(0);
    await a.close();
  });
});
