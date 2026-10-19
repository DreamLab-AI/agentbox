---
id: ADR-2120
title: Give Codex daemon packages executable persistent storage
date: 2026-10-01
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 3acd4fa08f06e2c4543debd46f0ce51605033d3e
verified_paths: [agentbox.sh, config/entrypoint-unified.sh, flake.nix, docker-compose.yml, scripts/refresh-compose.sh, tests/config/compose-persistence.test.cjs, tests/config/refresh-compose.test.cjs]
owner: jjohare
review_trigger: commit verification and rebuild; or change Codex daemon packaging
repo: agentbox
domain: BASELINE-container
---

# ADR-2120 — Give Codex daemon packages executable persistent storage

## Re-verification — 2026-10-15

The only changed hunk in the governed agentbox.sh adds `security` to the subcommand allowlist (ER-14); its existing scanner dispatch is unchanged. CLI regression checks pass, and all 23 runtime-delivery tests pass. Instruction projection, executable volumes, image evidence and vendor routing are unchanged.
Source anchor: `df584b3fd`. Existing status axes and deferred work remain unchanged.


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

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.roles.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). `docker-compose.yml` gains one tmpfs line. The Codex package volume and its exec mount are untouched. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/entrypoint-unified.sh` gains the W2 role-env block (`_AB_ROLE_ENV_VARS`, `_ab_role_env_capture` before the identity bootstrap, `_ab_role_env_scrub` on the line before `exec supervisord`, `_ab_role_key_file_own` in Phase 5c). Every function returns at its first line unless `[security].role_isolation` is on, so the flag-off boot is unchanged (RC-X1-06 compares the environment handed to supervisord byte for byte). `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `agentbox.sh` gains W9's `browsercontainer_fetch_podkey` before sidecar builds and a `browsercontainer podkey` subcommand (`7c10e502b`); nothing outside the browsercontainer verbs changes. `config/entrypoint-unified.sh` changed in a comment and a log line (the config's new name, `760ed01e4`). W2's role-env capture now runs `mkdir -p` on the secrets root and `mkdir -m 0700` on the role dir (`3b5412963`). That fixes shellcheck SC2174 and behaves the same. Both changes are reached only with the flag on. `flake.nix` gains three things: W5's read-only bake of the sidestr upstream (`lib/sidestr-upstream.nix`, linked at `/opt/agentbox/sidestr/upstream` under `[sidechain].enabled`; `e103f81a7`); the isolated supervisor config renamed `/etc/supervisord.roles.conf` (`760ed01e4`); and a `[program:serve-identity]` block that prints one line and exits 0 while `[security].role_isolation` is off (`b49c62249`).
The Codex package volume is untouched. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`32cedf9925ff6de8112fb45e41de048106d0d710`, custody integration CI fix)

Tripped by `32cedf992`, the fix for the PR's clippy and statix failures. `flake.nix` changes by one line in the `[sidechain.*]` normaliser: `parent = c.parent;` becomes `inherit (c) parent;` (statix W04), which evaluates to the same attribute set. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..32cedf992 -- <verified_paths>`.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `config/entrypoint-unified.sh` (`dc91e092a`) gains `_ab_devuser_privilege_check` and its call after the docker-socket check; it reads files only and is a no-op with `[security].role_isolation` off; `flake.nix` (`dc91e092a`) gains one let-binding, `roleIsolationBaked = securityCfg.role_isolation or false`, and its inline `/etc/sudoers` lines become a call to `config/bake-devuser-privilege.sh` with that flag; with the flag off (the shipped value) the baked `/etc/group`, `/etc/sudoers` and `/etc/sudoers.d/devuser` are byte-identical (RC-X1-07). Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 32cedf992..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `config/entrypoint-unified.sh` changes only in three custody blocks (ADR-2122, design 3.2). (1) A new at-rest step before Phase 3: `ab_custody_migrate` when `[security].role_isolation` is on, otherwise `ab_custody_revert`, which changes nothing on a volume that was never migrated (`tests/config/role-custody-migrate.test.sh` shows the stat set, ctime included, byte-identical). (2) Under the flag only, the volume-root chown loop skips `/var/lib/agentbox/secrets`. (3) After the identity bootstrap, the identity file goes to ab-identity 0400 under the flag; with the flag off, the devuser 0600 statements are unchanged. The Codex package volume and its exec mount are untouched. The decision holds. Re-verified by `git log dc91e092a..f93586b9e -- <verified_paths>`.

### Re-verification — 2026-10-03 (vaultSrc repin)

