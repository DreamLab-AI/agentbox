---
title: Resource topology — where the agentbox envelope goes and how to widen it
status: implemented-awaiting-rebuild
last_updated: 2026-09-05
related: [ADR-2034]
---

# Resource topology scoping (September 2026)

The agentbox container is the dominant consumer on the gateway host. It hits its
ceiling not because the ceiling is low but because most of what it spends goes
on its own overhead: per-tool-call hook boots and a full private copy of every
MCP server for every Claude Code session. This document records the
measurements, the causes, and a target structure that widens usable bandwidth
by roughly 2.5× without changing what agents can do.

All numbers were measured live on 2026-09-05 with two agent teams (40 Claude
Code sessions) running.

## 1. Measured state

### Host and envelope

| Item | Value |
|---|---|
| Host CPU | 2 × Xeon Gold 6154, 36 cores / 72 threads, 2 NUMA nodes (0-17+36-53, 18-35+54-71) |
| Host RAM | 376 GB (178 GB free at measurement) |
| Container CPU cap | 30 CPUs (`NanoCpus`), no `cpuset`, `cpu.weight` 100 |
| Container memory | 256 GB limit, 64 GB reservation, 32 GB shm |
| Container pids | no limit (7,305 live) |
| Sibling caps | browsercontainer 4 CPU / 8 GB (at 6.9 GB), gui-tools 8 CPU / 16 GB, others uncapped and idle |
| Where the cap lives | `docker-compose.override.yml` `deploy.resources` (hand-maintained, not generated from `agentbox.toml`) |

The override comment still says "32 cores"; the host has 36 cores and 72
threads. The container is allowed 42 % of the machine's threads while the
other containers together use under one core.

### Load

| Metric | Value |
|---|---|
| Average CPU in use (10 s window) | 9.7 of 30 |
| `docker stats` instantaneous | 678 % |
| Load average (1/5/15 min) | 7.2 / 11.2 / 11.5 |
| CFS throttling, lifetime | 5,491 of 776,900 periods (0.7 %), 4,078 s throttled |
| PSI cpu `some avg300` | 0.32 |
| PSI io `some avg300` | 0.92 |
| RSS (docker stats) | 28 GB; `memory.current` 96 GB including page cache |

Throttling is rare, so the 30-CPU cap is not the binding constraint most of
the time. The container is busy with bursty work whose aggregate is well under
the cap, yet tab 5 shows a sustained load band. That band is overhead.

### Where the CPU goes

Process rollup at measurement (sum of `%CPU`, RSS):

| Category | Procs | CPU | RSS |
|---|---|---|---|
| ruflo node (hooks + daemons) | 18 | 677 % | 4.1 GB |
| Shells / tmux | 47 | 311 % | 0.6 GB |
| Claude Code teammates (`--agent-id`) | 42 | 165 % | 10.4 GB |
| MCP servers (per-session copies) | 438 | 63 % | 29.3 GB |
| Claude Code interactive | 8 | 32 % | 3.3 GB |

The `ruflo` line is the per-tool-call hooks. A single boot costs:

| Hook | Wall | CPU |
|---|---|---|
| `ruflo hooks pre-command` | 2.7 s | 2.6 s |
| `ruflo hooks post-command` | 4.9 s | 3.6 s |
| `ruflo hooks route` (UserPromptSubmit) | 5.7 s | 3.6 s |
| `ruflo --version` (boot floor) | 0.05 s | 0.05 s |

Over a 20 s sample, 48 distinct hook processes were spawned (≈144/min). At
≈3 CPU-s each that is ≈7 cores burned continuously, which matches the 9.7-core
average almost entirely. Every Bash tool call from every agent also waits
≈7.6 s in hooks before and after the command runs, and the `route` hook
exceeds its own 5 s timeout so its work is discarded.

These hooks are not from `~/.claude/settings.json` (whose `hook-handler.cjs`
dispatch is light). They come from **per-project** `.claude/settings.json`
files, nine of them under `~/workspace` (`project`, `project2`, `solid-pod-rs`,
`OntologyDesign`, `Research`, `funding_platform`, `website-giw`,
`PeteStrategyDoc`) plus the ruflo plugin marketplace template, each with
`PreToolUse ^Bash$` → `ruflo hooks pre-command` and `PostToolUse ^Bash$` →
`ruflo hooks post-command`, plus edit/task equivalents and a `route` on every
prompt. Four `ruflo daemon start --foreground` processes (one per workspace)
are also resident but idle.

