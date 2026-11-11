---
id: ADR-2147
title: Retain Codex session state in a named volume
date: 2026-10-21
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 924f4282ae18428f044bfd468bb8a4cd66a6106e
verified_paths: [flake.nix, docker-compose.yml, docker-compose.override.yml, scripts/migrate-codex-home.sh, tests/config/compose-persistence.test.cjs]
owner: jjohare
review_trigger: changes to Codex home mounts, session retention, or the migration procedure
repo: agentbox
---

# ADR-2147: Retain Codex session state in a named volume

## Scoped source check — 2026-11-09

Shared composition changes add gated StatCraft (rebuild-class catalogue),
update pinned VisionCraft/dependency packages, and replace the bounded .local
tmpfs with a named volume. Nested OpenCode/code-server volumes retain their
identities. Codex remote startup stays manual; the removed feature flag is
not written. This does not widen listeners, authority or retrieval geometry.
The local-home migration fixture, 26 persistence/delivery tests, 25 supervisor
checks, 13 boot checks, manifest validation and port/listener gates pass.
See [local storage migration](../developer/local-home-storage.md). Runtime
acceptance remains separate; existing status axes and open limitations remain.

## Scoped source check — 2026-11-05

The only new shared-flake delta since the previous verification pins OpenSSH
10.6p2 and its upstream SHA-256 together, without changing listeners, mounts,
role mappings or this record's own feature gate. Upstream's 2026-11-05 release
adds the Linux musl/PAM-disabled password-auth workaround. This is a custom
package override: image VEX must not claim a stock nixpkgs OpenSSH build.
Runtime acceptance and all existing status limitations remain separate.

## Scoped source re-verification — 2026-11-03

Shared-file changes add pinned VisionCraft and direct AQE registration, retire
the unused precedent-bridge default, and extend governance custody/config
scrubbing. This record's own mechanism is retained; existing partial/staged
limitations and historical receipts are not promoted to new runtime acceptance.

Evidence: [rebuild verification receipt](../estate-closeout/adr-reverification-2026-11-03.md).
This verifies the scoped source amendment, not new whole-record runtime
acceptance. Decision, implementation and activation statuses are unchanged.

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

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `753788564` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `docker-compose.override.yml`: drops the injected `RUVECTOR_PG_CONNINFO`; `RUVECTOR_PG_PASSWORD` becomes required (`:?`, no default).
- `flake.nix`: removes the claude-flow config template (`claudeFlowConfigJson` and its `cp`) and the baked `RUVECTOR_PG_CONNINFO` image Env entry, and rewords one dream-engine supervisor comment.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 753788564..cc949bb79 -- docker-compose.override.yml flake.nix`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `e2b49adfc`: `flake.nix` gains `bendLib` and `bendPackages`, one `++ bendPackages` in `allPackages` and one in the `toolchains` layer group, and `ENABLE_BEND` in the image environment. Every hunk is an addition apart from one re-wrapped line in the `toolchains` layer group. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff e2b49adfc..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `flake.nix` gains `supervisordLauncher`, listed ahead of `pythonRuntimeEnv` in `pythonBasePackages` (ADR-2193: PID 1 is started by the runtime env's interpreter; the entrypoint's `exec supervisord` line is unchanged), `motionRenderPkg` in `skillToolPackages` (ADR-2194), and the CAD gate (ADR-2195): `cadLib`, `cadEnabled`, two gated additions to `spatialPackages`, a gated `[program:cad-engine]` block bound to `127.0.0.1:3245`, gated `/usr/share/fonts` links and `ENABLE_CAD` in the image environment. The changes add a routing scope setting, a launcher for PID 1, one Rust skill tool and a gated-off CAD feature. They add no published port, mount, volume, secret, identity, model route, vault path, registry entry or Nostr kind, and alter no existing gate, so what this record decides is not touched. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `924f4282a` (ADR-2196). Governed-path delta since `237178730`: `flake.nix` adds `semgrep`, `gitleaks`, `trivy` and `jujutsu` to the ungated `basePackages`; removes `codexMcpPkg`, its `npmServicePackages` entry and its copy into the openai-codex skill folder (the codex CLI, `toolchains.codex` and the codex-plugin-cc payload are unchanged); and gives `[program:podcast-cron]`'s `environment=` PATH util-linux and `vaultPackages` via `lib.makeBinPath`. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (124), skill-count, routing-table, the manifest validator, router and configuration jest, the corpus test (its baked-versus-repo comparison fails in-container until the next rebuild), and the agentbox-manifest and podcast-ingest cargo tests. The Nix changes are not evaluated or built. The decision and status axes are unchanged.
