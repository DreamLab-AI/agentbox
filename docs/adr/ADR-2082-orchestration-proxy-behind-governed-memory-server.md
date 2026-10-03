---
id: ADR-2082
title: The governed claude-flow server forwards orchestration tools to a filtered ruflo child; memory never crosses
date: 2026-09-07
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 451823ca8ec0b5452ceb8fdc52e777f77a2bbc43
verified_paths: [mcp/servers/lib/orchestration-proxy.js, mcp/servers/ruvector-mcp.cjs, mcp/servers/lib/ruvector-gates.js, config/entrypoint-unified.sh]
owner: jjohare
review_trigger: next image rebuild (activation), a ruflo major bump that renames the swarm/agent/task/coordination tools, or any proposal to forward a memory_* tool
repo: agentbox
domain: LEARNING-memory
---

# ADR-2082 — The governed claude-flow server forwards orchestration tools to a filtered ruflo child; memory never crosses

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `config/entrypoint-unified.sh` changes only inside the compaction section (install/uninstall factrail, store migration, key projection). No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Re-verification — 2026-10-01 (dependency refresh)

ruflo moves to 3.47.0 without a second MCP registration. The same governed server owns memory; all 11 orchestration-proxy tests pass, including denied prefixes, category filtering, unavailable-child stubs and respawn. Live child compatibility remains a deployment check.
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Re-verification — 2026-09-29 (instruction-home migration)

The RV_ORCH_PROXY/RV_ORCH_TOOLS projection still configures the single governed claude-flow server. All 11 orchestration-proxy assertions pass with a fake child, including memory denial, missing-binary fallback and respawn. No second ruflo MCP registration was introduced. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

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

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Tripped by `config/entrypoint-unified.sh` alone (`0950527d3`, the ADR-2093 compaction block — 66 pure insertions elsewhere in the file); `orchestration-proxy.js`, `ruvector-mcp.cjs` and `ruvector-gates.js` are unchanged since the previous anchor. The boot projection is intact at `HEAD`: the gate and filter are read at `config/entrypoint-unified.sh:979-980` (`_ab_toml_bool integrations.ruvector_external orchestration_proxy` / `_ab_toml_val … orchestration_tools`) and projected into the `claude-flow` env block of `.mcp.json` at `:1115` (`RUVECTOR_ORCHESTRATION_PROXY`). Claim STILL TRUE.

## Re-verification — 2026-09-21 (`e57156a8ff72a4b84145b7de1d67d8d0c79fd41d`)

Tripped by `config/entrypoint-unified.sh` alone (`b680a7ae`, ADR-2094); the three `mcp/servers/**` paths are unchanged since the previous anchor, so the proxy's own logic — `DENIED_PREFIXES`, the alias table, the fail-open-for-orchestration-only rule — is untouched by this diff. ADR-2094's entrypoint edits are three insertions (a projector block at `:2026`, two consumer sites, and a `runtime-env.sh` line at `:2722`), all after the ruvector projection this record governs. Re-read at HEAD in a detached worktree: `:980` still reads `orchestration_tools` with `_ab_toml_val` and `:1115` still projects `RUVECTOR_ORCHESTRATION_PROXY` into the `claude-flow` env block of `.mcp.json`, which is the apply-class-`boot` mechanism decision point 6 claims. `bash -n config/entrypoint-unified.sh` → clean. Gate-off byte-identity is unaffected: nothing in the ADR-2094 additions reads or writes the ruvector gate. Claim STILL TRUE.

### Re-verified 2026-09-21 at 6669e9f3b22af1e2b651037cf39a4a551a346d3f

One governed path moved, `config/entrypoint-unified.sh`, in a COMMENT-ONLY hunk: `git diff 1639f86ab..6669e9f3b -- config/entrypoint-unified.sh` is 6 insertions and 1 deletion, all of them `#` lines. The ShellCheck directive above the jev-compaction plugin install carried its rationale inside the directive, which SC1125 rejects and which made ShellCheck ignore the whole directive; the rationale is now a separate comment above a bare `# shellcheck disable=SC2086`. No executable line changed anywhere in the file, and the shell ignores comments, so runtime behaviour is byte-identical. The entrypoint's role in this claim is the .mcp.json registration of the governed claude-flow server and the orchestration_proxy gate read; neither line is in the hunk, and the other three governed paths (orchestration-proxy.js, ruvector-mcp.cjs, ruvector-gates.js) did not move at all. Claim STILL TRUE.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `config/entrypoint-unified.sh`: exports `VAULT_REPO` (from `[vault].repo`, else derived from `VAULT_ROOT`; empty when unresolvable so the management API fails closed) and adds it to the vault-disabled `unset` list. Nothing else in boot order, gating or service start changed. **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Governed changes:** `ruvector-mcp.cjs` (`b25903ec8`, ADR-2111 D4) now shapes `memory_search` output (limit 5, `min_score` 0.55, 300-char snippets, protected namespaces excluded from `"*"`) and emits compact JSON; `config/entrypoint-unified.sh` moved for other records. `orchestration-proxy.js` and `ruvector-gates.js` did not move, so `DENIED_PREFIXES`, the alias table and fail-open-for-orchestration-only are untouched; the memory tools stay the governed ones. The projection still reads the gate/filter (`entrypoint-unified.sh:1054`, `_RV_ORCH_TOOLS`) into the `claude-flow` env block (`:1189-1190`).

