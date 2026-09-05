# `config/hooks/` — what is a hook, and what is not

Not everything in this directory is a Claude Code hook. Three different kinds of
executable live here, they are wired by three different mechanisms, and the
distinction matters: a reader who assumes "file in `config/hooks/` ⇒ registered
hook" will look for a `settings.json` entry that was never meant to exist
(the drift note this file closes — ADR-2068).

Ground truth for any row below is the registering site, not this table. Re-check
with `grep -n '<file>' config/entrypoint-unified.sh services/agentbox-manifest/src/stacks.rs`.

## 1. Hooks registered in the ROOT session — `~/.claude/settings.json`

Seeded idempotently at boot by `config/entrypoint-unified.sh`. This is tmux
window 0 and every unattended teammate pane.

| File | Event(s) | Gate |
|---|---|---|
| `nostr-live-mirror.cjs` | `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` | always registered; silent no-op without a recipient pubkey. Off: `AGENTBOX_LIVE_MIRROR=0` |
| `fleet-session-start.sh` | `SessionStart` | always registered. Off: `AGENTBOX_NOSTR_GATEWAY=0` |
| `trust-seed.cjs` | `SessionStart` (plus one direct run at boot) | `AGENTBOX_TRUST_SEED` |
| `trajectory-recorder.cjs` | `Stop`, `SubagentStop` | `[memory_learning].record_trajectories` — de-registers itself when the gate is off |
| `dream-inbox-surface.cjs` | `UserPromptSubmit` | `DREAM_INBOX_HOOK` |
| `ruvnet-brain-ground.cjs` | `UserPromptSubmit` | `[skills.ruvnet_brain].grounding_hook` |
| `ontology-monitor.cjs` | `SessionEnd` | `[ontology_monitor].enabled` — de-registers itself, and its `env` master switch, when the gate is off (ADR-2068, ADR-2020) |

## 2. Hooks registered in PER-PROFILE sessions — `workspace/profiles/<stack>/.claude/settings.json`

Projected at boot by `agentbox-manifest provision-stacks`
(`services/agentbox-manifest/src/stacks.rs`, `learning_hooks()`). These are **not**
in the root `settings.json`.

| File | Event(s) | Gate |
|---|---|---|
| `claude-flow-hook-adapter.cjs` | `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd` | always, for Claude-hosted profiles |
| `ontology-monitor.cjs` | `SessionEnd` | `[ontology_monitor].enabled` (also root, per §1) |

## 3. NOT hooks — CLIs and helpers

Never registered on any event. Nothing will call these on a session boundary.

| File | What it actually is |
|---|---|
| `project-tracking-publish.cjs` | A **CLI**, spawned by the management API from `POST /v1/projects/:id/publish` (`management-api/routes/projects.js:28,322`), reading a `ProjectTrackingDigest` on stdin. It is the Node sibling of the `nostr-pod-bridge session-summary` publish path, not a Claude Code hook. |
| `fleet-tab-name.sh` | A helper shelled by `fleet-session-start.sh:17`. No independent registration. |
| `lib/egress-policy.cjs`, `lib/trajectory-util.cjs` | Shared libraries `require`d by the hooks above. |

## Adding one

A new hook is not wired by dropping a file here. Register it in the site that
owns its session class (§1 entrypoint, §2 `stacks.rs`), gate it in
`agentbox.toml`, make the off-state retract any registration an earlier on-boot
wrote (ADR-2020 byte-identical-when-off), and add its row above.
