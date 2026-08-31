---
id: ADR-2004
title: Durable state rides exactly five adapter slots; orchestrator boot-probe failure is fatal, the other four degrade to off
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A durable-state integration proposed that does not fit one of the five slots, or a sixth slot requested
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-005 (pluggable adapters), PRD-001 (capabilities and adapters), ADR-031 (adapter contract enforcement)
---

# ADR-2004 — Durable state rides exactly five adapter slots; orchestrator boot-probe failure is fatal, the rest degrade to off

## Context
Durable-state integrations must not proliferate into bespoke per-feature persistence. Each must be
swappable between a local implementation, an external/stdio-bridge, and a disabled state behind one
identical contract, so a feature is never client-only or standalone-only. Boot-time behaviour matters
differently per slot: the orchestrator is load-bearing for session lifecycle, whereas beads/pods/
memory/events can be absent without bricking the box — but they must degrade *loudly and safely*, not
silently return broken state. Prior state (ADR-005/PRD-001/ADR-031) set the pluggable-adapter shape
without pinning the slot count or the failure asymmetry.

## Decision
Every durable-state integration resolves to exactly one of five slots — `beads`, `pods`, `memory`,
`events`, `orchestrator` — each a `local-*`, external-bridge, or `off` implementation behind an
identical per-slot contract. At the once-per-boot connect probe, an `orchestrator` failure is fatal
(`process.exit(1)`); any other slot's failure is non-fatal — its health goes `degraded` and the slot
hot-swaps its live impl to the `off` impl, so callers get an explicit `AdapterDisabled` rather than a
half-broken adapter. This forecloses a sixth slot, a client-only integration, and any slot that fails
open by silently returning stale or partial state.

## Consequences
- One uniform substitution model; `tests/contract/` must pass for all three impl classes per slot.
- A degraded box is still a *correct* box: disabled slots reject cleanly instead of corrupting state.
- Cost: a genuinely new kind of durable state has nowhere to go without an ADR that widens the model;
  the orchestrator is a hard single point of boot failure by design.

## Verification
implementation_status = complete, established at verified_commit cbe7335b9.
`management-api/adapters/index.js:17` declares `const SLOTS = ['beads','pods','memory','events','orchestrator']`;
`resolveAdapters` (from :153) defaults any unresolved slot to `'off'` (:158). In
`management-api/server.js`, the boot probe fans out per slot: the `orchestrator` branch calls
`process.exit(1)` (:1218-1220), while every other slot sets `adapterHealth[slot]='degraded'` (:1223)
and swaps in the off impl (:1224-1234).
