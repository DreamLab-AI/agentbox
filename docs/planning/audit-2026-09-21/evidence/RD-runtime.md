# RD-runtime: what the running agentbox container actually does today

Scope: live process state, HTTP health, MCP registration reality, and 18-day usage
history for the container this session is running in, checked against
`agentbox.toml`, `docs/BASELINE-container.md` and `agentbox/CLAUDE.md`. Commands run
2026-09-21 from `/home/devuser/workspace/project/agentbox` unless stated. All output
quoted below is live command output, not documentation.

## 1. Gate-by-gate table

Source for "enabled?": `agentbox.toml` (line cited). Source for "running/healthy?":
`supervisorctl status`, `ss -tlnp`, and a direct curl/probe. Source for
"catalogue state": `GET /v1/system` (management-api, `agentbox.toml:1571` auth via
`MANAGEMENT_API_KEY` bearer — confirmed working, see §2).

| Gate | agentbox.toml | Program | Running? | Healthy? | Last error / note |
|---|---|---|---|---|---|
| `[sovereign_mesh]` | `enabled=true` (:24) | management-api, nostr-relay | RUNNING (both) | relay listens `127.0.0.1:7777` (`ss -tlnp`) | ws-only, no HTTP health page — expected |
| `[sovereign_mesh.relay]` | `enabled=true` (:118) | nostr-relay | RUNNING pid 386 | listener confirmed on 7777 | allowlist has 5 hex pubkeys (:123-131) |
| `[sovereign_mesh.voice_intent]` | `false` (:40) | — | n/a | n/a | POST /v1/voice-intent → 503 by design |
| `[sovereign_mesh.kg_elevation]` | `true` (:44) | management-api route | RUNNING (rides management-api) | not independently probed | rides the management-api process, not a separate program |
| `[sovereign_mesh.junkiejarvis]` | `false` (:59) | — | n/a | n/a | needs env `JUNKIEJARVIS_ENABLED=true` too |
| `[sovereign_mesh.per_user_agents]` | `false` (:83) | — | n/a | n/a | — |
| `[sovereign_mesh.git]` | `enabled=true` (:169) | management-api `/pods/:npub/.git/*` | rides management-api | not probed | — |
| `[sovereign_mesh.multi_user]` | `enabled=false` (:181) | — | n/a | n/a | — |
| `[mesh]` federation | `mode="standalone"` (:200) | — | n/a | n/a | loopback-only, matches relay `bind=127.0.0.1` |
| `[ontology_monitor]` | `enabled=true, mode="publish"` (:116-117) | SessionEnd hook (not a daemon) | fires per-session | untested this run | hook-based, not a supervised program |
| `[networking].tailscale` | `true` (:264) | tailscaled, tailscale-up | tailscaled RUNNING; tailscale-up EXITED (Sep 18, one-shot) | — | exit is expected — it's a run-once `up` command, not a daemon |
| Loom façade (external, not a local gate) | n/a | remote on HP (192.168.2.132:8084) | reachable | **healthy** — see §5 | `backend_reachable:true`, 8146 classes, 282,492 triples loaded |
| `[voice]` | **`enabled=false`** (:1681) | docker compose voice stack | **4 containers RUNNING** (`agentbox-voice-frontend-1`, `agentbox-voice-backend-1`, `voice-console`, `agentbox-voice-traefik-1`, all "healthy"/"Up 9-11 days") | healthy per `docker ps` | **manifest says off, reality says on** — see §2 finding |
| `[features.jev_compaction]` | present (:622) | Claude Code plugin (in-process, not a program) | active per plugin config | not independently testable from CLI | egress carve-out for email-tainted sessions documented in-file |
| `[skills.routing].router="jev"` | present (:877) | `config/hooks/skill-route.cjs` on UserPromptSubmit | fires per-turn | working — this session's skill list was populated | — |
| model-router console | baked (`/opt/agentbox/model-router`) | static file server on :8080 | **RUNNING** — `ss -tlnp` shows `0.0.0.0:8080` node pid 1142 | HTTP 302 (redirect, normal for a console SPA) | — |
| `[skills.ruvnet_brain]` | present (:737) | ruvnet-brain-mcp stdio server | binary present at `/nix/store/.../ruvnet-brain-mcp`, **not registered in any active `.mcp.json`** (see §3) | n/a | this session shows it as "failed to connect" — it is not configured at all in the files that matter, so "failed" undersells it: it's absent |
| management-api | `MANAGEMENT_API_PORT=9090` (env, confirmed) | management-api | RUNNING pid 383, port 9090 + metrics 9091 | **HTTP 200 with bearer auth** | `docs/BASELINE-container.md:54` says port **4000** — that line is stale; live env and `server.js:43` agree on 9090 |
| nip98-proxy | baked, supervised | nip98-proxy | RUNNING pid 399, port 9096 | HTTP 401 on `/health` without a NIP-98 header (correct — sole-ingress gate is working as designed) | — |
| AoE serve | `[interaction_plane]` | aoe-serve | RUNNING pid 391, loopback 9095 | HTTP 200 on `/health` | — |
| dream-engine | supervised | dream-engine | RUNNING pid 524 | listens on a **dynamic loopback port** (`127.0.0.1:49172` this boot) — no fixed port in docs to probe against | — |
| opf-router | supervised (redaction sidecar per BASELINE-container:253) | opf-router | RUNNING pid 873, loopback 9092 | not probed further | doc note confirms it is the privacy-filter sidecar, not an OpenAI façade — historical doc bug already fixed |
| browsercontainer | sidecar | (external container) | reachable | `{"status":"ok","chrome":true,"sessions":8,"cdp":"127.0.0.1:9222"}` | healthy, 8 live CDP sessions |
| ruvector-postgres | mandatory adapter | sidecar | RUNNING | `./agentbox.sh ruvector status`: image `2.0.5` matches toml pin exactly, extension 0.3.0, Postgres 17.9, **194,210 memory rows** | pin matches — no drift |
| email gateway | external svc | email-mcp-gateway:8765 | reachable | HTTP 200 on `/health` | healthy |
| codebase-memory MCP | registered | codebase-memory-mcp | RUNNING (loopback 9749) | tool calls answered during this audit | — |

