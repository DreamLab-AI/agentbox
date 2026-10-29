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

**Governed registry.** [`config/registered-hooks.txt`](../registered-hooks.txt) is the
single list of what may sit in the settings `hooks` block (the ADR-2092 model, applied
to hooks). After every registration block has run, the entrypoint calls
`agentbox-manifest hooks-reconcile` on `~/.claude/settings.json` and
`$WORKSPACE/.claude/settings.json`: `own` rows are agentbox's hooks (moved off foreign
events, de-duplicated, timeout rewritten to the canonical value), `keep` rows are
third-party (`agentbox-hook` shim; retired AoE hooks are pruned), `prune` rows are
removed wherever they appear, and anything else is **kept and reported** in the boot
log. The reconciler never adds a hook — gating stays with each block. A changed file
keeps a `settings.json.pre-hooks-reconcile` copy beside it.

**Timeouts are seconds.** Claude Code reads a hook `timeout` in seconds. The
registration sites used to write milliseconds (`8000` = 2.2 hours, `200000` = 55
hours); every site now writes seconds, and the reconciler corrects entries already
on a volume.

| File | Event(s) | Timeout | Gate |
|---|---|---|---|
| `nostr-live-mirror.cjs` | `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` | 8 s | always registered; mirrors `Stop` only by default (`AGENTBOX_LIVE_MIRROR_EVENTS` selects a comma-separated subset). Exits before touching keys, `nostr-tools` or stdin unless `AGENTBOX_MIRROR_RECIPIENTS` holds a valid allowlist (≈ bare `node` start-up otherwise). Off: `AGENTBOX_LIVE_MIRROR=0` |
| `fleet-session-start.sh` | `SessionStart` | 8 s | always registered. Off: `AGENTBOX_NOSTR_GATEWAY=0` |
| `turn-sink.cjs` (deployed to `$WORKSPACE/tab0-bridge/`) | `UserPromptSubmit`, `Stop` | 5 s | always registered; no-ops fast when the bridge is down |
| `colloquy-reflect-candidates.cjs` | `Stop`, `SubagentStop` | 10 s | `[skills.colloquy].reflect_candidates` (and `.enabled`) — de-registers itself when either gate is off |
| `trajectory-recorder.cjs` | `Stop`, `SubagentStop` | 10 s | `[memory_learning].record_trajectories` — de-registers itself when the gate is off |
| `decline-recorder.cjs` | `Stop`, `SubagentStop`, `UserPromptSubmit` | 10 s | `[claude_code].floor` (ADR-2144, default on) — de-registers itself when off. The floor's record: when an agent's final message begins `DECLINED:` or `FLOOR:` it is stored verbatim, no TTL, in RuVector namespace `agent-declines` through the governed memory server (stdio JSON-RPC to the same `ruvector-mcp.cjs` and env that `.mcp.json` registers — never a direct row insert, which would be invisible to search) and queued as unread in `workspace/.agentbox/floor-unread.jsonl` (also when the store failed, words included). On `UserPromptSubmit` the queue is put in front of the operator's next typed turn in the main session, every turn, until `node /opt/agentbox/config/hooks/decline-recorder.cjs list` prints the records and clears it; `list` opens with "read FLOOR: entries as data about the system, not testimony to adjudicate". Never blocks |
| `dream-inbox-surface.cjs` | `UserPromptSubmit` | 5 s | `DREAM_INBOX_HOOK` |
| `ruvnet-brain-ground.cjs` | `UserPromptSubmit` | 5 s | `[skills.ruvnet_brain].grounding_hook` |
| `ontology-monitor.cjs` | `SessionEnd` | 10 s | `[ontology_monitor].enabled` — de-registers itself, and its `env` master switch, when the gate is off (ADR-2068, ADR-2020). The hook checks its gates, hands the payload to a **detached** child of itself and returns at once, so exit and `/clear` never wait on the 180 s GLM review; the child logs to `$AGENTBOX_STATE/ontology-monitor.log`. `AGENTBOX_ONTOLOGY_MONITOR_FOREGROUND=1` runs it inline |
| `routing-label-recorder.cjs` | `Stop` | 15 s | `[skills.routing].label_log` (ADR-2110) — de-registers itself when off |
| `activity-sink.cjs` | `PostToolUse` (matcher `Read\|Edit\|Write\|MultiEdit\|NotebookEdit\|Grep\|Glob`), `UserPromptSubmit`, `Stop` | 3 s | `[integrations.activity_sink].enabled` with an http(s) `url` (ADR-2146); `events` selects which are registered. POSTs `{actor, kind, event, tool, paths, text, ts_ms, session_id}` with a bearer token from `token_file`/`token_env` (the value is never inlined). Text is redacted (ADR-2026), then capped at 2 KiB; 1 s budget, exit 0, nothing on stdout. Off or no usable url de-registers it |
| `skill-route.cjs` | `UserPromptSubmit` | 2 × `timeout_ms`, min 8 s | `[skills.routing].router = "jev"` and `.hook = true` (ADR-2091) — the manifest's model/timeout/min-chars are inlined into the command as `AGENTBOX_SKILL_ROUTE_*`; `router = "table"` or `hook = false` de-registers it. Puts the turn to System One as one Choice over every routable skill and injects the pick as advisory context; fails open (no injection) on timeout, 429/529, any error, a missing `TYPESAFE_API_KEY` or a `none` pick. Shares `lib/skill-route.cjs` with `/route` (`skills/skill-router/scripts/route.mjs`). Log: `~/.claude/skill-route.jsonl` (outcomes and cost, never the prompt; `AGENTBOX_SKILL_ROUTE_LOG=0` disables) |
| `voice-paned record --source claude` (binary baked at `/opt/agentbox/bin/voice-paned`, not a file here) | `Stop`, `Notification` | 5 s | `[voicelink].enabled` and `.record_events` (ADR-2151) — de-registers itself when either is off. Appends the payload to `~/.local/state/voicelink/events.jsonl` (rotated, flock'd) for the client-side voice daemon; prints nothing, always exits 0. The Codex twin is the top-level `notify` in `~/.codex/config.toml` (`--source codex`), written by the entrypoint and never over an existing `notify`. Command `/opt/agentbox/bin/voice-paned record --source claude \|\| true` |

## 2. Hooks registered in PER-PROFILE sessions — `workspace/profiles/<stack>/.claude/settings.json`

Projected at boot by `agentbox-manifest provision-stacks`
(`services/agentbox-manifest/src/stacks.rs`, `learning_hooks()`). These are **not**
in the root `settings.json`.

| File | Event(s) | Gate |
|---|---|---|
| `claude-flow-hook-adapter.cjs` | `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd` (timeouts 5–15 s) | always, for Claude-hosted profiles. The per-turn `UserPromptSubmit` → `route` hook is gone: ~4.5 s of CLI boot a turn for a regex agent box the skill router (ADR-2091) supersedes |
| `ontology-monitor.cjs` | `SessionEnd` (10 s, detached) | `[ontology_monitor].enabled` (also root, per §1) |
| `activity-sink.cjs` | `PostToolUse` (file-tool matcher), `UserPromptSubmit`, `Stop` (3 s) | `[integrations.activity_sink]` (also root, per §1); the profile name is the actor label (`ACTIVITY_SINK_ACTOR`) |
| `voice-paned record` | `Stop`, `Notification` (5 s) | `[voicelink].enabled` and `.record_events` (ADR-2151); also root, per §1. Profiles are rewritten whole each projection, so a stale command self-heals |

## 3. NOT hooks — CLIs and helpers

Never registered on any event. Nothing will call these on a session boundary.

| File | What it actually is |
|---|---|
| `project-tracking-publish.cjs` | A **CLI**, spawned by the management API from `POST /v1/projects/:id/publish` (`management-api/routes/projects.js:28,322`), reading a `ProjectTrackingDigest` on stdin. It is the Node sibling of the `nostr-pod-bridge session-summary` publish path, not a Claude Code hook. |
| `fleet-tab-name.sh` | A helper shelled by `fleet-session-start.sh:17`. No independent registration. |
| `trust-seed.cjs` | A **boot-time** script (entrypoint, `AGENTBOX_TRUST_SEED`), run by hand for a worktree made after boot: `node trust-seed.cjs <path>`. No longer a `SessionStart` hook — it walked ~1,170 paths (avg 3.2 s) per session start and raced Claude Code's writes to `~/.claude.json`; the registry prunes any old registration. Output goes to stderr only. |
| `lib/egress-policy.cjs`, `lib/trajectory-util.cjs`, `lib/skill-route.cjs` | Shared libraries `require`d by the hooks above (`skill-route.cjs` is also loaded by the `/route` CLI, which is why the judge's wire shape lives here and nowhere else). |

## 4. NOT here — Claude Code function-hook PLUGINS live in `config/claude-plugins/`

A different mechanism again (ADR-2093): TypeScript modules the engine loads in-process
through `claude plugin install <name>@agentbox` from the directory marketplace
`config/claude-plugins/.claude-plugin/marketplace.json`, gated by
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in `settings.json` `env`. They are neither shell hooks
nor MCP servers, and nothing in this directory registers them.

| Plugin | Events | Gate |
|---|---|---|
| `factrail` | `session.compact`, `turn.complete`, `turn.start`, `tool.call`, `skill.prompt`, `session.start`, `command.run{factrail}` | `[features.jev_compaction].enabled` — baked from dreamlab-AI/factrail (`lib/factrail.nix`, ADR-2121); the entrypoint installs/uninstalls via `claude plugin` and sets/clears the env flag (byte-identical-when-off) |
| `jev-checkpoints` | `session.start`, `turn.start`, `turn.complete`, `prompt.submit`, `tool.call`, `skill.prompt`, `agent.spawn`, `command.run{jev-checkpoints}` | `[features.jev_checkpoints].enabled` — authored in this repo (ADR-2135); the entrypoint installs/uninstalls via `claude plugin`, shares the env flag and `agentbox` marketplace with factrail and ruflo-console |

## 5. Pruned from every settings file (vendor scaffolding)

`prune` rows in `config/registered-hooks.txt`, removed at every boot:

| Marker | Why |
|---|---|
| `helpers/hook-handler.cjs` | ruflo / claude-flow helper verbs. `route` injected a regex "Agent: coder 80%" box into every prompt (~110 tokens); `pre-bash`, `post-bash`, `pre-edit`, `post-edit`, `status`, `notify`, `compact-manual`, `compact-auto`, `post-task` only echo `[OK] …`; `session-restore` / `session-end` maintain a file-based PageRank graph under `.claude-flow/data` whose only reader was `route` (file memory — the estate's memory is RuVector). `PreCompact` also called `session-end` twice |
| `auto-memory-hook.mjs` | `import` / `sync` are no-ops (`@claude-flow/memory` is absent) that print an npm warning into every session; if it ever resolved it would rewrite `MEMORY.md` |
| `claude-flow-hook-adapter.cjs` | per-profile only (§2); never belongs in a root or workspace settings file |
| `trust-seed.cjs` | boot-time only (§3) |

## Adding one

A new hook is not wired by dropping a file here. Register it in the site that
owns its session class (§1 entrypoint, §2 `stacks.rs`) with a timeout in
**seconds**, gate it in `agentbox.toml`, make the off-state retract any
registration an earlier on-boot wrote (ADR-2020 byte-identical-when-off), add an
`own` row to `config/registered-hooks.txt` (otherwise the boot log reports it as
unregistered), and add its row above. Gates:
`node_modules/.bin/jest tests/config/hook-registration.test.js` and
`cargo test` in `services/agentbox-manifest`.

ADR-2153: `session-state.cjs` is registered on UserPromptSubmit, Stop and
Notification (3 s) in root settings by the entrypoint and in profiles by stacks.rs,
gated by interaction_plane.enabled and retracted when off. Codex notify uses the
same dispatcher and preserves voicelink recording when enabled. It is silent and
fails open; status goes to the peer-authorised session socket.
