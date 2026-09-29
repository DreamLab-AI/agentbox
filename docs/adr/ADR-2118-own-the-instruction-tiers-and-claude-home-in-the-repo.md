---
id: ADR-2118
title: Own the instruction tiers and the Claude home in the repo
date: 2026-09-29
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 526b97dc6752ceaa9889ed3cd199b5145b7cf94c
verified_paths: [config/instructions, services/agentbox-manifest/src/instructions.rs, services/agentbox-manifest/src/cred_sync.rs, docker-compose.override.yml, docker-compose.hp.yml]
owner: jjohare
review_trigger: the connected node runs migrate-claude-home; or Claude Code starts reading AGENTS.md natively (drop the @AGENTS.md wrappers and the embed); or a Claude Code release changes where credentials live
repo: agentbox
domain: BASELINE-container
---

# ADR-2118 — Own the instruction tiers and the Claude home in the repo

## Re-verification — 2026-09-29 (instruction-home migration)

Host migration completed after adding explicit failure propagation and restrictive backup permissions. The generated Compose merge passes Docker validation after repairing generator drift. All 149 manifest tests and clippy pass; layer privacy 9/9, boot projection 13/13 and agent reconciliation 45/45 pass. Credential I/O failures retry on each poll, and --once reports write errors. Backups preserve the previous instruction files; host CLAUDE.md is byte-identical after migration. Rebuilt-image activation is still pending. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

## Context
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
- Not yet verified, which is why the status is `partial`/`staged`: `migrate-claude-home` against the real host (it needs host Docker), the regenerated compose from `nix build .#compose` (no Nix in the container; `docker-compose.yml` was edited to match the flake line by hand), and a boot on the new layout.
