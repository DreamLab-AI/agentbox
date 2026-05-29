'use strict';

/**
 * ADR-014 / ADR-059 Phase 1 — agentbox is the canonical schema source for the
 * agent-action wire envelope (ADR-059 §2: "agentbox agent-event-publisher.js
 * remains the canonical schema source; VisionClaw mirrors it in
 * src/agent_events/schema.rs").
 *
 * The envelope MUST carry the ADR-013 identity attribution (source_urn /
 * target_urn / pubkey) so a `did:nostr` is not dropped at the VisionClaw
 * federation boundary, and EVERY transport (the /v1/agent-events/stream
 * WebSocket and the deprecated MCP-TCP bridge) MUST emit that one shape — no
 * divergent inline builder that loses identity.
 */

const fs = require('fs');
const path = require('path');
const { agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');

const DID = `did:nostr:${'a'.repeat(64)}`;
const TARGET = `urn:visionclaw:kg:${'b'.repeat(64)}:sha256-12-deadbeef0011`;

describe('canonical agent-action notification (ADR-059 §2 envelope)', () => {
  it('carries the ADR-013 identity attribution end to end', () => {
    const ev = agentEventPublisher.emitAgentAction({
      source_agent_id: 7,
      target_node_id: 4242,
      action_type: 'update',
      duration_ms: 250,
      source_urn: DID,
      target_urn: TARGET,
      pubkey: 'a'.repeat(64),
      metadata: { note: 'x' },
    });
    const n = agentEventPublisher.createMcpNotification(ev);

    expect(n.method).toBe('notifications/agent_action');
    expect(n.params.event.version).toBe(3);
    expect(n.params.event.id).toBe(ev.id);
    expect(n.params.event.source_urn).toBe(DID);
    expect(n.params.event.target_urn).toBe(TARGET);
    expect(n.params.event.pubkey).toBe('a'.repeat(64));
    expect(n.params.event.action_type).toBe(1); // update
    expect(n.params.event.action_type_name).toBe('update');
    expect(n.params.message_type).toBe(0x23);
    expect(n.params.protocol_version).toBe(2);
  });

  it('emits null identity (not undefined) when attribution is absent', () => {
    const prevUrn = process.env.AGENTBOX_URN;
    const prevDid = process.env.AGENTBOX_DID;
    delete process.env.AGENTBOX_URN;
    delete process.env.AGENTBOX_DID;
    try {
      const ev = agentEventPublisher.emitAgentAction({
        source_agent_id: 1,
        target_node_id: 2,
        action_type: 0,
      });
      const n = agentEventPublisher.createMcpNotification(ev);
      expect(n.params.event.source_urn).toBeNull();
      expect(n.params.event.target_urn).toBeNull();
      expect(n.params.event.pubkey).toBeNull();
    } finally {
      if (prevUrn !== undefined) process.env.AGENTBOX_URN = prevUrn;
      if (prevDid !== undefined) process.env.AGENTBOX_DID = prevDid;
    }
  });
});

describe('the deprecated MCP-TCP bridge routes through the canonical builder (no drift)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../management-api/utils/agent-event-bridge.js'),
    'utf8'
  );

  it('delegates to the canonical schema source', () => {
    expect(src).toMatch(/agentEventPublisher\.createMcpNotification\(event\)/);
  });

  it('does not hand-roll an inline notifications/agent_action literal that drops identity', () => {
    expect(src).not.toMatch(/method:\s*'notifications\/agent_action'/);
  });
});
