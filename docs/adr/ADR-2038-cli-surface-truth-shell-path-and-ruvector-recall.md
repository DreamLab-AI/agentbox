---
id: ADR-2038
title: agentbox.sh CLI surface tells the truth — cmd_shell targets the live workspace path, ruvector usage lists recall
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: any change to $WORKSPACE in config/entrypoint-unified.sh, to services/agentbox-manifest's profile path, or to ruvector-sidecar-update.sh's subcommand dispatch
repo: agentbox
domain: BASELINE-container
---

# ADR-2038 — agentbox.sh CLI surface tells the truth — cmd_shell targets the live workspace path, ruvector usage lists recall

## Context

Two divergences in agentbox.sh's advertised surface (diagrams AB-05.5, AB-05.6). (a)
`cmd_shell` (agentbox.sh:1103) exec'd `cd /workspace/profiles/${profile}` inside the
container; agentbox/CLAUDE.md "Runtime model gotchas" states the literal `/workspace` is
retired, `HOME=/home/devuser`, workspace is `/home/devuser/workspace`; every host-side sibling
in the same script already uses `${SCRIPT_DIR}/workspace/profiles` (agentbox.sh:347, :511).
Container-side, `config/entrypoint-unified.sh:221,701` export `WORKSPACE=/home/devuser/workspace`
and `services/agentbox-manifest/src/stacks.rs:102` provisions each stack at
`env.workspace.join("profiles").join(name)`, confirming the live profile path is
`/home/devuser/workspace/profiles/<profile>`. (b) agentbox.sh:48's usage text lists the
`ruvector` subcommands and omits `recall`, which `scripts/ruvector-sidecar-update.sh:1146`
(`cmd_recall`) implements and `:1184`/`:1188` already dispatch and advertise in its own error
text.

## Decision

(a) `cmd_shell` now execs `cd /home/devuser/workspace/profiles/${profile}` — the literal,
verified container path — rather than the retired `/workspace` alias. (b) The usage line at
agentbox.sh:48 appends `|recall` to the bracketed subcommand list, and a one-line example
(`$0 ruvector recall`) is added after the `build-metadata-gin` example, matching the existing
example style.

## Consequences

- `agentbox.sh shell <profile>` lands in the profile's actual working directory instead of
  silently falling through to the container's default shell location (or failing outright once
  `/workspace` is fully retired).
- `agentbox.sh --help` / `ruvector -h`-adjacent usage text now lists every subcommand the
  dispatcher actually implements, closing the DOC-DRIFT flagged at AB-05.6.
- No behaviour change to `cmd_ruvector`'s dispatch or `ruvector-sidecar-update.sh` — recall was
  already reachable, only undocumented in the top-level usage text.

## Verification

Ran against the uncommitted working tree, HEAD at `89301ec7c911eab270c00a0cf81596d0d4f15535`
(agentbox submodule). Must be re-verified at the landing commit.

```
$ bash -n agentbox/agentbox.sh
(no output — exit 0)
```

```
$ grep -n "WORKSPACE=" agentbox/config/entrypoint-unified.sh
221:export WORKSPACE="/home/devuser/workspace"
701:export WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"
1395:    run_as_devuser env WORKSPACE="$WORKSPACE" \
1666:  SKILLS_TREE="${SKILLS_TREE:-/opt/agentbox/skills}" WORKSPACE="$WORKSPACE" \
1980:  WORKSPACE="$WORKSPACE" \
1998:export WORKSPACE="$WORKSPACE"
$ grep -n 'profiles' agentbox/services/agentbox-manifest/src/stacks.rs | head -3
4://! `workspace/profiles/<name>/` tree per stack with an `.env`, a `README.md`,
5://! shared-mount symlinks, and (for Claude-hosted profiles) a
102:    let root = env.workspace.join("profiles").join(name);
```
Confirms `/home/devuser/workspace/profiles/<profile>` is the live container path cmd_shell
must target.

```
$ grep -n "cmd_shell()" -A 15 agentbox/agentbox.sh | grep "docker exec"
1098-        docker exec -it --user 1000 agentbox bash -c \
1104-    docker exec -it --user 1000 agentbox bash -c "cd /home/devuser/workspace/profiles/${profile} && exec fish"
```

```
$ sed -n '48p' agentbox/agentbox.sh
  ${GREEN}ruvector${NC}         Manage the ruvector-postgres memory sidecar [status|check|test|update|rollback|migrate-trajectories|repair-namespaces|backfill-embeddings|archive-legacy|aggregate-effectiveness|build-metadata-gin|recall]
$ grep -n "ruvector recall" agentbox/agentbox.sh
  $0 ruvector recall                     # recall-regression harness (ADR-040 D2/W-B, read-only; self-recall@10 / true-recall@10)
```

```
$ grep -n "cmd_recall()\|recall)" agentbox/scripts/ruvector-sidecar-update.sh
1146:cmd_recall() {
1184:    recall)   shift || true; cmd_recall "$@" ;;
```
Confirms `recall` was already implemented and dispatched; only the top-level usage text was
missing it.

```
$ cd agentbox && node scripts/adr-index-gen.js docs/adr --check
ok: 54 ADR(s) valid (--check, README not written)
$ node scripts/adr-index-gen.js docs/adr
ok: 54 ADR(s) valid; wrote docs/adr/README.md
```
