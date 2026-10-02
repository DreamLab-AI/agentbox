---
id: ADR-2119
title: Remove the retired outliner ontology runtime
date: 2026-10-01
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: c7b5d5f5535c9203f21b24ed710705a3fe16dcf2
verified_paths: [flake.nix, lib/ontology-tools.nix, services/ontology-tools, services/agentbox-mcp/src/web_summary, skills/ontology-core, skills/ontology-enrich, dream.config.json]
owner: jjohare
review_trigger: commit and rebuild the image; or introduce a corpus writer or output format
repo: agentbox
domain: BASELINE-container
---

# ADR-2119 — Remove the retired outliner ontology runtime

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Context

The authored corpus has migrated to Obsidian-compatible YAML frontmatter.
The independent `ontology-tools` crate still parsed and emitted outliner
OntologyBlocks, remained baked unconditionally, and supplied an obsolete dream
evaluator. Web-summary also advertised an obsolete format alias. Their presence
made the supported authoring path ambiguous during planning for new domains.

## Decision

Remove `services/ontology-tools`, its Nix derivation and package registration.
Use the existing `vault` CLI for corpus authoring, validation, links and builds.
The required ontology dream evaluator exercises the current proposal/apply
boundary; upstream vault tests remain part of its Nix build.
Web-summary supports Obsidian and plain topics, plus Markdown summaries, and
rejects unsupported format names. No compatibility writer or replacement stub
is retained. Historical ADRs and archives remain evidence; unrelated private
outliner notebooks are outside this corpus retirement.

## Consequences

The source tree has one corpus authoring route. Existing container images still
contain the baked executable and require a rebuild to remove it. Neither the
Nix store nor the running container has been modified by this change.
The upstream vault source pin must be reviewed separately when deploying newer
proposal or creation capabilities; this change does not claim those are live.

The user authorised the retirement. Image `sha256:399888769570` activates the
change: `ontology-tools` is absent while the vault-backed ontology governance
and web-summary tests remain green.

## Verification

Working-tree checks on 2026-10-01: 29 web-summary Rust tests passed, including
current-format acceptance and obsolete/unknown-format rejection; 59 Node tests
passed for ontology proposal/apply governance. `git diff --check` passed.
The Nix runtime image built and loaded successfully. Live verification confirms
that `/opt/agentbox/bin/ontology-tools` is absent, all five adapters are healthy,
and readiness is green.
