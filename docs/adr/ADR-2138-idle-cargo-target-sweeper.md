---
id: ADR-2138
title: Sweep idle Cargo target directories under supervisord
date: 2026-10-12
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [services/agentbox-ops/src/target_gc.rs, services/agentbox-ops/src/bin/target-gc.rs, tests/config/target-gc.test.sh]
owner: jjohare
review_trigger: the first sweep that removes a directory a build still needed; a change to how Cargo locks its target directory; the operator deciding whether project/ joins the sweep
repo: agentbox
domain: BASELINE-container
---

# ADR-2138 — Sweep idle Cargo target directories under supervisord

## Context

Agents build in many git worktrees and scratch directories, and each gets its own Cargo `target/`, 5 to 50 GB apiece. A survey on 2026-10-12 found 99 of them totalling 707 GiB on a host disk at 95%. One manual sweep of the idle ones recovered 525 GiB. All of it is regenerable, and none of it is ever cleaned, so it refills.

The container has no systemd: PID 1 is supervisord, and timed work is a supervised program gated on a manifest key (ADR-2057, ADR-2131, ADR-2034). Housekeeping Rust already lives in `services/agentbox-ops` (`teammate-gc`, `ruflo-daemon-gc`).

## Decision

A manifest section `[resources.target_gc]` gates `[program:target-gc]`. The flake's default for a manifest without the section is off, because the program deletes data; the shipped `agentbox.toml` sets `enabled = true`. The program is `target-gc --delete --loop`, one pass every `interval_secs` (6 h), at `nice` and idle I/O class, run as `devuser`. The tool is a new `agentbox-ops` binary, read-only unless `--delete` is passed.

A directory is removed only if all of these hold, rechecked immediately before removal:

- **It is Cargo's.** `CACHEDIR.TAG` carries the standard signature and either `.rustc_info.json` exists or a profile directory holds `.fingerprint`. Other tools write `CACHEDIR.TAG`, so the tag alone does not qualify.
- **No build is using it.** Cargo holds an exclusive `flock` on `.cargo-lock` for a whole build; a non-blocking exclusive attempt on every such file within two levels must succeed. An unopenable lock file counts as held.
- **It is idle.** Nothing within three levels was modified in the last `max_age_days` (7).

The walk never follows symlinks, never enters `.git` or `node_modules`, and does not search inside a target it has found. Roots default to the workspace. `exclude` defaults to `/home/devuser/workspace/project`, the host-bound checkout whose `launch.sh up dev` reuses `project/target`: a sweep there would silently turn a 2-minute build into a 15-minute one. The operator opts it in by editing `exclude`.

The manifest is baked into `/etc/agentbox.toml`, so every key is REBUILD-class. A one-off sweep uses flags (`--root`, `--exclude`, `--max-age-days`) and needs no rebuild. The validator raises `E080` for a relative path and `W077` when every root is excluded.

## Consequences

- Build output stops accumulating without bound. The cost is a cold rebuild of any worktree untouched for a week.
- A directory used only by a process that opens no `.cargo-lock` (a custom `CARGO_TARGET_DIR` consumer reading artefacts, not building) can be removed while idle by the clock. That is the accepted failure case; `max_age_days` is the guard.
- Hard links are double-counted in the reported size. The report is an estimate.
- `nix flake check` and the image build were not run in the authoring container; the supervisor block is checked by text (`tests/config/target-gc.test.sh`), and the image is unverified until the host `./agentbox.sh rebuild`.
- Not covered: Docker images, volumes and build cache, which are host-side, and `.tmp` scratchpads that hold no Cargo target.

## Verification

`cargo test` in `services/agentbox-ops` (nine unit cases including a held lock, symlink escape, nested targets and exclusion; one binary-level case proving a default run deletes nothing), `bash tests/config/target-gc.test.sh` (18), and a read-only run of the binary against the live workspace.
