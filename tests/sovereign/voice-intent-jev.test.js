'use strict';

/**
 * AB-12-S1-01 — the Jev option on operator voice intents. Off by default; local-only; runs only
 * after speaker, mandate and target checks; may annotate or ABSTAIN, never choose a verb, a
 * subject or a target. Fallback cases assert the route's response is the one it gave before.
 * Mocked transport throughout.
 */

const Fastify = require('../../management-api/node_modules/fastify');
const { createMandate, signMandate } = require('../../management-api/lib/mandate');
const voiceIntentRoutes = require('../../management-api/routes/voice-intent');
const { parseIntent } = require('../../management-api/lib/voice-intent');
const vj = require('../../management-api/lib/voice-intent-jev');

const ISSUER = 'a'.repeat(64);
const SPEAKER = 'b'.repeat(64);
const ACTOR = 'c'.repeat(64);
const ACTOR_DID = `did:nostr:${ACTOR}`;

const LOCAL = {
  AGENTBOX_JEV_VOICE_INTENT: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1',
  AGENTBOX_SKILL_ROUTE_API: 'http://lan/v1/systemone', AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL: '1',
};
const ok = (answers) => async () => ({ ok: true, status: 200, json: async () => ({ model: 'local', answers, usage: {} }) });
const fam = (choice, confidence = 0.9) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });
const noul = (p) => ({ type: 'noul', noul: p });
const logs = [];
const run = (transcript, env, fetchImpl) => vj.interpret(parseIntent(transcript), { env, fetchImpl, log: (l) => logs.push(l) });

describe('lib/voice-intent-jev — fallback equivalence', () => {
  const T = 'delete the node about old prototype';
  const strict = { ...LOCAL, AGENTBOX_JEV_VOICE_VETO_BELOW: '0.5' };
  const misses = {
    'flag off': [{ ...LOCAL, AGENTBOX_JEV_VOICE_INTENT: '0' }, ok({ family: fam('delete'), verb_ok: noul(0) })],
    'flag unset': [{}, ok({})],
    'cloud key only (local-only consumer)': [{ AGENTBOX_JEV_VOICE_INTENT: '1', TYPESAFE_API_KEY: 'k' }, ok({})],
    'proxy not declared local': [{ AGENTBOX_JEV_VOICE_INTENT: '1', AGENTBOX_SYSTEM_ONE_PROXY: '1', AGENTBOX_SKILL_ROUTE_API: 'http://p' }, ok({})],
    'transport error': [strict, async () => { throw new Error('down'); }],
    timeout: [strict, async () => { const e = new Error('a'); e.name = 'AbortError'; throw e; }],
    'http 500': [strict, async () => ({ ok: false, status: 500, json: async () => ({}) })],
    'http 429': [strict, async () => ({ ok: false, status: 429, json: async () => ({}) })],
    'unparseable body': [strict, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })],
    'answers missing': [strict, ok({})],
    'family outside the offered set': [strict, ok({ family: fam('format-disk'), verb_ok: noul(0) })],
    'verb_ok missing': [strict, ok({ family: fam('delete') })],
  };
  for (const [name, [env, fetchImpl]] of Object.entries(misses)) {
    it(`${name}: resolves null`, async () => { expect(await run(T, env, fetchImpl)).toBeNull(); });
  }
});