`f93586b9e..33cbb29e8` changes one governed line: `flake.nix` `vaultSrc` moves from VisionClaw `64512141b` to main `94dc0ff60` (`33cbb29e8`, PR #13; ADR-2108 records why). Its one consumer is `lib/vault.nix` (the vault CLI package, `flake.nix:781`); nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) reads it. The decision holds. Re-verified by `git log f93586b9e..33cbb29e8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (poker house seat, PR #14)

`33cbb29e8..b41d9486c`: `flake.nix` bakes `nostr-bbs-poker-citizen` (`lib/poker-citizen.nix`) and a `[program:poker-citizen]` (`user=devuser`) only when `[sidechain].enabled` and `[poker_citizen].enabled`; it opens no listener: it dials the forum relay over `wss` and the local producer at `127.0.0.1:3450` (`55b9fe9f6`). Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) reads the new table or program. The decision holds. Re-verified by `git log 33cbb29e8..b41d9486c -- <verified_paths>`.

### Re-verification — 2026-10-03 (key-variable rule)

`b41d9486c..e3b06d688` changes one governed line: `flake.nix` passes `--env-classes ${./config/custody/env-classes.json}` to the build-time `role-accounts isolate`, which now refuses a devuser program holding a key variable without a role (ADR-2122). Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) changes. The decision holds. Re-verified by `git log b41d9486c..e3b06d688 -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo 3.51.1, Claude Code 2.1.288)

`e3b06d688..daba195e5`: `flake.nix` changes only the `rufloPkg` pin: version 3.51.1, its lock (`config/npm-locks/ruflo-3.51.1.package-lock.json`) and both hashes (`daba195e5`), with the rationale comment. The ruflo closure's bins and extraBins aliases, every gate and every other derivation are unchanged. Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) changes meaning. The decision holds. Re-verified by `git log e3b06d688..daba195e5 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (ruflo-console gate, `451823ca8`)

`daba195e5..451823ca8`: `config/entrypoint-unified.sh` adds the ruflo-console boot block after factrail's, and factrail's function-hook switch and `agentbox` marketplace removal also respect the new gate; with it off both behave as before; `flake.nix` adds the pinned `rufloConsole` input (ruflo v3.51.1, files-only), the `rufloConsolePlugins` bake (only the three mod directories) and its copy into the `agentbox` marketplace under `[toolchains].ruflo_console`, and lets that gate pull in the ruflo closure. Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) changes meaning. The decision holds. Re-verified by `git log daba195e5..451823ca8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (agentic-qe 3.14.7)

`451823ca8..d52d3eeb4`: `flake.nix` changes only the `agenticQePkg` pin: version 3.14.7, its lock and both hashes (`d52d3eeb4`), with the rationale comment. Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) changes meaning. The decision holds. Re-verified by `git log 451823ca8..d52d3eeb4 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (wrangler 4.147.0)

`d52d3eeb4..341c8bd36`: `flake.nix` changes only the `wranglerPkg` pin: version 4.147.0, its lock and both hashes (`341c8bd36`), with the rationale comment. Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) changes meaning. The decision holds. Re-verified by `git log d52d3eeb4..341c8bd36 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (mermaid-cli hold note)

`341c8bd36..cff75f7ea`: `flake.nix` changes only the comment above `mermaidCliPkg` (12.0.0 held, re-evaluation recorded); no pin, hash or gate changes (`cff75f7ea`). Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) changes meaning. The decision holds. Re-verified by `git log 341c8bd36..cff75f7ea -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (web-researcher hold note)

`cff75f7ea..09e6271e9`: `flake.nix` changes only a comment in `webResearcherMcpPkg` (v1.49.4 held: needs Go 1.27.1, beyond the pinned nixpkgs); no pin, hash or gate changes (`09e6271e9`). Nothing this record governs (ADR-2120 — Give Codex daemon packages executable persistent storage) changes meaning. The decision holds. Re-verified by `git log cff75f7ea..09e6271e9 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (ruflo memory governed, 1fc26c786)

`09e6271e9..1fc26c786`: `config/entrypoint-unified.sh` changes in one place (`012bf98f5`): three exports in the runtime-env block after `RUFLO_DAEMON_AI_WORKERS` — `RUFLO_DAEMON_AUTOSTART` (default `0`), `CLAUDE_FLOW_DISABLE_BRIDGE` (default `1`) and `CLAUDE_FLOW_MEMORY_PATH` (default `/home/devuser/.cache/ruflo/memory`), each `${X:-default}` so an operator export wins (ADR-2123). `flake.nix`: `34f322740` projects `[sidechain].faucet_units`/`faucet_sats` into `[program:sidestr-faucet]`'s environment; `aeca58df6` passes `SIDESTR_PEG_SCRIPT` to the per-chain producer; `bde96a334` adds the `pokerCitizenSeats` map and bakes `[program:poker-citizen-<name>]` per `[poker_citizen.<name>]` (the package gate now counts a seat); `18a85577c` bakes `[program:poker-coach]` under `[poker_coach]`; `b83e0e5d7` adds `findutils` to both producer PATHs; `012bf98f5` adds `rufloGovernedPkg` — `ruflo`/`claude-flow` wrappers that exec `mcp/servers/ruflo-memory-cli.cjs` for `memory` and otherwise run `rufloPkg` with `RUFLO_DAEMON_AUTOSTART=0`, `CLAUDE_FLOW_DISABLE_BRIDGE=1` and `CLAUDE_FLOW_MEMORY_PATH` under `~/.cache` as overridable defaults, `claude-flow-mcp` symlinked through unchanged — and swaps it for `rufloPkg` in the gated package list (ADR-2123). `agentbox.sh`, `docker-compose.yml`, `scripts/refresh-compose.sh` and the two compose tests did not move. Nothing this record decides (ADR-2120 — Give Codex daemon packages executable persistent storage) changed: no volume, mount option or Codex path changes. The decision holds. Re-verified by `git diff 09e6271e9..1fc26c786 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (runtime-env path escape, 34f5e4254)