### Where the memory goes

Each Claude Code session spawns its own private copy of every stdio MCP
server in `.mcp.json`. With 27 sessions holding the full set:

| Server | Copies | Avg RSS | Total |
|---|---|---|---|
| agentic-qe (`aqe mcp`) | 24 | 142 MB | 3.4 GB |
| perplexity | 24 | 81 MB | 1.9 GB |
| ontology-bridge | 24 | 80 MB | 1.9 GB |
| consultant-antigravity | 24 | 76 MB | 1.8 GB |
| precedent-bridge | 24 | 74 MB | 1.8 GB |
| ruvnet-brain | 24 | 74 MB | 1.8 GB |
| consultant-perplexity | 24 | 73 MB | 1.7 GB |
| consultant-codex | 24 | 73 MB | 1.7 GB |
| consultant-deepseek | 24 | 72 MB | 1.7 GB |
| aci-shell | 24 | 71 MB | 1.7 GB |
| harness-bridge | 24 | 71 MB | 1.7 GB |
| ruvector-mcp (claude-flow) | 25 | 68 MB | 1.7 GB |
| codebase-memory-mcp (client + wrapper) | 49 | 35 MB | 1.7 GB |
| web-researcher (Go) | 25 | 31 MB | 0.8 GB |
| code-interpreter (Python) | 25 | 18 MB | 0.5 GB |
| **Total** | **386** | | **25.3 GB** |

That is ≈959 MB and 13-14 processes per session before the session does any
work, and 13 node boots on every teammate spawn. Eleven of the fifteen are
stateless bridges to a network service or a CLI; only `code-interpreter`
(kernel per session), `aci-shell` (per-agent DID in env), `codebase-memory`
(already a thin client over a shared `--cbm-daemon`) and `agentic-qe`
(in-memory backend) carry per-session state.

### Secondary findings

- `~/.npm` tmpfs is 100 % full (256 MB); any `npx` of a new package fails with ENOSPC.
- `~/.cache` tmpfs is at 85 % of 1 GB (`claude` 966 MB).
- `/sys/fs/cgroup` is mounted read-only with an empty `subtree_control`, so
  nested cgroups cannot be created from inside the container; internal
  weighting has to come from `nice`/`ionice` or from container topology.
- The team in `session-dc65aee1` has been resident for over seven hours with
  sixteen teammates; idle teammates still hold their full MCP set.

## 2. Causes, ranked

1. **Per-tool-call full CLI boot.** ruflo's hook path loads the whole CLI
   (plugins, memory backend, config) for a job that produces a few lines of
   telemetry. ~7 cores and ~7.6 s latency per Bash call.
2. **MCP fan-out per session.** Stateless bridges are duplicated 27×. ~21 GB
   RSS, ~300 processes, and a 13-boot storm on every teammate spawn.
3. **Stale host envelope.** 30 of 72 threads, no NUMA placement, no pids
   guard, envelope hand-edited in the override instead of manifest-driven.
4. **Flat cgroup.** Background supervised services (dream-engine, sweeps,
   jupyter, code-server, xvnc/i3, blender/qgis MCP) compete at equal weight
   with agent sessions.
5. **Session hygiene.** No idle-teammate reaper; tmpfs sizing too small for
   the npm/npx path.

## 3. Target structure

```
host (72 threads, 376 GB)
├── agentbox            cpus 56, cpuset 0-13,36-49,18-31,54-67, cpu_shares 1024, pids 32768
│   ├── supervisord (PID 1) — interaction plane, tmux, sessions, hook shim
│   ├── agentbox-mcp-hub — ONE process per stateless MCP server, streamable HTTP on 127.0.0.1:9720
│   └── per-session stdio MCP: code-interpreter, aci-shell, codebase-memory client, agentic-qe
├── agentbox-services   same image, profile=services, cpu_shares 256, nice 10 (Phase 3)
│   └── dream-engine, ruvector sweeps, ontology-condense, jupyter, code-server, xvnc/i3, blender/qgis MCP
├── browsercontainer    4 CPU / 8 GB (unchanged)
├── gui-tools-service   8 CPU / 16 GB (unchanged)
└── ruvector-postgres, xinference, email gateway, voice stack (uncapped, idle)
```

