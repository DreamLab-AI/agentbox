---
id: ADR-2164
title: A per-task action token keeps the Management API key out of tasks
date: 2026-11-01
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: b3d4367d4f50c158f5bc86184419529563ea5d45
verified_paths: [config/hooks/trajectory-recorder.cjs, config/entrypoint-unified.sh, management-api/lib/trajectory-store.js, mcp/consultants/shared/consultant-base.js, management-api/lib/task-action-tokens.js, management-api/middleware/auth.js, management-api/lib/agent-event-auth.js, management-api/routes/agent-events.js, management-api/utils/process-manager.js]
owner: jjohare
review_trigger: any new route a task needs to call, any change to the Management API auth gate or auth modes, or a hook that gains a way to sign NIP-98
repo: agentbox
evidence_class: test
acceptance_boundary: Jest suites tests/sovereign/task-action-token*.test.js drive the real gate and route under the default nip98 policy with a mocked spawn. Not shown - a live task spawned in the running container, since the live management-api was deliberately not restarted, and a live Postgres (the pool is a recording fake; the SQL text and parameters are pinned, not executed).
---

# ADR-2164 — A per-task action token keeps the Management API key out of tasks

## Context
`spawnTask` withholds `MANAGEMENT_API_KEY` from the child (IR3), so the trajectory recorder
and the consultant emitter could not authenticate their in-task `POST /v1/agent-events/emit`.
Giving a task the key would hand it every Management API route. The task needs a credential
that proves only "I am task T" and can post only T's actions. `spawnTask` has no task
timeout; the only timer is the 10 s SIGTERM→SIGKILL grace in `stopTask`.

## Decision
- Mint at spawn (after input validation and the ZAI check): 32 bytes of `crypto.randomBytes`,
  base64url, opaque. Server memory holds SHA-256(token) → `{taskId, expiresAt}`; lookup is by
  digest with `crypto.timingSafeEqual`. No JWT, no signed envelope. Child env gets
  `TASK_ACTION_TOKEN` (and the non-secret `MANAGEMENT_API_PORT`), never the key.
- It is a third credential type on the existing gate (`middleware/auth.js`), not a second
  gate. Scope: `POST /v1/agent-events/emit` and `/batch` only, matched on the registered
  route pattern; 403 elsewhere; 401 unknown/expired/revoked/missing.
- It proves a task, not an identity. The route stamps the token's `taskId`, rejects a
  different `taskId`, rejects asserted `source_urn`/`pubkey`, and rejects a whole batch on
  any violation. `verifyAgentEventRequest` accepts it under every policy.
- Revoked on exit, error and `stopTask`; TTL backstop 4 h, `TASK_ACTION_TOKEN_TTL_MS`.
- Sovereign mode: accepted under `strict-nip98` as the one non-NIP-98 credential, confined as above.
- Callers use the operator key when present, else the token; the consultant emitter's early
  return is gone and it names its `taskId`.

## Consequences
- Tokens are in-memory: a management-api restart revokes all, so a running task's later posts 401 (fail closed, recorder is fail-open).
- A task process can read its own token and post bogus actions for its own task; it cannot touch another task or any other route.
- Unattributed identity: task actions carry no `did:nostr`.

## Verification
`cd management-api && jest -c package.json tests/sovereign/task-action-token` (22 tests; 11 and 2 fail against the previous sources).

## Amendment — 2026-11-01 (owner decision): trajectory writes go through the API
Owner decisions: inside a task the trajectory recorder posts through `TASK_ACTION_TOKEN` and the API writes Postgres; no database credential or recorder gate variable ever enters a task; the token TTL stays 4 h, revoked on exit.

**Why the allowlist was not enough.** `spawnTask`'s env carried no `PG*` or gate variable, but the recorder is a `Stop` hook registered in `~/.claude/settings.json`, and a task inherits `HOME`, so its `claude` child ran that hook. The registered command inlined `RUVECTOR_PG_CONNINFO` (with the password, defaulting to `ruvector`) and both gates, and the recorder itself defaulted to `ruvector:ruvector`. A task therefore held database credentials by another door.

**Decision.**
- One write path: `POST /v1/agent-events/trajectory`, a sibling of emit/batch (those carry a strict visualisation envelope and publish to the websocket; trajectory rows are a different payload) and a fourth entry in `TASK_TOKEN_ROUTES`. It is not an attributed agent action, so the global gate alone authenticates it: the operator credential or a task token; no per-agent `did:nostr` is asserted.
- `management-api/lib/trajectory-store.js` is the only code that writes `trajectories` / `trajectory_steps`: the same statements and parameters the recorder used, in one transaction, through the memory adapter's pool (`adapters.memory` = `external-pg`, one conninfo, no second read of it). `503` when the memory slot is anything else, `400` on a malformed post or a step id outside the posted trajectory id, `500` and a rollback on a database error.
- The recorder keeps deciding row content (ids, `step_order`, result JSON, cumulative rollup from its stash) and posts it fully formed. Its pg client, `RUVECTOR_PG_CONNINFO`, default password and gate reads are deleted. Enablement is registration: the entrypoint registers the hook only when `[memory_learning]` `enabled` and `record_trajectories` are both true and de-registers it otherwise; the registered command carries only the public `AGENTBOX_PUBKEY` and `AGENTBOX_AGENT`.
- No parallel path: an operator session posts with `MANAGEMENT_API_KEY` to the same route. The watermark advances only on a 2xx (ADR-2015); this run's CTC bodies are not emitted when the persist failed, since the retry rebuilds them.
- Consultant emitter: `claude` 2.1.309 hands its own environment to the stdio MCP servers it spawns (probe: `TASK_ACTION_TOKEN`, `TASK_ID` and `MANAGEMENT_API_PORT` reached a spawned `sh`), so the token reaches the emitter with no spawn change.

**Consequences.**
- Under `strict-nip98` (sovereign mesh) an operator session holds only the Bearer key, so the route answers 401 and operator trajectories are not recorded (the watermark stays; every Stop retries) until a hook can sign NIP-98. Before this change the direct connection worked there. The CTC emit already had this limit. Task posts are unaffected.
- A token holder can post a trajectory under any session id (ids derive from the session, not the task), so it can add rows or roll up another session's trajectory. It can read nothing and reach no other table; the same-UID boundary already lets it do worse.
- `routing-label-recorder.cjs` (ADR-2110, off by default) still inlines the same conninfo in its registered command; it is a separate hook and is not changed here.

**Verification.** `tests/sovereign/task-trajectory-ingest.test.js` (route and recorder end to end against a recording pool) and `tests/sovereign/task-trajectory-env.test.js` (task env, generated hook command, grep-pin, consultant emitter in a spawned env); the watermark cases in `tests/sovereign/learning-evidence-closeout.test.js`.
