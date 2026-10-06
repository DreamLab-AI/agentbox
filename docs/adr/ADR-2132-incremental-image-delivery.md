---
id: ADR-2132
title: Separate non-disruptive image preparation from scoped runtime activation
date: 2026-10-06
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: layer grouping, delivery transport, candidate validation or cache retention changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2132 — Incremental image delivery and explicit activation

## Context

The previous 42.3 GiB image repeated 392 store paths between layers. A deployment
with 102 of 104 layers unchanged still spent roughly 27 minutes exporting and
loading it. Frequently edited application paths shared a 9.5 GiB layer with
heavy dependencies. The rebuild command stopped the stack before building and
ran broad cleanup afterwards.

## Decision

Keep Nix and the repository. Exclude prior closures from each ordered image
layer; put stable platform dependencies before toolchains, CLIs and services,
with application/configuration paths last. Preserve every enabled capability.

`prepare` builds and imports a candidate without stopping/recreating Agentbox or
its sidecars. The default incremental transport is a digest-pinned, loopback-only
host registry cache, not a runtime service or durable-state adapter. A separate
`activate` validates the receipt and replaces only Agentbox using merged Compose.
`rebuild` composes these two operations; `--prepare-only` omits activation.

Preparation never runs production bootstrap or attaches production state to a
smoke container. Activation refuses configuration/image/container drift and
retains a recovery image. Cleanup is not part of either operation. Keep latest,
previous and last-activated candidate roots; release only older successful
workflow-owned GC-root symlinks, never data or store paths.

## Consequences

Cold population still transfers the image. Lower-layer upgrades still affect
Docker's parent chain. Local incremental delivery needs a Linux daemon; the
explicit daemon-stream fallback retains whole-image transfer costs. Registry
cache storage needs separately scheduled operator maintenance. Splitting heavy
capabilities, private binary caching and Rust artifact caching are deferred.

## Verification

`tests/config/runtime-delivery.test.cjs` (wired to the invariants workflow) exercises failure preservation, separate
preparation, offline smoke restrictions, drift rejection and scoped activation
using mocked commands. Real candidate build/import and incremental measurements
are required before declaring the host workflow verified. The production
container is intentionally not activated during this rollout.

The first rebuilt manifest measures 35.7 GiB with five non-overlapping layers.
All prior store paths are retained except the two replaced application/root
outputs. A subsequent application-source change preserves all four dependency
layer digests and changes only the 1.02 GiB final layer. These are image-manifest
measurements, not an end-to-end activation benchmark.

See [the operator runbook](../developer/incremental-builds.md).
