---
id: ADR-2022
title: Governed ontology writes only — the ungoverned axiom-load backdoor stays disabled outside bootstrap
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 1ee6f6f1a9be19f7331643727a08e4061665532c
verified_paths: [agentbox.toml]
owner: jjohare
review_trigger: any change to direct_axiom_load default, or the authority-class of ontology_axiom_load
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-023 (ontology bridge), ADR-054 (ontology-bridge write-path findings), PRD-014 Seam D/D2
---

# ADR-2022 — Governed ontology writes only — the ungoverned axiom-load backdoor stays disabled outside bootstrap

## Context

The shared ontology has two write paths. The governed one (PRD-014 Seam D/D2):
`ontology_propose` → Whelk consistency check → human approval → PR. The legacy
ungoverned one: a raw `POST /api/ontology/load` reachable through
`ontology_axiom_add`, which writes axioms with no consistency gate and no human
in the loop. The ontology-bridge write-path review (ADR-054) flagged this as an
unguarded backdoor into a shared, consistency-critical resource.

## Decision

`direct_axiom_load` defaults **false**, so `ontology_axiom_add` refuses and
redirects the caller to the governed path. Personal-KG concepts reach the shared
ontology only through `ontology_propose → Whelk → human approval → PR`. The raw
`POST /api/ontology/load` backdoor is classified **zero-tolerance** in the
authority table — set the flag true only for admin/bootstrap, where a signed
authorisation is required. The named invariant lives in
`docs/GOVERNANCE-capabilities.md`.

## Consequences

- No agent can mutate the shared ontology without passing Whelk consistency and
  a human merge, so an inconsistent or hallucinated axiom cannot land silently.
- Bootstrap/admin bulk-load still exists but is an explicit, signed,
  zero-tolerance action — deliberately slow and auditable.
- Cost: routine enrichment is gated behind a PR round-trip; there is no fast
  path for high-volume trusted writes, by design.

## Verification

At `cbe7335b9`, `agentbox.toml`: `direct_axiom_load = false` (:638) with rationale
at :634-637 ("Default off = ontology_axiom_add refuses + redirects");
`ontology_axiom_load = "zero-tolerance"` in `[skills.authority.classes]` (:724),
commented "ungoverned KG write backdoor".
