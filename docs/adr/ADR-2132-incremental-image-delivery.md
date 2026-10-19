---
id: ADR-2132
title: Separate non-disruptive image preparation from scoped runtime activation
date: 2026-10-06
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 52183d76fde866ab1f05aea524aeea33d8573c3f
verified_paths: [agentbox.sh, scripts/runtime-delivery.*, scripts/refresh-compose.sh, config/build-registry.json, lib/image-layers.nix, flake.nix, tests/config/runtime-delivery*, .github/workflows/invariants.yml, docs/developer/incremental-builds.md]
owner: jjohare
review_trigger: layer grouping, delivery transport, candidate validation or cache retention changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2132 — Incremental image delivery and explicit activation

## Re-verification — 2026-10-15

The only changed hunk in the governed agentbox.sh adds `security` to the subcommand allowlist (ER-14); its existing scanner dispatch is unchanged. CLI regression checks pass, and all 23 runtime-delivery tests pass. Instruction projection, executable volumes, image evidence and vendor routing are unchanged.
Source anchor: `df584b3fd`. Existing status axes and deferred work remain unchanged.


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

At `cca7ea3b1`: `node --test tests/config/runtime-delivery.test.cjs` passes 22/22 with mocked Docker and Nix, covering help without Docker calls, `--prepare-only`, option refusal, the layer-duplication report, prepare in each delivery mode leaving the live lifecycle untouched, failure preserving the previous candidate, each drift rejection before mutation, scoped activation with a recovery tag, refusal of a foreign registry, a persistent-mount migration, a layer mismatch, and GC-root release. The source-drift guard (`c49339d0e`) compares `nix eval .#runtime.outPath` with the receipt's image path. Not run: a real host `prepare`/`activate` cycle and an end-to-end timing.

See [the operator runbook](../developer/incremental-builds.md).

## Re-verification — 2026-10-07 at cca7ea3b151be3ea44907581d40271c714b07dd0

`6d3d21b05` routes `agentbox.sh` `prepare`, `activate` and `rebuild` (`agentbox.sh:1075-1076,2577-2578`) through `scripts/runtime-delivery.sh` (flock) into `scripts/runtime-delivery.cjs`. `rebuild` no longer runs `cmd_down`, `cmd_up` or `post-deploy-cleanup.sh`, and `--prepare-only` skips activation (`:279-282`). `prepare` (`:148-228`) runs `refresh-compose.sh` and `nix build .#runtime .#runtime.copyTo`. It refuses repeated store paths and pushes to the loopback, digest-pinned registry in `config/build-registry.json`; `registry()` refuses anything else and needs a local Linux socket (`:87-122`). It then checks the loaded layers against the Nix manifest and smoke-tests with `--network none --read-only` and no mounts under an overridden entrypoint (`:123-132`). It refuses promotion if the agentbox container or `agentbox.toml` changed during the run. It never calls compose `up` or `down`. `releaseOldRoots` unlinks only `/nix/store` `result*` symlinks of successful generations other than the latest, previous and active ones (`:133-147`). `activate` validates the receipt (`:229-246`). It rejects a changed configuration hash or image identity, a changed container ID or start time, and persistent-mount drift. Since `c49339d0e`, it also rejects a `.#runtime.outPath` that differs from the prepared image (`:232-233`). It then tags `agentbox:recovery-<id>`, recreates only `agentbox` with `--no-deps --pull never`, re-checks the image and mounts, and waits for `/ready` (`:247-258`). `7dadf61d7` adds `lib/image-layers.nix`, where each group excludes all earlier layers, and orders `platform`, `toolchains`, `agent-clis`, `services` in `flake.nix:4378-4402`. `mkImage` defaults `maxLayers` to 1, so application and root paths form the fifth layer. `node --test tests/config/runtime-delivery.test.cjs` passes 22 of 22, and `.github/workflows/invariants.yml:70` runs it. Every Decision clause is in code, so `implementation_status: partial` understates it. The deferred items (capability splits, binary and Rust caches) are listed as consequences, not decision. `activation_status: staged` is honest: no activation runs without an explicit `activate`, and the ADR records that production was not activated. No real host prepare/activate cycle has been measured end to end. The decision holds.

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- prepare builds/imports a candidate without stopping or recreating agentbox or sidecars; rebuild = prepare + activate; --prepare-only omits activation
- default transport is digest-pinned loopback-only host registry; activate validates the receipt, replaces only agentbox via merged Compose with --no-deps --pull never, retains a recovery image
- cleanup is not part of either operation; GC-root release keeps latest/previous/active
- layers: lib/image-layers.nix excludes earlier layers; order platform, toolchains, agent-clis, services; mkImage maxLayers default 1 (five layers)
- tests/config/runtime-delivery.test.cjs is wired to invariants workflow and passes
- source-drift guard compares nix eval .#runtime.outPath to the receipt image path

Evidence:

- Diff to scripts/runtime-delivery.cjs is +9/-1: prepare's single nix build now also builds '.#runtime.securityEvidence' and '.#security-tools' and runs scripts/security-scan.sh report into generation/security, adding securityReport/securityBundleChecksum to the receipt. No change to activation, registry(), smoke test, drift checks, or GC-root release
- runtime-delivery.cjs (218dc12c3):258 only compose 'up' is in activate with -d --no-deps --force-recreate --pull never agentbox; no post-deploy-cleanup or 'down' references
- lib/image-layers.nix, config/build-registry.json, scripts/runtime-delivery.sh, scripts/refresh-compose.sh, invariants.yml: no diff since cca7ea3b1
- flake.nix:4502-4527 imageLayers = platform/toolchains/agent-clis/services, mkImage maxLayers ? 1 (hunks add securityEvidence/security-tools outputs and ADR-2139 programs; layer code unchanged)
- node --test tests/config/runtime-delivery.test.cjs → 23/23 pass (was 22; added security-report failure case, which asserts prepare still preserves the previous candidate and live container)
- invariants.yml:28,70 still run the test; incremental-builds.md hunk adds a 'Security report' section only
- agentbox.sh hunks: cmd_up/cmd_build call security-scan.sh report; cmd_rebuild/prepare/activate still delegate to runtime-delivery.sh (:1079-1080, :2682-2683)

Commands run: `node --test tests/config/runtime-delivery.test.cjs`

Not checked, and notes: Cosmetic drift only: re-verification section cites 22/22 tests and flake.nix:4378-4402 / runtime-delivery.cjs line spans that have shifted (tests 23/23; layers now flake.nix:4502-4518); and prepare's nix build is now '.#runtime .#runtime.copyTo .#runtime.securityEvidence .#security-tools' (still one nix call, still non-disruptive). No real host prepare/activate cycle can be run here (needs Docker/Nix/host).

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. Image layer composition only: the next `prepare` drops the Blender layer because `blender_local = false`. The prepare/activate flow, retained candidate and recovery images and the mount rules are unchanged. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.
