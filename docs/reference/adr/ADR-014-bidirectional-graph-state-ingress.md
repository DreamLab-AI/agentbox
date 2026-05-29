# ADR-014: Bi-directional graph-state ingress for agent reaction

**Status:** Accepted
**Date:** 2026-04-28
**Author:** Agentbox team
**Supersedes:** n/a — first formal decision on inbound graph signals
**Related:**
- ADR-005 (pluggable adapter architecture — events slot)
- ADR-008 (privacy filter / OPF middleware — applies to inbound `user_interaction`)
- ADR-009 (embedded Nostr relay — durable cross-session channel; deferred to Phase 5)
- ADR-013 (canonical URI grammar — `did:nostr:<pubkey>`, `urn:agentbox:*`)
- PRD-006 (Linked-data interfaces — viewer slot S12)
- DDD-003 (sovereign messaging — operator pubkey + relay allowlist)
- DDD-004 (linked-data interchange — URI canonicaliser aggregate)
- **Pair:** VisionClaw ADR-059 (bi-directional URI-keyed agent activity channel — server side; this ADR is the agentbox half of the same contract)

## TL;DR

Agentbox today only **emits** agent activity (claude-flow hooks → AgentEventPublisher → JSON-RPC + binary frames). It cannot consume signals from the integrating host (VisionClaw or any future Linked-Data host) so agents are blind to user attention, graph mutations, and authority grants. This ADR adds a single inbound channel — a WebSocket subscriber to the host's `/wss/agent-events` endpoint — that delivers `user_interaction` and (later) `graph_delta` and `authority_grant` events into the existing AgentEventPublisher pubsub. Agents wake on user focus / select / hover / drag for the duration of the interaction. The pair-ADR (VisionClaw ADR-059) defines the wire format; this ADR defines how the agentbox side subscribes, attributes, filters, and routes.

## Context

Three observations forced the decision:

1. **The current bridge is one-way.** `management-api/utils/agent-event-bridge.js` opens a TCP socket toward `MCP_TCP_HOST:MCP_TCP_PORT` (default `localhost:9500`), serialises agent events outbound, and consumes nothing inbound. The reconnect storm visible in agentbox logs (`Agent event bridge error: connect ECONNREFUSED 127.0.0.1:9500`) is the artefact of this assumption clashing with VisionClaw's actual socket layout (MCP listens on `:3001` inside `visionclaw_container`, not `:9500` inside agentbox).

2. **Agents cannot see user attention.** VisionClaw renders `AgentCapsule` nodes in a 3D spring graph and the user routinely focuses, selects, hovers, or drags specific KGNodes. Today nothing about that interaction reaches the agent runtime. An agent answering "what is the user looking at?" has to guess. This breaks the user-aware-agent UX the integrating host wants.

3. **The events adapter slot is empty for ingress.** Agentbox's pluggable-adapter contract (ADR-005) defines five slots — beads, pods, memory, **events**, orchestrator — each with `local-*`, `external`, or `off` implementations. The events slot today (`events = "local-jsonl"`) only **writes**. The slot's contract (ADR-005 §events) explicitly allows bidirectional adapters; we just haven't built one.

## Decision

Agentbox adds an **inbound WebSocket subscriber** that participates in the events adapter slot. The subscriber routes inbound events into the existing `agentEventPublisher` pubsub so any agent or skill that already subscribes to outbound events can subscribe to inbound events the same way.

### 1. Subscriber transport

A new module `management-api/utils/agent-event-ws-subscriber.js` opens a WebSocket to the integrating host's `/wss/agent-events` (subprotocol `vc-agent-events.v1`).

- Connection target is configured via `[adapters.events].host_ws_url` in `agentbox.toml`, with env-var override `AGENTBOX_HOST_WS_URL`.
- When the slot is `events = "off"`, the subscriber does not start.
- When the slot is `events = "external"` and the URL is set, the subscriber starts at boot under supervision (`flake.nix` supervisor block emits a `[program:agent-event-ws]`).
- Reconnect uses exponential backoff (1 s → 30 s, capped); identical to existing `agent-event-bridge.js` reconnect behaviour for operator familiarity.
- Authentication uses the same NIP-98 path as outbound: a signed kind-27235 event with the agent's own `did:nostr:<pubkey>` is presented in the `Authorization` header on the WS upgrade. The host validates per its own auth middleware (VisionClaw `RequireAuth` per ADR-059 §1).

