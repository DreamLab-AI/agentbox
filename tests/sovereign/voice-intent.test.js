'use strict';

/**
 * WS7 (PRD-014 Seam B / B3, producer): a plain-text voice transcript maps to a
 * deterministic agent intent and the corresponding agent-action emit payload,
 * which the canonical agentEventPublisher renders into the ADR-059 §2 wire
 * envelope (`notifications/agent_action`). The STT engine is out of scope —
 * the producer accepts transcript text.
 */

const {
  IntentError,
  parseIntent,
  resolveActorIdentity,
  buildActionFromIntent,
  transcriptToAction,
} = require('../../management-api/lib/voice-intent');
const { AgentActionType, agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');
const Fastify = require('../../management-api/node_modules/fastify');
const { createMandate, signMandate } = require('../../management-api/lib/mandate');
const voiceIntentRoutes = require('../../management-api/routes/voice-intent');

const DID = `did:nostr:${'a'.repeat(64)}`;
const PUBKEY = 'a'.repeat(64);

describe('parseIntent — deterministic verb→action_type grammar', () => {
  it('maps "create a node about X" → CREATE', () => {
    const i = parseIntent('create a node about photovoltaic cells');
    expect(i.verb).toBe('create');
    expect(i.action_type).toBe(AgentActionType.CREATE);
    expect(i.subject).toBe('photovoltaic cells');
    expect(i.recognised).toBe(true);
  });

  it('maps "link X to Y" → LINK with both operands', () => {
    const i = parseIntent('link solar panels to renewable energy');
    expect(i.verb).toBe('link');
    expect(i.action_type).toBe(AgentActionType.LINK);
    expect(i.subject).toBe('solar panels');
    expect(i.object).toBe('renewable energy');
  });

  it('maps "find/show X" → QUERY', () => {
    expect(parseIntent('find the latest perovskite research').action_type).toBe(AgentActionType.QUERY);
    expect(parseIntent('show me the budget node').action_type).toBe(AgentActionType.QUERY);
  });

  it('maps delete/update/transform verbs to their action_types', () => {
    expect(parseIntent('delete the node about old prototype').action_type).toBe(AgentActionType.DELETE);
    expect(parseIntent('update the meeting notes').action_type).toBe(AgentActionType.UPDATE);
    expect(parseIntent('summarise the meeting notes').action_type).toBe(AgentActionType.TRANSFORM);
  });

  it('falls back to read-only QUERY on an unrecognised utterance (never a silent mutation)', () => {
    const i = parseIntent('blah blah unrecognised mumbling');
    expect(i.action_type).toBe(AgentActionType.QUERY);
    expect(i.recognised).toBe(false);
  });

  it('rejects empty / non-string transcripts', () => {
    expect(() => parseIntent('')).toThrow(IntentError);
    expect(() => parseIntent(null)).toThrow(IntentError);
  });
});

describe('resolveActorIdentity — B4 attribution from env, never from the transcript', () => {
  it('derives source_urn + pubkey from AGENTBOX_DID', () => {
    expect(resolveActorIdentity({ AGENTBOX_DID: DID })).toEqual({ source_urn: DID, pubkey: PUBKEY });
  });
  it('returns nulls when no identity is configured', () => {
    expect(resolveActorIdentity({})).toEqual({ source_urn: null, pubkey: null });
  });
});

describe('buildActionFromIntent + wire envelope', () => {
  it('produces an emit payload that renders the exact ADR-059 §2 wire shape', () => {
    const { emit } = transcriptToAction('link solar panels to renewable energy', { env: { AGENTBOX_DID: DID } });
    // The producer leaves string ids for the route to hash; the publisher
    // accepts numbers, so simulate the route's hashing with fixed numbers here.
    const ev = agentEventPublisher.emitAgentAction({
      ...emit,
      source_agent_id: 7,
      target_node_id: 4242,
    });
    const n = agentEventPublisher.createMcpNotification(ev);

    expect(n.jsonrpc).toBe('2.0');
    expect(n.method).toBe('notifications/agent_action');
    expect(n.params.type).toBe('agent_action');
    expect(n.params.event.version).toBe(3);
    expect(n.params.event.action_type).toBe(AgentActionType.LINK);
    expect(n.params.event.action_type_name).toBe('link');
    expect(n.params.event.source_urn).toBe(DID);
    expect(n.params.event.pubkey).toBe(PUBKEY);
    expect(n.params.message_type).toBe(0x23);
    expect(n.params.protocol_version).toBe(2);
    expect(typeof n.params.timestamp).toBe('string');
    expect(n.params.event.metadata.origin).toBe('voice-transcript');
    expect(n.params.event.metadata.object).toBe('renewable energy');
  });

  it('omits identity (renders null) when no DID is configured', () => {
    const prevUrn = process.env.AGENTBOX_URN;
    const prevDid = process.env.AGENTBOX_DID;
    delete process.env.AGENTBOX_URN;
    delete process.env.AGENTBOX_DID;
    try {
      const { emit } = transcriptToAction('find the budget', { env: {} });
      const ev = agentEventPublisher.emitAgentAction({ ...emit, source_agent_id: 1, target_node_id: 2 });
      const n = agentEventPublisher.createMcpNotification(ev);
      expect(n.params.event.source_urn).toBeNull();
      expect(n.params.event.pubkey).toBeNull();
    } finally {
      if (prevUrn !== undefined) process.env.AGENTBOX_URN = prevUrn;
      if (prevDid !== undefined) process.env.AGENTBOX_DID = prevDid;
    }
  });
});

// ── REC-3 (CTC emitter): token burden + handoff-chain id ride the wire ──────────
describe('REC-3 — CTC fields on the agent-events envelope (emitter side)', () => {
  it('forwards token_count, handoff_id and verification when supplied', () => {
    const ev = agentEventPublisher.emitAgentAction({
      source_agent_id: 1, target_node_id: 2, action_type: AgentActionType.QUERY,
      token_count: 1234, handoff_id: 'urn:agentbox:activity:chain-7', verification: 'pass',
    });
    const n = agentEventPublisher.createMcpNotification(ev);
    expect(n.params.event.token_count).toBe(1234);
    expect(n.params.event.handoff_id).toBe('urn:agentbox:activity:chain-7');
    expect(n.params.event.verification).toBe('pass');
  });

  it('renders the CTC fields null for an existing caller that omits them (byte-compatible)', () => {
    const ev = agentEventPublisher.emitAgentAction({
      source_agent_id: 1, target_node_id: 2, action_type: AgentActionType.QUERY,
    });
    const n = agentEventPublisher.createMcpNotification(ev);
    expect(n.params.event.token_count).toBeNull();
    expect(n.params.event.handoff_id).toBeNull();
    expect(n.params.event.verification).toBeNull();
  });
});

// ── COM-15 (producer): mandate gate + signed-31402 dispatch toward actor_did ────
describe('COM-15 — /v1/voice-intent mandate gate + signed 31402 dispatch', () => {
  const ISSUER = 'a'.repeat(64);   // granting user
  const SPEAKER = 'b'.repeat(64);  // grantee/agent (auth off → the acting principal)
  const ACTOR = 'c'.repeat(64);    // scene-selected TARGET, distinct from the speaker
  const SPEAKER_DID = `did:nostr:${SPEAKER}`;
  const ACTOR_DID = `did:nostr:${ACTOR}`;

  // Isolate the MANDATE gate as the subject under test: pin speaker-auth off so
  // the mandate credential (not NIP-98) is the sole accept/decline gate. With
  // auth off the acting speaker principal is the mandate's grantee (record.agent),
  // which must still be recorded DISTINCTLY from the target actor_did.
  let prevAuth;
  beforeAll(() => { prevAuth = process.env.AGENTBOX_AGENT_EVENT_AUTH; process.env.AGENTBOX_AGENT_EVENT_AUTH = 'off'; });
  afterAll(() => {
    if (prevAuth === undefined) delete process.env.AGENTBOX_AGENT_EVENT_AUTH;
    else process.env.AGENTBOX_AGENT_EVENT_AUTH = prevAuth;
  });

  // A signer that stamps id/pubkey/sig without touching real crypto.
  const fakeSigner = { async sign(unsigned) { return { ...unsigned, id: 'mandate-id', pubkey: ISSUER, sig: 'sig' }; } };

  async function validMandate({ issuedAt, expiresAt } = {}) {
    const { record } = createMandate({ issuer: ISSUER, agent: SPEAKER, container: '/kg/', issuedAt, expiresAt });
    return signMandate(record, fakeSigner);
  }

  // Build a throwaway Fastify app with the route + injected deps.
  async function makeApp(opts = {}) {
    const app = Fastify({ logger: false });
    const dispatched = [];
    const dispatchActionRequest = opts.noDispatcher
      ? undefined
      : async (unsigned) => { dispatched.push(unsigned); return { ...unsigned, id: 'signed-31402-id', pubkey: 'signer', sig: 'sig' }; };
    await app.register(voiceIntentRoutes, {
      logger: { debug() {}, warn() {}, info() {}, error() {} },
      manifest: {},
      dispatchActionRequest,
      verifyMandateEvent: opts.verifyMandateEvent || (() => true),
    });
    await app.ready();
    return { app, dispatched };
  }

  it('DECLINES 403 mandate-required when no mandate is presented (un-gated behind mandate)', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/voice-intent',
      payload: { transcript: 'create a node about solar', actor_did: ACTOR_DID },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('mandate-required');
    await app.close();
  });

  it('ACCEPTS with a valid mandate and DISPATCHES a signed 31402 targeting actor_did', async () => {
    const { app, dispatched } = await makeApp();
    const mandate = await validMandate();
    const res = await app.inject({
      method: 'POST', url: '/v1/voice-intent',
      payload: { transcript: 'link solar to renewable energy', actor: 'scene-actor', actor_did: ACTOR_DID, mandate },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.dispatched).toBe(true);
    // Dispatch evidence resolves to the signed 31402.
    expect(body.dispatch.request_event_id).toBe('signed-31402-id');
    expect(body.dispatch.kind).toBe(31402);
    expect(body.dispatch.target_did).toBe(ACTOR_DID);
    // Speaker and actor are DISTINCT principals (DDD-017 invariant 6).
    expect(body.speaker_did).toBe(SPEAKER_DID);
    expect(body.actor_did).toBe(ACTOR_DID);
    expect(body.speaker_did).not.toBe(body.actor_did);
    // The dispatched event is a kind-31402 addressed to the actor (`p` tag),
    // carrying speaker/actor as distinct fields — never a hashed nickname.
    expect(dispatched).toHaveLength(1);
    const evt = dispatched[0];
    expect(evt.kind).toBe(31402);
    expect(evt.tags.some((t) => t[0] === 'p' && t[1] === ACTOR)).toBe(true);
    const content = JSON.parse(evt.content);
    expect(content.fields.speaker_did).toBe(SPEAKER_DID);
    expect(content.fields.actor_did).toBe(ACTOR_DID);
    await app.close();
  });

  it('DECLINES 403 mandate-invalid for a malformed mandate event', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/voice-intent',
      payload: { transcript: 'find the budget', actor_did: ACTOR_DID, mandate: { kind: 1, content: '{}' } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('mandate-invalid');
    await app.close();
  });

  it('DECLINES 403 mandate-unverified when the mandate signature does not verify', async () => {
    const { app } = await makeApp({ verifyMandateEvent: () => false });
    const mandate = await validMandate();
    const res = await app.inject({
      method: 'POST', url: '/v1/voice-intent',
      payload: { transcript: 'find the budget', actor_did: ACTOR_DID, mandate },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('mandate-unverified');
    await app.close();
  });

  it('DECLINES 403 mandate-inactive for an expired mandate', async () => {
    const { app } = await makeApp();
    const mandate = await validMandate({ issuedAt: 500, expiresAt: 1000 }); // long past
    const res = await app.inject({
      method: 'POST', url: '/v1/voice-intent',
      payload: { transcript: 'find the budget', actor_did: ACTOR_DID, mandate },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('mandate-inactive');
    await app.close();
  });

  it('DECLINES 400 actor_did-invalid when the target is not a did:nostr', async () => {
    const { app } = await makeApp();
    const mandate = await validMandate();
    const res = await app.inject({
      method: 'POST', url: '/v1/voice-intent',
      payload: { transcript: 'find the budget', actor_did: 'not-a-did', mandate },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('actor_did-invalid');
    await app.close();
  });

  it('DECLINES 503 dispatch-unavailable when no signed-31402 dispatcher is wired (fail-closed)', async () => {
    const { app } = await makeApp({ noDispatcher: true });
    const mandate = await validMandate();
    const res = await app.inject({
      method: 'POST', url: '/v1/voice-intent',
      payload: { transcript: 'find the budget', actor_did: ACTOR_DID, mandate },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('dispatch-unavailable');
    await app.close();
  });
});