`1fc26c786..34f5e4254`: `config/entrypoint-unified.sh` changes one line in the runtime-env heredoc — `CLAUDE_FLOW_MEMORY_PATH` is escaped so it resolves in the sourcing shell (`$HOME/.cache/ruflo/memory`) instead of as a root-side `/home/devuser` literal (RC-X1-01, `34f5e4254`). No path, gate, projection or program this record governs changed. Nothing this record decides changed.

## Re-verification — 2026-10-07 at cca7ea3b151be3ea44907581d40271c714b07dd0

Since `34f5e4254`, only `agentbox.sh` and `flake.nix` changed among the governed paths. `docker-compose.yml` (`:147`, `:199-200`), the entrypoint chown (`config/entrypoint-unified.sh:542`), `scripts/refresh-compose.sh` and both tests have no diff. `flake.nix` still declares `codex-packages:/home/devuser/.codex/packages` (`:3695`) and lists it among the baseline volume names (`:3725`). `6d3d21b05` (ADR-2132) replaces `cmd_rebuild`'s down + build + `up --build` with `scripts/runtime-delivery.sh rebuild`. That runs `prepare`, which calls `scripts/refresh-compose.sh` before `nix build` (`runtime-delivery.cjs:159`), then `activate`. `up --build` (`agentbox.sh:757`) and `build` (`:929`) still refresh too, so "including `up --build` and the rebuild flow" remains true. The stale-mount gap stays closed by a stricter mechanism: fast activation now refuses a candidate whose persistent mounts would differ (`runtime-delivery.cjs:243`) rather than recreating the stack. The other `flake.nix` hunks are vaultSrc bumps, ADR-2109 forum-governance env, sealmap, the diagram-review cron, faucet PATH entries and the layer dedup (`7dadf61d7`), none of which touches the volume. The decision holds.

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- Named volume agentbox-codex-packages mounted at /home/devuser/.codex/packages
- Parent /home/devuser/.codex stays a bounded (512M) noexec tmpfs
- Entrypoint initialises the package volume root ownership to UID/GID 1000 at boot
- scripts/refresh-compose.sh runs before local builds: up --build, build, and the rebuild flow
- Compose validated before atomic replace; failure preserves existing file (tests)

Evidence:

- docker-compose.yml:120 '/home/devuser/.codex:mode=755,size=512M,uid=1000,gid=1000'; :147 'codex-packages:/home/devuser/.codex/packages'; :199-200 volume name agentbox-codex-packages
- flake.nix:3704 tmpfs 512M entry; :3818-3819 codex-packages mount with the 'parent .codex tmpfs is noexec' comment
- config/entrypoint-unified.sh:545-546 /home/devuser/.codex and /home/devuser/.codex/packages in the volume-root chown list (chown root only, not -R)
- agentbox.sh:758 (up --build) and :931 (build) call scripts/refresh-compose.sh; scripts/runtime-delivery.cjs:159 calls it in prepare, and agentbox.sh:1079-1080 'rebuild' delegates to runtime-delivery.sh → covers the rebuild flow (unchanged from cca7ea3b1)
- diff hunks: agentbox.sh adds security-scan report calls and help text, systemone help; entrypoint adds ADR-2140/2139/2135 blocks; flake.nix adds security tools/evidence etc → none touches the codex package mount, tmpfs, or refresh-compose
- node --test tests/config/compose-persistence.test.cjs → 1/1; tests/config/refresh-compose.test.cjs → 3/3; docker-compose.yml, scripts/refresh-compose.sh and both tests have no diff since cca7ea3b1

Commands run: `node --test tests/config/compose-persistence.test.cjs tests/config/refresh-compose.test.cjs; git show 218dc12c3:docker-compose.yml|grep codex; git grep refresh-compose 218dc12c3`

Not checked, and notes: Live-state claims (image sha256:399888769570 live, 59 GiB mount, codex doctor accounting) need the running host and were not rechecked.

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. The Codex daemon package volume and its entrypoint wiring are untouched. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff efa293b87..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.
