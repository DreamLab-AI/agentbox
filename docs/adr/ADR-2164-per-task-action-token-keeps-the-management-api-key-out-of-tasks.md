---
id: ADR-2164
title: A per-task action token keeps the Management API key out of tasks
date: 2026-11-01
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 9709cd3fe512135c1dec7245c252817ef97ec617
verified_paths: [config/hooks/trajectory-recorder.cjs, mcp/consultants/shared/consultant-base.js, management-api/lib/task-action-tokens.js, management-api/middleware/auth.js, management-api/lib/agent-event-auth.js, management-api/routes/agent-events.js, management-api/utils/process-manager.js]
owner: jjohare
review_trigger: any new route a task needs to call, or any change to the Management API auth gate or auth modes
repo: agentbox
evidence_class: test
acceptance_boundary: Jest suites tests/sovereign/task-action-token*.test.js drive the real gate and route under the default nip98 policy with a mocked spawn. Not shown - a live task spawned in the running container, since the live management-api was deliberately not restarted.
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
