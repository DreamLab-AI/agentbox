# ADR-068: Kernel ToolDispatcher deferral (recorded non-goal)

- **Status:** Proposed (non-goal record)
- **Date:** 2026-08-27
- **Relates to:** [ADR-062](ADR-062-metaharness-adoption-posture.md), ADR-005
  (adapter architecture), upstream ruflo OIA walkthrough (2026-06-26)

## Context

`@metaharness/kernel` offers an in-process `ToolDispatcher` that could replace the
dispatch core wrapping every adapter call. ruflo itself evaluated and deferred this
("touching 314 tools at v0.1.0 of an upstream package is too high blast radius").
Kernel remains 0.1.x with 4 lifetime versions and a native `@ruvector/emergent-time`
backend surface. In agentbox, the dispatch path carries the three mandatory
middleware layers (observability → privacy filter → JSON-LD, ADR-005/008/012); an
in-process third-party dispatcher would sit underneath all three.

## Decision

Wiring `@metaharness/kernel`'s `ToolDispatcher` into any agentbox dispatch path is a
**non-goal**. Kernel's read-only surfaces (scorecard/genome/threat-model/scanMcp)
may be adopted later under [ADR-062](ADR-062-metaharness-adoption-posture.md) Tier 2
if a use case emerges.

Any future reconsideration must supersede this ADR explicitly, owning: the middleware
ordering guarantee, the five-slot adapter contract, blast radius across all
registered tools, and kernel's maturity at that time. It must not arrive as
dependency drift.

## Consequences

- The adapter dispatch core stays first-party; MetaHarness integration remains at
  the edges (subprocess evaluators, plugin skills, gated dynamic import).
