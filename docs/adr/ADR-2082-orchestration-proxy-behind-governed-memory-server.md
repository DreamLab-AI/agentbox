---
id: ADR-2082
title: The governed claude-flow server forwards orchestration tools to a filtered ruflo child; memory never crosses
date: 2026-09-07
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ee742ade57ddca06ba846676e6006171ec76c49d
verified_paths: [mcp/servers/lib/orchestration-proxy.js, mcp/servers/ruvector-mcp.cjs, mcp/servers/lib/ruvector-gates.js, config/entrypoint-unified.sh]
owner: jjohare
review_trigger: next image rebuild (activation), a ruflo major bump that renames the swarm/agent/task/coordination tools, or any proposal to forward a memory_* tool
repo: agentbox
domain: LEARNING-memory
---

# ADR-2082 — The governed claude-flow server forwards orchestration tools to a filtered ruflo child; memory never crosses

## Context
`ruvector-mcp.cjs` replaced `claude-flow mcp start` as the `claude-flow` MCP server so
that every `memory_*` call rides ruvector-postgres + Xinference (ADR-2014). It kept
advertising `swarm_init`, `agent_spawn`, `task_orchestrate`, `swarm_status`,
`coordination_sync` and ten other orchestration names, but since the 2026-06-11 audit
removed the legacy server they have answered `{ ok:false, error:'unimplemented' }`.
Forty-one agent templates bind those names as `mcp__claude-flow__*`; the mesh/hive
capability the product advertises was therefore a set of honest stubs. The Nix closure
bakes ruflo v3.38, whose `ruflo mcp start` implements them and honours a category
filter (`CLAUDE_FLOW_MCP_TOOLS`, ruflo #2726). Registering ruflo as a second MCP
server would change every tool name and re-expose ruflo's SQLite `memory_*` tools.

## Decision
The governed server stays the single `claude-flow` entry. Behind the manifest gate
`[integrations.ruvector_external].orchestration_proxy` (env
`RUVECTOR_ORCHESTRATION_PROXY`) it spawns **one** `ruflo mcp start` child per
session, lazily at the client's first `tools/list`, with `CLAUDE_FLOW_MCP_TOOLS` set
from `orchestration_tools` (default `swarm,agent,task,coordination`). The child's
tools replace the stubs of the same name and are appended otherwise
(`mcp/servers/lib/orchestration-proxy.js`).

- **Memory never crosses.** `DENIED_PREFIXES` (`memory_`, `agentdb_`, `embeddings_`,
  `hooks_`, `agentic_flow_`, `ruvllm_`, `agenticow_`) is enforced on the proxy side
  regardless of the filter. The ADR-2014 access invariant is unchanged: the only
  `memory_*` tools a client can reach are the governed ones.
- **Legacy names are aliases, not fabrications.** `task_orchestrate` →
  `coordination_orchestrate`, `load_balance` → `coordination_load_balance`,
  `bottleneck_analyze` → `performance_bottleneck`, with a thin argument shim
  (`type`→`agentType` on `agent_spawn`; v2 strategies → `parallel`). A legacy name
  whose target is outside the enabled categories stays an honest stub.
- **Fail-open for orchestration only.** No ruflo binary, a failed handshake or a dead
  child ⇒ the stub list is advertised and answered exactly as before, the failure is
  logged, and memory is unaffected. The child is respawned at most three times per
  session. Memory keeps its ADR-2014 fail-closed contract.
- **Gate off ⇒ byte-identical.** With the gate off nothing is required, spawned or
  advertised beyond the pre-ADR-2082 26-tool list.
- Apply class **boot**: the entrypoint projects the gate and filter into the
  `claude-flow` env block of `.mcp.json`; a new Claude session picks them up.

## Consequences
- The 41 agent templates that call `mcp__claude-flow__swarm_init` / `agent_spawn` /
  `task_orchestrate` get real ruflo implementations without renaming.
- One extra node process per Claude session (~105 MB RSS measured, ruflo 3.38.21) and
  ~39 extra tool schemas (~7k tokens) per session. Widening `orchestration_tools`
  widens both; it is the operator's knob.
- Swarm/agent/task state lives where ruflo puts it: `<cwd>/.claude-flow/` (gitignored),
  not in ruvector-postgres. That is orchestration state, not durable memory.
- ruflo's `coordination_orchestrate` records an orchestration and says so in its
  response (`executor: "none"`); execution still happens through Claude Code's own
  agent runtime. The proxy does not hide that note.
- The runtime copy under `/opt/agentbox` is baked, so the capability is live only
  after the next image rebuild; until then sessions see the stubs.

## Verification
Verified at `ee742ade5` (the landing commit), 2026-09-07:
- `node mcp/servers/lib/orchestration-proxy.test.js` — 11 pass (pure merge/alias/deny
  rules; fake child for spawn, forward, timeout, crash-respawn, missing-binary
  fail-open).
- `node mcp/servers/lib/memory-tools.test.js` — 23 assertions pass (memory path
  untouched).
- Gate off: `tools/list` from the repo server and the baked `/opt/agentbox` server both
  return 26 tools.
- Gate on, against the baked ruflo: 59 tools (39 forwarded, 3 legacy aliases, 9 honest
  stubs). `swarm_init{topology:mesh}` → persisted swarm; `agent_spawn{type:'coder',
  name:'c1'}` → registered `agentId:'c1'`; `task_orchestrate{strategy:'adaptive'}` →
  `coordination_orchestrate` with `strategy:'parallel'`; `swarm_status` → `agentCount:1`;
  `neural_patterns` → `error:'unimplemented'`; `memory_search` → ruvector-postgres
  (`method:'hnsw-xinference'`). No ruflo child survives the server's exit.
- `node scripts/agentbox-config-validate.js agentbox.toml` and `setup/agentbox.default.toml`
  valid; `node scripts/ci/check-manifest-catalogue.js` PASS (62 gate paths).
