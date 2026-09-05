---
id: ADR-2041
title: Wire the execution journal and action pipeline onto POST /v1/tasks
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: a second route or MCP tool needs to become an AgentAction, or task-spawn's `local` classification is challenged by a real incident
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2041 — Wire the execution journal and action pipeline onto POST /v1/tasks

## Context

`execution-journal.js:85` (`ExecutionJournal`, ADR-057) and `agent-action-pipeline.js:58`
(`AgentActionPipeline`, ADR-059) were complete, tested implementations with zero production
call sites: the only non-test require was `execution-coverage.js:20,22`, reading static
constants and always reporting `status: 'declared'` (AB-14.1, AB-14.8). AB-14.2 and AB-14.7
show the full nine-stage/D1-D5 machinery coded but "never reached by real traffic".
GOVERNANCE-capabilities.md's "Known divergences #1 — TOP OPEN RISK" (lines 199-206) names
this the governance gap: autonomy is live, the governor that would police it is not wired.

## Decision

`management-api/lib/action-plane.js` (new) owns a lazy singleton `ExecutionJournal` +
`AgentActionPipeline`, resolving the events adapter via `loadManifest()` →
`resolveAdapters(manifest)` (the same path server.js uses). `routes/tasks.js`'s
`POST /v1/tasks` calls `dispatchTaskSpawn()`: the pipeline's executor performs the real
`processManager.spawnTask(...)` inside the protected executor seam, so the spawn only
happens after classify/guard and a capability token exist. Every task-spawn action is
minted a real `session_urn` (`uris.mint({kind:'meta', ...})`, never an ad-hoc template
literal) and an `agent_did` resolved honestly: verified `request.auth.pubkey` first, then
the (unverified, defensively-read) `X-Agentbox-Pubkey` header ADR-2042 is wiring
separately, then this container's own `AGENTBOX_AGENT_DID`, then `null`.

Fail-closed (PHASE2 policy 1): ADR-005's "off" events adapter deliberately no-ops
`dispatch()` without throwing, so `ExecutionJournal`'s own constructor guard alone would
accept it and silently drop every event. `action-plane.js` adds a stricter check —
`adapters.events._implName === 'off'` (or no `dispatch()` at all, or adapter/manifest
resolution throwing) — and refuses to build the pipeline; `routes/tasks.js` then replies
503 rather than spawning unjournalled. No dev-profile flag exists anywhere in agentbox
today to relax this (grepped `AGENTBOX_DEV*` / `dev_profile` / `dev-profile` / `dev_mode`
across the repo — none found), so the refusal is unconditional; inventing a new flag was
out of this ADR's scope.

Task-spawn is classified `side_effect_class: 'local'` — a mutation confined to the
agent's own task workspace/process (task dir, log file, a process under the local
orchestrator), not a `read`, but also not `mutate`/`egress`/`secret`/`spend` (those remain
approval-gated by ADR-059 D3 and no approver is wired here). `local` is in `FAST_PATH`, so
the action is still fully journalled through `record` but does not additionally require an
approval receipt — this ADR wires the journal and the pipeline's stage machinery onto a
real route; it does not build the (separately-scoped) human/ACSP approval flow that a
`mutate` classification would require.

The capability-token secret is `AGENTBOX_ACTION_PIPELINE_SECRET`; when unset, a random
per-boot secret is minted and one clear warning is logged (tokens do not survive a
restart). `execution-coverage.js` gains `buildLiveExecutionCoverage()`, which feeds
`action-plane.js`'s real singleton into the unchanged `buildExecutionCoverage(live)` (its
"declared by default" pure-function contract, and its existing contract test, are
untouched). `routes/system.js` does not call the new function yet — that one-line wiring
(`options.execution.snapshot`) is `server.js`'s route registration, outside this ADR's
file ownership; see Consequences.

## Consequences

