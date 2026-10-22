---
name: isaac-sim
description: "Run physics simulation of rigid and articulated bodies in the headless NVIDIA Isaac Sim sidecar (isaac-sim container, Isaac Lab pinned) and deliver the motion to Blender. Use for gravity/contact tests, jointed bodies and robots, reproducible simulated trajectories, contact events, or when a Blender animation needs real dynamics instead of a posed or IK-driven result. Not for controllers or imitation learning (Stage B, not yet deployed), RL training, or ROS."
---

# Isaac Sim sidecar

Headless Isaac Sim in its own GPU container, driven by a small typed job API. Agentbox stays
the control plane; Blender stays the authoring and rendering environment. Specified by
[ADR-2149](../../docs/adr/ADR-2149-isaac-sim-sidecar.md).

Check what is actually usable before planning around it:

```
node /opt/agentbox/skills/isaac-sim/tools/isaac-job.js preflight
```

`health` reports four separate levels (control, simulator initialised, physics stepping, GPU
rendering). The last three rise only when a job ran the exact baked fixture (`fixtures/fixtures/*.py`)
and its own `verification.json` says `pass: true`; a healthy container, an installed package or a
job you labelled `smoke:*` proves none of them. `verified` lists the qualifying runs; `submitted_kinds`
is informational. `gpu_rendering` is always false until a render fixture exists.

## Workflow

1. `stage` the script and inputs into the shared tree (prints sha256; symlinks refused).
2. `submit <script> --kind K --seed N --require motion.json ...` returns a durable job id.
   Identical script + inputs + args + seed returns the existing job. Use `--rerun` to force.
3. `wait <id>` or `status <id>`. A client timeout is **not** a failure: ask again, never resubmit.
4. `artefacts <id>` is complete only after the runner validated the required outputs.
5. Import into Blender with `tools/blender_import_motion.py` via `blender-job.js` (see below).

Jobs are trusted agent-authored Python run by Isaac's interpreter, exactly like Blender
`execute_code`. Only submit scripts you wrote or reviewed. `cancel` signals that job's process
group only and keeps the receipt and partial log.

## Motion to Blender

```
blender-job.js submit skills/isaac-sim/tools/blender_import_motion.py -- \
  /home/devuser/exchange/isaac/jobs/<id>/result --fps 25
```

It bakes each body as a world-space Empty at float frame `t * fps` (no rounding, no resampling of
the physics timeline), then compares **every** sample, including off-grid ones, against the export
at declared tolerances and checks that two cameras see identical world matrices. Exit 3 means the
bridge failed regardless of how the preview looks. Verify the job's exit state *and* read
`motion_bridge_report.json`: `blender-job.js` and `blender-batch.sh` now pass `--python-exit-code 1`, so a script exception fails the job; the
importer's own forced non-zero exit stays as defence in depth.

## Rules that bite

- Physics runs at the solver step; the delivery clock (for example 25 fps) is applied downstream.
  Never make the solver step at the delivery rate, and keep one time mapping for all bodies.
- Mark estimated masses/inertias (`mass_estimated`). Do not call guessed values measured.
- Conventions are fixed: right-handed, Z up, metres, quaternions w-x-y-z. See
  [references/motion-contract.md](references/motion-contract.md).
- Never target the GPU of another service for convenience. The sidecar is pinned to one GPU UUID.
- Do not install anything into the sidecar from a job; pinned Lab lives at `/opt/IsaacLab`.

References: [job API](references/job-api.md) · [motion contract](references/motion-contract.md) ·
[operations and pins](../../docs/developer/isaac-sim.md).
