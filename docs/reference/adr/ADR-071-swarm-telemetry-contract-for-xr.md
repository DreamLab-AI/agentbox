# ADR-071: Swarm-telemetry contract as consumed by the XR visualiser

**Status**: Proposed (2026-08-30)
**Relates to**: ADR-051 (Loom client — agents whose work is being visualised), VisionClaw ADR-140 (XR agent-swarm visualisation, consumer side), VisionClaw ADR-059 (agent-action `0x23` beam wire)

## Context

VisionClaw's Vive XR client is gaining an embodied agent-swarm visualisation
(VisionClaw ADR-140): agent avatars glide to the graph node they are working on,
a work beam streams agent→node, and a HUD Swarm tab lists the roster with
status and current task. That visualisation is a **pure consumer** — it renders
whatever telemetry the swarm emits. This ADR records, from the agentbox
(producer) side, the minimal contract agents must satisfy for the visualisation
to light up, so the producer and consumer do not drift.

The investigation behind ADR-140 found the telemetry estate is largely
scaffolding: the agent-action beam frame is live and fanned to all clients, but
the agent status / current-task pipeline emits placeholder data on a socket the
XR client never opens. So "what must agentbox emit" is a real, currently-unmet
requirement, not a formality.

## Decision

The XR visualisation binds to exactly two facts per agent, in priority order:

1. **The work link (REQUIRED, already wired).** Each meaningful agent action
   MUST emit an agent-action event carrying `source_agent_id` and the KG-space
   `target_node_id` of the node being acted on, plus an `action_type`
   (`Query|Update|Create|Delete|Link|Transform`). This is the `0x23` beam
   (VisionClaw ADR-059, `AgentBeamActor`), already broadcast to every `/wss`
   client. **Without a `target_node_id`, an agent cannot be embodied** — it has
   no node to glide to and no beam to draw. Agents that never emit actions appear
   only as idle roster entries.
   - The optional action payload SHOULD carry `{"intent": "<short task line>"}`.
     The XR client uses `intent` as the agent's current-task line until a richer
     status channel exists.

2. **Status + task (OPTIONAL, producer currently missing).** For the 4-channel
   status halo (`idle | working | blocked | done`) and a durable task line, the
   swarm SHOULD emit an agent-state update with `{ agentId, status, currentTask,
   targetNodeId? }`. Contract points:
   - `status` is a free-form string. The XR client maps it:
     `busy|active|working|running → working`; `blocked|error → blocked`;
     `done|terminating|offline → done`; anything else → `idle`. Agents SHOULD
     use `blocked` when stalled awaiting input and `done` on task completion —
     these two values are the reason the halo can show more than working/idle.
   - Delivery: a JSON text frame on the graph `/wss` socket (emitted via the same
     `BroadcastMessage` fan-out the `broker:new_case` envelope already uses), NOT
     the desktop-only `/api/visualization/agents/ws` socket, which the XR client
     never opens. The consumer-side landing point (`apply_agent_state`) already
     exists; the producer does not.

3. **Identity.** Agents SHOULD carry their sovereign `did_nostr` (ADR-051 trust
   key) alongside `agentId`; the XR avatar already keys its badge on the DID.

## Consequences

- **Positive:** the contract is small and mostly already met — emit `0x23`
  actions with a real `target_node_id` and the beam + embodiment work today. The
  status/task tier is additive and degrades gracefully (agents still render,
  just with coarser status).
- **Negative / accepted:** the richer status tier requires a producer that does
  not exist yet. Until an agent-state text frame is emitted on `/wss`, XR status
  is `working`/`idle` inferred from action recency and the task line is the
  action `intent`. This is a known gap, owned jointly with VisionClaw ADR-140's
  follow-up.
- **Anti-drift:** any change to the agent-action or agent-state shape MUST update
  both this ADR and VisionClaw ADR-140. The wire is the contract; these two
  documents are its two ends.
