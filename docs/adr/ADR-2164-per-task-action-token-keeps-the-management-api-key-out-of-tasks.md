---
id: ADR-2164
title: A per-task action token keeps the Management API key out of tasks
date: 2026-11-01
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: a8186a8e366bb51281043c8bb14801819025c2e8
verified_paths: [config/hooks/trajectory-recorder.cjs, config/hooks/routing-label-recorder.cjs, config/entrypoint-unified.sh, management-api/lib/pg-config.js, management-api/lib/routing-label-store.js, management-api/lib/trajectory-store.js, mcp/consultants/shared/consultant-base.js, management-api/lib/task-action-tokens.js, management-api/middleware/auth.js, management-api/lib/agent-event-auth.js, management-api/routes/agent-events.js, management-api/utils/process-manager.js, management-api/adapters/index.js, management-api/adapters/lifecycle.js, management-api/adapters/events/external.js, management-api/server.js, scripts/ruvector-sidecar-update.sh]
owner: jjohare
review_trigger: any new reader of the RuVector Postgres password or any new place a connection is assembled, any new route a task needs to call, any change to the Management API auth gate or auth modes, or a hook that gains a way to sign NIP-98
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
- A token holder can post a trajectory under any session id (ids derive from the session, not the task), so it can add rows or roll up another session's trajectory (closed by Amendment 3: a token may write only trajectories its own task owns). It can read nothing and reach no other table; the same-UID boundary already lets it do worse.
- `routing-label-recorder.cjs` (ADR-2110, off by default) inlined the same conninfo in its registered command; Amendment 2 below closes that.

**Verification.** `tests/sovereign/task-trajectory-ingest.test.js` (route and recorder end to end against a recording pool) and `tests/sovereign/task-trajectory-env.test.js` (task env, generated hook command, grep-pin, consultant emitter in a spawned env); the watermark cases in `tests/sovereign/learning-evidence-closeout.test.js`.

## Amendment 2 — 2026-11-01 (owner decision): the database credential has one source

Owner decision: "Fix the same-class conninfo leaks too." The Postgres connection string, and above all its password, must not appear in any hook command, any MCP or Codex config file, or any exported env that tasks or tools inherit. Parallel paths are poison: one path stays, every trace of the others goes.

**What was wrong (same class as the trajectory recorder).** `RUVECTOR_PG_CONNINFO` with the password inlined was projected into `.mcp.json` (the claude-flow, colloquy and ruvnet-brain servers), the Codex `config.toml`, the registered routing-label Stop hook (default password `ruvector`), a `ruvnet-brain` ingest command line and `agentbox.sh`; baked into the image `Env` from the manifest; exported again, with a `ruvector:ruvector` default, into the runtime-env file that every shell sources and that is copied onto the workspace volume; and forwarded to children by `local-process-manager`'s allowlist. About fifteen readers (the memory MCP server, ruflo CLI, the aggregate/distil/sona/recall/ingest scripts, the dream-engine) each parsed it with their own copy of the parser and fell back to `password=ruvector`.

