---
id: ADR-2120
title: Give Codex daemon packages executable persistent storage
date: 2026-10-01
decision_status: proposed
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
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

The running agentbox has not been rebuilt or restarted. Full Codex daemon
startup must be checked after deployment. The decision is recorded as proposed
pending the ledger's required committed verification anchor; implementation is
staged in the working tree.

ADR index regeneration remains blocked by seven existing stale verification
anchors in other records; those anchors were not rewritten.
