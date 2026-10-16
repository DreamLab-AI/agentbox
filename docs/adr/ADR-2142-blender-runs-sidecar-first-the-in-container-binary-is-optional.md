---
id: ADR-2142
title: Blender runs sidecar-first; the in-container binary is optional
date: 2026-10-16
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 9fcd1eef98b2a3eb8469df0fb6bf62ec7a34cc76
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