**Decision.**
- **One credential source.** The password enters the container once, as `RUVECTOR_PG_PASSWORD` (compose requires it, `:?`, no default). Early in the entrypoint `_ab_pg_credential_prepare` writes it to one devuser-owned 0600 file, `/run/secrets/ruvector-pg/password` (a devuser subdirectory of the tmpfs, so it works with `role_isolation` on and off), exports only `RUVECTOR_PG_PASSWORD_FILE` and the public parts `RUVECTOR_PG_HOST/PORT/DATABASE/USER`, and unsets `RUVECTOR_PG_PASSWORD` and `RUVECTOR_PG_CONNINFO` before any config, hook or child can copy them. No password and no conninfo string is written to any projected file or exported env after that point; copies left by earlier boots in live config, Claude Code backups and `*.pre-*`/`*.bak*` snapshots are removed by the boot scrub (Amendment 4), and the password is rotated after the deploy because copies outside the scrub's reach cannot be ruled out.
- **One reader helper.** `management-api/lib/pg-config.js` (`pgPoolConfig`, `pgPoolConfigFromManifestConninfo`) builds the pool config from the parts plus the file, reusing `role-secret.js` `readSecretFile` (bounded, regular files only, errors name the path and never a value). It deliberately does not use `resolveRoleSecret`: its flag-off env fallback would be a second path. The memory MCP server, ruflo CLI, aggregate-effectiveness, the ruvnet-brain server and ingest, the aggregate/distil/recall/sona/dream-machine/corpus scripts, the EXP-B8 reader and the management-api memory slot (`adapters/index.js`: host/port/db/user from the manifest URL, a real password in the URL is refused) all go through it. The dream-engine (Rust) reads the same file (`PgTarget::connect_options`); its password is never held in the config struct.
- **No password defaults, fail closed.** Every literal `ruvector` / `ruvector:ruvector` default is gone. A missing, empty or non-regular file throws an error naming the file path, so the client refuses to start; the entrypoint logs the same and keeps booting.
- **Routing-label recorder (ADR-2110): routed through the API, not deleted.** `[skills.routing].label_log = false` (`agentbox.toml:1348`) and ADR-2110 is `rejected` / `inactive`, but `label_log`, its validator (E076/E077), the schema, `system-manifest.js`, the egress policy, the EXP-B8 analyser and two test suites all hang on the recorder; deleting the subsystem is its own decision. So it follows the trajectory recorder: it posts the rows it built to a new operator-only `POST /v1/agent-events/routing-label` (not in `TASK_TOKEN_ROUTES`: a task has no reason to record labels and gets 403), `management-api/lib/routing-label-store.js` owns the DDL and the INSERT through the memory adapter's pool, and the recorder's `pg` client, conninfo parsing and the inlined hook-command conninfo are gone.
- **Persisted files self-heal.** The first-write guards never rewrite existing files, so a boot scrub (`PGSCRUB_MARKER` heredoc, before Phase 8) deletes every `RUVECTOR_PG_CONNINFO` from every `mcpServers` entry in `.mcp.json` and in Claude Code's per-user state (`~/.claude/.claude.json`, `~/.claude.json`, top level and under `projects.<path>`, where it caches the resolved MCP config), replaces the Codex line with the parts and the file path, and drops `memory.password` from `~/.claude-flow/config.json`. The claude-flow config template (`flake.nix` `claudeFlowConfigJson`, `/opt/agentbox/config/claude-flow-config.template.json`) is deleted: its only reader was the retired `claude-flow mcp start` path.
- **Manifests.** `[integrations.ruvector_external].conninfo` and `[plugins.memory].conninfo` carry no password (`postgresql://ruvector@ruvector-postgres:5432/ruvector`); the old `@@RUVECTOR_PG_PASSWORD@@` placeholder is still accepted by the helper so an older manifest keeps booting, a real password in the URL is refused. `config/custody/env-classes.json`: `RUVECTOR_PG_CONNINFO` and `_PG_PW_ESC` removed, `RUVECTOR_PG_PASSWORD` reworded, the file path and parts classified `NON_SECRET`. `scripts/ci/check-db-password.sh` is the one gate that pins "no default password literal, no compose conninfo".

**Consequences.**
- Same-UID boundary unchanged: a task is the same Unix user as the memory server, so it can still read the 0600 file, and `.mcp.json` still hands MCP children its path. What changed is that the password is no longer in a hook command, a config file, an exported env or a process list, so it is not leaked by `env`, a config read or a hook-command dump. A task holding no DB credential by *design* (Invariant 12) is the API route; the file is the residual under the same-UID model.
- `docker exec` shells see the container's configured env, which still has `RUVECTOR_PG_PASSWORD` from compose (PID 1's copy is unset, the container config's is not). Clients in such a shell work through the helper's default file path; removing the variable from `docker inspect` needs a Docker secret in place of the compose env, a deployment change not made here.
- Operator-only routing-label recording stops under `strict-nip98` (as the trajectory route does) until a hook can sign NIP-98.
- `.env.example` still shows a `RUVECTOR_PG_PASSWORD=ruvector` example line and an empty `RUVECTOR_PG_CONNINFO=`: a harness deny rule prevented this implementer from editing `.env*`; the owner should change them to a required placeholder.