### 2. Inbound event types

The subscriber accepts the additive envelope defined in VisionClaw ADR-059 §3:

```jsonc
{
  "version": 1,
  "type": "user_interaction",
  "kind": "focus" | "select" | "hover" | "drag",
  "session_id": "uuid-v4",
  "session_pubkey": "abc...",                                // optional did:nostr hex
  "target_node_id": 4242,
  "target_urn": "urn:visionclaw:kg:...",                     // present if known
  "duration_ms": 1500,
  "timestamp": 1714312345678
}
```

Three event types are recognised in this ADR; later phases extend the set:

| Phase | type | source | sink |
|---|---|---|---|
| 2 | `user_interaction` | VisionClaw user | agents subscribed to `user-focus` topic |
| 5 | `graph_delta` | VisionClaw Neo4j change feed | agents that registered a query subscription |
| 5 | `authority_grant` | VisionClaw operator | NIP-26 delegation handler (gates auth) |

`graph_delta` and `authority_grant` are **out of scope for this ADR**. They get their own follow-on (ADR-015 and ADR-016 respectively) and are gated on Phase 5 of ADR-059.

### 3. Routing into the agent runtime

Inbound events are normalised into the existing `AgentEvent` envelope (`management-api/utils/agent-event-publisher.js:44-54`) with one extension:

```diff
{
   id, timestamp, type, source_agent_id, target_node_id,
   action_type, duration_ms, metadata,
+  direction: "inbound"  // new: "inbound" | "outbound"; default "outbound"
}
```

The publisher delivers to all subscribers regardless of direction. Subscribers MAY filter on `direction` if they care.

A new helper subscription `agentEventPublisher.subscribeInbound(filterSpec, handler)` is added so agents and skills can register interest by `{ kind, target_urn_prefix, session_pubkey }`. This is sugar over the existing pubsub; semantics are unchanged.

### 4. Identity attribution — phased (matches ADR-059)

| Phase | `session_pubkey` requirement | Action on missing |
|---|---|---|
| 1 | optional | accept; tag event `attribution: anonymous` |
| 2 | optional | as above |
| 3 | optional | as above |
| 4 | required when host claims write authority over an ADR-050 owned KGNode | reject + log |
| 5 | required + signed + NIP-26 delegation chain validated by `auth.js` | fail-closed (ADR-005 W030 lift) |

Phase 5 enforcement depends on the future ADR-016 (NIP-26 delegation handler in `management-api/middleware/auth.js`). Until ADR-016 lands, attribution is best-effort.

### 5. Privacy filter (OPF) integration

The OPF middleware (ADR-008) wraps every adapter dispatch. Inbound `user_interaction` events pass through the **inbound** OPF policy (`OPF_POLICY_INBOUND`, agentbox.toml `[privacy.policy].inbound`):

- `strict` — drop event if `target_urn` resolves to a credential / pod-scoped resource the agent's pubkey does not own.
- `soft` — log + redact `metadata` but allow the event to reach subscribers.
- `off` — pass through unchanged (default in dev).

This composes cleanly with the existing OPF flow (`OPF_POLICY_PODS=strict, OPF_POLICY_MEMORY=strict, OPF_POLICY_INBOUND=soft`); no new middleware shape is introduced.

### 6. URN expectations

