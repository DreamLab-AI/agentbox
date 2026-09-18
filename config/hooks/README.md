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
| `colloquy-reflect-candidates.cjs` | `Stop`, `SubagentStop` | `[skills.colloquy].reflect_candidates` (and `.enabled`) — de-registers itself when either gate is off |
| `trajectory-recorder.cjs` | `Stop`, `SubagentStop` | `[memory_learning].record_trajectories` — de-registers itself when the gate is off |
| `dream-inbox-surface.cjs` | `UserPromptSubmit` | `DREAM_INBOX_HOOK` |
| `ruvnet-brain-ground.cjs` | `UserPromptSubmit` | `[skills.ruvnet_brain].grounding_hook` |
| `ontology-monitor.cjs` | `SessionEnd` | `[ontology_monitor].enabled` — de-registers itself, and its `env` master switch, when the gate is off (ADR-2068, ADR-2020) |
| `skill-route.cjs` | `UserPromptSubmit` | `[skills.routing].router = "jev"` and `.hook = true` (ADR-2091) — the manifest's model/timeout/min-chars are inlined into the command as `AGENTBOX_SKILL_ROUTE_*`; `router = "table"` or `hook = false` de-registers it. Puts the turn to System One as one Choice over every routable skill and injects the pick as advisory context; fails open (no injection) on timeout, 429/529, any error, a missing `TYPESAFE_API_KEY` or a `none` pick. Shares `lib/skill-route.cjs` with `/route` (`skills/skill-router/scripts/route.mjs`). Log: `~/.claude/skill-route.jsonl` (outcomes and cost, never the prompt; `AGENTBOX_SKILL_ROUTE_LOG=0` disables) |

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
| `lib/egress-policy.cjs`, `lib/trajectory-util.cjs`, `lib/skill-route.cjs` | Shared libraries `require`d by the hooks above (`skill-route.cjs` is also loaded by the `/route` CLI, which is why the judge's wire shape lives here and nowhere else). |

## 4. NOT here — Claude Code function-hook PLUGINS live in `config/claude-plugins/`

A different mechanism again (ADR-2093): TypeScript modules the engine loads in-process
through `claude plugin install <name>@agentbox` from the directory marketplace
`config/claude-plugins/.claude-plugin/marketplace.json`, gated by
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in `settings.json` `env`. They are neither shell hooks
nor MCP servers, and nothing in this directory registers them.

| Plugin | Events | Gate |
|---|---|---|
| `jev-compaction` | `session.compact`, `turn.complete`, `session.start`, `command.run{jev-compact}` | `[features.jev_compaction].enabled` — the entrypoint installs/uninstalls via `claude plugin` and sets/clears the env flag (byte-identical-when-off) |

## Adding one

A new hook is not wired by dropping a file here. Register it in the site that
owns its session class (§1 entrypoint, §2 `stacks.rs`), gate it in
`agentbox.toml`, make the off-state retract any registration an earlier on-boot
wrote (ADR-2020 byte-identical-when-off), and add its row above.
