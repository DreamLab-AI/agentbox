---
id: ADR-2155
title: Activate typed-decision consumers with a separate private route
date: 2026-10-29
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ef768e785c7b89a6d31bba7e9f94a22055d96a19
verified_paths: [services/agentbox-manifest/src/system_one.rs, config/hooks/lib/jev-option.cjs, tests/system-one/consumer-activation.test.mjs]
owner: operator
review_trigger: Image activation or changes to consumer locality or acceptance thresholds
repo: agentbox
---

# ADR-2155 — Activate typed-decision consumers with a separate private route

## Context

The owner requested activation of all implemented Jev/System One integrations on
2026-10-29, with testing before rebuilding. Merged feature code was mostly off;
Stage B exports could not reach already-started supervisor siblings. Several
baked upstream sources predated their optional Jev code.

## Decision

`[system_one.consumers]` owns explicit per-consumer switches. The Rust projector
exports them before supervisord starts and again into the interactive runtime
environment. Existing public consumers retain the selected SubQ vendor. Private
consumers use `system_one.local_backend`, which must name a declared, keyless LAN
backend. Failure of that route never sends their content to the cloud. Explicit
local-only flags cover consultants, trajectories, ontology, governance and dream
triage. Claim-specific checkpoints and dream screening are enabled.

JS/Rust consumer switches control behaviour within existing services; disabling
a consumer does not remove its host process. Optional CLI/server Cargo features
require both the vendor-slot parent gate and their own consumer switch.

The owner decision accepts the bounded routing/checkpoint extensions and local
processing recorded in the egress register. It does not remove email fences,
authorisation, deterministic gates, or human approval. Unfitted thresholds that
would authorise automatic changes remain unset; spawn selection stays shadow.

Vault, Ontomark and Solid bake their optional Jev features from content-addressed
source pins that actually contain the implementation. The local façade returns
Choice, Score and Noul type discriminators for strict consumers.

## Verification and activation

See `docs/reference/system-one-activation.md`. Source configuration is staged;
no service was restarted or image activated by this work. The local sidecar also
requires rebuilding for its response compatibility fix. Transport acceptance is
not evidence of accuracy uplift. Memory recall currently cannot score because
six frozen fixture IDs no longer resolve; this must not be represented as a pass.
