---
id: ADR-2153
title: Replace Agent of Empires with an owned, tmux-backed session plane that reconciles to the manifest
date: 2026-10-28
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: [ADR-2079]
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: the session-plane daemon lands, or any AoE consumer below is found to have been missed
repo: agentbox
---

# ADR-2153 — Replace Agent of Empires with an owned, tmux-backed session plane that reconciles to the manifest

## Context
- Live on 2026-10-28, 5 of 10 AoE sessions are dead and one (`zai`) reports Idle while blocked on a trust prompt. The causes, each reproduced:
  - OpenCode v2.0.32 has no model flag on its TUI (`-m` and `--model` both fail: "Unrecognized flag"), and AoE 1.13 passes one. That kills `deepseek`, `loom` and `loom-raw`.
  - The worktrees under `${PROJECT}-worktrees/` are gone, so `codex`, `antigravity` and the OpenCode sessions have no cwd. The status-hook `ENOENT` in `debug.log` occurs only for those sessions.
  - `trust-seed.cjs` writes only the root `~/.claude.json`. A wrapper profile reads its own `profiles/<slug>/.claude/.claude.json` (its `CLAUDE_CONFIG_DIR`). zai's does not trust `~/workspace/project`. openrouter's does, but only because the prompt was once accepted by hand.
  - `agy` is not signed in.
- The seeder creates sessions and never reconciles them ("already exists — skipping (never killed)"). The records are frozen as of 2026-09-06 (`deepseek` still runs `deepseek-chat`, while the manifest says `deepseek-flash`).
- We run a fork (`DreamLab-AI/agentbox-of-empires@33e806ad`) that is 1 commit ahead and 970 behind upstream. v1.16 adds a one-way data migration.
- What we actually consume from AoE: create/list/send (seeder, tab0-bridge, nostr-gateway `/spawn`), the status hook into `/v1/sessions/boundary` (ADR-043 identity), `aoe session show` (`tmux-autostart.sh`), the TUI picker (tab 8), and the web board behind `:9096` and the `:8444` cockpit.
- The only AoE test in CI is `aoe-launch-never-attaches`. Nothing checks that a seeded command is accepted by the pinned CLI, or that its pane survives boot.

## Decision
1. **AoE is removed.** This covers the `aoe` flake input, `[program:aoe-serve]`, the `aoe-profiles` volume, `scripts/aoe-*`, the `:9095` listener, and the nip98-proxy default upstream to it. The web board is dropped and is not replaced. The proxy keeps `/mgmt/*`.
2. **A Rust crate, `services/agentbox-sessions`, replaces it.** It is a supervised daemon plus a CLI on the same binary, gated by `[interaction_plane]`.
3. **The manifest is the only declaration.** `[[interaction_plane.session_seeds]]` (slug, tool, model, worktree) is the desired state. The per-tool command lines live in `config/session-plane/launch.json`, the launch contract. Each command is verified against the pinned CLI versions by `tests/cli/session-launch-contract.test.mjs`.
4. **Reconcile, not create-only.**
   - At boot and on a timer, a seed whose session is missing, whose pane is dead, whose pane is blocked, or whose command/path/model differs from the manifest is recreated.
   - Before recreating, the daemon runs `git status --porcelain --ignored` on the worktree. If it is dirty it reports and does not touch the session.
   - Sessions the daemon did not create are never touched.
5. **Worktrees live at `~/workspace/wt/aoe-<slug>`** (global one-root rule). Before launch, the daemon seeds folder trust for each session directory in every config store the session's tool reads: the root `~/.claude.json`, every wrapper profile's `profiles/<slug>/.claude/.claude.json`, and `~/.codex/config.toml`.
6. **The daemon runs as devuser**, as `aoe-serve` does: it must own devuser's tmux server, and it launches agents, which a role account never hosts. Its one secret is `MANAGEMENT_API_KEY`, and that is devuser-class (`config/custody/env-classes.json`). It therefore gets no `role-accounts.json` row.
   - **The API is a unix socket only**, offering `list`, `create`, `send` and `status`. It follows the identity-port precedent: mode 0660 in a dedicated socket group whose members are devuser and `ab-gateway`, authorised by `SO_PEERCRED` against an ACL of uid 1000 and 961. That way nostr-gateway still reaches it under `[security].role_isolation`.
   - tab0-bridge and nostr-gateway move to the socket and keep their existing tmux fallbacks.
   - There is no TCP listener, so ADR-2002's token boundary and the gateway's `aoe-share` token copy retire with `:9095`.
   - **`tab0` (the coordinator) is an external entry.** It names `agentbox:0`. It is listed and sendable, and it carries an identity binding, but it is never launched, recreated or reconciled.
7. **Status is explicit.**
   - `dead` comes from tmux `#{pane_dead}`.
   - `blocked` is a pane-capture match against the launch contract's blocker patterns (trust, sign-in, unrecognised flag).
   - `busy` and `idle` come from agent hooks where they exist: Claude Code Stop/Notification and Codex `notify`, the same spool voicelink uses. OpenCode and `agy` fall back to the contract's `ready` pattern.
   - A blocked session is never reported idle.
