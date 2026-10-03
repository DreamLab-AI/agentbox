---
id: ADR-2118
title: Own the instruction tiers and the Claude home in the repo
date: 2026-09-29
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 3b54129631067277f6363309b01cce485faa027a
verified_paths: [config/instructions, services/agentbox-manifest/src/instructions.rs, services/agentbox-manifest/src/cred_sync.rs, config/entrypoint-unified.sh, agentbox.sh, flake.nix, docker-compose.yml, docker-compose.override.yml, docker-compose.hp.yml, tests/config/claude-home-migration.test.sh, tests/config/compose-persistence.test.cjs]
owner: jjohare
review_trigger: the connected node runs migrate-claude-home; or Claude Code starts reading AGENTS.md natively (drop the @AGENTS.md wrappers and the embed); or a Claude Code release changes where credentials live
repo: agentbox
domain: BASELINE-container
---

# ADR-2118 — Own the instruction tiers and the Claude home in the repo

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `config/entrypoint-unified.sh` changes only inside the compaction section (install/uninstall factrail, store migration, key projection); `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Re-verification — 2026-10-01 (dependency refresh)

Compose persistence tests still cover 15 declared identities, external Claude home, read-only instructions and PID parity. Instruction layers pass 9/9, projection contract 13/13 and pre-deploy live drift check is clean. The new cargo quarantine does not change credential/instruction volume ownership or migrate another node.
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Re-verification — 2026-09-29 (instruction-home migration)

Host migration completed after adding explicit failure propagation and restrictive backup permissions. The generated Compose merge passes Docker validation after repairing generator drift. All 149 manifest tests and clippy pass; layer privacy 9/9, boot projection 13/13 and agent reconciliation 45/45 pass. Credential I/O failures retry on each poll, and --once reports write errors. Backups preserve the previous instruction files; host CLAUDE.md is byte-identical after migration. Rebuilt-image activation is still pending. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

## Context

## Re-verification — 2026-09-30 (interim sidechain supervision)

The Nix additions leave credential sync, instruction projection and volume declarations unchanged. Generated Compose is byte-identical; persistence tests pass, instruction-layer tests pass 9/9 and boot-projection tests pass 13/13. No repeat migration or connected-node rollout is performed.
Source anchor: `d0fa1b80b`. Existing status axes and deferred work are unchanged;
this scoped source/test receipt does not assert a new running-image activation.

### Original context
ADR-2111 made `AGENTS.md` the one canonical file per tier and built the projection, but two tiers had no versioned source. `~/.claude/CLAUDE.md` (global) lived on a whole-directory `rw` bind of the host's `~/.claude`, and `~/workspace/AGENTS.md` and `~/workspace/CLAUDE.md` lived on the legacy MAD volume. All three were hand-edited, had no history and mixed product rules with estate specifics (LAN addresses, private repository names, relay URLs). The repository is public. The same bind carried four jobs: auth, state, config and instructions. That forced the `HOST_CLAUDE_PATH` mirror mount (plugin JSON stores host paths) and left the Q20 surface fully open. A separate `~/.claude.json` bind was dead: `CLAUDE_CONFIG_DIR=~/.claude` puts the live file inside `~/.claude`. A stale, gitignored `workspace/AGENTS.md` in the checkout looked like the source. Probed on Claude Code 2.1.280, a directory holding only `AGENTS.md` loads nothing, so the `@AGENTS.md` wrappers remain necessary.

## Decision
- **Instruction tiers are repo-owned and repo-authoritative.** `config/instructions/{global,workspace,workspace.claude}.md` hold the tracked, public, tool-neutral layer. `config/instructions/local/` holds the operator/estate layer and is gitignored. The directory is bind-mounted read-only at `/etc/agentbox/instructions` and never baked into the image. At every boot `agentbox-manifest instructions-project` composes the tracked and local layers into `~/.claude/CLAUDE.md`, `~/workspace/AGENTS.md` and `~/workspace/CLAUDE.md` (the workspace tier is embedded at its `@AGENTS.md` line), overwriting live edits. `--check` exits 1 on drift. Codex gets the global and workspace tiers appended whole to `~/.codex/AGENTS.md`; the global layer is tool-neutral for that reason.
- **`~/.claude` is container-owned.** It is the external named volume `agentbox-claude-home`, seeded once by `./agentbox.sh migrate-claude-home`. The seed never modifies the host directory, leaves out `CLAUDE.md`, `.credentials.json` and debris (the debris is tarred as a record), and rewrites host paths in the plugin registry. The `~/.claude.json` bind and the `HOST_CLAUDE_PATH` mirror are removed.
- **Only credentials cross the boundary.** The host's `~/.claude` is bound at `/var/lib/agentbox/host-claude`, and `[program:claude-cred-sync]` (`agentbox-manifest cred-sync`, gated on `toolchains.claude_code`) polls both `.credentials.json` files and merges them recursively. A token record (an object with `expiresAt`) is kept whole from the side with the later expiry; other objects merge key by key, so a Claude refresh on one side and an MCP login on the other both survive. Writes are atomic, mode 0600. The sync is correct whether Claude Code writes in place or by rename, so it doesn't rely on the undocumented write strategy of a closed binary. A symlink was rejected for that reason.
- **The host keeps its own global tier.** The projector writes `~/.claude/CLAUDE.md` only when the credential bind exists, which is the sign that `~/.claude` is the volume. A deployment still binding the host's whole `~/.claude` runs with `--no-global`.

## Consequences
- Every instruction edit has history and review. Private facts stay local, and `tests/config/instructions-layers.test.sh` rejects estate specifics in a tracked layer. The gitignored layer has no history of its own: back it up with the operator's private material.
- Editing a generated file is futile by design. The header on each output names the layer to edit.
- The container no longer reads settings, hooks, agents or plugins from the host. Host-side and in-container Claude Code diverge in everything except credentials.
- Q20 is narrowed, not closed: the credential bind is still a writable host directory. The next step, if wanted, is a dedicated host credential directory.
- `agentbox-manifest agents-md-embed` is retired. `instructions-project` owns the embed, and `agents_md::embed` remains as its helper.
- Follow-up: the connected node (`docker-compose.hp.yml`) migrates when its operator runs `migrate-claude-home` there. Still deferred: `~/.config/claude` ownership, the Q43 workspace migration, and giving stack profiles the global tier and credentials. All are recorded in BASELINE-container's open items.

## Verification
- `cargo test` in `services/agentbox-manifest`: composition, idempotence, live-edit overwrite, `--check` drift, the no-layers no-op, the `--no-global` skip and the embed; cred-sync covering later-expiry-wins, MCP entries from both sides surviving, propagation after a temp+rename refresh with mode 0600, seeding a missing side and waiting out a torn write. `cargo clippy --all-targets` has no warnings.
- The live loop was exercised with fake credentials: a rename-style rotation reached the other side within one 1 s tick. No real token was refreshed.
- A dry projection into scratch paths diffed against the live files: every difference is an intended edit (headers, estate facts moved to `local/`, dated lines removed). `--check` is clean afterwards.
- `bash tests/config/instructions-layers.test.sh` gives 9/9, and a negative control finds 7 estate hits in the `local/` files. `bash tests/config/boot-projection-contract.test.sh` gives 13/13. `bash -n` passes on the entrypoint and `agentbox.sh`.
- Gateway activation verified on 2026-09-29; implementation remains `partial` because the connected node and the other explicitly deferred migrations are unchanged. The gateway's regenerated Compose was validated with Docker and deployed on the new layout.

## Gateway deployment receipt — 2026-09-29

- Deployed image: `sha256:5b0d0ebf8e395aa467caced189008c160d9face4304a83524201b6a638122407`, built from the source verification anchor above. The embedded and deployed Compose files are byte-identical.
- Migration copied about 2.8 GB into `agentbox-claude-home`; previous global/workspace instructions and the private layers were backed up privately. The host global instruction file remained byte-identical before migration and after both boots. No host state was deleted.
- Host checks found and repaired generated-Compose drift (network indentation, omitted volume declarations, environment fallbacks and PID parity). A subsequent startup exposed double-prefixing of the secrets/events volume names; the container was stopped, original volume identities restored, and a regression gate added before the final image rebuild. The two mistakenly created volumes were left unused and intact, not substituted for the original data.
- All 17 live named-volume mappings match the resolved Compose model. The Claude home is the new volume, instruction layers are a read-only bind, and the old whole-home mirror and top-level `.claude.json` binds are absent. Instruction layers are absent from the baked config tree.
- `instructions-project --check` passes as devuser. Codex's generated instructions include both complete composed tiers. Credential copies compare equal without printing them, the container credential file is mode 0600, and `claude-cred-sync` is supervised and running. A synthetic live-loop test covers in-place writes, rename rotation, both directions and preservation of independent MCP logins; no real token refresh was forced.
- Readiness reports all five adapters healthy with zero degraded components. RuVector smoke tests and the voice console/backend/ASR/TTS health checks pass.
- Sync remains eventual, not a lock shared with Claude Code: concurrent refreshes are not serialized, and a one-sided logout is reseeded. Stop sync and clear both sides for intentional shared logout. This deployment does not certify overlapping real OAuth refreshes.
- Email, the connected node, `~/.config/claude`, Q43 and stack-profile migration were not changed. The wider prompt-audit report is not part of this deployment receipt.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `config/entrypoint-unified.sh` changes only in Phase 3: an `AGENTBOX_IDENTITY_ROOT` default export before `nostr-pod-bridge bootstrap`, and a chown to devuser plus chmod 0600 of the bootstrap identity file after it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff c7b5d5f55..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. No instruction-tier projection or Claude home handling changed. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.roles.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). `docker-compose.yml` gains the `/run/secrets` tmpfs line, and `docker-compose.override.yml` changed only in W0's Docker socket comments. The instruction mounts, `instructions-project` and `cred-sync` are untouched. One risk is carried from the custody design (R4): with devuser out of group root, anything that relied on group-0 read bits now fails. Whether any mounted instruction file depends on group 0 is unverified until the rebuild. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/entrypoint-unified.sh` gains the W2 role-env block (`_AB_ROLE_ENV_VARS`, `_ab_role_env_capture` before the identity bootstrap, `_ab_role_env_scrub` on the line before `exec supervisord`, `_ab_role_key_file_own` in Phase 5c). Every function returns at its first line unless `[security].role_isolation` is on, so the flag-off boot is unchanged (RC-X1-06 compares the environment handed to supervisord byte for byte). `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `agentbox.sh` gains W9's `browsercontainer_fetch_podkey` before sidecar builds and a `browsercontainer podkey` subcommand (`7c10e502b`); nothing outside the browsercontainer verbs changes. `config/entrypoint-unified.sh` changed in a comment and a log line (the config's new name, `760ed01e4`). W2's role-env capture now runs `mkdir -p` on the secrets root and `mkdir -m 0700` on the role dir (`3b5412963`). That fixes shellcheck SC2174 and behaves the same. Both changes are reached only with the flag on. `flake.nix` gains three things: W5's read-only bake of the sidestr upstream (`lib/sidestr-upstream.nix`, linked at `/opt/agentbox/sidestr/upstream` under `[sidechain].enabled`; `e103f81a7`); the isolated supervisor config renamed `/etc/supervisord.roles.conf` (`760ed01e4`); and a `[program:serve-identity]` block that prints one line and exits 0 while `[security].role_isolation` is off (`b49c62249`).
The instruction tiers and the Claude home are untouched. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.
