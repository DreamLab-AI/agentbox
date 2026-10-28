---
id: ADR-2147
title: Retain Codex session state in a named volume
date: 2026-10-21
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 21769a881315a246afaa6e9d0b39daf4ec39b5bc
verified_paths: [flake.nix, docker-compose.yml, docker-compose.override.yml, scripts/migrate-codex-home.sh, tests/config/compose-persistence.test.cjs]
owner: jjohare
review_trigger: changes to Codex home mounts, session retention, or the migration procedure
repo: agentbox
---

# ADR-2147: Retain Codex session state in a named volume

Date: 2026-10-21. Status: accepted.

Codex's home was a 512 MiB tmpfs. Only `packages/` and the host credential
file were independently mounted. Transcripts and session databases vanished
on container replacement. Inspection confirmed tmpfs at `~/.codex`, whereas
Claude's main home was already the disk-backed `agentbox-claude-home` volume.
Routed Claude profiles live under the persisted workspace.

Replace the Codex home tmpfs with `agentbox-codex-home`, declared in the Nix
Compose generator. Retain the existing package volume and credential bind.
Persist the entire home so SQLite indexes, WALs, archived sessions and new
session metadata follow transcripts. Existing boot reconciliation owns the
volume root as UID/GID 1000. No retention expiry or automated deletion applies.

## Existing-container migration

Run these steps on the Docker host. Exit all Codex clients and its daemon
before capture, but leave the Agentbox container running: stopping it destroys
tmpfs contents. The migration refuses to overwrite an existing target volume.

```sh
bash scripts/migrate-codex-home.sh "$HOME/codex-home-before-volume.tar"
bash scripts/refresh-compose.sh
# After preparing the new image, perform the reviewed mount migration:
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps --force-recreate agentbox
```

The archive excludes the separately mounted credentials and packages, and
retains SQLite databases and WALs together. Do not resume clients between
capture and recreation. Keep the archive until resume/history are verified.
Fast activation deliberately rejects changed persistent mounts; use the explicit
Compose migration above, then prepare again for subsequent fast activations.
Never use `down -v`. New installations need no migration.

The configuration gate checks resolved named-volume identities, absence of
home tmpfs mounts and the separate credential bind. Nix regeneration must run
on the host; Nix was unavailable in the implementation container.

## Re-verification — 2026-10-21 at 395380f71

Reviewed the committed remote-media change against this record. Nix changes
only the ComfyUI MCP dependency closure and its existing builtin/external gates;
`skills/mcp.json` changes only Blender's declared protocol. Blender's optional
local binary, proxy and background-job safety boundaries remain intact. No
identity, ingress, daemon role, instruction projection, persistent mount, scanner
or vendor-routing behavior changes. Media checks pass: 23 Node tests, 12 graph
client tests and 9 downloader tests. Runtime/Compose checks pass (27 tests),
role-supervisor checks pass (25), skills lint and loopback-port checks pass.
Sidecar image activation is tracked separately in the host deployment receipt.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch Codex state. Re-read at HEAD: `codex-home:/home/devuser/.codex` (flake.nix:3893) and `codex-packages` (flake.nix:3895), no `.codex` tmpfs entry, `CODEX_HOME` (flake.nix:4476). `node tests/config/compose-persistence.test.cjs` passes (17 volume identities, no home tmpfs) in a detached worktree at HEAD. The migration script was read, not run.
