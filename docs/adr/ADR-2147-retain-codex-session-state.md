---
id: ADR-2147
title: Retain Codex session state in a named volume
date: 2026-10-21
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 75378856483d13f952569018421c4526da0aede2
verified_paths: [flake.nix, docker-compose.yml, docker-compose.override.yml, scripts/migrate-codex-home.sh, tests/config/compose-persistence.test.cjs]
owner: jjohare
review_trigger: changes to Codex home mounts, session retention, or the migration procedure
repo: agentbox
---

# ADR-2147: Retain Codex session state in a named volume

## Scoped re-verification — 2026-10-31

Reviewed the governed-path delta since the previous verification: only the
operator user-cron gate, devuser supervisor block, rebuild-class catalogue entry
and its boolean schema registration changed. Existing capability, identity,
storage and network contracts are unchanged. Preflight, manifest validation,
25 role-isolation supervisor checks and the user-cron schema regression pass.
This does not promote any activation status or claim a live role-isolation rehearsal.

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

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

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2147 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.

## Close-out 2026-10-30 — activation

`activation_status: staged → live`. The Codex home is the named volume on the running container, and session state survived a container replacement.

- Running image: `.agentbox-build/active.json` (host, read via the project bind) records `sourceCommit` `e786197ccb9f56c638d4b0181e77f33ab38b7db9`, `sourceDirty: false`, `delivery: registry`, `activatedAt` 2026-10-30T14:22:59.281Z, `imageId` `sha256:9776d2fc515c…`; `docker inspect agentbox --format '{{.Image}}'` and `$AGENTBOX_IMAGE_HASH` both return `sha256:9776d2fc515c5922cde9f7791248f731416192a6b4a66e8d6d06b15bfd5c892d`. The running container therefore runs main at `e786197cc`.
- `findmnt -no SOURCE,FSTYPE,TARGET /home/devuser/.codex` → `/dev/nvme0n1p1[/docker/volumes/agentbox-codex-home/_data] ext4 /home/devuser/.codex` (no tmpfs); `docker inspect agentbox` mounts list `agentbox-codex-home -> /home/devuser/.codex`, `agentbox-codex-packages -> /home/devuser/.codex/packages` and the `auth.json` bind separately.
- `find ~/.codex/sessions -name '*.jsonl' | wc -l` → 46; `find … ! -newermt '2026-10-30 14:22' | wc -l` → 46 (all predate the 14:22 recreate); the oldest is dated 2026-10-21, the migration day.

Implementation axis and `verified_commit` are unchanged.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `flake.nix`: the ontomark comment now names the verbs it owns (`4a07fbfb3`). No section this record governs changed; the decision holds. Re-verified by `git diff 358e5d32c..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.