Inbound `target_urn` values are minted by the host per their own grammar. Agentbox **resolves** but does **not** persist them. The existing `lib/uris.js` parser is extended only to recognise `urn:visionclaw:*` as a valid foreign URN that round-trips through the resolver (`/v1/uri/<urn>` returns 307 to the host's resolver when the URN matches a known external prefix configured in `agentbox.toml [linked_data.federation.peers]`).

This preserves ADR-013's invariant: every URN agentbox **mints** is unique by construction; URNs agentbox **observes** but does not own are passed through as opaque labels.

## Phasing

| Phase | Deliverable | Code surface |
|---|---|---|
| 1 | `agentbox.toml` schema for `[adapters.events].host_ws_url`; subscriber stub returns 501 if URL set without flag | manifest schema only |
| 2 | Full subscriber + `direction: "inbound"` extension + `subscribeInbound` helper; OPF integration | `management-api/utils/agent-event-ws-subscriber.js` (~200 lines), `management-api/utils/agent-event-publisher.js` (+30 lines), supervisor block in `flake.nix` |
| 3 | Recognised inbound types: `user_interaction` (focus/select/hover/drag) | event-type registry update; no protocol break |
| 4 | Phase-4 attribution gate (require pubkey for ownership-claiming events) | `auth.js` (+40 lines) |
| 5 | Inbound `graph_delta` + `authority_grant`; full NIP-26 delegation enforcement | ADR-015 + ADR-016 (separate decisions) |

Phases 1–3 are scoped to one sprint and land alongside VisionClaw ADR-059 phases 1–3.

## Consequences

**Positive.**

- The agentbox events adapter slot finally has a bidirectional implementation. Per ADR-005 it can therefore swap to `external` against any host that speaks the same WS contract — VisionClaw is the first integrator, but the contract is generic.
- The `agent-event-bridge.js` ECONNREFUSED loop is resolved by deprecating the TCP outbound (in favour of the same WebSocket carrying both directions). The supervisor block for the legacy bridge is removed in Phase 2.
- Agents become user-aware. The simplest UX example: an agent watching `user_interaction.kind = "focus"` can pre-fetch context for the focused node via its existing skills before the user clicks.
- The OPF middleware applies symmetrically to inbound and outbound, preserving the ADR-005 / ADR-008 layering invariant (privacy redaction → JSON-LD encoder → adapter dispatch).

**Negative.**

- Adds one always-on subscriber process under supervision. Memory cost: ~5 MB per agentbox instance. CPU cost: negligible.
- The legacy `agent-event-bridge.js` must keep working in Phase 1 (events still flow to VisionClaw via TCP if the WS is not configured) until Phase 2 cuts over. Two paths for one sprint is operationally messy.
- `target_urn` round-tripping creates a small dependency on host availability for resolver redirects. Mitigation: resolver returns the original URN as 410 when the host federation peer is unreachable, per agentbox ADR-013 §Resolver semantics.

**Reversible?** Yes through Phase 3. Phase 4 (auth gate) requires a feature-flag rollback path for one release.

### Implementation note — 2026-05-29 (producer convergence)

Phase-1 work on the VisionClaw pair (ADR-059) surfaced a producer-side bug worth
recording: the deprecated `agent-event-bridge.js` JSON path hand-rolled its own
`notifications/agent_action` literal instead of calling the publisher's builder,
so it **computed the ADR-013 identity (`source_urn`/`target_urn`/`pubkey`) and
then discarded it** before the wire. Every transport now emits through the single
canonical builder `agentEventPublisher.createMcpNotification(event)`; the bridge
no longer constructs its own envelope. This makes the "canonical schema source"
claim in ADR-059 literally true — there is one builder, not one-builder-plus-a-
divergent-copy. Guarded by `tests/sovereign/agent-event-notification.test.js`
(asserts identity end-to-end **and** that the bridge contains no inline
`method: 'notifications/agent_action'` literal). The legacy bridge is otherwise
unchanged: still gated behind `ENABLE_MCP_BRIDGE` (default off) pending Phase-2
removal. Commit `8005fc3f`.

### Implementation note — 2026-05-29 (consumer side now consumes)

The VisionClaw consumer half landed too (ADR-059 Phase 2a): a new authenticated
`/wss/agent-events` ingest handler (`project/src/agent_events/ingest.rs`) parses
the canonical `notifications/agent_action` envelope, validates it, and publishes
it to a process-global broadcast hub. **This is the actual close of the X2 gap
this ADR was written to fix** — the pushed events agentbox emits are now *read*
by VisionClaw rather than dropped (previously VisionClaw only polled a list and
never consumed the push). cargo-verified, 7/7 tests, via the live-bind-mounted
`visionclaw_container`.

Two findings from that work refine this ADR's expectations:

1. **The render of ingested actions is a separate increment.** VisionClaw's
   agent-action *render* path is latent — the outbound `0x23` binary broadcast is
   dead code, `MultiMcpVisualizationActor` is never started, and the live
   agent-viz WS emits empty placeholder data. So "ingest" (done) and "render"
   (ADR-059 Phase 2b) are decoupled; the hub is the seam between them. Bolting
   render onto dead substrate was deliberately avoided.
2. **`:9500` retirement is two payloads, not one.** This ADR frames `:9500` as the
   agent-action egress. Implementation showed `:9500` *also* carries agent **state
   snapshots** (VisionClaw `bots_client` polls `query_agent_list` every 2 s for
   cpu/health/status — a different payload from `agent_action`). The
   `agent-event-bridge.js` retarget stops the *action* push hitting `:9500`, but
   fully retiring `:9500` additionally needs the WS contract to carry **state**.
   Tracked as ADR-059 Phasing row 2b.

## Alternatives considered

### A. Polling agentbox for state instead of pushing

VisionClaw could expose `/v1/graph/state?since=...` and have agentbox poll. Rejected: latency-bounded user interactions (focus, drag) need <100 ms freshness; polling at that rate wastes capacity for both sides and breaks under load. WebSocket push matches the existing outbound shape.

### B. Use the embedded Nostr relay (ADR-009) for everything

NIP-04 / NIP-44 DMs are signature-verified by construction and sovereign-by-default. Rejected as the **hot path**: relay round-trip latency (50–200 ms) is too high for spring-system user-interaction effects. Adopted as the **durable cross-session channel** in Phase 5 for `authority_grant` and offline state catch-up.

### C. Add a real MCP TCP listener in VisionClaw on :9500

Matches the agentbox bridge's current expectation; no agentbox-side change needed beyond pointing the bridge at the right host. Rejected: VisionClaw already has WebSocket infrastructure, doesn't want to maintain a binary TCP framing parser, and the new bidirectional surface gets browser-debuggability for free.

## Open questions

1. Should the subscriber accept inbound events from multiple hosts simultaneously (federation), or one host per agentbox instance? (Recommend: one host until federation-mode `[federation.mode = "client"]` requires multi-host; deferred to ADR-015.)
2. When `[adapters.events] = "off"`, should outbound events still be available to in-process subscribers? (Recommend: yes — `local-jsonl` already does this; the slot's `off` value disables external transport, not the publisher itself.)
3. Should `user_interaction` events be persisted to the local JSONL events log? (Recommend: yes when `direction: "inbound"`; helpful for replay-driven testing.)

## References

- Code:
  - Agentbox: `management-api/utils/agent-event-publisher.js:11-224` (publisher), `management-api/utils/agent-event-bridge.js:1-150` (legacy outbound), `management-api/routes/agent-events.js:391-403` (hook ingestion), `management-api/lib/uris.js:72-232` (URN mint + parse), `management-api/middleware/auth.js:33-99` (NIP-98), `flake.nix:970-980` (management-api supervisor block — model for new `agent-event-ws` block)
  - VisionClaw: see ADR-059 references section.
- Manifest:
  - `agentbox.toml` `[adapters].events`, `[adapters.events].host_ws_url` (new), `[privacy.policy].inbound` (new field, accepts `strict|soft|off`)
- ADR-005 events slot definition: `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md` §events
- OPF inbound policy: `docs/reference/adr/ADR-008-privacy-filter-routing.md` §Inbound
- URN grammar (`urn:visionclaw:*` recognition): `docs/reference/adr/ADR-013-canonical-uri-grammar.md` §Foreign URNs (to be added in ADR-014 implementation phase)
