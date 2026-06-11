---
id: ADR-028
title: Per-User Agent Fabric (pod-sourced identity, RuVector memory, heartbeat autonomy)
status: Proposed
date: 2026-06-11
supersedes: []
related: [ADR-008, ADR-009, ADR-010, ADR-015, ADR-018, PRD-008]
"@context": https://schema.org
"@type": TechArticle
---

# ADR-028: Per-User Agent Fabric

## Status

Proposed (2026-06-11). Minimal prototype landed alongside this ADR.

## Context

We ship one *shared* forum agent (JunkieJarvis, ADR-adjacent to PRD-008 /
`management-api/lib/junkiejarvis-agent.js`): a single identity that answers
everyone. The missing capability is **per-user agent intelligence** — each
member having their *own* autonomous agent whose identity, memory, and
authority derive from infrastructure that member already owns.

We evaluated `jsclaw` (openclaw/nanoclaw lineage) as a candidate. It is a
zero-dependency container-orchestration framework with three patterns worth
adopting — **multi-agent bindings**, **heartbeat autonomy**, and
**identity-file system prompts** — but it is NOT Solid-based and would be a
parallel re-implementation of agentbox's own runtime (forbidden by ADR-001).
We therefore adopt the *patterns*, not the dependency, and bind them to the
substrate we have already hardened.

The synthesis the evaluation surfaced: **the user's Solid pod is the natural
store for their agent's identity files.** We already provision a per-pubkey pod
(solid-pod-rs, ADR-010) with `profile/card`, `inbox/`, `private/`, `public/`,
`settings/`. The pod is WAC-gated, so identity sourced from `private/` is
readable only by the user and an agent acting under delegated authority.

## Decision

Introduce a **Per-User Agent Fabric (PUAF)**: a thin layer over existing
substrate that instantiates, per member, an autonomous agent.

```
                 ┌──────────────── PUAF ────────────────┐
  Nostr DM /     │  bindings  →  resolve user → agent    │
  @mention   ──► │  agent(user):                         │
                 │    identity  ← Solid pod (private/agent/SOUL.md, USER.md)
                 │    memory    ← RuVector  (ns user:<pubkey>:agent, HNSW)
                 │    brain     ← callLlm   (z.ai GLM / Anthropic)  [reuse]
                 │    comms     ← NostrBridge (NIP-42/44/59)        [reuse]
                 │    autonomy  ← heartbeat → read pod inbox/ → act │
                 └──────────────────────────────────────┘
```

### Components

1. **Identity (pod-sourced).** On wake, the agent fetches `SOUL.md` / `USER.md`
   from the owner's pod at `{POD_BASE}/pods/<pubkey>/private/agent/<file>`
   (NIP-98 authed; falls back to `public/agent/` then to a built-in default).
   The pod is the source of truth for *who the agent is* — edited by the user
   through the pod, never baked into the image. This is the ADR-010 sovereign
   stack acting as the agent's brain-store.

2. **Memory (RuVector).** Per-user namespace `user:<pubkey>:agent`. Recall via
   the mandated MCP path (ADR-015); never markdown files (jsclaw's model) —
   HNSW semantic recall is the whole point. The privacy filter (ADR-008)
   already strips the `user:<pubkey>:` prefix at federation boundaries.

3. **Bindings.** `resolveBinding(bindings, msg) → agentId`, most-specific match
   wins (openclaw semantics). Maps an inbound (channel, peer, account) to the
   owning user's agent. Default → the shared concierge (JunkieJarvis).

4. **Heartbeat.** Periodic wake (per-user interval, quiet-hours aware). Each
   tick: read the owner's pod `inbox/` (LDP container), and for unprocessed
   items wake the LLM with a HEARTBEAT prompt — reply `HEARTBEAT_OK` (suppress)
   or act (DM the user, write memory, create a calendar event). Mirrors
   `jsclaw/heartbeat.js` semantics on our stack.

5. **Authority (delegation).** The agent acts under a **scoped delegated key**,
   not the user's root key. v1: a per-user agent sub-key the user authorises
   via NIP-26 delegation (kind/at-most-30-day window), recorded as a
   `urn:agentbox:mandate:<scope>:<id>` (existing URN kind, no new primitive).
   The agent's pod reads/writes are bounded by WAC grants to the agent key.

### Reuse, not rebuild

| Need | Source | New? |
|---|---|---|
| LLM brain | `junkiejarvis-agent.js::callLlm` | reuse |
| Signer | `junkiejarvis-agent.js::signerFromHex` | reuse |
| Relay pool / AUTH | `mcp/servers/nostr-bridge.js` | reuse |
| Pod read/write | NIP-98 `GET/PUT {pod}/pods/<pk>/...` | reuse |
| Memory | RuVector MCP (ADR-015) | reuse |
| Bindings / heartbeat | new ~120 LoC, patterns from jsclaw | new |

## Consequences

- **Positive.** Per-user agents with zero new infrastructure; the pod becomes
  the user-editable agent brain; memory is semantic; one shared concierge
  degrades gracefully to per-user when a binding exists. No parallel runtime.
- **Negative / risks.** Delegation scope must be tight (a runaway per-user
  agent acts as the user) — heartbeat budget caps + WAC scoping + the
  AIMDS/privacy middleware are mandatory. N agents = N relay sessions; the
  bridge must pool, not open one socket per user (fan-in subscription by
  `#p`-set, dispatch by tag).
- **Reversible.** PUAF is additive and gate-flagged (`[per_user_agents]` in
  `agentbox.toml`, default off). Removing it leaves JunkieJarvis untouched.

## Prototype scope (this change)

One user (carol): `SOUL.md` sourced from her pod, RuVector memory namespace,
a heartbeat that reads her pod `inbox/` and acts, and a DM binding so a message
to her agent routes to *her* instance. Proves the loop end-to-end on real
substrate before generalising to the fabric.
