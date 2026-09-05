---
id: ADR-2037
title: agentbox.sh health derives its exit code from .adapters/.degraded_count, not a nonexistent .services key
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: any change to the /health response schema in management-api/server.js (its declared fields, or the addition/removal of an adapter slot)
repo: agentbox
domain: BASELINE-container
---

# ADR-2037 — agentbox.sh health derives its exit code from .adapters/.degraded_count, not a nonexistent .services key

## Context

`cmd_health` (agentbox.sh:1107) built its `degraded` list with
`jq '.services // {} | select(.value.status == "degraded" or "failed")'`. `GET /health`
(management-api/server.js:543-573) emits `status, uptime, image_hash, manifest_checksum,
adapters, degraded_count, note` per its declared response schema — there is no `.services`
key. `degraded` was therefore always empty and the `exit 1` branch was unreachable; BASELINE
claimed the CLI "exits non-zero if any slot's gauge is 0", which was also false since the CLI
never read the `agentbox_adapter_health` gauge. Diagrams AB-04.16 / AB-05.7 expose both facts.
`adapters` values are `"healthy" | "degraded" | "off"` (server.js:109).

## Decision

Fix the CLI, not the server: `/health`'s payload is the declared schema contract other
consumers read, so a `.services` key exists nowhere else and will not be invented to match a
CLI typo. `cmd_health` now derives failure from what `/health` actually emits: a slot in
`.adapters` counts as failed when its value is neither `"healthy"` nor `"off"`; `cmd_health`
exits 1 when any such slot exists OR `.degraded_count > 0`, and exits 0 otherwise. The
`adapter/<slot>: <value>` pretty-print, `--json`, the no-jq fallback, and the `/v1/meta`
metrics print are unchanged.

## Consequences

- The health CLI's exit code is now a real signal or automation (CI, cron, `up` polling) that
  shells out to `agentbox.sh health` gets a correct pass/fail.
- No server-side change and no new contract surface; `/health`'s schema stays exactly as
  declared for its other consumers.
- Follow-on: BASELINE-container's Adapter spine stage-4 text and diagram AB-04.16/AB-05.7
  DIVERGENCE notes describe the old, broken behaviour and need a DOC-CORRECT pass by the
  BASELINE-container doc owner; this ADR does not itself touch that doc (out of this change's
  file ownership).

## Verification

Ran against the uncommitted working tree, HEAD at `89301ec7c911eab270c00a0cf81596d0d4f15535`
(agentbox submodule). Must be re-verified at the landing commit.

```
$ bash -n agentbox/agentbox.sh
(no output — exit 0)
```

```
$ echo '{"status":"degraded","adapters":{"beads":"healthy","memory":"degraded","pods":"off"},"degraded_count":1}' \
  | jq -r '.adapters // {} | to_entries[] | select(.value != "healthy" and .value != "off") | .key'
memory
$ echo '{"status":"degraded","adapters":{"beads":"healthy","memory":"degraded","pods":"off"},"degraded_count":1}' \
  | jq -r '.degraded_count // 0'
1
```

```
$ echo '{"status":"ok","adapters":{"beads":"healthy","memory":"healthy","pods":"off"},"degraded_count":0}' \
  | jq -r '.adapters // {} | to_entries[] | select(.value != "healthy" and .value != "off") | .key'
(no output)
$ echo '{"status":"ok","adapters":{"beads":"healthy","memory":"healthy","pods":"off"},"degraded_count":0}' \
  | jq -r '.degraded_count // 0'
0
```

End-to-end: the real `cmd_health` body (agentbox.sh:1107-1186) was `eval`-sourced into a
sandboxed harness with `curl` stubbed to return each payload above for `HEALTH_URL`. Degraded
payload printed `adapter/memory: degraded`, `Degraded/failed services: memory`, and exited 1;
healthy payload printed only the three `adapter/*: ...` lines and exited 0 — confirming the new
derivation and exit branch match server.js:543-573's actual field set (`adapters`,
`degraded_count`), not the old `.services` assumption.

```
$ cd agentbox && node scripts/adr-index-gen.js docs/adr --check
ok: 54 ADR(s) valid (--check, README not written)
$ node scripts/adr-index-gen.js docs/adr
ok: 54 ADR(s) valid; wrote docs/adr/README.md
```
