---
id: ADR-2147
title: Retain Codex session state in a named volume
date: 2026-10-21
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: f9eb13b85ab4167612e847136a83048f0e92885d
verified_paths: []
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
