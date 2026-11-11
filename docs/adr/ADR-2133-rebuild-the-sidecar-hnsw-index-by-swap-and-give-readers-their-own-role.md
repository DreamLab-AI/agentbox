---
id: ADR-2133
title: Rebuild the sidecar HNSW index by swap, and give read-only consumers their own role
date: 2026-10-07
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: f7a5ae4ab24d1c4b20e15819c26f3d6b63f84b32
verified_paths: [scripts/ruvector-sidecar-update.sh, tests/config/ruvector-sidecar-ops.test.sh, tests/config/reindex-screen.test.sh]
owner: jjohare
review_trigger: a ruvector extension or image bump; a new read-only consumer or readable table; any pg_hba change; `ruvector reader-role --yes` and `hba-harden --yes` run on the live sidecar (activation → live)
repo: agentbox
domain: LEARNING-memory
---

# ADR-2133 — Rebuild the sidecar HNSW index by swap, and give read-only consumers their own role

## Live auth hardening — 2026-11-11

The existing gated `hba-harden --yes` operation replaced the four Docker-subnet
trust entries with SCRAM rules, deduplicated rules and reloaded configuration.
Backup: `pg_hba.conf.agentbox-20261111T201519Z` beside the original on PGDATA.
No database/container restart, role/password rotation, memory-row change or
index rebuild was performed. The one-time `hba_scram` gate was re-sealed to
`false`; the hardened configuration persists on the data volume.

Preflight verified both the container and Agentbox passwords against the stored
SCRAM verifier without printing them. Host-side checks also verified the
configured VisionClaw reader credentials. Fresh owner and reader connections
succeeded through **both** Docker-network addresses, and wrong passwords were
rejected with SQLSTATE `28P01` on both. The reader's default remains read-only.
`ruvector status` reports no trust rule outside loopback; Agentbox is ready with
no degraded services.

The initial helper exited 141 after reload: `head -1` stopped reading before
the second credential's Docker read returned, causing SIGPIPE under `pipefail`.
`2743e2a6b` drains all credential output with awk while selecting only the first
password. Delayed-producer and no-secret-output regression checks bring the
operator suite to **48/48**. Independent network checks completed the original
post-reload verification. This source fix will be baked at the next normal
image build; the checkout's operator command already uses it.

The refreshed recall fixture passed before and after auth hardening at median
self **179/200**, true **105/120**, exact-token delta **3** (three runs each).
The release gate permits the post-change receipt with the governed MCP
environment and matching live embedding fingerprint. See ADR-2018 for fixture
provenance. This closes the live trust-auth finding only: the record's overall
activation axis stays staged because its other acceptance boundaries (including
the pre-swap index screen and full reader-role lifecycle rehearsal) are not
claimed here.

## Context
VisionClaw's live test measured recall@10 of 0.70–0.71 against an exact scan. In that test only 89 of 100 rows found themselves in their own top 10.
The recall gate could not run either: 8/320 fixture ids had been pruned. On a regenerated fixture it read self 170/200 and true 100/120 (FAIL). The index was 4.2 GB for 213,780 rows.
The index law (LEARNING-memory invariant 8) had no tool behind it. The last fix was a hand-run `REINDEX`, which holds ACCESS EXCLUSIVE on the index, so ANN searches block for the whole ~8 min build.
VisionClaw also connects as the owner `ruvector`, a superuser. The sidecar's pg_hba has `host all all 172.18.0.0/16 trust` and `… 172.20.0.0/16 trust` ahead of the scram line, so any client on either docker network can log in as any role without a password.

Provenance: the image entrypoint writes pg_hba only on first initdb (`docker-entrypoint.sh` runs `pg_setup_hba_conf` only while `DATABASE_ALREADY_EXISTS` is empty, appending `host all all all scram-sha-256` because `POSTGRES_HOST_AUTH_METHOD` is unset). No agentbox or host-project script writes trust lines. PGDATA dates from 2026-01-27 and pg_hba.conf was last modified 2026-05-19, so the trust lines were a hand edit that persists on `ruvector_postgres_data_v2`.