- **Narrower than the governance gap.** GOVERNANCE-capabilities.md's divergence #1 names
  every agent-initiated side effect (tool calls, MCP plugin tools, consultant/subagent
  actions, background jobs, alternate harness paths) as unguarded by a single decision
  point. This ADR closes that gap for exactly one surface, `POST /v1/tasks`. The
  divergence bullet should be narrowed, not deleted, by whoever next amends
  GOVERNANCE-capabilities.md (out of this ADR's file scope — flagged to the domain owner).
- **`/v1/system` still under-reports until `server.js` is touched.** `buildLiveExecutionCoverage()`
  exists and is verified correct (see Verification), but `routes/system.js` calls
  `buildExecutionCoverage(live)` with `live` sourced from `options.execution.snapshot()`,
  and `server.js` never passes an `execution` option to that route registration. A future
  one-line change (`execution: { snapshot: () => require('./lib/action-plane').getCoverageSnapshot() } }`)
  in `server.js`, owned by `ab-runtime`, completes this.
- **`local` is a rollout choice, not a permanent verdict.** Spawning an autonomous agent
  process is exactly the "recursive spawn" risk GOVERNANCE-capabilities.md's divergence #1
  names. Classifying it `local` (fast path, no approval) keeps `POST /v1/tasks` working
  unchanged for existing consumers while making it fully journalled; a future ADR may
  reclassify it `mutate` once a real approver (human/ACSP) exists, per ADR-059 D5's
  "per-adapter rollout with an audited, measured coverage matrix".
- **Two idle events-adapter instances exist post-change**: `app.adapters.events`
  (decorated by `server.js`, still has zero other dispatch call sites) and
  `action-plane.js`'s own `resolveAdapters()` result (the one now actually used). No
  concurrent-writer conflict today because only the latter ever calls `dispatch()`; a
  future consolidation could inject `fastify.adapters.events` instead, but that requires
  `server.js` to pass it through route options, again outside this ADR's file ownership.
- **Capability-token secret is ephemeral by default.** Operators who want tokens to
  survive a `management-api` restart must set `AGENTBOX_ACTION_PIPELINE_SECRET`; this does
  not affect the journal, which is durable via the events adapter regardless.

## Verification

```
cd agentbox/management-api && npx jest --rootDir .. \
  tests/contract/agent-action-pipeline.contract.spec.js \
  tests/contract/execution-journal.contract.spec.js \
  tests/contract/execution-coverage.contract.spec.js
# → Test Suites: 3 passed, 3 total / Tests: 41 passed, 41 total
```

```
node -e "require('./management-api/lib/action-plane.js')"   # exits 0, loads clean
node -e "require('./management-api/routes/tasks.js')"        # exits 0, loads clean
```

End-to-end smoke (isolated manifest, `events = "local-jsonl"`, other adapters `off`,
avoiding this dev sandbox's unrelated `better-sqlite3` Node-ABI mismatch): `dispatchTaskSpawn()`
against a fake `processManager.spawnTask` returned
`{ready:true, decision:'allow', output:{taskId,taskDir,logFile}}`, appended one real,
hash-chained JSONL record (`kind: "exec.tool.completed"`, `side_effect_class: "local"`,
correct `agent_did` from `request.auth.pubkey`), and `buildLiveExecutionCoverage()` then
reported `journal.status: "live"` with that session in `sessions` and
`action_pipeline.status: "live"`. Re-running with the manifest pointed at a missing path
(→ every adapter slot resolves `off`) returned
`{ready:false, reason:"events adapter is not live (impl=off) — refusing to spawn a task unjournalled"}`
and `routes/tasks.js` maps that to a 503, never a silent spawn.

`node --test tests/contract/agent-action-pipeline.contract.spec.js` and
`tests/contract/execution-journal.contract.spec.js` (the exact commands specified for this
task) fail with `ReferenceError: describe is not defined` — both suites are Jest specs
(`management-api/package.json`'s `jest.roots` includes `tests/contract`), not
`node:test` files; `node --test` is the wrong runner for them. They pass under `npx jest`
above. `tests/contract/execution-coverage.contract.spec.js` was not in this task's
mandated check list but was run anyway since `execution-coverage.js` was touched; it
passes unchanged, confirming `buildExecutionCoverage()`'s "declared by default" contract
is untouched.

Verification ran on the uncommitted agentbox working tree above `verified_commit`
(agentbox's own `HEAD`, a submodule of the outer VisionClaw repo) and must be re-run at
the landing commit.
