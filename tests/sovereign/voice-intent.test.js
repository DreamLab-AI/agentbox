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