**Deployment narrowed, Decision unchanged.** The running manifest sets `orchestration_tools = "swarm,agent"` (2026-09-25, ~185 tok/tool; `task`/`coordination` unused). The code default this record names is still `swarm,agent,task,coordination` (`orchestration-proxy.js:46`, `setup/agentbox.default.toml`, schema). Under the narrowed filter the Decision's own rule applies: `task_orchestrate` and `load_balance` (targets in `coordination`) are honest stubs in this deployment, so the first Consequence ("templates … `task_orchestrate` get real ruflo implementations") holds only for `swarm_*`/`agent_*` until an operator widens the filter. The catalogue summary (`management-api/lib/system-manifest.js:208`) still says it forwards `task_*`/`coordination_*`; that is the default, not this deployment. `node mcp/servers/lib/orchestration-proxy.test.js` → 11 passed. Claim STILL TRUE.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `config/entrypoint-unified.sh` changes only in Phase 3: an `AGENTBOX_IDENTITY_ROOT` default export before `nostr-pod-bridge bootstrap`, and a chown to devuser plus chmod 0600 of the bootstrap identity file after it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff caab741c6..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `config/entrypoint-unified.sh` changed only as follows. W0: the root boot `PATH` is store-only, the workspace cargo bin is appended for devuser shells only, Stage B is one-shot and the Docker socket is gated. W1: the role-custody lib is sourced, and the `/run/secrets` and supervisor-config steps are gated on `[security].role_isolation`; flag-off statements are verbatim (ADR-2122). The orchestration-proxy registration is untouched. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `config/entrypoint-unified.sh` gains the W2 role-env block (`_AB_ROLE_ENV_VARS`, `_ab_role_env_capture` before the identity bootstrap, `_ab_role_env_scrub` on the line before `exec supervisord`, `_ab_role_key_file_own` in Phase 5c). Every function returns at its first line unless `[security].role_isolation` is on, so the flag-off boot is unchanged (RC-X1-06 compares the environment handed to supervisord byte for byte). The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `config/entrypoint-unified.sh` changed in a comment and a log line (the config's new name, `760ed01e4`). W2's role-env capture now runs `mkdir -p` on the secrets root and `mkdir -m 0700` on the role dir (`3b5412963`). That fixes shellcheck SC2174 and behaves the same. Both changes are reached only with the flag on.
The orchestration proxy and its memory fence are untouched. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `config/entrypoint-unified.sh` (`dc91e092a`) gains `_ab_devuser_privilege_check` and its call after the docker-socket check; it reads files only and is a no-op with `[security].role_isolation` off. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `config/entrypoint-unified.sh` changes only in three custody blocks (ADR-2122, design 3.2). (1) A new at-rest step before Phase 3: `ab_custody_migrate` when `[security].role_isolation` is on, otherwise `ab_custody_revert`, which changes nothing on a volume that was never migrated (`tests/config/role-custody-migrate.test.sh` shows the stat set, ctime included, byte-identical). (2) Under the flag only, the volume-root chown loop skips `/var/lib/agentbox/secrets`. (3) After the identity bootstrap, the identity file goes to ab-identity 0400 under the flag; with the flag off, the devuser 0600 statements are unchanged. The orchestration-proxy registration is untouched. The decision holds. Re-verified by `git log dc91e092a..f93586b9e -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo-console gate, `451823ca8`)

`f93586b9e..451823ca8`: `config/entrypoint-unified.sh` adds the ruflo-console boot block after factrail's, and factrail's function-hook switch and `agentbox` marketplace removal also respect the new gate; with it off both behave as before. Nothing this record governs (ADR-2082 — The governed claude-flow server forwards orchestration tools to a filtered ruflo child; memory never crosses) changes meaning. The decision holds. Re-verified by `git log f93586b9e..451823ca8 -- <verified_paths>`.
