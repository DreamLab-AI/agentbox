---
id: ADR-2142
title: Blender runs sidecar-first; the in-container binary is optional
date: 2026-10-16
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 61f27d5b375f9838ef7b7334e3f984d0d4a9ea70
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
