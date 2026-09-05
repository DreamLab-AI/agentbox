---
id: ADR-2034
title: Tool-call hooks and stateless MCP servers run resident, and the container envelope is manifest-projected
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: first host rebuild after 2026-09-05 (records verified_commit and the measured acceptance numbers in docs/reference/resource-topology-2026-09.md §5), or any change to ruflo hook wiring, the [resources] table, or the hub server list
repo: agentbox
domain: BASELINE-container
---

# ADR-2034 — Tool-call hooks and stateless MCP servers run resident, and the container envelope is manifest-projected

## Context
Measured 2026-09-05 with 40 Claude Code sessions: the container averaged 9.7 of
its 30 CPUs, of which ≈7 were `ruflo hooks pre-command`/`post-command` CLI boots
(2.6-3.6 CPU-s each, ≈144/min) installed by ten per-project
`.claude/settings.json` files in four spellings (`ruflo`, `npx @claude-flow/cli`,
`aqe`, `agentic-qe`); each Bash tool call waited ≈7.6 s in hooks. 386 per-session
MCP server processes held 25.3 GB (≈959 MB, 13 procs per session), ten of the
fifteen server types being stateless bridges. The 30-CPU cap sat in the
hand-edited `docker-compose.override.yml` against a 72-thread host, with no
cpuset, no pids limit and a read-only cgroup mount. Detail and evidence:
`docs/reference/resource-topology-2026-09.md`.

## Decision
1. Per-tool-call hooks do not boot a CLI. `agentbox-hook event <kind>`
   (`services/agentbox-ops/src/bin/agentbox-hook.rs`, library
   `src/hookspool.rs`) appends the event to `/run/agentbox/hooks/<workspace>.jsonl`
   and exits; `pre-command` keeps a narrow catastrophic-command deny-list (exit 2).
   `[program:agentbox-hook-drain]` folds the spools into
   `/var/lib/agentbox/events/hooks/{hook-metrics.json,hook-events-<day>.jsonl}`.
   The entrypoint runs `agentbox-hook reconcile --root $WORKSPACE --depth 2` at
   boot, rewriting every project settings block that invokes a CLI `hooks
   pre-command|post-command|pre-edit|post-edit|pre-task|post-task` to the shim and
   dropping `hooks route`. Idempotent; ownership and mode preserved.
2. Stateless MCP servers run once behind `agentbox-mcp hub`
   (`services/agentbox-mcp/src/hub/`, axum streamable HTTP, loopback only — the
   binary refuses any other bind). At the end of the boot `.mcp.json` sequence
   `agentbox-manifest mcp-hub-project` lifts each listed stdio definition into
   `$WORKSPACE/.mcp-hub-servers.json` (0600), rewrites the `.mcp.json` entry to
   `{type: http, url: <hub>/<name>/mcp}` and writes `/run/agentbox/mcp-hub.json`
   for the hub. The list is `[resources.mcp_hub].servers` (default: the four
   consultants, web-researcher, ontology-bridge, ruvnet-brain, precedent-bridge,
   harness-bridge, perplexity). Servers with per-session state — claude-flow,
   code-interpreter, aci-shell, codebase-memory, agentic-qe — are never listed.
   `enabled = false` restores the stdio entries from the sidecar on next boot.
3. The container envelope is the `[resources]` table in `agentbox.toml`,
   projected by `flake.nix` `agentboxResources` into the generated compose
   (`deploy` limits/reservations incl. the nvidia device reservation, `cpuset`,
   `cpu_shares`, `pids_limit`, `shm_size`) and into the tmpfs sizes
   (`/run`, `/tmp`, `~/.npm`, `~/.cache`). `docker-compose.override.yml` carries
   no resource limits. Background supervised programs run under
   `nice -n [resources.services].nice` (default 10).
4. `[program:teammate-gc]` reaps agent-team teammates whose CPU counter has
   not advanced for `[resources.session_hygiene].idle_secs` (default 1800),
   identifying them by argv elements and re-verifying `(pid, starttime, argv)`
   before SIGTERM (ADR-2032); `reap = false` reports only.

## Consequences
- ≈7 cores and ≈7.6 s per Bash call return to agent work (Phase 0 applied
  live 2026-09-05: 10 settings files, 60 hooks rewritten, 8 route hooks dropped;
  shim wall time 0.13 s in a debug build); ≈17 GB RSS and ≈240 processes are
  released at 27 sessions once the hub is live; teammate spawn does 5 node boots
  instead of 13.
- New runtime contract surface: loopback `:9720`, the spool and hub config on
  `/run`, the hub sidecar beside `.mcp.json`, the events subdirectory. Secrets
  that lived in `.mcp.json` move to the 0600 sidecar and the tmpfs hub config.
- The hub answers `initialize` from a cached child result and offers no GET
  stream; server-initiated requests from a child are refused. A child that
  exits is respawned on the next request.
- Forbidden after activation: per-tool-call CLI hooks in any project settings;
  resource limits in `docker-compose.override.yml`; a non-loopback hub bind;
  listing a stateful server in `[resources.mcp_hub].servers`.
- Deferred: an `agentbox-services` sibling container (real cgroup weighting)
  needs a design for the shared-volume bootstrap running once, not twice;
  `agentic-qe` joins the hub once its memory backend is RuVector; a
  container-wide teammate budget is Claude Code's, not ours.

## Verification
Code-level, 2026-09-05, in the authoring container (no Nix): `cargo test` —
agentbox-ops 197 lib tests (hookspool 12, teammates 5), agentbox-manifest 68 +
golden suites, agentbox-mcp 70 incl. hub child multiplex/respawn/spawn-failure
against a shell fake server; `bash -n config/entrypoint-unified.sh`; schema and
catalogue load; `scripts/ci/check-*.sh` pass except the pre-existing untracked
`tests/config/vault-path-precedence.test.sh` logseq-path hit. `flake.nix` is
brace/quote-balanced and content-checked only. Image evaluation, boot, the hub
under a real Claude Code session and the acceptance numbers in
`docs/reference/resource-topology-2026-09.md §5` are the rebuild's to record.