## Decision
- `ruvector reindex [--dry-run|--yes]` is the only sanctioned rebuild. It works in this order:
  1. Record a recall run. It refuses to rebuild without one.
  2. Check that the opclass is `ruvector_cosine_ops`.
  3. Build `idx_memory_embedding_hnsw_rebuild` non-concurrently, with `SET max_parallel_maintenance_workers = 0`, `m=16` and `ef_construction=128`, beside the live index.
  3a. Screen before the swap (amendment 2026-11-03): score each index alone and swap only if the new build is no worse. If it loses, drop it and rebuild once. If it loses again, keep the current index and exit non-zero (`reindex.phase=kept-old`).
  4. Swap with `BEGIN; SET LOCAL lock_timeout='60s'; DROP INDEX …; ALTER INDEX … RENAME …; COMMIT`.
  5. Verify the definition, the planner's choice and a duplicate-free top-20.
  6. Rerun recall. It fails non-zero below self 175/200 or true 102/120, or on a FAIL verdict.

  Results are recorded under `state.json .reindex`, leaving the update flow's keys untouched. A scratch database on ruvector 0.3.0 showed that a renamed HNSW index serves rows inserted after the swap, with no duplicates.
- `ruvector reader-role [--dry-run|--yes|--verify]` (flag `reader_role`) creates or updates `ruvector_reader`:
  - **Login and privileges:** LOGIN with the password from `RUVECTOR_READER_PASSWORD`, passed by name via `docker exec -e` and psql `\getenv`, so it never reaches argv or stdout. No attributes and no memberships. `default_transaction_read_only=on`. CONNECT, USAGE on `public`, SELECT on `memory_entries` only, and EXECUTE on the `<=>` function.
  - **Revoked from PUBLIC:** TEMPORARY on the database and CREATE on `public`.
  - **pg_hba:** a role-scoped scram line kept ahead of every host line.
  - **Verification:** it logs in as the role over TCP. A wrong password must be refused, and the ANN and exact top-k queries must work. INSERT, UPDATE, DELETE, CREATE and CREATE TEMP must be refused both in the read-only default and after a `READ WRITE` opt-in, and so must SELECT on another table.
  - **When it runs:** one-time, idempotent, re-run after a restore onto a fresh volume. It is not applied at boot (`memory_entries` is created after initdb) and not wired through compose (the reader password stays out of the sidecar's environment).
- `ruvector hba-harden [--dry-run|--yes]` (flag `hba_scram`, default off) rewrites non-loopback `trust` host lines to `scram-sha-256` and drops duplicate lines.
  - **Precondition:** the container's `POSTGRES_PASSWORD` and the governed client password (the one 0600 file `RUVECTOR_PG_PASSWORD_FILE` names, read from the container since ADR-2164 amendment 2; `.mcp.json` no longer carries a password) must both verify against the owner's SCRAM verifier. The check uses node:crypto, and its accept and reject paths are tested on the RFC 7677 vector and the status trust banner.
  - **Rollback:** if the owner cannot log in over the network path afterwards, or a wrong password still can, the backup is restored.

## Consequences
- Searches keep an index throughout a rebuild. Writes wait for the build (468 s on this corpus), and the swap needs a brief ACCESS EXCLUSIVE lock, which is retried 3 × 60 s.
- Free disk equal to one extra index is needed during the build.
- Until `hba-harden` runs, the reader role limits only what VisionClaw's own code can do: any client on the docker networks can still connect as the owner without a password. `hba-harden` removes that, but every owner-role client must then send the right password. VisionClaw's configured password cannot be checked from agentbox, so the operator flips `hba_scram`.
- pg_hba lives on the data volume, so `hba-harden` survives container recreates and image bumps; a fresh volume starts clean (loopback trust from initdb plus the scram line). It can come back two ways: another hand edit, or `rollback` restoring an older pg_basebackup snapshot, which carries its own pg_hba.conf. `status` (and so `check`), the end of `update` and the end of `rollback` therefore print a red banner naming every non-loopback trust rule.
- Fixture regeneration is part of recall upkeep: a pruned id stops the gate rather than passing it.

## Verification
- `bash tests/config/ruvector-sidecar-ops.test.sh`: 39/39. It uses a stub docker and a stub harness, and covers the dry-runs, every refusal path, the ordering and state recording, the password-never-printed checks and the RFC 7677 vector and the status trust banner.
- Live, 2026-10-07: `reindex --yes` exited 0. Recall went from self 170/200 and true 100/120 (FAIL) to self 192/200 and true 109/120 (PASS, median-of-3). The build took 468 s and the run 11m23s; the index went from 4209 MB to 1670 MB.
- The reader SQL and the verification ran against a scratch database and a probe role, both dropped afterwards. All write paths were refused at both layers, and the wrong-password probe correctly failed under the existing trust lines.
- `reader-role --yes` and `hba-harden --yes` have not been run on the live sidecar.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `9db3bcc49` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `scripts/ruvector-sidecar-update.sh`: `owner_client_passwords` reads the container password file instead of scraping a conninfo out of `.mcp.json`, plus two comments.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 9db3bcc49..cc949bb79 -- scripts/ruvector-sidecar-update.sh`.

## Re-verification — 2026-11-01 (`4f3bd5325`)

Governed-path delta since `cc949bb79`: `scripts/ruvector-sidecar-update.sh`: `owner_client_passwords` reads the client password file in the agentbox container (new `CLIENT_CONTAINER`), not the postgres one, so the pre-upgrade SCRAM check covers that client (ADR-2164 amendment 4); `tests/config/ruvector-sidecar-ops.test.sh`: a stub branch and one case proving the password file is read in the agentbox container (ADR-2164 amendment 4). This record's `hba-harden` SCRAM pre-check reads the client password file; it now reads it in the agentbox container where it lives (the postgres container never held it), so the check covers that client instead of silently dropping it. The decision is unchanged. Decision unchanged; `verified_commit` bumped. Re-run: `git diff cc949bb79..4f3bd5325 -- scripts/ruvector-sidecar-update.sh tests/config/ruvector-sidecar-ops.test.sh`.

## Amendment — 2026-11-03: pre-swap screen (`d09926697`)

**Why.** On 2026-10-31, two serial index-law builds on identical data scored 168/200 and 183/200 self-recall. A valid build is therefore not necessarily a good one, and the swap in step 4 dropped the old index with no way back.

**Decision change (step 3a).** After the build, `cmd_reindex` scores each index alone:
- **Scoring.** Inside a transaction it runs `DROP INDEX` on the other index, then a SQL self-recall (`hnsw_screen_sql`: unfiltered top-10 on each fixture row's own vector, `enable_seqscan = off`), then `ROLLBACK`. DROP INDEX is transactional. A scratch table on 2026-10-31 showed that the ruvector hnsw AM brings both indexes back valid and maintained.
- **Lock bound.** Each probe holds ACCESS EXCLUSIVE on `memory_entries` (~7 s at 266k rows). It is bounded by `lock_timeout = '60s'` and `statement_timeout = REINDEX_SCREEN_TIMEOUT_S` (default 30 s).
- **Outcomes.**
  - `screen_verdict`: new ≥ current → swap.
  - Otherwise drop the new build and rebuild once. A second loss keeps the current index and exits non-zero (`kept-old`).
  - A probe that cannot score either index refuses the swap (`screen-failed`) and leaves the valid rebuild in place for a manual swap.
- **State.** Scores are recorded as `reindex.screen_{new,old}_<attempt>`.
- **Gate.** The post-swap recall harness (step 6) is still the gate. Its failure text no longer claims the index cannot be the cause.

**Verification.** `bash tests/config/ruvector-sidecar-ops.test.sh`: 46/46 (40 existing + 6 screen cases: ordering between build and swap, no COMMIT, scores recorded, retry-then-swap, kept-old, screen-failed). `bash tests/config/reindex-screen.test.sh`: 14/14 (SQL shape and verdict). Both suites use the stub docker. The screen has **not** completed a live `reindex --yes`. Activation stays `staged`.

**Open live state (2026-11-03).** A worktree run of this code on 2026-10-31 15:41 stopped at `reindex.phase=building` (attempt 1). The sidecar still carries `idx_memory_embedding_hnsw_rebuild`, valid and ready, 4771 MB, beside the live `idx_memory_embedding_hnsw` (4771 MB), so every write maintains two HNSW indexes. The next `reindex --yes` drops the leftover before it builds. Until then, the operator can drop it by hand (`DROP INDEX public.idx_memory_embedding_hnsw_rebuild;`). That run's state and recall artefact are preserved under the VisionFlow estate-review evidence for 2026-11-03 (lane-agentbox/reindex-screen).

Re-run: `git diff 4f3bd5325..d09926697 -- scripts/ruvector-sidecar-update.sh tests/config/ruvector-sidecar-ops.test.sh`.
