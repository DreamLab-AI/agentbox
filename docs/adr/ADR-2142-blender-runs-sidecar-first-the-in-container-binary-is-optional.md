---
id: ADR-2142
title: Blender runs sidecar-first; the in-container binary is optional
date: 2026-10-16
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: d1dd896f4a790762b150d81a94a03b268b04c543
verified_paths: [agentbox.toml, flake.nix, skills/blender/tools/blender-job.js, skills/blender/tools/blender-introspect.js, skills/blender/tools/blender-batch.sh, skills/blender/SKILL.md, skills/uk-solar-planner/SKILL.md, skills/game-dev/tools/engine-check.sh, tests/toolchains/blender-present.sh]
owner: jjohare
review_trigger: the image rebuild activates the change, the GPU sidecar (gui-tools-service) or its shared volume changes, a local-Blender consumer is added, or `blender_local` is flipped in the shipped manifest
repo: agentbox
---

# ADR-2142 — Blender runs sidecar-first; the in-container binary is optional

## Context
- BlenderMCP needs an OpenGL context in Blender's GUI event loop; the in-container display has none, so interactive Blender already lives in the GPU sidecar (`gui-tools-service`) behind the `blender-mcp` proxy.
- Headless batch work used the in-container `pkgs.blender` (`wrapGpuBin`), a large closure with its own vulnerability surface (ADR-2137) and no GPU render path of its own.
- `/home/devuser/gui-tools` here and `/home/devuser/exchange` in the sidecar are one volume (verified bidirectional 2026-10-15), so a job can be staged, run there and read back without a socket transfer.
- The two gates were conflated: `skills.spatial_and_3d.blender` gated both the proxy and the package.

## Decision
- `[skills.spatial_and_3d].blender` gates the skill, the `blender-mcp` proxy and its supervisor block. A new `blender_local` (boolean, default true when absent) gates only the in-container binary. The catalogue lists them as `blender-mcp` and `blender-local` (`apply_class: 'rebuild'`).
- This deployment sets `blender_local = false`. Scripted builds and renders go through `skills/blender/tools/blender-job.js` (stage, submit, status, tail, wait, list, cancel) into the sidecar; `blender-batch.sh` exits 2 with a pointer when no local binary exists.
- The job runner treats the shared volume as untrusted: it refuses symbolic links on both sides of `stage`, opens state files with `O_NOFOLLOW`, records a `/proc` start time with each pid and verifies it before reporting a job running or signalling it, and creates no job directory before the sidecar has answered.
- Consumers of Blender (`uk-solar-planner`, `game-dev`) must not assume a local binary unless `blender_local` is true or absent.

## Consequences
- The activated image drops the in-container `blender` binary and its closure from this deployment; `blender-present.sh` skips (exit 77) once the key is false.
- There is no local fallback when the sidecar is down: jobs and interactive work fail with exit 2 until `./agentbox.sh gui-tools up`. This is the accepted trade for a smaller image and GPU renders on the sidecar.
- ADR-2137: existing image VEX statements bound to Blender and its dependency PURLs must be withdrawn and regenerated from the next image's `image.layers.paths`.
- ADR-2132: the activated candidate drops the Blender layer; the prepare/activate flow itself is unchanged.
- Scripts run in the sidecar see the repository only through staged files and use the `exchange` path spelling; the sidecar's Blender build can differ from the one that used to be baked, so run `blender-introspect.js version` before relying on an API.
- Implementation is complete and tested (`skills/blender/tools/tests/`); activation was verified on 2026-10-16 with the rebuilt image and a completed sidecar render. Revert: `blender_local = true` and rebuild.

## Activation evidence (2026-10-16)

Image source `9fcd1eef98b2a3eb8469df0fb6bf62ec7a34cc76` is active. No local `blender` command is present; baked API introspection reports sidecar Blender 5.2.0 LTS. Job `deploy-20261016-smoke` exited 0 and produced `smoke.png` using OptiX on NVIDIA RTX 6000 Ada GPUs. All 32 persistent mounts and 16 sidecar container identities were preserved. Fresh SBOM/VEX evidence was generated from the candidate image layers.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff 9fcd1eef9..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.

Re-verified and deployed 2026-10-20 at `dd6ff7e065a9a2851f7cfa9fa8c71305ce2a8782`: the reviewed flake/Compose delta adds only a root-owned 1 MiB tmpfs at `/etc/claude-code` so boot can project the managed floor on the read-only rootfs. Live file is uid 0, mode 0644, agent-readable and agent-unwritable; the same floor is present in the 13,605-byte Codex instructions. Root and all eight Claude profiles each register the three decline events once. Native pod alpha.17 serves `/forge` (HTTP 200), with testnet policy and zero mirror follows/announce relays; activity sink remains off. Readiness has no degradation, 32 persistent mounts are unchanged, and the other 17 containers are unchanged (speech-to-text was separately rebuilt for its tested marker-ordering fix). The image SBOM/VEX evidence was regenerated for the shipped image; this does not claim an online vulnerability scan or cover the host and sidecars. Existing decision and status axes are retained unless the record explicitly states activation below.


## Re-verification — 2026-10-21

The manifest diff only selects minimal thinking and a 20-minute cap for the final deepsec sweep; feature gates, identity policy, corpus paths and memory geometry are unchanged. The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

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

## Bridge example verification — 2026-10-21

At `f67874c7e`, the Blender skill's JSON example now names the same baked
Node bridge as `register-mcp.sh`; the sidecar proxy, optional local binary
gate and background-job implementation are unchanged. The MCP protocol and
Blender tool tests pass (23 media Node tests); this is a documentation fix.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch Blender. Re-read at HEAD: the `blender && blender_local` condition on `wrapGpuBin pkgs.blender` (flake.nix:1504), `ENABLE_BLENDER_LOCAL` (flake.nix:4371), and the shipped manifest still has `blender_local = false` (agentbox.toml:635). `node scripts/ci/check-manifest-catalogue.js` passes (95 gate paths) in a detached worktree at HEAD. No image rebuild or sidecar run.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2142 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.