## 2. "On but broken" — ranked by how often the owner would hit it

1. **Voice stack running while `agentbox.toml` says `enabled = false`.** Four
   Docker containers (`agentbox-voice-frontend-1`, `agentbox-voice-backend-1`,
   `voice-console`, `agentbox-voice-traefik-1`) have been up 9-11 days and are
   reported "healthy" by `docker ps`, yet `[voice].enabled = false` at
   `agentbox.toml:1681`. This is the opposite of most drift (a feature the
   manifest disclaims is actually live and consuming resources/attack surface on
   `:8444`/`:8443`). The owner would hit this constantly if they trust the
   manifest as ground truth — it under-reports what's exposed. Voice has its
   own lifecycle (`./agentbox.sh voice`, docker-compose.voice.yml) separate from
   `agentbox up`, so this is a stale-manifest-vs-manually-started-sidecar gap,
   not a boot-path bug — but it means `agentbox.toml` cannot currently be trusted
   as the source of truth for "is voice on".
2. **`docs/BASELINE-container.md:54` cites management-api on port 4000; it is
   actually 9090** (confirmed via `MANAGEMENT_API_PORT` env, `server.js:43`, and
   a working curl). Anyone following that doc line to probe the API by hand
   gets a connection refusal and no clue why. Low effort to fix (one-line doc
   edit) but it's the exact kind of thing that costs an operator 10 minutes
   mid-incident.
3. **`ruflo` (claude-flow) is one release behind** (v3.41.0 running,
   v3.42.4 latest per `claude-flow doctor`) and **its own memory.db/daemon
   are not initialized** ("Memory Database Presence: Not initialized",
   "Daemon Status: Not running", "MCP Servers: No MCP config found"). This
   doesn't break the RuVector-backed memory path this estate actually uses
   (`external-pg` adapter, 194,210 rows, confirmed live) — but it does mean
   any workflow that assumes claude-flow's own local sqlite memory or daemon
   is present will silently no-op. Matches the SessionStart hook warning seen
   at the top of this session: `@claude-flow/memory not resolvable... 
   self-learning imports are DISABLED`.
