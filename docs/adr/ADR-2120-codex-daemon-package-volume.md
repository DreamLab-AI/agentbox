---
id: ADR-2120
title: Give Codex daemon packages executable persistent storage
date: 2026-10-01
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 055c06ff69b2f53bf38a67d254c048bb03599fc8
verified_paths: [agentbox.sh, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, scripts/refresh-compose.sh, tests/config/compose-persistence.test.cjs, tests/config/refresh-compose.test.cjs]
owner: jjohare
review_trigger: commit verification and rebuild; or change Codex daemon packaging
repo: agentbox
domain: BASELINE-container
---

# ADR-2120 — Give Codex daemon packages executable persistent storage

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `config/entrypoint-unified.sh` changes only inside the compaction section (install/uninstall factrail, store migration, key projection); `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

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

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `config/entrypoint-unified.sh` changes only in Phase 3: an `AGENTBOX_IDENTITY_ROOT` default export before `nostr-pod-bridge bootstrap`, and a chown to devuser plus chmod 0600 of the bootstrap identity file after it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff c7b5d5f55..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. No volume or Codex package path changed. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.isolated.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). `docker-compose.yml` gains one tmpfs line. The Codex package volume and its exec mount are untouched. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.
