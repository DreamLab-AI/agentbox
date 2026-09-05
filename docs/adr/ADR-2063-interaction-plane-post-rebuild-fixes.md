---
id: ADR-2063
title: The MCP hub waits for its config, AoE session records persist on a volume, and the seeder reaps only its own clean orphans
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 08e817f394a908264c378745193bf7a0bbf6ec0e
verified_paths: []
owner: jjohare
review_trigger: an AoE upgrade that changes the sessions API fields or persists extra_args for native agents, a change to supervisor priorities, or a second worktree-root layout
repo: agentbox
domain: BASELINE-container
---

# ADR-2063 — The MCP hub waits for its config, AoE session records persist on a volume, and the seeder reaps only its own clean orphans

## Context
The 2026-09-05 rebuild exposed four interaction-plane defects at first boot.
`[program:agentbox-mcp-hub]` (priority 205) crashed three times on the missing
`/run/agentbox/mcp-hub.json`, which the bootstrap program (priority 5,
`startsecs=0`) writes minutes later; supervisord parked it FATAL and every
hub-routed MCP server (four consultants, four bridges, perplexity, web-researcher)
refused connections. AoE keeps `profiles/<p>/sessions.json` under `~/.config`,
a tmpfs, so every boot lost the session records while the worktrees they had
created stayed on the persistent mount: 18 `antigravity-N` and 18 `loom-N`
checkouts of ~195 MB each, plus a dead `loom-raw` directory that made the daemon
refuse that seed with "Worktree already exists" on every boot since 2026-08-31.
AoE 1.13 does not persist `extra_args` from `POST /api/sessions` for native
agents, so the seed's `model` never reached `agy` (AB-02.7, AB-12.6).

## Decision
The hub polls for its config file before loading it (`agentbox-mcp hub
--wait-config-secs`, default 600) and the entrypoint restarts or starts the
supervised hub after every projection, so a late or rewritten config is a
bounded wait, never a FATAL program. AoE profile state is a named volume
(`aoe-profiles` → `~/.config/agent-of-empires/profiles`) with devuser ownership
applied at boot, so seeds reconcile against surviving records instead of
re-creating. For native ACP agents (codex, gemini, antigravity) the seed's model
rides the per-agent `agent_command_override` as `--model <model>`. Before
creating sessions the seeder reaps its own orphans under `${PROJECT}-worktrees`:
a directory is a candidate only when its basename is exactly `<slug>` or
`<slug>-<digits>` for a `worktree: true` seed and no session in any state
references its path (`project_path` from the daemon, `path` from the CLI); a
registered worktree is removed only when `git status` is clean (submodule state
ignored) and its branch holds no commit beyond the main branch; a candidate that
is not a registered worktree is renamed aside, never deleted. If any session
that owns a managed worktree exposes no path, the reaper refuses to act.

## Consequences
Hub-routed MCP servers come up on first boot without operator intervention.
Session identities (did:nostr, URN, beads epic, memory namespace) now survive a
container restart, which is the "never killed" semantics the reconciler always
claimed. The worktree root stays bounded at one checkout per seed; a human still
decides about dirty or ahead trees and about directories moved aside. Root-owned
`.git/worktrees/*` metadata from an August root-run submodule init is chowned at
boot so `git worktree prune` can clear the two zombie entries (`codex`, `loom`).
The seed model still does not reach opencode seeds (deepseek, loom, loom-raw);
those select their model through the provisioned OpenCode provider config.

## Verification
Working tree above 08e817f39 on 2026-09-05, in the rebuilt image; re-run at the
landing commit. `cargo test --locked --offline` in services/agentbox-mcp: 73
passed including `hub::wait_tests` (present, late write, timeout); `cargo clippy
--all-targets -D warnings` and `cargo fmt --check` clean. `node --test
tests/cli/aoe-seed-orphans.test.mjs`: 3 passed (fail-closed on a pathless
managed session; keeps live, dirty and ahead trees; reaps the clean orphan and
moves the dead directory aside). `cargo test --test consultant_model` in
services/agentbox-manifest: 3 passed after the entrypoint edit. Live: the
seeder reaped 69 orphaned worktrees and moved `loom-raw` aside; `aoe list --json`
shows `antigravity` running `env AGENTBOX_PROFILE=antigravity agy --model
gemini-3.8-flash`; `loom-raw` was created for the first time since 2026-08-31.
Regression during development: the first reaper read the CLI's `path` field
from daemon objects that carry `project_path`, saw no live sessions and removed
the four live (clean, minutes-old) worktrees; the fail-closed path guard and the
regression test exist because of it. `docker compose config -q` and
`scripts/ci/check-ports-loopback.sh` pass with the new volume. The hub wait and
the volume activate at the next image rebuild (activation_status: staged).
