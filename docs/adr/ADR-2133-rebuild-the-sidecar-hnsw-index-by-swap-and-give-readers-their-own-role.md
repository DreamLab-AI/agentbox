---
id: ADR-2133
title: Rebuild the sidecar HNSW index by swap, and give read-only consumers their own role
date: 2026-10-07
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 4f09c96b2f6869a472d27d22cb23c45df4bbfd80
verified_paths: [scripts/ruvector-sidecar-update.sh, tests/config/ruvector-sidecar-ops.test.sh]
owner: jjohare
review_trigger: a ruvector extension or image bump; a new read-only consumer or readable table; any pg_hba change
repo: agentbox
domain: LEARNING-memory
---

# ADR-2133 — Rebuild the sidecar HNSW index by swap, and give read-only consumers their own role

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
  - **Precondition:** the container's `POSTGRES_PASSWORD` and the governed `.mcp.json` conninfo password must both verify against the owner's SCRAM verifier. The check uses node:crypto, and its accept and reject paths are tested on the RFC 7677 vector and the status trust banner.
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
