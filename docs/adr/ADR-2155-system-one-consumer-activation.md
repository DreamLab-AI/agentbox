---
id: ADR-2155
title: Activate typed-decision consumers with a separate private route
date: 2026-10-29
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: d0e9ca7865c7e120bd657b0ffc66e54b043dfa1a
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


Security follow-up re-verified 2026-10-29 at `7d8c3b2dfe165f4ab3f8a5e4f62b8294ea7b155d`: the changed hunks drop privilege before workspace credential writes, replace credentials atomically, reject typed-decision redirects and retain the timeout through response parsing. The stalled-body, planted-symlink and HTTP307 regressions pass. These strengthen the existing boundaries; status axes and activation limits are unchanged. The original Deepsec report remains BLOCK with a separate remediation receipt, not a claimed clean rescan.

Re-verified 2026-10-30 at `29a4b4939`: AMENDED 2026-10-30 (operator): the local-only flags this record lists no longer default to 1. `[system_one].local_only` (empty by default) now drives AGENTBOX_JEV_<X>_LOCAL_ONLY for twelve consumers (the five listed here plus failure taxonomy, manifest plan, voice intent, approval review, memory rerank, headroom evidence, which were literal localOnly:true), so every consumer takes the selected backend through the proxy. The private route itself is unchanged and is used exactly for the names listed; a listed consumer with no usable local backend is off, never cloud. Data-level fences (email taint, private ontology seeds) unchanged.

Re-verified 2026-10-30 at d0e9ca786: system_one.rs gains the skill_list_at_least export (verify-gated, warned when out of range). The consumer activation set and its staged status are unchanged.
