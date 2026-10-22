# Isaac Sim sidecar — operations

Governing record: [ADR-2149](../adr/ADR-2149-isaac-sim-sidecar.md). Agent-facing usage: `skills/isaac-sim/`.

## Bring-up (host shell only)

Host bind paths resolve on the host, so building from the agent container would bake stale code
(`agentbox.sh` refuses). Free space first; the image is about 10 GB compressed and expands well beyond
that, and 20 GiB must remain free throughout. Do not prune other services' caches to make room.

Host shell (build, start, stop):

```bash
./agentbox.sh isaac-sim gpu                     # pick the GPU (one per container); saved to the gitignored .env
./agentbox.sh isaac-sim up                      # offers the same picker, default = last time; builds and starts
```

The picker lists each card with its memory and load, defaults to the saved choice, and times out to it after
`ISAAC_SIM_PICK_TIMEOUT` seconds (15; 0 waits). With nothing saved it picks nothing and fails closed. Non-interactive
runs (`ISAAC_SIM_NO_PROMPT=1`, no terminal) use the saved UUID or fail. It rewrites only its own `ISAAC_SIM_GPU_UUID`
line in `.env`. One GPU per container is deliberate: more throughput later means more instances, one per card.
`build`, `down`, `logs` and `status` read `ISAAC_SIM_GPU_UUID` from `.env`, because Compose interpolates the whole file. The control plane has no published port and `isaac-sim` resolves only on `visionclaw_network`, so
the checks below run **inside the agentbox container** (or via `docker exec agentbox …` from the host):

```bash
./agentbox.sh isaac-sim preflight               # versions, GPU, storage; the sim health levels are false at first
./agentbox.sh isaac-sim smoke                   # fall, pendulum, then fall again and compare (repeatability)
```

Then close the loop on real simulator output (the Blender bridge has so far only been run on analytic references):

```bash
blender-job.js submit skills/isaac-sim/tools/blender_import_motion.py -- \
  /home/devuser/exchange/isaac/jobs/<fall-job-id>/result --fps 25
```

Health rises only for a job that ran the exact baked fixture bytes and whose own `verification.json` has `pass: true`;
a client-chosen `kind` label proves nothing. `gpu_rendering` stays false: no render fixture exists yet.

From the host project, `scripts/launch.sh up dev` asks which optional sidecars (Codescape, Blender+QGIS, Isaac Sim) to
start, defaulting to last time's choice (stored in the gitignored `.launch-sidecars`). Non-interactive runs reuse that
choice; `--sidecars=blender,isaac-sim|none` sets it explicitly and `--no-prompt` skips the menu. Isaac Sim still needs
`ISAAC_SIM_GPU_UUID` in `agentbox/.env`: without it the sidecar is skipped with a warning and the main stack carries on.

Recreating only this service leaves Agentbox, Blender, ComfyUI and every volume untouched. Roll back with
`./agentbox.sh isaac-sim down`; the `isaac-sim-cache` volume can then be removed freely, the exchange volume never.

## Pin verification (do before the first build)

The pins in `isaac-sim-sidecar/Dockerfile` came from a discovery pass and are unverified until you do these:

1. `docker buildx imagetools inspect nvcr.io/nvidia/isaac-sim:6.2.0` — the linux/amd64 digest must equal the Dockerfile's `ISAAC_SIM_IMAGE`.
2. The pinned base uses uid/gid 1234 (`isaac-sim`) and mode 0750 on `/isaac-sim`.
   Compose retains uid/gid 1000 for the exchange volume and adds supplementary
   vendor group 1234 (`ISAAC_SIM_VENDOR_GID`). Both Python entry points have been
   checked under that identity. Recheck the user, traversal permissions and cache
   paths when changing the base; do not run privileged or recursively change the
   vendor tree's ownership.
3. Check the install page for 6.2.0: `ACCEPT_EULA` and `PRIVACY_CONSENT` names, and the Lab install steps.
4. `git ls-remote https://github.com/isaac-sim/IsaacLab refs/tags/v3.0.0` must resolve to `ISAAC_LAB_COMMIT`.
5. Both interpreter paths exist and run: `/isaac-sim/python.sh` (jobs) and `/isaac-sim/kit/python/bin/python3` (runner, healthcheck).
6. `git` is present in the base image (the Lab clone needs it) and `./isaaclab.sh --install none` is a valid invocation for Lab 3.0.0; adjust the Dockerfile if not.
7. Kit's writable directories: find every in-tree cache/log/data path under `/isaac-sim` and `HOME` that a uid-1000 process writes. Redirect each to `/isaac-cache`; do not run as root to avoid it.
   The baked fixtures pass `extra_args=["--portable-root", os.environ["ISAAC_KIT_PORTABLE_ROOT"]]`
   to `SimulationApp`, moving Kit's cache/data/log roots to `/isaac-cache/kit`.
   Custom job scripts must use the same launch option; changing `HOME` alone does
   not override Isaac Sim's default portable root inside its vendor directory.
   Hub uses `/isaac-cache/hub`; the inherited detect-only mode is disabled so it
   can start locally rather than search for a missing host Hub.
8. Save the image digest, `/etc/isaac-sim-versions.json`, `nvidia-smi` output and the smoke `verification.json` files
   as the deployment evidence the ADR's *Verification* section then cites.

## What each failure means

| Symptom | Meaning |
|---|---|
| `preflight` shows `physics_stepping: false` after `smoke` | no baked-fixture run has passed its own verification; the fixture failed; read `isaac-job.js tail <id>`; likely an Isaac API drift in `fixtures/sim_backend.py` |
| job `lost` | the sidecar restarted or the process was killed; inspect the log, then deliberately resubmit with `--rerun` |
| submit returns 507 | free space is below `ISAAC_SIM_MIN_FREE_GIB` floor; free space, do not lower the floor |
| `wait` exits 3 | observation timeout only; the job continues |

## Known limitations

Each job keeps at most 4 MiB in `job.log` and one 4 MiB rotation in `job.log.1`.
Small progress messages remain visible while jobs run. Result artefacts are
retained independently; log rotation never removes inputs, results or receipts.

Fixtures are unexecuted against the real image. Contact force/impulse and joint effort are reported as
unavailable until the backend is shown to expose them. Concurrency is a per-sidecar cap, not a lock shared
with ComfyUI or Blender; the operator is the arbiter of GPU assignment.