Manifest: a new `[resources]` table in `agentbox.toml` is the single source
for the envelope; `flake.nix` `composeText` projects it into the generated
`docker-compose.yml`, and `docker-compose.override.yml` stops carrying limits.

### 3.1 Hook shim (replaces the per-call CLI boot)

- One Rust binary `agentbox-hook` in `services/agentbox-ops` (the crate that
  already owns `ruflo-daemon-gc`). It reads the hook JSON on stdin, appends a
  single line to `/run/agentbox/hooks/<workspace-hash>.jsonl`, and exits 0 in
  under 10 ms. Pre-command safety keeps a local deny-list (the same patterns
  ruflo's `--validate-safety` checks) so the guard survives without the boot.
- `agentbox-hook drain --loop` (supervised, nice 10) rotates the spools every
  30 s and folds them into `hook-metrics.json` (per-workspace counts by kind,
  tool and leading command, post-command success ratio) plus dated
  `hook-events-*.jsonl` on the events volume. ruflo itself is an external nix
  package and cannot be taught to drain in-process, so the signal is kept in
  the events volume in the same shape and latency and CPU leave the tool-call
  path. The `ruflo-aggregate-sweep` can ingest these files into RuVector later.
- The `route` hook is dropped from the per-prompt path: it exceeds its own
  timeout today and its output is advisory.
- The nine project-level `.claude/settings.json` hook blocks are replaced by
  the shim through `config/hooks/trust-seed.cjs`'s sibling reconcile step at
  boot, so new checkouts do not reintroduce the CLI hooks.
- `/run` tmpfs grows from 64 MB to 256 MB for the spool.

### 3.2 MCP hub (replaces per-session copies of stateless servers)

- `agentbox-mcp-hub`, a supervised program built on the existing
  `services/agentbox-mcp` crate (`rmcp` already a dependency; add the
  `transport-streamable-http-server` feature). It starts each hubbed server
  once as a child stdio process and exposes it at
  `http://127.0.0.1:9720/<name>/mcp`, multiplexing clients on
  `Mcp-Session-Id`. Loopback-only, consistent with the ADR-2013 publish
  policy and the `aoe serve` loopback posture.
- Hubbed set (10, `[resources.mcp_hub].servers`): ontology-bridge,
  ruvnet-brain, precedent-bridge, harness-bridge, perplexity, web-researcher,
  and the four consultants. These are stateless bridges; their only per-session
  input is the env block, which is identical across sessions.
- Stays stdio (5): claude-flow (the memory mandate, ADR-2014 fail-closed
  semantics — kept per session deliberately), code-interpreter, aci-shell,
  codebase-memory (already daemon-backed), agentic-qe (candidate once its
  memory backend is pointed at RuVector).
- Projection: `agentbox-manifest mcp-hub-project` runs last in the boot
  `.mcp.json` sequence, so it works uniformly over projector-managed and
  bespoke entries without touching the ADR-2008 registry. It lifts each listed
  stdio definition into `$WORKSPACE/.mcp-hub-servers.json` (0600), rewrites the
  entry to `{"type":"http","url":"http://127.0.0.1:9720/<name>/mcp"}` and
  writes `/run/agentbox/mcp-hub.json`. Claude Code already consumes `http`
  and `sse` entries (`email-gateway`, `browser-gpu`).
- Expected: −17 GB RSS, −240 processes at 27 sessions; teammate spawn does 5
  node boots instead of 13.

### 3.3 Manifest-driven envelope

```toml
[resources]
cpus            = 56
cpuset          = "0-13,36-49,18-31,54-67"   # 14 cores + siblings per NUMA node; 16 threads left for host + sidecars
cpu_shares      = 1024
memory          = "256G"
memory_reserve  = "96G"
pids_limit      = 32768
shm             = "32G"

[resources.tmpfs]
run   = "256M"
npm   = "1G"
cache = "4G"
tmp   = "2G"

[resources.services]   # Phase 3: background split
cpu_shares = 256
nice       = 10
```

`flake.nix` `composeText` (≈ line 2356) emits `deploy.resources`, `cpuset`,
`cpu_shares`, `pids_limit` and the tmpfs list from this table. The
`system-manifest.js` catalogue entry carries apply class `boot` (compose
re-up), not `rebuild`.

### 3.4 Background weighting

- Phase 0 (live, no rebuild): `renice -n 10` the supervised background
  programs; `ionice -c3` the sweeps and condense scheduler.
- Phase 0 permanent: `command=nice -n 10 ...` on those `[program:*]` blocks
  in `flake.nix`.
- Phase 3: move them to the `agentbox-services` sibling (same image, a
  `AGENTBOX_PROFILE=services` supervisord include set) with `cpu_shares 256`,
  sharing the named volumes and `visionclaw_network`. This is the only way to
  get real cgroup weighting given the read-only cgroup mount.

### 3.5 Session hygiene

- `ruflo-daemon-gc` gains a teammate-idle policy: a `--agent-id` session with
  no tool call in 30 min and a lead that has exited is reaped, releasing its
  MCP set.
- Team spawn respects `swarm.maxAgents` (15) as a container-wide budget, not
  per lead.

## 4. Expected outcome

| Measure | Now | Target |
|---|---|---|
| CPU cap | 30 | 56 |
| Overhead CPU (hooks + MCP idle) | ≈7-8 cores | < 1 core |
| Usable agent CPU | ≈22 cores | ≈55 cores (≈2.5×) |
| Hook latency per Bash call | ≈7.6 s | < 50 ms |
| MCP processes per session | 13-14 | 4 |
| MCP RSS at 27 sessions | 25.3 GB | ≈5 GB |
| Teammate spawn node boots | 13 | 2 |

## 5. Phases and acceptance

| Phase | Change | Rebuild? | Acceptance |
|---|---|---|---|
| 0 | Remove `ruflo hooks pre/post-command` and `route` from the nine project settings; `renice` background programs; grow `~/.npm`/`~/.cache` tmpfs | no (compose re-up for tmpfs) | `pgrep -fc 'ruflo.js hooks'` stays 0 over 60 s; 10 s `cpu.stat` delta < 3 cores idle-team; `df ~/.npm` < 50 % |
| 1 | `agentbox-hook` shim + daemon spool drain; boot reconcile of project hook blocks | yes | Bash-call hook wall < 50 ms; ruflo metrics rows still arrive in RuVector (`memory_search` on `hooks` namespace shows post-command entries) |
| 2 | `agentbox-mcp hub` + `mcp-hub-project` boot step | yes | per-session stdio MCP count = 5; container RSS at 27 sessions < 14 GB; consultant/perplexity/ontology tools answer from a fresh session; `curl 127.0.0.1:9720/health` lists 10 servers |
| 3 | `[resources]` in manifest, `agentboxResources` compose projection, override stripped of limits; background `nice` | yes (compose re-up for the envelope) | `docker inspect agentbox` shows cpus 56 / cpuset / pids 32768; `ps -o ni` = 10 on dream-engine, sweeps, jupyter, code-server; `nr_throttled` delta 0 across a 10-min two-team burst |
| 4 | Teammate-idle reaper; container-wide agent budget | yes | no `--agent-id` process older than 30 min idle; sessions ≤ budget |

Phase 0 is a same-day change and returns roughly seven cores and 7.6 s per
tool call on its own. Phases 1-3 are independent of each other and can land
in any order.

## 6. Risks and open questions

- **Learning signal.** The spool must carry the same fields ruflo's hooks
  record today (`--track-metrics`, `--store-results`); verify with the recall
  gate (`./agentbox.sh ruvector recall`) after Phase 1.
- **Hub session semantics.** Claude Code opens one HTTP session per
  server per Claude session; the hub must honour `Mcp-Session-Id` and
  `DELETE` on close so a crashed teammate does not leak state. Servers that
  read `AGENTBOX_AGENT_DID` (aci-shell) stay stdio for this reason.
- **Loopback trust.** The hub is unauthenticated on 127.0.0.1, the same
  posture as `aoe serve :9095` (N-05). It must never be published.
- **NUMA placement.** `cpuset` without a matching `mems` policy still lets
  memory land on either node; acceptable for now, revisit if PSI memory rises.
- **Read-only rootfs.** The spool and hub sockets live on `/run` tmpfs;
  nothing new is written under `/opt` or `$HOME`.
- **cgroup v2 nesting** would be cleaner than a sibling container but needs
  `cgroupns=private` with a writable mount, which `read_only: true` currently
  prevents; parked.

## 7. Evidence

Commands used (all read-only, run inside the container on 2026-09-05):

```
cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/*.pressure
docker inspect agentbox --format '{{json .HostConfig}}'
docker stats --no-stream
ps -eo pcpu,rss,args | awk '...category rollup...'
ps -eo rss,args | grep <server> | awk '...avg RSS...'
time node .../ruflo.js hooks pre-command --command ls --validate-safety true
pgrep -f 'ruflo.js hooks'   # sampled 1/s for 20 s
grep -rl 'hooks pre-command' ~/workspace/*/.claude/settings.json
grep cgroup /proc/mounts; cat /sys/fs/cgroup/cgroup.subtree_control
df -h ~/.npm ~/.cache /tmp /run
```

## 8. Implementation record (2026-09-05)

Everything above except the `agentbox-services` sibling container is
implemented in the working tree and awaits the host rebuild
(`./agentbox.sh rebuild && ./agentbox.sh up`). Decision record: ADR-2034.

| Piece | Where |
|---|---|
| Hook shim, reconcile, drain | `services/agentbox-ops/src/hookspool.rs`, `src/bin/agentbox-hook.rs` |
| Teammate reaper | `services/agentbox-ops/src/teammates.rs`, `src/bin/teammate-gc.rs` |
| MCP hub | `services/agentbox-mcp/src/hub/{mod,child,config,rpc}.rs`, `agentbox-mcp hub` |
| Hub projection at boot | `services/agentbox-manifest/src/mcp_hub.rs`, `agentbox-manifest mcp-hub-project` |
| Boot wiring | `config/entrypoint-unified.sh` (hook reconcile after trust-seed; hub projection after the registry projector; `/run/agentbox/hooks`) |
| Manifest + schema + catalogue | `agentbox.toml [resources]`, `schema/agentbox.toml.schema.json`, `management-api/lib/system-manifest.js` (`resources-envelope`, `mcp-hub`, `hook-shim`, `teammate-gc`) |
| Image | `flake.nix`: `resourcesCfg` bindings, `agentboxResources` compose block, tmpfs sizes, `bgNice` on 12 background programs, `[program:agentbox-mcp-hub]`, `[program:agentbox-hook-drain]`, `[program:teammate-gc]`, runtime env `AGENTBOX_MCP_HUB*`, `AGENTBOX_HOOK_*`, `AGENTBOX_TEAMMATE_GC` |
| Override | `docker-compose.override.yml` no longer carries `deploy` limits or `shm_size` |

Applied live the same day, before the rebuild: `agentbox-hook reconcile` over
the workspace (10 files, 60 hooks rewritten, 8 route hooks dropped, shim
installed on the writable `~/workspace/.cargo/bin`), `renice -n 10` on the
background supervised programs, `ionice -c3` on the three sweeps, and the
`~/.npm` tmpfs emptied from 100 % to 1 %.

Post-rebuild verification, in order: boot log shows `[hook-shim]`,
`[mcp-hub] hub on: converted=… kept=…`; `supervisorctl status` lists the three
new programs RUNNING; `curl -s 127.0.0.1:9720/health`; a fresh Claude session
lists the consultant, perplexity and ontology tools; `docker inspect agentbox`
shows the envelope; then the §5 acceptance numbers.

The `agentbox-services` split stays deferred: the same image runs the
identity bootstrap against shared named volumes, and two containers doing so
concurrently needs its own design (one bootstrap, one waiter) before the
weighting gain is worth the risk. `nice` covers the interim.
