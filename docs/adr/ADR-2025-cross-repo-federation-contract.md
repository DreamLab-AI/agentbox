---
id: ADR-2025
title: "Cross-repo federation contract: sha12 content address, urn:agentbox grammar, closed inbound kind-map"
date: 2026-08-31
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: any change to the sha12 truncation, the urn:agentbox mint/parse grammar, or the closed inbound kind-map on either repo
repo: agentbox
domain: PROTOCOL-registry
---

# ADR-2025 — Cross-repo federation contract: sha12 content address, urn:agentbox grammar, closed inbound kind-map

## Context
The agentbox↔visionclaw federation seam is pinned from the visionclaw side only.
visionclaw ADR-2023 declares its content address "byte-identical to the agentbox
`sha12()` contract"; visionclaw ADR-2025 maps inbound `urn:agentbox:*` kinds;
visionclaw ADR-2022 converges with agentbox ADR-2011 on hex-canonical identity.
No agentbox record owns `sha12()`, the `urn:agentbox:<type>` grammar, or the
closed inbound kind-map — agentbox ADR-2011 concedes that convergence was
"parallel, not deduped". Each repo's CI validates only its own tree, so an
agentbox helper change passes agentbox CI and silently breaks the visionclaw
join. Governing doc: `docs/PROTOCOL-registry.md`.

## Decision
This record owns, on the agentbox side, the federation primitives visionclaw
depends on: (1) the content-address truncation length — 12 hex characters — and
lowercase hex casing; (2) the `urn:agentbox:<type>[:<scope>]:<local>` mint/parse
grammar; (3) the closed inbound kind-map. It declares a typed cross-repo
dependency on **visionclaw ADR-2022** (hex-canonical identity convergence),
**visionclaw ADR-2023** (`sha12` byte-parity content address), and **visionclaw
ADR-2025** (inbound `urn:agentbox:*` kind mapping) — cited explicitly in prose
because the `supersedes`/`superseded_by` schema has no repo qualifier yet. A
shared conformance fixture asserting `sha12` byte-parity and hex-canonical
identity MUST run in BOTH repos' CI before any change to these primitives merges;
neither repo may alter a governed primitive on a green single-tree build alone.

## Consequences
The federation seam gains a single governed contract and a cross-repo CI gate:
changes to the truncation length, hex casing, URN grammar, or kind-map become
co-ordinated across both repos instead of silent. Cost: a new shared fixture must
be authored and wired into both CI pipelines, and the two-sided dependency is
carried in prose until the ADR schema grows a repo-qualified cross-reference.
Follow-on: promote the prose dependency to a typed field once the schema supports
it, and register this contract in the domain routing table.

## Verification
None yet — proposed, not built. No conformance fixture exists and no cross-repo
CI gate is wired; `implementation_status: none`, `verified_paths: []`. On
acceptance, verification is the shared fixture passing in both agentbox and
visionclaw CI at a recorded commit.
