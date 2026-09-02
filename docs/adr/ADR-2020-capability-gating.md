---
id: ADR-2020
title: Optional capabilities are manifest-gated and byte-identical-when-off; execution-gated tools are spend-capped and never auto-routed
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: d3920a4eecc87268e87ce35a0e69f21bf6327b1e
verified_paths: [agentbox.toml, skills/tree-search-coder/SKILL.md]
owner: jjohare
review_trigger: any new optional skill/feature block added to agentbox.toml, or any change to the tree-search-coder spend/route posture
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-039 (system-manifest apply-class catalogue), ADR-020 (ACI MCP + execution-gated tree-search, Surface 2 spend/route posture); manifest mechanism in BASELINE-container ADR-2003
---

# ADR-2020 — Optional capabilities are manifest-gated and byte-identical-when-off; execution-gated tools are spend-capped and never auto-routed

## Context

The box ships a growing set of optional capabilities (`code_interpreter`,
`codeact`, `aci_shell`, `tree_search_coder`, `dream_machine`, …). Two forces:
an operator must be able to turn any of them off and get a provably clean
runtime; and execution-gated tools that spend money or fan out N candidates
must not silently drain budget or be reached by automatic routing. Prior art:
the system-manifest apply-class catalogue (ADR-039) and the Surface-2 spend/route
posture from the ACI/tree-search work (ADR-020).

## Decision

Every optional capability is gated by an `agentbox.toml` block that gates **both**
the Nix package set and the supervisor block, each carrying a system-manifest
apply-class. A disabled gate leaves **zero runtime footprint** (byte-identical-
when-off): the package is not baked and no supervised process exists. The
N-candidate execution-gated `tree_search_coder` additionally carries a hard
per-invocation `spend_cap_usd` plus `max_candidates`/`per_branch_timeout_s`
ceilings, and is **never wired into automatic routing** — it is explicitly
invoked only. The governing invariants live in
`docs/GOVERNANCE-capabilities.md`.

## Consequences

- Turning a capability off is a one-line `enabled = false` edit with a defined
  apply-class, and the operator can trust the off-state is footprint-free.
- The slow path cannot be reached by a router heuristic or bleed past its cap,
  so its N× token cost is always a deliberate, bounded choice.
- Cost: activation of a gate requires an image rebuild (nix-baked package +
  supervisord), so toggling is not hot; and the byte-identical-when-off
  guarantee must be re-checked whenever a new gate is added.

## Verification

At `cbe7335b9`, `agentbox.toml`: `[skills.code_interpreter]` (:535),
`[skills.codeact]` (:551), `[skills.aci_shell]` (:579),
`[skills.tree_search_coder]` (:621) carrying `max_candidates = 5`,
`per_branch_timeout_s = 60`, `spend_cap_usd = 0.50` and the inline comment
"explicitly invoked, never auto-routed" (:624), and `[dream_machine]` (:1560).
`skills/tree-search-coder/SKILL.md` frontmatter is orchestration-only and states
"NEVER auto-routed; only ever invoked explicitly". Manifest apply-class mechanism
defined in ADR-2003.