4. **7 MCP servers reported "failed to connect" this session**
   (`consultant-antigravity`, `consultant-codex`, `consultant-deepseek`,
   `consultant-perplexity`, `perplexity`, `ruvnet-brain`, `web-researcher`) —
   see §3 for the full breakdown. The practical impact: none of these are
   actually registered in any `.mcp.json` this profile reads
   (`~/.claude/.mcp.json` has exactly one server, `codebase-memory-mcp`;
   the baked `skills/mcp.json` defines all 28 including these 7, but that
   file is a *catalogue*, not what's live). `~/.claude/settings.json` has a
   single hand-written `consultant-codex` entry pointing at a **stale,
   non-existent path** — `/home/devuser/workspace/agentbox/mcp/consultants/codex/server.js`
   (missing the `project/` segment the real tree uses) and a pinned nix-store
   codex binary (`0.128.0`) that predates the currently-installed `0.153.3`.
   That single entry violates the explicit rule in `agentbox/CLAUDE.md`
   ("Never write a `/nix/store/...` path into persistent config... make the
   registration self-healing") — it's exactly the class of bug that section
   warns about, just recurring in `~/.claude/settings.json` instead of
   `.mcp.json`. Fixing it is cheap (delete the stale entry; let the projector
   re-register from the manifest) but it currently means any session started
   from this profile carries one guaranteed-broken MCP server by default.
5. **`AGENTBOX_CONSULTANTS_ENABLED` is not set** in this container's
   environment, so the projector never registers the five `[consultants]`
   servers (`agentbox.toml:1207-1253`) even though API keys for all of them
   (OpenAI, Perplexity, DeepSeek, Google) are present in the environment —
   keys are provisioned but the feature gate that would use them is off.
   Whether that's intentional (cost control) or an oversight is not
   determinable from the container alone.
6. **Skill live-set is much smaller than what's registered or baked.**
   `skills/registered-skills.txt` names 57 skills; `/opt/agentbox/skills` bakes
   137 directories (doc says 127 — another stale count, though closer);
   `~/.claude/skills` (what this profile actually sees) holds only 23. Agent
   registration is clean by contrast (12 registered → 12 `.md` files baked in
   `/opt/agentbox/agents`, matching `~/.claude/agents`) — so the skill
   reconciler and the agent reconciler are not in the same state of repair.

## 3. MCP registration reality vs the 7 reported failures

Checked every `.mcp.json` reachable from this profile plus
`~/.claude/settings.json`:

| Server | In `skills/mcp.json` (catalogue) | In `~/.claude/.mcp.json` (live, root) | In `project/.mcp.json` | In `~/.claude/settings.json` | Gate state |
|---|---|---|---|---|---|
| consultant-antigravity | yes, stdio via `agy` | no | no | no | gated on `AGENTBOX_CONSULTANTS_ENABLED` (unset) |
| consultant-codex | yes, stdio via `codex` | no | no | **yes — stale path + stale nix pin** | gate unset AND the settings.json copy is broken independently |
| consultant-deepseek | yes, stdio, needs `DEEPSEEK_API_KEY` | no | no | no | key present, feature gate unset |
| consultant-perplexity | yes, stdio, needs `PERPLEXITY_API_KEY` | no | no | no | key present, feature gate unset |
| perplexity (official) | yes, needs `PERPLEXITY_API_KEY` | no | no | no | key present; entrypoint only registers it "when `PERPLEXITY_API_KEY` is set" per the catalogue note — but it isn't live in any `.mcp.json` this profile reads, so that registration step did not run for this profile |
| ruvnet-brain | **not present** (`None`) in `skills/mcp.json` at all | no | no | no | binary exists on disk (`/nix/store/.../ruvnet-brain-mcp`) but nothing wires it into any config this session can see |
| web-researcher | yes, gated `skills.research.web_researcher` | no | no | no | binary present, package-gated; not live |

`~/.claude/.mcp.json` — the file the root session actually loads — contains a
single entry, `codebase-memory-mcp`, pointed at a real nix-store path. Every
one of the 7 "failed to connect" servers in this session's tool list is
therefore coming from somewhere outside the per-profile `.mcp.json` chain —
most plausibly the team/mesh harness that spawned this teammate process
requested the full 28-server catalogue regardless of what the container's own
projector would have registered. The practical conclusion for the owner's
**solo daily-driver use** (not team/mesh mode): none of these 7 would show up
as "failed" at all, because 6 of them are never registered by the projector
while their feature gates are off, and the 7th (`ruvnet-brain`) isn't wired in
anywhere. The one real, container-native bug is the stale `consultant-codex`
entry sitting directly in `~/.claude/settings.json`.

## 4. What a rebuild would change right now

- `git status --porcelain` on `/home/devuser/workspace/project` (the parent
  checkout) shows only ` M agentbox` (submodule pointer state) and one
  untracked `.dream-standby` marker file at the repo root. The submodule
  diff is a detached-ref artefact (`git submodule status` reports the
  worktree is on `archive/feature-high-perf-networking-1021-gc44678323` at
  the same commit as `HEAD` inside `agentbox/`) rather than uncommitted
  content — there is **no uncommitted manifest drift** blocking a rebuild
  right now. `agentbox/CLAUDE.md`'s bind-mount warning ("builds from inside
  this container bake stale image code") is the standing risk to flag, not
  an active one: nothing in `agentbox.toml` differs from what's checked in.
- A rebuild **would** pick up: ruflo v3.42.4 (currently v3.41.0 live, one
  version behind per `claude-flow doctor`), and whatever the current
  `docs/BASELINE-container.md:54` port-4000 / actual-9090 and skills-count
  (127 documented vs 137 baked) corrections need — those are doc-only fixes
  that don't need a rebuild, just a doc edit.
- A rebuild would **not** by itself resolve the voice-stack manifest/reality
  gap (§2.1), because voice has its own lifecycle outside `agentbox up`/
  `rebuild` — the compose stack has to be explicitly stopped or the manifest
  flipped to `true` to make the two agree.
- A rebuild would **not** fix the stale `consultant-codex` entry in
  `~/.claude/settings.json`, since that file is a host-mounted, persistent
  config the entrypoint does not overwrite wholesale (only registers/repairs
  entries it owns via the projector) — it needs a manual edit or a
  self-healing check added per the `agentbox/CLAUDE.md` "Never write a
  `/nix/store/...` path into persistent config" rule.

## 5. Loom façade and adjacent externals

`curl http://192.168.2.132:8084/health` (6s timeout) returned a fully healthy,
detailed façade status: `mode:"scaffold"`, backend `http://127.0.0.1:8085/v1`
reachable, ontology graph loaded (`ontology.ttl` + `ontology-inferred.ttl`,
282,492 triples, 8,146 classes), serving bundle `phase:"served"`,
`atomicity_verified:true`, and a live confidence window
(`requests:1000, engaged:997, verbatim:3, mean_confidence:0.997`). One soft
flag inside the payload: the embedding qualification block reports
`ready:false` with `rejections:["artefact declares no embedding model;
contract requires \"bge-small-en-v1.5\""]` — the served scaffold/prose
artefacts are working, but a downstream artefact used for semantic
qualification is missing its `model_id` stamp. Not user-visible in the
`ok:true` façade response, but worth flagging since it is a data-contract gap
the owner's memory-first pattern depends on (bge-small-en-v1.5 is the
estate-standard embedder).

## 6. Container usage pattern (18-day session history)

Session logs for this exact project path
(`~/.claude/projects/-home-devuser-workspace-project-agentbox`) span
2026-08-25 to 2026-09-21: **242 session files total, active on 18 distinct
days** out of the ~28-day window, with a clearly bursty pattern rather than
steady daily use:

```
2026-08-25   1     2026-09-05  19     2026-09-13   2
2026-08-27   1     2026-09-06   2     2026-09-16   2
2026-08-28   3     2026-09-07  11     2026-09-18   1
2026-08-31   9     2026-09-08  17     2026-09-20   8
2026-09-02  10     2026-09-09  16     2026-09-21  28 (today, in progress)
2026-09-03  12     2026-09-10   1
                    2026-09-11   1
```

Peaks on 09-05, 09-08 and 09-09 (governing-doc/ADR consolidation dates match
the git log in the system reminder — "sovereign settlement" ADR pack
2096-2103, PRD-024/DDD-022) line up with heavy multi-session bursts (16-19
files/day), consistent with swarm/team fan-out rather than one linear
session. Long quiet stretches (09-11 to 09-16, one session every few days)
suggest the tool is used in concentrated work sprints on specific features,
not as a continuously-running daily assistant — closer to "burst-driven
project tool" than "always-on daily driver" by this metric alone, though this
audit only counted files, not turn-level engagement within each burst.

## 7. Five cheapest fixes with the largest daily-driver payoff

1. **Delete/repair the stale `consultant-codex` entry in
   `~/.claude/settings.json`** (`/home/devuser/workspace/agentbox/mcp/...`,
   wrong path segment, nix-store pin two versions old). One-line edit,
   removes a guaranteed-broken MCP server from every session on this profile.
2. **Fix `docs/BASELINE-container.md:54`**: management-api port is 9090, not
   4000 (confirmed live). One-line doc edit; directly undermines anyone using
   the doc to hand-probe the API during an incident.
3. **Resolve the voice-stack manifest/reality mismatch**: either flip
   `[voice].enabled = true` in `agentbox.toml` to match the four
   long-running healthy containers, or stop the compose stack if it's meant
   to be off. Currently the single most-visible "manifest lied" surface —
   anyone reading `agentbox.toml` to answer "is voice running" gets the
   wrong answer.
4. **Reconcile the skills live-set**: 57 registered vs only 23 present in
   `~/.claude/skills` is a big gap versus the clean 12-registered/12-baked
   agent reconciliation. Worth running the skills reconciler and diffing
   against `skills/registered-skills.txt` to see what's silently missing
   from discovery.
5. **Decide on the consultant gate**: `AGENTBOX_CONSULTANTS_ENABLED` is
   unset while four provider API keys (OpenAI, Perplexity, DeepSeek, Google)
   already sit in the environment doing nothing. Either flip the gate on (the
   keys are already paid-for/provisioned) or document why it's deliberately
   off, so the next audit doesn't re-flag it as drift.

---
Commands and file:line citations used throughout are reproducible from
`/home/devuser/workspace/project/agentbox` with the same environment; the
`GET /v1/system` JSON pull (28KB) and `docker ps`/`ss -tlnp` outputs are not
reproduced verbatim here for length but were captured during this audit.
