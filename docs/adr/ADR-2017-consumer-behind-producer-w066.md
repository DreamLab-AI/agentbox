---
id: ADR-2017
title: Learning consumers may never be enabled ahead of their producer
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: feed_routing is flipped on, or the memory_learning gate set changes
repo: agentbox
domain: LEARNING-memory
lineage: "legacy ADR-036 D6, PRD-020."
---

# ADR-2017 — Learning consumers may never be enabled ahead of their producer

## Context
The effectiveness aggregates that the retrieval and routing consumers read are
produced by the trajectory-recording hook (ADR-2015). Enabling a consumer while
`record_trajectories` is off gives it no corpus: it runs, reads nothing, and
silently returns inert results — a configuration that looks live but is not
(ADR-036 D6). A manifest with all learning gates off must remain byte-identical to
the pre-learning product.

## Decision
`feed_retrieval` and `feed_routing` must not be `true` while `record_trajectories`
is `false`. The config validator raises **W066** on that inversion, naming the
offending consumer(s). Each learning script is additionally self-gating on its own
env flag, so a default-off manifest ships the pre-learning behaviour exactly. This
forecloses a consumer-ahead-of-producer manifest passing validation.

## Consequences
- Ordering is enforced at config time, not discovered as empty results at runtime.
- Enabling learning is a deliberate two-step: producer first, then consumers.
- The validator must be kept in sync with the gate names; a renamed gate needs a
  W066 update (review_trigger).
- Cost: no way to "preview" a consumer against a live corpus without also turning
  the producer on.

## Verification
implementation_status = complete at verified_commit cbe7335b9. Confirmed by grep:
`scripts/agentbox-config-validate.js:1341-1359` implements W066 — `consumersOn =
ml.feed_retrieval === true || ml.feed_routing === true` and, when
`ml.record_trajectories !== true`, emits code `W066` naming `which`.
`mcp/servers/lib/ruvector-gates.js:37-39` exposes the `recordTrajectories`,
`feedRetrieval`, `feedRouting` self-gates. activation_status = live:
`feed_retrieval` flipped on 2026-08-31; `feed_routing` remains gated pending a
post-flip observation window.
