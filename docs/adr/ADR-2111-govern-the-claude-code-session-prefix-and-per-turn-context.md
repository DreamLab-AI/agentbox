---
id: ADR-2111
title: Govern the Claude Code session prefix and per-turn context
date: 2026-09-25
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: de84739eea73bdbeffa595f57c1a5d71fd77f630
verified_paths: []
owner: jjohare
review_trigger: next Claude Code minor bump that changes hook output, agent/command discovery or cache-TTL settings; or a measured session prefix above 45k tokens
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2111 — Govern the Claude Code session prefix and per-turn context

## Context
Measured on Claude Code 2.1.280 against Anthropic's session-value guidance (cache reads cost 0.1×,
the prefix is paid on every session and every cache miss, and noise in history is re-read on every
call). A session in `agentbox/` started at ~60k tokens. Retired agents/commands still loaded because
ADR-2092's `.superseded/` sidecar sat inside roots Claude Code scans recursively. Three
`UserPromptSubmit` hooks emitted top-level `additionalContext`, which Claude Code ignores, so the
ADR-2091 router never reached the model. Every hook `timeout` was written in milliseconds but read as seconds.
`memory_search` crushed ranked results (kept the lowest row, lost relevant ones irrecoverably).
Unregistered ruflo scaffolding injected a regex routing box on every turn. All subagents inherited
the main model, headless `claude -p` paths loaded the whole estate, and the OpenRouter profile's
model pin sat in a file Claude Code never reads, so it billed Opus.

## Decision
1. **Retirement sidecars live outside every scanned root** (`~/.claude/agentbox-superseded/`,
   override `AGENTBOX_SUPERSEDED_DIR`); legacy in-root sidecars are migrated on every run (ADR-2092 amended).
2. **Hook context uses the honoured shape only**: `{"hookSpecificOutput":{"hookEventName",
   "additionalContext"}}` via `config/hooks/lib/hook-output.cjs`. Stdout from `SessionStart` /
   `UserPromptSubmit` is model context; progress goes to stderr. The router scores registered skills only.
3. **Hook registration is governed** by `config/registered-hooks.txt` (`own`/`keep`/`prune`),
   reconciled at boot by `agentbox-manifest hooks-reconcile`; timeouts are seconds; SessionEnd
   work that may call a model (ontology-monitor, session-summary) detaches and returns at once.
4. **Search returns snippets, ranked and floored**: no crushing; 300-char snippets, `min_score`
   0.55, default limit 5, protected namespaces excluded from `"*"` unless named; `full:true` or
   `memory_retrieve` for whole values.
5. **Cache and model hygiene**: seed `subagentPromptCacheTtl: "1h"`, `autoMemoryEnabled: false`,
   `switchModelsOnFlag: false` (only where unset); mechanical agents run `haiku`/`sonnet` at low
   effort with `omitClaudeMd`; headless paths pass `--effort low`, strict empty MCP config,
   `disableAllHooks`, `MAX_THINKING_TOKENS=0`; token-auth profiles pin a 1h prompt cache and every model tier.
6. **Always-loaded instructions hold undiscoverable constraints only**; depth moves to
   `docs/reference/claude-context/` and lazily loaded subdirectory files. No `@imports` for depth.
   **One tool-neutral source per tier: `AGENTS.md`.** In a repo, `CLAUDE.md` is `@AGENTS.md` plus
   Claude-only notes (agentbox, host project, `crates/colloquy`; sidestr moved to sidestr-rs, ADR-2112). The workspace tier
   sits above every project root, where Claude Code skips `@` imports as unapproved external includes,
   so `agentbox-manifest agents-md-embed` copies `~/workspace/AGENTS.md` into a generated block of
   `~/workspace/CLAUDE.md` at boot rather than seeding external-include approval (which would let any
   trusted repo import files from outside itself). Codex gets `~/.codex/AGENTS.md` = its generated
   tool notes + the operator's Working style section + `~/workspace/AGENTS.md`. `config/hooks/` stays
   `CLAUDE.md`-only (Claude Code hooks).
7. **Compaction is cache-aware** (ADR-2093 amended): absolute token threshold, hysteresis, sticky
   per-session email taint, and compaction before an idle session's cache expires.

## Consequences
- Measured: prefix ~60k → ~45k expected after rebuild (retired agents −6.8k, commands −2.4k,
  CLAUDE.md 40.4 KB → 19 KB); headless prefix 38–60k → 7–10k tokens; typical search 11–28 KB → ~2.8 KB;
  router judge input ~16k → 3.2k tokens per call.
- Routing, brain grounding and the dream inbox now actually reach the model; their size caps
  (300 / 1,200 chars; dream inbox skips harness-generated turns) are the new budget.
- `agentic_qe = false` removes the `aqe` CLI (rebuild-class). Unused MCP servers with existing
  gates (aci-shell, code-interpreter, harness-bridge, codebase-memory, per-consultant) remain on — an operator decision.
- Callers that need whole search values must opt in (`full:true`); colloquy and voyager do.
- The host project's local `.claude/settings.json` (ruflo-generated, untracked) was corrected by hand
  (seconds, no-op Stop hook and ruflo session-restore removed); `hooks-reconcile` does not govern it.
- Follow-on: per-consultant MCP gating needs a projector change.

## Verification
`bash tests/config/agent-reconcile.test.sh` 45/45; jest `tests/config` (prompt-hooks 33,
hook-registration 12, skill-route, routing-labels) green apart from the pre-existing
`multi-user-regression` failure; `node mcp/servers/lib/memory-tools.test.js` 35/35;
`cargo test` in `services/agentbox-manifest` (85 unit + integration) and `services/agentbox-ops` (202);
jev-compaction policy 36/36 + engine 8/8; `skills/lint-skills.sh` clean; live: Agent-tool listing
dropped to the registered set, dream-inbox context observed in a live turn. Activation is `staged`
until `./agentbox.sh rebuild` bakes `/opt/agentbox` (brain-ground lib, nostr-gateway, Hermes, memory server).
