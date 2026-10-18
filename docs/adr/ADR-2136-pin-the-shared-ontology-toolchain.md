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

No Agentbox Nix repin or runtime activation is claimed by this record. The independent producer now has released implementations, described below. Source inspected at `b9991c372f4172a3e7b24a5bca35bc22aab000da`: `flake.nix:42` pins `3213e314f82491f338660c79b77332da6610ed9c`; `lib/vault.nix:75` (cited as `:74` at inspection; the line moved) reads the producer lockfile and `:80` selects the crate. Required evidence: Nix package build with checks enabled, CLI JSON/exit-code compatibility, guarded edits and proposal rejection fixtures, declared feature-on/off tests, fixture generation compatibility and post-activation executable/generation identity. Reinspect live configuration before implementation; this document is not a runtime audit.

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

## Estate alignment and the ADR-2108 mapping — 2026-10-12

Owner decisions, with evidence in [Ontomark ADR-OM-005](https://github.com/DreamLab-AI/ontomark/blob/ffe06e4/docs/adr/ADR-OM-005-estate-alignment-one-producer-explicit-projections.md). This record stays **proposed**.

**Mapping to ADR-2108** (accepted, "the vault binary is baked by Nix"). This record overturns 2108's packaging decision and keeps its retirement decision; on acceptance it supersedes 2108, not before.

| ADR-2108 section | ADR-2136 disposition |
|---|---|
| ontology-bridge retired; no MCP server fronts the corpus | **kept unchanged** |
| `vault` built by Nix from the `vaultSrc` flake input (`flake.nix:40-43` pins a VisionClaw commit; `lib/vault.nix` builds `crates/vault`) | **replaced** by Decision 1: the released `ontomark` CLI by tag and sha256 (`ontomarkSrc` or a fetched release asset), plus a thin AGPL governance adapter for `propose`/`apply`/`panel publish` during the window (DEPRECATION AB-P1..P5, D4) |
| `vault --version` boot gate | **kept**, gating the new binary and the adapter |
| review trigger "crates/vault pushed to a remote" | **fired** by the shared workspace existing; this record is the response |

**New responsibility: AB-P6.** Agentbox produces the VisionClaw pod-resource pack from the released CLI (`ontomark build --scope machine`, Ontomark ADR-OM-005 decision 4: the private machine bundle that keeps `working/` for the GPU view; it is a scope flag on `build`, not a separate verb, and never writes `publish/`) and serves it to VisionClaw, which reaches Agentbox directly. VisionClaw's own publish build job (DEPRECATION VC-60) is retired only when the pack is byte-equal for a dated window and VisionClaw ADR-2106 has been re-verified or amended.

**Licence (Decision 5 restated with facts).** `horned-owl` is LGPL-3.0 and an opt-in `whelk-el` feature, off by default and absent from the CLI tree; the package here must not enable it. `nostr-bbs-core` is AGPL-3.0-only (owner-held) and stays in the adapter, never in the permissive package. Dependencies flow permissive → AGPL, never the reverse.

**Identity.** `visionGraph@<sha>` is the generation identity (Loom ADR-141); the bundle this image serves is a distribution of it, sha256-pinned. Re-minting identities is permitted at this stage with the migration artefacts ADR-2137 §4 requires.

## The shipped `vault` could not read the migrated corpus — 2026-10-18

- **Observed.** The `vault` CLI baked into the running image (`/nix/store/…-vault-0.1.0`) refuses the current visionGraph corpus: `vault --repo . validate` exits 1 with `./knowledge is not a vault: no pages/ directory`. The corpus moved to flat Obsidian vaults, and `vaultSrc` pinned VisionClaw `3213e314f`, which predates VisionClaw `4fe620296` ("Read the flat Obsidian vaults: pages at the vault root").
- **Change.** `vaultSrc` moves to VisionClaw `4fe620296a8266e47f96b106aadd15a513082b97` (on `main` upstream) in `flake.nix` and `flake.lock`. The lock's `narHash` was computed outside Nix by serialising the GitHub source tree in NAR format; the same procedure reproduces the previous lock entry's hash exactly. The `whelk` git dependency is unchanged, so `lib/vault.nix`'s `outputHashes` stand.
- **Evidence at the new pin.** `cargo test -p vault` passes: 384 tests, 0 failures, across 11 test targets. The binary built from it validates the corpus and agrees with ontomark 0.4.0 on every summary figure: 9546 pages, 9546 with ontology, 9244 public, 0 errors, 28875 warnings. That also answers estate register ER-12: the two frontmatter parsers do not disagree on the real corpus.
- **Not yet true.** The image has not been rebuilt. The owner rebuilds from the host shell; until then the running `vault` remains the broken one.
