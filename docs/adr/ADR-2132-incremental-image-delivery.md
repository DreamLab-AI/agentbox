---
id: ADR-2132
title: Separate non-disruptive image preparation from scoped runtime activation
date: 2026-10-06
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 75378856483d13f952569018421c4526da0aede2
verified_paths: [agentbox.sh, scripts/runtime-delivery.*, scripts/refresh-compose.sh, config/build-registry.json, lib/image-layers.nix, flake.nix, tests/config/runtime-delivery*, .github/workflows/invariants.yml, docs/developer/incremental-builds.md]
owner: jjohare
review_trigger: layer grouping, delivery transport, candidate validation or cache retention changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2132 — Incremental image delivery and explicit activation

## Scoped re-verification — 2026-10-31

Reviewed the governed-path delta since the previous verification: only the
operator user-cron gate, devuser supervisor block, rebuild-class catalogue entry
and its boolean schema registration changed. Existing capability, identity,
storage and network contracts are unchanged. Preflight, manifest validation,
25 role-isolation supervisor checks and the user-cron schema regression pass.
This does not promote any activation status or claim a live role-isolation rehearsal.

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

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

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified and deployed 2026-10-20 at `dd6ff7e065a9a2851f7cfa9fa8c71305ce2a8782`: the reviewed flake/Compose delta adds only a root-owned 1 MiB tmpfs at `/etc/claude-code` so boot can project the managed floor on the read-only rootfs. Live file is uid 0, mode 0644, agent-readable and agent-unwritable; the same floor is present in the 13,605-byte Codex instructions. Root and all eight Claude profiles each register the three decline events once. Native pod alpha.17 serves `/forge` (HTTP 200), with testnet policy and zero mirror follows/announce relays; activity sink remains off. Readiness has no degradation, 32 persistent mounts are unchanged, and the other 17 containers are unchanged (speech-to-text was separately rebuilt for its tested marker-ordering fix). The image SBOM/VEX evidence was regenerated for the shipped image; this does not claim an online vulnerability scan or cover the host and sidecars. Existing decision and status axes are retained unless the record explicitly states activation below.


## Re-verification — 2026-10-21

The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified at `c8c20341c66feec751fe6234167c220c70fe2ffb`: the only governed code delta is the REUSE
Sphinx builder string correction. Both documentation outputs and all 872
enabled package tests pass; 23 runtime-delivery checks pass. Runtime
boundaries and activation status are unchanged.

Re-verified at `9173cdba6f0a84556bbd4c059db0a7e823aa7a2d`: the governed delta isolates Typepy 1.3.5
and fixes wrapper arguments for host-only sbomnix. Its dependency suites
pass (834 Typepy, 1682 SimpleSQLite), 23 delivery checks pass, and an actual
shipped-path smoke scan emits CycloneDX, SPDX and CSV. Runtime and activation
contracts remain unchanged.

## Re-verification — 2026-10-21 at 73bd631c0

Reviewed the committed change to the Codex home: the parent tmpfs becomes a
named volume; its package volume and credential bind remain independent. No
supervisor, ingress, toolchain, feature-gate, scanner or instruction-projector
code changes. Compose persistence and runtime-delivery checks pass (24 tests),
Compose refresh checks pass (3 tests), and role-supervisor checks pass (25 tests).
This mount migration is explicitly outside fast activation (ADR-2147).

## Re-verification — 2026-10-21 at 395380f71

Reviewed the committed remote-media change against this record. Nix changes
only the ComfyUI MCP dependency closure and its existing builtin/external gates;
`skills/mcp.json` changes only Blender's declared protocol. Blender's optional
local binary, proxy and background-job safety boundaries remain intact. No
identity, ingress, daemon role, instruction projection, persistent mount, scanner
or vendor-routing behavior changes. Media checks pass: 23 Node tests, 12 graph
client tests and 9 downloader tests. Runtime/Compose checks pass (27 tests),
role-supervisor checks pass (25), skills lint and loopback-port checks pass.
Sidecar image activation is tracked separately in the host deployment receipt.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch layering. Re-read at HEAD: `imageLayers` via `lib/image-layers.nix` (flake.nix:4583) and `mkImage ... maxLayers ? 1` (flake.nix:4603). The cacert override changes one package's version string and bundle contents, not layer grouping. `node --test tests/config/runtime-delivery.test.cjs` passes 23/23 and `node --test tests/config/refresh-compose.test.cjs` passes 3/3 in a detached worktree at HEAD.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2132 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.

## Close-out 2026-10-30 — activation

`activation_status: staged → live`. The Verification section's missing item, "a real host `prepare`/`activate` cycle", has now run on the host and is the delivery path of the running container.

- Running image: `.agentbox-build/active.json` (host, read via the project bind) records `sourceCommit` `e786197ccb9f56c638d4b0181e77f33ab38b7db9`, `sourceDirty: false`, `delivery: registry`, `activatedAt` 2026-10-30T14:22:59.281Z, `imageId` `sha256:9776d2fc515c…`; `docker inspect agentbox --format '{{.Image}}'` and `$AGENTBOX_IMAGE_HASH` both return `sha256:9776d2fc515c5922cde9f7791248f731416192a6b4a66e8d6d06b15bfd5c892d`. The running container therefore runs main at `e786197cc`.
- The same receipt records `preparedStartedAt` 2026-10-30T14:13:43Z, `createdAt` 14:22:04Z, and `seconds` `{build: 125.452, pushOrStream: 9.961, pull: 61.258, smokeAndVerify: 0.521, deliveryAndSmoke: 71.968}`; `candidate.json` sits beside it and generation directories are retained.
- `docker images | grep recovery` lists `agentbox:recovery-7fb68740e2f3`. A recovery tag exists, but it cannot be dated to this cycle: Nix-built images report `Created` 0001-01-01.

Implementation axis and `verified_commit` are unchanged; the timings are one cycle, not a benchmark.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `.github/workflows/invariants.yml`: `check-no-logseq-paths` also rejects `mainKnowledgeGraph` and `pages/` literals (`bbb942058`); `flake.nix`: the ontomark comment now names the verbs it owns (`4a07fbfb3`). No section this record governs changed; the decision holds. Re-verified by `git diff 358e5d32c..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.