describe('lib/voice-intent-jev — wire shape and decisions', () => {
  it('builds a Choice MAP over the grammar families + unclear, and a Noul only for state-changing parses', () => {
    const del = vj.buildRequest(parseIntent('delete the node about old prototype'));
    expect(Object.keys(del.questions.family.criteria)).toEqual(['link', 'transform', 'delete', 'update', 'create', 'query', 'unclear']);
    expect(Array.isArray(del.questions.family.criteria)).toBe(false);
    expect(del.questions.verb_ok.type).toBe('noul');
    expect(del.state.parsed.verb).toBe('delete');
    expect(del.state.allowed_commands).toContain('link');
    const q = vj.buildRequest(parseIntent('find the latest research'));
    expect(q.questions.verb_ok).toBeUndefined();
    const unrec = vj.buildRequest(parseIntent('mumble mumble'));
    expect(unrec.questions.verb_ok).toBeUndefined();
    expect(unrec.state.parsed).toBeUndefined();
  });

  it('default thresholds abstain from nothing: a doubted delete is only annotated', async () => {
    const r = await run('delete the node about old prototype', LOCAL, ok({ family: fam('unclear', 0.99), verb_ok: noul(0.01) }));
    expect(r.clarify).toBe(false);
    expect(r.agrees).toBe(false);
    expect(r.verbOk).toBe(0.01);
  });

  it('a low verb_ok below the veto threshold abstains; a confident one does not', async () => {
    const env = { ...LOCAL, AGENTBOX_JEV_VOICE_VETO_BELOW: '0.5' };
    expect((await run('delete the node about old prototype', env, ok({ family: fam('delete'), verb_ok: noul(0.1) }))).clarify).toBe(true);
    const good = await run('delete the node about old prototype', env, ok({ family: fam('delete'), verb_ok: noul(0.95) }));
    expect(good.clarify).toBe(false);
    expect(good.agrees).toBe(true);
  });

  it('`unclear` at or above its threshold abstains on a mutating parse; read-only parses are never held', async () => {
    const env = { ...LOCAL, AGENTBOX_JEV_VOICE_UNCLEAR_AT: '0.8' };
    expect((await run('update the meeting notes', env, ok({ family: fam('unclear', 0.9), verb_ok: noul(0.9) }))).clarify).toBe(true);
    expect((await run('update the meeting notes', env, ok({ family: fam('unclear', 0.5), verb_ok: noul(0.9) }))).clarify).toBe(false);
    expect((await run('find the budget', env, ok({ family: fam('unclear', 0.99) }))).clarify).toBe(false);
  });

  it('an unrecognised utterance is annotated with a suggested family and never turned into a mutating verb', async () => {
    const intent = parseIntent('blah blah unrecognised mumbling');
    const r = await vj.interpret(intent, { env: { ...LOCAL, AGENTBOX_JEV_VOICE_VETO_BELOW: '1', AGENTBOX_JEV_VOICE_UNCLEAR_AT: '0' }, fetchImpl: ok({ family: fam('delete', 0.99) }) });
    expect(r.family).toBe('delete');
    expect(r.clarify).toBe(false);
    expect(intent.verb).toBe('query');
    expect(intent.recognised).toBe(false);
  });
});

