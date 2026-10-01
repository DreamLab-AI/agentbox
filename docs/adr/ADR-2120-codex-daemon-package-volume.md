---
id: ADR-2120
title: Give Codex daemon packages executable persistent storage
date: 2026-10-01
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 0a63db7c49faf1c97bc2f4839f25027c2fec35c2
verified_paths: [agentbox.sh, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, scripts/refresh-compose.sh, tests/config/compose-persistence.test.cjs, tests/config/refresh-compose.test.cjs]
owner: jjohare
review_trigger: commit verification and rebuild; or change Codex daemon packaging
repo: agentbox
domain: BASELINE-container
---

# ADR-2120 — Give Codex daemon packages executable persistent storage

## Context

Codex 0.158.0 stages daemon packages in `CODEX_HOME/packages`. Agentbox mounts
CODEX_HOME on a 512 MiB noexec tmpfs. A local execution probe failed with EACCES,
and Codex doctor reported insufficient package storage. `--no-daemon` bypassed
this path; `--yolo` remains a separate approval/sandbox option.

## Decision

Mount a disk-backed named volume, `agentbox-codex-packages`, at
`/home/devuser/.codex/packages`. Initialise its root ownership to UID/GID 1000
at boot. Retain the parent's bounded noexec configuration tmpfs.

Refresh generated Compose through `scripts/refresh-compose.sh` before local
builds, including `up --build` and the rebuild flow. Validate the generated file
before atomically replacing the existing configuration. Failed generation or
validation preserves the existing file. This closes the deployment gap where
an image rebuild retained stale mounts.

## Verification and activation

Nix generated Compose successfully in a disposable builder using a copied
source snapshot. Four tests passed: resolved persistent mount identities,
successful refresh, failed Nix generation and failed Compose validation.
Shell syntax and diff whitespace checks pass. A disposable Docker test
confirmed that the parent blocks execution while the nested package volume
allows execution and accepts UID 1000 ownership.

Image `sha256:399888769570` is live. The resolved Compose model and live mounts
agree on `agentbox-codex-packages`; all 18 named-volume identities match and the
original workspace volume is retained. A real `codex app-server daemon start`
installed the 0.158.0 managed binary into the new volume, reported the daemon
running, and stopped cleanly. The stored package occupies 351 MiB and survives
the bounded parent tmpfs.

`codex doctor` still judges free space from the parent `CODEX_HOME` mount and
therefore reports its 512 MiB limit even though the executable package subtree
is a separate 59 GiB disk-backed mount. The real install/start test proves the
original EACCES/storage failure is closed; the remaining doctor result is an
upstream nested-mount accounting limitation, not a runtime failure.

ADR index regeneration remains blocked by seven existing stale verification
anchors in other records; those anchors were not rewritten.
