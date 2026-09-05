---
id: ADR-2040
title: No supervised program offers an unauthenticated listener on a bridge-reachable interface
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: A new supervised program that binds a network interface, or any proposal to set --auth none / an empty auth token on one
repo: agentbox
domain: BASELINE-container
lineage: extends ADR-2013 (loopback-only compose publishes) from the publish plane to the listener plane; ADR-2003 (gate both package set and supervisor block); precedent [program:aoe-serve] token auth
---

# ADR-2040 — No supervised program offers an unauthenticated listener on a bridge-reachable interface

## Context
ADR-2013 constrains what compose **publishes** to the host. It cannot see what a process **binds**
inside the container, because a container-internal bind is never declared as a port in any syntax —
so no amount of parser rigour in `scripts/ci/check-ports-loopback.mjs` would detect it. Two
supervised programs bind all interfaces with no credential: `code-server --bind-addr 0.0.0.0:8080
--auth none` (`[program:code-server]`) and `jupyter-lab --ip=0.0.0.0 --port=8888
--IdentityProvider.token=` (`[program:jupyter-lab]`; an empty token EXPLICITLY assigns the trait,
which beats the traitlets default that would otherwise read `JUPYTER_TOKEN`). Both gates are ON in the running manifest
(`[toolchains].code_server` and `[skills.data_science].jupyter`, both `true`). The host publishes are loopback (`docker-compose.yml:59`, `:61`), but
a loopback publish only constrains host→container; agentbox joins the external `visionclaw_network`
(`docker-compose.yml:160-162` → `docker-compose.override.yml:180-183`), so every peer on that bridge
reaches both unauthenticated. code-server exposes a terminal on the workspace. Raised by the estate
lead (their ADR-2062); exposed by diagrams **AB-06.7** and **AB-07.9**.

## Decision
Every supervised program that binds a network interface satisfies **one** of:

1. it binds container-loopback and is reached only by a co-resident process — the
   `[program:aoe-serve]` shape (`--allowed-host 127.0.0.1 --host 127.0.0.1`,
   never published, reached through the co-resident NIP-98 proxy); or
2. it authenticates every request, with the credential **minted at boot** into a `0600` file under a
   `0700` directory, honouring an operator-supplied value when one is present.

`--auth none`, an empty auth token, and any equivalent "no credential" default are forbidden on a
program that binds anything other than loopback. A credential is never interpolated into the
generated supervisord text, which is world-readable in the image; the program reads it from the
minted file or from an environment variable exported by PID 1.

Binding `127.0.0.1` is **not** a substitute for authentication on a published surface: Docker
forwards a publish to the container's bridge IP, not to container-loopback, so a loopback bind would
break the operator's tunnel path rather than secure it. Where a surface must stay reachable through
its publish, option 2 is the only compliant answer.

The credential-minting pattern is the one already established for AoE at
`config/entrypoint-unified.sh:560-577`.

## Consequences
- code-server moves to `--auth password` and JupyterLab to a minted token. Operators who reach these
  surfaces through the SSH tunnel now need a credential; where to read it is printed once at boot,
  and the credential itself is never logged.
- The minting is idempotent across restarts and never overwrites an operator-supplied value, so a
  pinned `CODE_SERVER_PASSWORD` / `JUPYTER_TOKEN` keeps working.
- This is a behaviour change for anyone currently opening the IDE with no prompt. It is deliberate:
  an unauthenticated editor-plus-terminal reachable by every sibling container is not a posture the
  estate's fail-closed default permits.
- Follow-on, deliberately **not** taken here: extending the CI gate to read supervisor commands for
  `--bind-addr` / `--host` / `--listen` alongside compose `ports:`, so a future `0.0.0.0` bind is
  caught mechanically rather than by review. Recorded as the open half below; it needs its own ADR
  because it changes what `scripts/ci/check-ports-loopback.mjs` is *for* (a publish gate becoming a
  listener gate), and the estate lead owns the workflow that invokes it.
- ADR-2013 is unaffected and remains correct within its own plane. Its closeout
  (`ADR-2013:160-165`) already records that the structural-bypass half is closed and the deployment
  half is open; this ADR is the listener plane, which is a third thing neither covers.

## Consequences — status
`implementation_status: partial` / `activation_status: staged` is honest: the two listener fixes land
in this change, the CI listener gate does not. It moves to `complete`/`live` when a gate enforces the
invariant mechanically.

## Verification
Verification ran on the **uncommitted working tree** above SHA
`89301ec7c911eab270c00a0cf81596d0d4f15535`; `verified_commit` and `verified_paths` must be re-run and
restored at the landing commit.

- `grep -n 'bind-addr 0.0.0.0\|--ip=0.0.0.0\|--host 0.0.0.0\|listen 0.0.0.0' agentbox/flake.nix`
  → before this change: `:1853` (jupyter-lab) and `:2180` (code-server) only. Re-run after the fix to
  confirm the sweep is clean of unauthenticated binds.
- `grep -n 'aoe serve --auth token' agentbox/flake.nix` → the compliant `[program:aoe-serve]` shape.
  Programs are cited by block NAME, not line number, per ADR-2039: the two lines this ADR first cited
  (`:2180`, `:1853`) had already shifted to `:2199` and `:1865` by the time the fix landed.
- `grep -n 'code_server = true' agentbox/agentbox.toml` and `grep -n '^jupyter = ' …` → both `true`.
  Cited by key rather than line: `code_server` shifted `:1309`→`:1316` during this very phase when an
  unrelated key was added above it, which is ADR-2039's point demonstrated on my own record.
- `awk 'NR>=160&&NR<=162' agentbox/docker-compose.yml` and `awk 'NR>=180&&NR<=183'
  agentbox/docker-compose.override.yml` → the `visionclaw` join resolving to external
  `visionclaw_network`.
- Post-change: `bash -n agentbox/config/entrypoint-unified.sh`; a grep proving no credential appears
  in the generated supervisor text; `node scripts/agentbox-config-validate.js` exit 0. Results
  recorded in the Phase 2 report.
