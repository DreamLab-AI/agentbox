---
id: ADR-2019
title: Model-lifecycle freeze — 384-dim bge is the active column, SONA and attention-rerank stay off
date: 2026-08-31
decision_status: accepted
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A SONA binary with configurable embedding_dim (384-capable) ships, or a dimension migration is planned
repo: agentbox
domain: LEARNING-memory
lineage: "legacy PRD-020 / ADR-040 (model lifecycle), DDD-018 (I22)."
---

# ADR-2019 — Model-lifecycle freeze — 384-dim bge is the active column, SONA and attention-rerank stay off

## Context
The active embedding column is bge-small-en-v1.5 at 384-dim. Two learning
enhancements were built or trialled and both are inert at 384-dim: the prebuilt
`@ruvector/sona@0.1.5` NAPI binary hardcodes `embedding_dim=256` and accumulates
nothing on 384-dim learns (verified live); attention-rerank was measured on
2026-07-21 as `cos/sqrt(384)` on the L2-normalised corpus — an identity blend,
max diff ~4e-7. A dimension migration would reuse a stale SONA scope and silently
decouple the learn side from apply (DDD-018 I22).

## Decision
The embedding model is locked to bge-small-en-v1.5 / 384-dim as the sole active
column. `sona_learn`/`sona_apply` stay **off** because the shipped binary cannot
accumulate at 384-dim; `attention_rerank` stays **off** as a measured no-op on the
L2-normalised corpus. Any future dimension migration must mint a **fresh SONA scope
string** — never reusing `'agentbox_memory'` across dimensions (I22). This
forecloses flipping SONA/attention on as cargo-cult "improvements" and forecloses a
dimension migration that silently poisons the SONA scope.

## Consequences
- No wasted compute or false confidence from an engine that discards 384-dim learns.
- SONA remains deliberately unbuilt at 384-dim; the feeder is proven but the gates
  stay sealed until a 384-dim-capable binary and a passing recall run (ADR-2018).
- A dimension migration is a scoped, deliberate operation, not a config flip.
- Cost: the potential upside of SONA/attention is forgone until the binary changes.

## Verification
implementation_status = none — SONA/attention are deliberately unbuilt at 384-dim.
At verified_commit cbe7335b9: `mcp/servers/lib/aggregate-effectiveness.js:48` sets
`EMBEDDING_DIM = 384`; `scripts/ruvector-sona-feeder.mjs:15-31,53-56` documents the
fixed 384-dim scope, the fresh-scope-on-migration I22 rule, and the 256-dim binary
no-accumulation finding, with `SONA_SCOPE = 'agentbox_memory'` and
`SONA_EMBEDDING_DIM = 384` at lines 128-129. `agentbox.toml:429-431` holds
`attention_rerank`, `sona_learn_enabled`, `sona_apply_enabled` all `false` with the
measured/blocked rationale. activation_status = inactive: gates stay sealed.
