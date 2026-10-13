---
id: ADR-2138
title: Sweep idle Cargo target directories under supervisord
date: 2026-10-12
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 044f1d689569572417a98f91afcf744fc2ca2385
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

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- [resources.target_gc] gates [program:target-gc]; flake default (no section) is off; shipped agentbox.toml sets enabled = true
- Program is `target-gc --delete --loop`, one pass every interval_secs (6 h), nice + idle I/O class, run as devuser; new agentbox-ops binary, read-only unless --delete
- Removal needs: Cargo's (CACHEDIR.TAG standard signature AND (.rustc_info.json OR a profile dir with .fingerprint)); no build using it (non-blocking exclusive flock on every .cargo-lock within two levels; unopenable lock counts as held); idle (nothing within three levels modified in max_age_days = 7); all rechecked immediately before removal
- Walk never follows symlinks, never enters .git or node_modules, does not search inside a found target
- Roots default to the workspace; exclude defaults to /home/devuser/workspace/project
- Manifest baked into /etc/agentbox.toml (REBUILD-class); one-off sweep via flags --root/--exclude/--max-age-days
- Validator raises E080 for a relative path and W077 when every root is excluded
- Verification: nine unit cases incl. held lock, symlink escape, nested targets, exclusion; one binary-level case proving a default run deletes nothing; target-gc.test.sh has 18 checks

Evidence:

- git diff 3baa60024..de7fa461e -- services/agentbox-ops/src/target_gc.rs services/agentbox-ops/src/bin/target-gc.rs tests/config/target-gc.test.sh → empty
- services/agentbox-ops/src/target_gc.rs:32-33 CACHEDIR_SIGNATURE; :152-170 is_cargo_target (tag signature + .rustc_info.json or .fingerprint); :36 SKIPPED_DIRS [.git, node_modules]; :38 PROBE_DEPTH = 3 used by newest_mtime (:231-250); :256-276 lock_files (target + profile dirs, two levels); :287-298 is_locked (non-blocking exclusive flock; open failure/WOULDBLOCK/other error => locked); :173-206 discover (symlink_metadata everywhere, `continue` after a found target so no descent); :300-345 sweep rechecks idle + !is_locked immediately before remove_dir_all; :56-64 defaults (roots=/home/devuser/workspace, exclude=<root>/project, 7 days, 21_600 s)
- services/agentbox-ops/src/bin/target-gc.rs:20-41 --delete (off by default), --root, --exclude, --loop; :44-68 policy(): manifest then flag overrides; --max-age-days
- flake.nix:216 targetGcEnabled = (resourcesCfg.target_gc or {}).enabled or false; :3293-3310 [program:target-gc] command=ionice -c3 target-gc --delete --loop --manifest /etc/agentbox.toml, user=devuser, inside lib.optionalString targetGcEnabled; nice via ${bgNice}; agentbox.toml:1527-1541 enabled=true, roots=[/home/devuser/workspace], exclude=[.../project], max_age_days=7, interval_secs=21600
- scripts/agentbox-config-validate.js:643-670 E080 (non-absolute roots/exclude) and W077 (enabled, every root excluded)
- cargo test in services/agentbox-ops: `--lib target_gc` → 9 passed x3 runs; tests/target_gc_default_is_read_only.rs → 1 passed (default run deletes nothing); full lib 212 passed with --test-threads=1
- NODE_PATH=<agentbox checkout node_modules> bash tests/config/target-gc.test.sh → 18 passed, 0 failed. (Without NODE_PATH the worktree lacks node_modules and the two validator checks fail with 'missing Node deps'; environmental, not a defect.)

Commands run: `git diff 3baa60024..de7fa461e -- <verified_paths> (empty); cargo test --locked --offline (services/agentbox-ops, scratch target dir); NODE_PATH=<agentbox>/node_modules TMPDIR=<scratch> bash tests/config/target-gc.test.sh`

Not checked, and notes: Two caveats worth recording but neither falsifies the ADR: (1) Flake test: in a default parallel `cargo test`, target_gc::tests::a_target_with_a_held_cargo_lock_is_kept_even_when_idle failed once (assert 'released locks are no longer busy', target_gc.rs:451) because a concurrently-running test that spawns child processes (hermes) can briefly inherit the test's lock fd across fork, keeping the flock alive after drop(holder); it passes 3/3 in isolation and with --test-threads=1. A real, latent test-isolation flake, not a product defect (and arguably a reminder that fork-inheritance can hold a Cargo lock, which only makes the sweeper err on the safe side). (2) Validator code collision: scripts/agentbox-config-validate.js now uses E080 for BOTH this ADR's relative-path check (L656) and ADR-2139's System One checks (L1582-1596); the ADR-2138 claim is true but 'E080' is not unique to it. The unchanged-diff does not cover agentbox.toml/flake.nix/validator, so I read those at de7fa461e directly. Not verified: 'nix flake check'/image build (the record says unrun) and the 'read-only run against the live workspace' (I did not run the binary on the live workspace).

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.
