---
id: ADR-2136
title: Pin the shared ontology toolchain independently of the host application
date: 2026-10-11
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: Before shared workspace extraction or any consumer dependency or generation migration
repo: agentbox
---

# ADR-2136 — Pin the shared ontology toolchain independently of the host application

## Context

The immutable `vault` binary currently builds from an entire pinned host workspace through `vaultSrc`. Its source pin differs from the corpus publisher's pin. Extraction should give agents the same ontology semantics and release identity without making a database or a desktop plugin the corpus authority.

Estate proposal: [VisionFlow ADR-2014](../../../../VisionFlow/docs/adr/ADR-2014-shared-ontology-workspace.md). Evidence: [workspace investigation](../../../../visionGraph/planning/ontology-workspace/README.md). Proposed extension to [GOVERNANCE-capabilities](../GOVERNANCE-capabilities.md) and [BASELINE-container](../BASELINE-container.md).

## Decision

This is a proposed extension. Existing accepted invariants remain in force until a separately reviewed implementation and migration establish the new baseline.

1. Repoint the Nix source input and immutable CLI package to the independent ontology workspace once its released native CLI passes compatibility gates. Preserve the `vault` command contract or ship an explicitly versioned transition; no mutable user-installed executable replaces the baked tool.
2. Keep authored Markdown and machine-readable headers authoritative. Agentbox memory, Loom, graph stores and caches remain separate derived or operational systems, never a second ontology write authority. Existing manifest corpus-path authority and governed proposal/edit guards remain intact.
3. Consume shared crate capabilities where appropriate, with rich native features available independently of Obsidian. Route optional existing-vault automation through the same typed proposals, validation and approval boundaries. Do not add OCR or document ingestion work.
4. Record the producer version, source revision, lockfile, schema/artefact capabilities and selected corpus policy in build evidence. Update Nix hashes, source pin and compatibility tests together. Validate generation agreement with the publisher and Loom; build, staged package and activated runtime are separately evidenced states.
5. Preserve licence boundaries and feature gates. A permissive package must not silently acquire an AGPL dependency. Optional serving/query adapters are independently gated; the core corpus operations remain usable offline without database services.

## Consequences

The image no longer needs the host application's full source to build the corpus tool. Coordinated release testing and retained rollback packages cost maintenance, but remove an existing source of pin drift. Activation remains an operator-controlled deployment step after package verification; writing this proposal changes no manifest or running service.

## Verification

No implementation or activation is claimed. Source inspected at `b9991c372f4172a3e7b24a5bca35bc22aab000da`: `flake.nix:42` pins `3213e314f82491f338660c79b77332da6610ed9c`; `lib/vault.nix:74` reads the producer lockfile and `:80` selects the crate. Required evidence: Nix package build with checks enabled, CLI JSON/exit-code compatibility, guarded edits and proposal rejection fixtures, declared feature-on/off tests, fixture generation compatibility and post-activation executable/generation identity. Reinspect live configuration before implementation; this document is not a runtime audit.
