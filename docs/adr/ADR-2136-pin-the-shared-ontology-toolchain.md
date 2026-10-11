---
id: ADR-2136
title: Pin the shared ontology toolchain independently of the host application
date: 2026-10-11
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: "not applicable — Agentbox repin remains proposed"
verified_paths: []
owner: jjohare
review_trigger: Before shared workspace extraction or any consumer dependency or generation migration
repo: agentbox
---

# ADR-2136 — Pin the shared ontology toolchain independently of the host application

## Context

The immutable `vault` binary currently builds from an entire pinned host workspace through `vaultSrc`. Its source pin differs from the corpus publisher's pin. Extraction should give agents the same ontology semantics and release identity without making a database or a desktop plugin the corpus authority.

Estate ownership decision: [VisionFlow ADR-2014](../../../../VisionFlow/docs/adr/ADR-2014-shared-ontology-workspace.md). Evidence: [workspace investigation](../../../../visionGraph/planning/ontology-workspace/README.md). Proposed extension to [GOVERNANCE-capabilities](../GOVERNANCE-capabilities.md) and [BASELINE-container](../BASELINE-container.md).

## Decision

This is a proposed extension. Existing accepted invariants remain in force until a separately reviewed implementation and migration establish the new baseline.

1. Repoint the Nix source input and immutable CLI package to [DreamLab-AI/ontomark](https://github.com/DreamLab-AI/ontomark), the selected independent producer, once the Agentbox-specific compatibility gates pass against its released native CLI. Preserve the `vault` command contract or ship an explicitly versioned transition; no mutable user-installed executable replaces the baked tool.
2. Keep authored Markdown and machine-readable headers authoritative. Agentbox memory, Loom, graph stores and caches remain separate derived or operational systems, never a second ontology write authority. Existing manifest corpus-path authority and governed proposal/edit guards remain intact.
3. Consume shared crate capabilities where appropriate, with rich native features available independently of Obsidian. Route optional existing-vault automation through the same typed proposals, validation and approval boundaries. Do not add OCR or document ingestion work.
4. Record the producer version, source revision, lockfile, schema/artefact capabilities and selected corpus policy in build evidence. Update Nix hashes, source pin and compatibility tests together. Validate generation agreement with the publisher and Loom; build, staged package and activated runtime are separately evidenced states.
5. Preserve licence boundaries and feature gates. A permissive package must not silently acquire an AGPL dependency. Optional serving/query adapters are independently gated; the core corpus operations remain usable offline without database services.

## Consequences

The image no longer needs the host application's full source to build the corpus tool. Coordinated release testing and retained rollback packages cost maintenance, but remove an existing source of pin drift. Activation remains an operator-controlled deployment step after package verification; writing this proposal changes no manifest or running service.

## Verification

No Agentbox Nix repin or runtime activation is claimed by this record. The independent producer now has released implementations, described below. Source inspected at `b9991c372f4172a3e7b24a5bca35bc22aab000da`: `flake.nix:42` pins `3213e314f82491f338660c79b77332da6610ed9c`; `lib/vault.nix:74` reads the producer lockfile and `:80` selects the crate. Required evidence: Nix package build with checks enabled, CLI JSON/exit-code compatibility, guarded edits and proposal rejection fixtures, declared feature-on/off tests, fixture generation compatibility and post-activation executable/generation identity. Reinspect live configuration before implementation; this document is not a runtime audit.

## Producer ownership continuation — 2026-10-11

[Ontomark source and release evidence](https://github.com/DreamLab-AI/ontomark/blob/4abbce9/README.md)
records parser/model/NGG1 0.1.0, corrected Whelk/reasoner 0.1.1 and compiler 0.1.2,
plus the native CLI and portable engine rc1 assets. The compiler owns the C3
marker and shared scaffold/prose wire types; reader-only consumers disable default
features. Its optional typed projection receives an explicit model/profile and
authoring/public scope, rather than importing a host application's runtime.
Missing/duplicate identities and unsupported reasoning retain explicit refusals;
there are no implicit phantom identities or fabricated compatibility defaults.

[Graph ownership](https://github.com/DreamLab-AI/ontomark/blob/7f5b2bb/docs/adr/ADR-OM-002-shared-graph-and-obsidian-boundary.md)
is distinct from the corpus producer. Ontomark `packages/graph` owns the offline
Canvas renderer, hierarchy adapter and focus traversal; `ontomark-ngg1` owns the
binary codec. VOWL consumes that codec through its compatibility API and retains
physics. The publisher owns tiers, routes and simulation; the separate
[Obsidian plugin](https://github.com/DreamLab-AI/ontomark-obsidian) owns vault events,
commands, settings and edit UI. Agentbox consumes released capabilities; it does
not become a graph host or duplicate the compiler by baking the CLI.

The permissive core's rights-holder grant and excluded governance/signing code
are recorded in [NOTICE](https://github.com/DreamLab-AI/ontomark/blob/340b8a0/NOTICE).
Whelk preserves the Rust MIT and Scala BSD notices. These published packages do not
prove the currently activated Agentbox executable has moved: Nix source/hash
updates, local command compatibility, governed-write tests and post-activation
identity remain this proposal's gates. The core's nightly nomination is separate
from an Agentbox image repin and does not change those obligations.