8. **Identity binding stays in management-api.** The daemon emits create/turn/close to `/v1/sessions/boundary`, and minting stays in `uris.js`. At cut-over, each AoE-keyed session epic is closed (`phase=close`) and the replacement sessions mint new bindings. Nothing is migrated in place.
9. **The picker is `agentbox-sessions pick`**, run in tab 8. It only ever calls `switch-client` on its own client (it carries the ADR-2063 / no-attach invariant forward).
10. **The roster is the current seeds minus `loom`.** The ontology-scaffolded OpenCode session is dropped, and `loom-raw` is the local Qwen session (`scaffold:false`).
11. **Acceptance.** After a cold boot, every seed has a live, unblocked pane within 60 s, and every chat seed answers one canned prompt end to end. `router` is excluded from the round-trip because it is a dispatcher console that sends work to the public fleet. This runs as the live tier of the launch contract test and as a boot health line.

## Consequences
- Fixes stop arriving through a fork that is 970 commits behind. We own about 1–2k lines of Rust in its place, and about 1.1k lines of AoE-specific JS go: `aoe-seed-sessions.mjs`, `aoe-session-boundary.cjs` and `aoe-curl.sh`. The proxy, tab0-bridge, the wrappers and `sessions-boundary.js` stay.
- The browser and phone dashboard, and the `:8444` cockpit's AoE board, go away. Remote control remains through Nostr DMs (nostr-gateway → socket) and voice (`voice-paned`, unaffected).
- INGRESS-identity's `:9095` invariants and door rows retire. The `:9096` row narrows to `/mgmt/*` and the other existing routes. `check-listeners.test.mjs` and `check-ports-loopback.sh` update with it.
- The daemon needs:
  - a `system-manifest.js` entry (apply class `rebuild`);
  - a gate on both its Nix package and its supervisor block;
  - a socket-group entry in `config/role-accounts.json`, alongside `ab-identity-port`, but no role account.
- ADR-2079 is superseded, because it examined AoE as a dispatch plane. ADR-2080's router console becomes an ordinary seed on the new plane and keeps its scope rules. ADR-2002 and ADR-2063 are retired when this ADR goes live, not before.
- `agy` sign-in remains an operator action. The acceptance gate reports it as `blocked: sign-in` and does not hide it.
- Until the daemon lands, AoE stays as it is, broken (operator decision 2026-10-28). The local Qwen model can still be reached directly at the Loom door with `scaffold:false`.

## Verification
The context facts were established on 2026-10-28 from:
- `aoe list --json` and `aoe session show` for each session;
- `~/.config/agent-of-empires/debug.log`;
- pane captures of `aoe_loom*`;
- an isolated `tmux -L` launch of each seed command against the installed CLIs: opencode 2.0.32, codex-cli 0.164.0, agy 1.4.4, claude-code 2.1.309;
- `git -C ~/workspace/project worktree list`;
- `profiles/{zai,openrouter}/.claude/.claude.json` (the project is trusted in openrouter's and not in zai's);
- `gh api …/compare` against upstream.

The OpenCode template was verified working: `OPENCODE_CONFIG_CONTENT='{"model":"loom-agent/current"}' opencode --standalone` reaches the full TUI on `qwen3.8-27b-heretic-q8_0 (Loom passthrough)`. Implementation status is `none`. `tests/cli/session-launch-contract.test.mjs` is written first. Its static tier passes, 6/6. Its live tier (`AGENTBOX_LIVE_LAUNCH=1`) is red, 5 of 7, until the daemon exists:
- `codex`, `antigravity`, `deepseek` and `loom-raw` fail because their session directories under `~/workspace/wt/` are not prepared;
- `zai` is blocked on the trust prompt;
- `openrouter` and `router` pass.

With `AGENTBOX_LAUNCH_DIR=~/workspace/project/agentbox`, which checks the CLI contract without prepared directories, the 2026-10-28 runs show:
- **Round trip passes:** `codex`, `zai`, `deepseek` and `loom-raw` each answer the canned prompt. This is after `trust-seed.cjs` began seeding the wrapper profile stores, and after the send path started pausing before Enter. Codex treats text and Enter in one burst as a paste.
- **Launches clean:** `router`, which is excluded from the round trip.
- **Fails on a credential:** `openrouter` returns `401 User not found`. Its key is invalid; this is not a launch problem.
- **Fails on sign-in:** `antigravity` stays blocked until signed in.
- **Known flake:** `zai` timed out once and passed on the next two runs. The wrapper kind has no `ready` pattern, so the prompt is sent after a fixed settle time.

A mutation check that restores the old OpenCode `-m` argv fails both the static tier and the live tier (`pane died: Unrecognized flag: -m in command opencode`).
