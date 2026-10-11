---
id: ADR-2137
title: Generate image-scoped SBOM and VEX from shipped Nix payloads
date: 2026-10-11
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: image inventory, VEX predicates, scanner matching or release artefact selection changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2137 — Image-scoped vulnerability evidence

## Context

Generic vulnerability matches can name code that a Nix package never builds or
ships. The NixOS VEX approach evaluates those claims against a system's build
and configuration. Agentbox uses `nix2container` and supervisord rather than a
NixOS system configuration; host-kernel and NixOS-service assumptions do not
describe its container payload.

## Decision

Enumerate shipped store paths from `image.layers.paths`, not the builder
closure. Expose a Nix evidence output on each image variant and a pinned host
scanner environment. Generate SBOM/OpenVEX reports on the host during
preparation and CI image builds, and retain them outside the runtime image.
No daemon, adapter or manifest gate is added.

A private MIT OR Apache-2.0 Rust emitter generates statements only for exact
versioned PURLs present in the SBOM as subcomponents of the image-scoped
product. Its initial OpenSSH `CVE-2007-2768` rule requires reviewed source/build
identity and absence of OPIE filenames across the whole shipped
payload. False or unknown conditions withdraw the statement.

Host scans keep raw and VEX-filtered Grype reports and gate the
remaining findings at high severity by default. CI retains independent
Trivy/Syft checks, uses the matching source/build run and each architecture's
immutable digest, and releases attach only matching-commit scan artefacts.
Local preparation uses the image JSON hash until a scan binds the evidence to
the published OCI digest.

## Consequences and verification

Statements assess the immutable image only; host kernels, mounts, sidecars and
imperative runtime changes require separate assessment. No general NixOS feed
is imported. Rule changes need positive and withdrawal fixtures and a scanner
check against a rebuilt image. The rollout is staged for the next rebuild;
fixture checks do not certify a live image or a current vulnerability database.

See the [operator and maintainer guide](../developer/vex.md).
