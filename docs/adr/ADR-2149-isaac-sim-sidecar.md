---
id: ADR-2149
title: Isaac Sim runs as an opt-in headless sidecar behind a typed job API
date: 2026-10-22
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: first pinned-image build and smoke run; any Isaac Sim, Isaac Lab or controller version change; Stage B (controllers) proposal
repo: agentbox
domain: BASELINE-container
---

# ADR-2149 — Isaac Sim runs as an opt-in headless sidecar behind a typed job API

## Context
Blender and ComfyUI are GPU sidecars (ADR-2142, ADR-2148). Articulated-body and robot simulation
needs NVIDIA Isaac Sim, whose Ubuntu/Omniverse runtime cannot live in the Nix image. The existing
sidecars publish ports on `0.0.0.0`, default to all GPUs or index 0, and launch jobs over the
Blender socket; none of that is acceptable here. Free disk is the binding constraint, so every job is refused below a configurable free-space floor (default 20 GiB).

## Decision
1. **Sidecar.** `docker-compose.isaac-sim.yml`, service `isaac-sim`, derived from the pinned NVIDIA
   image by digest, non-privileged, no Docker socket, `no-new-privileges`, **no `ports:`**. Headless;
   streaming is a future profile. Live-class and ungated like `gui-tools-service` (no `agentbox.toml` section: runtime knobs are the `ISAAC_SIM_*` environment variables), not part of the Nix image.
2. **Versions (chosen 2026-10-22).** Isaac Sim **6.2.0** with Isaac Lab **v3.0.0** (commit
   `e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4`, verified after checkout; the build fails on a moved tag),
   because the Lab release documentation pairs those two. ProtoMotions is excluded: its pinned Lab
   revision targets Sim 6.0. The digest recorded in the Dockerfile was observed from the registry
   manifest and must be re-checked at build time.
3. **GPU.** Pinned by UUID through `ISAAC_SIM_GPU_UUID` in the gitignored `.env`. The compose file
   and `agentbox.sh` fail closed without it. One job at a time by default (`max_concurrent`); a
   service sharing a GPU is not evidence the GPU is free.
4. **State.** The existing `agentbox_gui-tools-exchange` volume, confined to `isaac/`, so Blender and
   agentbox read results with no recreation of either. Shader/kit/asset caches live in their own
   `isaac-sim-cache` volume. The container runs as uid 1000, the volume owner.
5. **Control.** An internal stdlib HTTP runner on `isaac-sim:9890` (not `docker exec`, which
   role isolation denies): idempotent submit with a receipt, `queued/running/succeeded/failed/cancelled/lost`,
   bounded logs, per-job process-group cancel, manifest written only after required outputs validate,
   pid plus /proc start time so a recycled pid is never trusted, `lost` (never auto-resubmitted) after a restart,
   and a free-space floor. It is Python because it must run under the interpreter the vendor image ships; the
   client (`skills/isaac-sim/tools/isaac-job.js`) is Node, as `blender-job.js` is.
6. **Health is four levels** (control, simulator initialised, physics stepping, GPU rendering). Only
   the first is inferred; the others become true only from a **succeeded smoke job of that kind**.
7. **Contract.** `isaac-motion-export/1` (Z up, metres, quaternion wxyz, continuous simulation time,
   explicit estimated-mass flags and joint limits) is validated by `motion_export.validate`. USD/UsdPhysics
   carries scenes; URDF/MJCF are accepted inputs. Blender import bakes at float frames with no resampling.
8. **Scope.** Stage A plus the pinned Isaac Lab install. No controllers, RL, streaming or ROS. A Stage B
   ADR must reconcile the ProtoMotions/MimicKit pins first. Host-project fixtures stay out of this repository.
9. **Egress.** Pulls come from `nvcr.io`; Lab is cloned from GitHub at build time only; telemetry is
   off (`PRIVACY_CONSENT=N`); fixtures need no remote assets. No job content leaves the container.

## Consequences
- Adds a heavy opt-in service and roughly 10 GB compressed image (larger installed) plus Lab; build only from the host shell.
- A job script is trusted Python with the sidecar's file access, like Blender `execute_code`. The control
  plane is reachable by any container on `visionclaw_network`; this is an accepted internal boundary, not a public API.
- The exchange volume is shared: Isaac can see Blender's files and the reverse. Least-privilege `subpath` mounting is a follow-up.
- Fixtures call Isaac through one adapter (`sim_backend.py`) so API drift is a one-file change.

## Verification
Executed (2026-10-22, no image present): `tests/isaac-sim/test_runner.py` (9 cases: lifecycle, idempotency, queueing, per-job cancel, `lost`, health-evidence rules, stub interpreter),
`tests/isaac-sim/test_motion_export.py` (6 contract and repeatability cases), runner plus `isaac-job.js` end to end, and
the Blender 5.2.2 bridge on the live `gui-tools-service` against analytic references: worst position error
6.1e-8 m and rotation 1.5e-7 rad against declared 1e-5 m / 1e-4 rad, identical world matrices across two cameras.
That proves the importer and conventions, **not** any Isaac output. `agentbox-config-validate` and `skills/lint-skills.sh` pass.

**Not yet verified, hence `partial`/`staged`:** the image build and digest, the runtime user and cache paths,
the EULA and privacy variable names for 6.2.0, the Lab install, the compose interpolation (Compose was not run),
and every Isaac-side fixture (`fall_box.py`, `pendulum.py`). The first `./agentbox.sh isaac-sim smoke` is that verification.