describe('/v1/voice-intent — the Jev option in the route', () => {
  let prevAuth;
  beforeAll(() => { prevAuth = process.env.AGENTBOX_AGENT_EVENT_AUTH; process.env.AGENTBOX_AGENT_EVENT_AUTH = 'off'; });
  afterAll(() => {
    if (prevAuth === undefined) delete process.env.AGENTBOX_AGENT_EVENT_AUTH; else process.env.AGENTBOX_AGENT_EVENT_AUTH = prevAuth;
  });
  const fakeSigner = { async sign(unsigned) { return { ...unsigned, id: 'mandate-id', pubkey: ISSUER, sig: 'sig' }; } };
  const mandate = async () => signMandate(createMandate({ issuer: ISSUER, agent: SPEAKER, container: '/kg/' }).record, fakeSigner);

  async function makeApp(extra = {}) {
    const app = Fastify({ logger: false });
    const dispatched = [];
    await app.register(voiceIntentRoutes, {
      logger: { debug() {}, warn() {}, info() {}, error() {} }, manifest: {},
      dispatchActionRequest: async (u) => { dispatched.push(u); return { ...u, id: 'signed-31402-id', pubkey: 'signer', sig: 'sig' }; },
      verifyMandateEvent: () => true,
      ...extra,
    });
    await app.ready();
    return { app, dispatched };
  }
  const post = async (app, payload) => app.inject({ method: 'POST', url: '/v1/voice-intent', payload });
  const strip = (b) => { const { event_id, notification, dispatch, ...rest } = b; return rest; };

  it('option off (the default): the response is the pre-change response and no interpretation key appears', async () => {
    const m = await mandate();
    const base = await makeApp();
    const off = await makeApp({ interpretIntent: async () => null });
    const a = await post(base.app, { transcript: 'delete the node about old prototype', actor_did: ACTOR_DID, mandate: m });
    const b = await post(off.app, { transcript: 'delete the node about old prototype', actor_did: ACTOR_DID, mandate: m });
    expect(a.statusCode).toBe(200);
    expect(strip(b.json())).toEqual(strip(a.json()));
    expect(a.json().interpretation).toBeUndefined();
    expect(base.dispatched).toHaveLength(1);
    expect(off.dispatched).toHaveLength(1);
    await base.app.close(); await off.app.close();
  });

  it('accept path (annotate): the interpretation rides the response and the dispatch still runs unchanged', async () => {
    const m = await mandate();
    const seen = [];
    const { app, dispatched } = await makeApp({ interpretIntent: async (intent) => { seen.push(intent.verb); return { set: vj.QUESTION_SET, family: 'delete', agrees: true, clarify: false }; } });
    const res = await post(app, { transcript: 'delete the node about old prototype', actor_did: ACTOR_DID, mandate: m });
    expect(res.statusCode).toBe(200);
    expect(res.json().interpretation.family).toBe('delete');
    expect(res.json().intent.verb).toBe('delete');
    expect(res.json().dispatch.request_event_id).toBe('signed-31402-id');
    expect(dispatched).toHaveLength(1);
    expect(seen).toEqual(['delete']);
    await app.close();
  });

  it('abstention: a doubted mutating intent is held 422 and nothing is dispatched', async () => {
    const m = await mandate();
    const { app, dispatched } = await makeApp({ interpretIntent: async () => ({ set: vj.QUESTION_SET, family: 'unclear', clarify: true }) });
    const res = await post(app, { transcript: 'delete the node about old prototype', actor_did: ACTOR_DID, mandate: m });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('clarification-needed');
    expect(dispatched).toHaveLength(0);
    await app.close();
  });

  it('authority: the option is never consulted before the mandate, signature, activity and target checks', async () => {
    const m = await mandate();
    let calls = 0;
    const spy = async () => { calls++; return null; };
    const a = await makeApp({ interpretIntent: spy });
    expect((await post(a.app, { transcript: 'find the budget', actor_did: ACTOR_DID })).statusCode).toBe(403);               // no mandate
    expect((await post(a.app, { transcript: 'find the budget', actor_did: ACTOR_DID, mandate: { kind: 1, content: '{}' } })).statusCode).toBe(403);
    expect((await post(a.app, { transcript: 'find the budget', actor_did: 'not-a-did', mandate: m })).statusCode).toBe(400); // bad target
    await a.app.close();
    const unverified = await makeApp({ interpretIntent: spy, verifyMandateEvent: () => false });
    expect((await post(unverified.app, { transcript: 'find the budget', actor_did: ACTOR_DID, mandate: m })).statusCode).toBe(403);
    await unverified.app.close();
    expect(calls).toBe(0);
  });

  it('end to end through the real option with a mocked local judge: flag on + thresholds set abstains; flag off dispatches', async () => {
    const m = await mandate();
    const prevFetch = globalThis.fetch;
    const prevEnv = { ...process.env };
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ model: 'local', answers: { family: fam('unclear', 0.95), verb_ok: noul(0.05) }, usage: {} }) });
    try {
      Object.assign(process.env, LOCAL, { AGENTBOX_JEV_VOICE_VETO_BELOW: '0.5' });
      const on = await makeApp();
      const held = await post(on.app, { transcript: 'delete the node about old prototype', actor_did: ACTOR_DID, mandate: m });
      expect(held.statusCode).toBe(422);
      expect(on.dispatched).toHaveLength(0);
      await on.app.close();
      process.env.AGENTBOX_JEV_VOICE_INTENT = '0';
      const off = await makeApp();
      const sent = await post(off.app, { transcript: 'delete the node about old prototype', actor_did: ACTOR_DID, mandate: m });
      expect(sent.statusCode).toBe(200);
      expect(off.dispatched).toHaveLength(1);
      await off.app.close();
    } finally {
      globalThis.fetch = prevFetch;
      for (const k of Object.keys(process.env)) if (!(k in prevEnv)) delete process.env[k];
      Object.assign(process.env, prevEnv);
    }
  });
});