**Verification.** `tests/sovereign/pg-credential-custody.test.js` (the entrypoint's custody function, runtime-env export, MCP/Codex heredocs and registered hook commands run for real with a sentinel password; the scrub run over pre-existing files holding the old conninfo; the helper through a recording fake pool; fail-closed on a missing file; grep-pins), `tests/sovereign/routing-label-ingest.test.js`, `tests/config/routing-labels.test.js`, `cargo test` in `services/dream-engine`, and `scripts/ci/check-db-password.sh`. Not shown: a live boot, a live Postgres connection, or the running memory MCP server restarting against the new file.

## Amendment 3 — 2026-11-01 (security review): token scope inside the routes, and the same-UID limit

A security review of the branch found the token's route list was right but its scope inside two routes was not.

**Decision.**
- **Trajectory ownership (B1).** `management-api/lib/trajectory-store.js` stamps `metadata.task_id` with the token's task id when a token post creates a trajectory (over anything the body sent), then re-reads the owner under `SELECT … FOR UPDATE` in the same transaction. A token write to a trajectory owned by another task, or by the operator (no `task_id`), rolls back and answers `403` before any step or rollup is written. One task may own several trajectories (ids derive from the session, which the server never learns, so ownership cannot be bound to a session). Operator credentials run no ownership statement and behave as before. The key is a jsonb member of `metadata`, not a column.
- **Source attribution (B2).** For a token post, emit and batch use `hashString(<token task id>)` as the source agent and ignore the posted `source_agent_id` (`routes/agent-events.js`: the source is derived from the metadata `withTaskId` already stamped, so one place decides the task). The brief's "agent identity" is covered by `reconcileTaskScope`, which already answers 403 to any asserted `source_urn` or `pubkey`, stricter than overwriting. Side effect: the consultant emitter's beam inside a task now starts at the task body, not at `consultant-<name>`.
- **Missing password file (G2).** The password file being unusable no longer exits the API: `resolveAdapters` builds that slot as a failed-config adapter, the lifecycle withdraws it (`degraded`, `off` replacement, writes refused), and `/health` publishes `adapter_failures.memory` (see Amendment 4 for what it carries). Fail-closed slots (`orchestrator`) still abort startup. ADR-015, as amended, requires the ruvector MCP server to fail closed with no `sql.js` fallback; it does not require the management-api to exit.

**Consequences.**
- **Same-UID limit.** The management-api runs as devuser in every current configuration, including with `role_isolation` on (it is in no role of `config/role-accounts.json`), so a hostile task can still reach the operator key and the database credential file. The token narrows only the network surface and keeps the key and credential out of the task's environment, hook commands and model context; it is not process isolation.
- Trajectories created before this change have no `task_id`, so they count as operator-owned. A resumed session would post to the same row (the id derives from the session) and get 403 on every Stop, with the recorder holding its watermark and retrying. That cannot arise because the task spawner never resumes a session: `spawnTask` builds a fixed argv with no resume or continue flag, and since Amendment 4 refuses an `agent`, `provider` or `task` value that could be read as one, so every post-deploy task has a fresh session and a fresh trajectory id. (Revoking tokens on restart is not the reason: a new post-deploy token could still post to an old id.)

**Verification.** `tests/sovereign/task-trajectory-scope.test.js` (own task, foreign task, operator-owned, forged metadata, several trajectories, operator unchanged), the B2 cases in `task-action-token.test.js`, `tests/sovereign/memory-slot-missing-password.test.js`; each fails against the previous sources.

## Amendment 4 — 2026-11-01 (second security review): scrub reach, atomic writes, degraded slots, `/health`, no resume

The second review found the boot scrub missed copies of the credential and that two behaviours it documented were not true.

**Decision.**
- **Scrub reach and atomicity (S1).** The one scrub routine (`PGSCRUB_MARKER`) now also rewrites Claude Code's `~/.claude/backups/.claude.json.backup.*`, every `*.pre-*`, `*.bak*` and `*.backup*` file in `~/.claude`, and such snapshots of `.mcp.json`, `settings.json`, `config.toml` and `config.json` in the workspace, `~/.codex` and `~/.claude-flow`. It removes only RuVector's password and conninfo values (mcpServers conninfo becomes the public parts plus the file path; hook command strings lose `RUVECTOR_PG_CONNINFO=...`; `memory.password` goes from claude-flow config; a `postgres://` URL or `host=`/`user=`/`dbname=` conninfo loses its password only when it names the RuVector host, user or database, so another database's credentials in the same file are untouched), never deletes a snapshot, skips symlinks, and is idempotent. Every write is a 0600 sibling temp file, fsync, `fchown` to the original owner (the boot runs as root and a rename replaces the inode), rename; a failure before the rename leaves the original and removes the temp file, and the temp only ever holds scrubbed text. Live `.mcp.json` and `.claude.json` stay forced to 0600; every other file keeps its mode.
- **Rotation (owner step).** The pre-scrub copies were spread across persistent volumes and may exist in places the scrub cannot reach, so the RuVector password is rotated after this deploy. This is manual: no script rotates the owner password (`scripts/ruvector-sidecar-update.sh` handles only the reader role).
- **A degraded slot never accepts and drops a write (S2).** The `off` stand-in the lifecycle installs for a slot that failed refuses `dispatch()` with `AdapterDisabled`; the events `off` adapter still no-ops for a slot the operator configured off (ADR-005), so the authority journal can no longer report a record as journalled when the events slot failed. The external adapters now share one config key: `slotConfig` passes `baseUrl` and `events/external.js` reads it (previously `externalUrl` against `url`/`baseUrl`, so every external slot failed to construct).
- **`/health` carries no error text (S3).** `adapter_failures` is a fixed class per slot (`config-failed`, `connect-timeout`, `connect-failed`) and `adapter_failure_files` the configured path for a `config-failed` slot. The full reason goes to the server log only.
- **No resume path (S7).** `spawnTask` refuses an empty `agent` or `provider`, one with control characters, or one that begins with `-`, and an agentic-flow `task` that begins with `-`, so a caller cannot make the child CLI read a value as `--resume` or `--continue`. The rule is deliberately narrow: free-text role labels (`agent: "Product Manager"` from the briefing route) stay valid. On the `claude` path the prompt always begins `Working directory:` and cannot be a flag. The `agentic-flow` binary is not installed in the image under review, so whether its parser has a resume flag is unverified; the refusal is defensive.
- `scripts/ruvector-sidecar-update.sh` reads the client password file in the agentbox container, where it lives, so the pre-upgrade SCRAM check covers that client.

**Verification.** `tests/sovereign/pg-scrub-snapshots.test.js`, `degraded-slot-refuses-writes.test.js`, `memory-slot-missing-password.test.js`, `spawn-task-no-resume.test.js`, and `tests/config/ruvector-sidecar-ops.test.sh`; each fails against the previous sources.

## Re-verification — 2026-11-01 (`3d717c40f`)

`management-api/lib/trajectory-store.js` and `management-api/routes/agent-events.js` changed since `09067b095` exactly as amendment 3 above describes (`git diff 09067b095..3d717c40f -- management-api/lib/trajectory-store.js management-api/routes/agent-events.js`); `management-api/adapters/index.js` and `management-api/adapters/lifecycle.js` join the governed paths for the missing-password-file behaviour. Decision otherwise unchanged; `verified_commit` bumped.

## Re-verification — 2026-11-01 (`a8186a8e3`)

`management-api/routes/agent-events.js` changed since `3d717c40f` only in the B2 source-agent derivation (`resolveSourceId` removed; the source comes from the `withTaskId` stamp), `git diff 3d717c40f..a8186a8e3 -- management-api/routes/agent-events.js`. Decision unchanged; `verified_commit` bumped.
