---
id: ADR-2003
title: Compose the whole image from agentbox.toml via one Nix flake, with honest per-gate apply-classes
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A feature added without a system-manifest catalogue entry, or a runtime install path reappearing
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-001 (nixos-flakes), PRD-002 (immutable runtime bootstrap), ADR-039 (docbox-backported apply-class + system-manifest)
---

# ADR-2003 — Compose the whole image from agentbox.toml via one Nix flake, with honest per-gate apply-classes

## Context
The image must be reproducible and immutable: no Dockerfile layering, no runtime package installs
that drift a running box away from its declared configuration. `agentbox.toml` is the *running*
config, not a template. A feature gate touches three places — the Nix package set, the supervisor
block, and the human-facing system view — and a gate that flips a key without saying whether that
takes effect live, at boot, or only on rebuild misleads the operator. Prior state (ADR-001/ADR-039)
established flakes and a back-ported apply-class taxonomy but left the coupling implicit.

## Decision
One `flake.nix` composes the entire image, reading `agentbox.toml` at build time via
`builtins.fromTOML (builtins.readFile ./agentbox.toml)`. Adding a feature gate means gating the Nix
package set AND the supervisor block AND adding a `system-manifest.js` catalogue entry whose
apply-class is exactly one of `live` / `boot` / `rebuild` and is honest about when the change lands.
The catalogue may drift (a new gate needs a new entry); the *state* cannot — it is introspected from
the parsed toml at request time, never hand-maintained. This forecloses Dockerfile layering, runtime
installs, and any "enabled" flag whose truth is asserted rather than read from the toml.

## Consequences
- The image is reproducible from the toml alone; a byte-identical build is possible when a gate is off.
- Every feature carries a truthful "how do I make this take effect" contract for operators.
- Cost: adding a gate is a three-touch change (packages, supervisor, manifest) — no shortcut path,
  and a missing catalogue entry is a documentation defect the state introspection cannot mask.

## Verification
implementation_status = complete, established at verified_commit cbe7335b9. `flake.nix:106` is the
literal `builtins.fromTOML (builtins.readFile ./agentbox.toml)` build-time read.
`management-api/lib/system-manifest.js:27-31` defines `APPLY_CLASSES = { live, boot, rebuild }`, and
its header (lines 9-13) documents that the enabled state is introspected from the parsed
`agentbox.toml` at request time, not stored — the catalogue can drift, the state cannot.
