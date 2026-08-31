---
id: ADR-2005
title: Every adapter dispatch is wrapped in a fixed order — observability, then privacy filter, then JSON-LD encoder
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A new cross-cutting concern proposed for the dispatch path, or any reordering of the three layers
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-005 (observability), ADR-008 (privacy filter routing), ADR-012 (jsonld federation grammar), DDD-004 §L08
---

# ADR-2005 — Every adapter dispatch is wrapped in a fixed order: observability → privacy filter → JSON-LD encoder

## Context
Three cross-cutting concerns apply to every adapter method call: observability (span + log +
metrics), privacy redaction, and JSON-LD encoding for federation. Their order is not arbitrary —
if the JSON-LD encoder runs before redaction, unredacted fields can be serialised into a federated
representation and leave the box. Observability must span the full call including redaction latency.
Prior ADRs (005/008/012) each owned one layer but did not fix their composition order, leaving the
sequencing to be re-decided per call site.

## Decision
Every adapter method call passes through a fixed three-layer wrap, in order: observability (ADR-005)
→ privacy redaction (ADR-008) → JSON-LD encoding (ADR-012). Privacy redaction MUST complete before
the encoder runs (DDD-004 §L08). Any new cross-cutting concern adopts the same ordered shape, with
its fail-open vs fail-closed behaviour stated explicitly in an ADR. This forecloses encode-before-
redact, per-call-site ad-hoc ordering, and a cross-cutting concern that bypasses the wrap.

## Consequences
- Redaction is structurally guaranteed to run before any federated serialisation of adapter output.
- Observability latency includes redaction, so spans reflect the true dispatch cost.
- Cost: every non-lifecycle adapter method pays all three layers; new concerns must slot into the
  ordered chain rather than hook in arbitrarily.

## Verification
implementation_status = complete, established at verified_commit cbe7335b9.
`management-api/observability/metrics.js:111-115` documents the layer order (1 observability, 2
privacy ADR-008, 3 JSON-LD ADR-012) and states redaction completes before the encoder (DDD-004 §L08);
`wrapDispatch` is defined from :125. `management-api/adapters/index.js:131` defines
`instrumentAdapter`, applied at :170 to wrap every non-lifecycle adapter method.
