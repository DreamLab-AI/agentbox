---
id: ADR-2008
title: skills/mcp.json is the MCP source of truth; the projector reconciles (removes stale) rather than appends
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A managed MCP server appearing in .mcp.json with a failing gate, or an append-only registry edit reappearing
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-039 (docbox-backported / system-manifest), ADR-011 (consultation MCPs); closes audits MCP-1/MCP-2/MCP-6
---

# ADR-2008 — skills/mcp.json is the MCP source of truth; the projector reconciles rather than appends

## Context
The MCP server registry drifted append-only: servers whose gate later turned off, or whose required
binary/file was absent, lingered in `.mcp.json` (audit MCP-6, add-only rot). A single source of truth
was needed, plus a boot-time step that removes servers that no longer qualify — without clobbering
hand-authored (`bespoke`) or GPU-sidecar (`reference`) entries the projector does not own. Prior
state: ADR-039 (system-manifest / docbox back-port) and ADR-011 (consultation MCPs).

## Decision
The MCP server registry lives in `skills/mcp.json`. At boot a projector upserts only
`projector`-class servers into `.mcp.json`: for each it evaluates the server's `x-agentbox-gate` and
`x-agentbox-requires` (binary on PATH / file present) against the boot env, and REMOVES any managed
server whose gate/requires now fail — this is reconcile, not append. Servers marked `bespoke` or
`reference` are never touched. Net effect on next boot: the projector adds only gated-on, present,
currently-orphaned servers, and current managed definitions with closed gates are removed on a successful reconciliation. Registry deletion and unreadable-input cases need separate handling. This forecloses append-only
registry edits and any managed server persisting past its gate.

## Consequences
- A current managed definition whose gate flips off is removed when reconciliation succeeds; deleted definitions and unreadable registry inputs can leave old target entries.
- Hand-authored and sidecar-wrapper servers are safe from the reconciler.
- Cost: a managed server must carry an accurate gate + requires, or it will be removed at boot; the
  projector is the only sanctioned writer of managed entries in `.mcp.json`.

## Verification
Historical verification recorded complete at cbe7335b9. The 2026-09-04 isolated deletion/error fixtures below narrow the guarantee to partial.
`scripts/project-mcp-servers.mjs:13-20` documents the managed-by-projector contract: evaluate gate
(:14), check requires (:16-17), upsert as reconcile-not-append with failing gate/requires REMOVED
(:19-20). The reconcile loop keys on `def['x-agentbox-managed-by']` (:122); `gateOpen` (:87) and
`requiresMet` (:96) implement the gate/requires evaluation, and non-`projector` classes are left
untouched.

## Closeout extension — 2026-09-04

CP-01/04/08. Owner remains jjohare with configuration/runtime maintainers. The actual isolated projector preserves a target entry after its definition is removed and retains old configuration on malformed registry input while exiting zero. Missing requirements arrays also remove an otherwise gated-on entry; all nine current managed definitions have arrays.

**Acceptance condition:** retain ownership history for deletion/rename, validate schema, distinguish persistence from planned counters, and test atomic target replacement plus reader reload. Preserve bespoke entries. Exercise no-op/error/boot paths and report degraded reconciliation without exposing secrets. Reopen on registry schema, ownership, writer or boot changes. See the [review](../../../../VisionFlow/docs/estate-review/configuration-projection.md) and [actual-script receipt](../../../../VisionFlow/docs/estate-review/evidence/mcp-projection-probes.json).

## Acceptance progress — 2026-09-05

**Implemented.** `scripts/project-mcp-servers.mjs` rewritten against the four
reproduced defects.

- *Deleted or renamed definitions.* An **ownership ledger** (sidecar JSON beside
  the target, override `MCP_PROJECTION_STATE`) records the names this projector
  owns, with a bounded deletion/rename history. Any owned name that is no longer
  a `projector`-managed registry definition is removed from `.mcp.json` and the
  removal is recorded. The ledger is deliberately *not* stored inside
  `.mcp.json`, which the harness reads and must carry no agentbox-private keys.
  A target entry absent from the ledger is treated as bespoke and never touched,
  so adopting this revision cannot delete a hand-written server; names projected
  before the ledger existed are adopted on their next successful projection.
- *Schema validation.* `validateRegistry()` checks root shape, the
  `x-agentbox-managed-by` vocabulary, gate grammar, requirements grammar,
  transport (`command` or `url`) and the types of `args`/`env`/`headers`. Every
  error is enumerated before anything is written.
- *Malformed input.* Unreadable, unparseable or schema-invalid registry now
  **exits 2** with the target byte-identical; a target read failure or a failed
  replacement exits 3. The target and the ledger are replaced by write-to-temp +
  `fsync` + `rename(2)` in the same directory, preserving the previous file mode.
  Boot is still not blocked: `config/entrypoint-unified.sh` pipes the script and
  appends `|| true`, so the failure surfaces as a loud `[mcp] FAIL` line without
  aborting the entrypoint. That call site is unchanged.
- *Missing requirements array.* `requiresMet()` is total and always returns
  `{ok, why, explicit}`. An absent or `null` array is the empty requirement set —
  the previous revision returned a bare `true`, whose `.ok` was `undefined`, so a
  gated-ON server was reconciled out. The empty set is now reported explicitly in
  the run summary rather than being indistinguishable from "all requirements met".
- *Incidental.* `binOnPath()` no longer shells out to `command -v $name`; `$PATH`
  is walked in-process, so no registry-controlled string reaches a shell.

**Tests and results.** `node tests/config/mcp-projector.test.mjs` — **60 passed,
0 failed**. Covers gate on/off; deletion, rename and demotion-to-bespoke removal
with ledger history; a never-owned target entry surviving an empty registry; a
missing and a `null` requirements array retaining the entry while an unmet
requirement still reconciles it out; nine invalid-registry shapes each exiting 2
with the target byte-identical; absent, unparseable and unwritable targets;
no temp file left behind; idempotence, dry-run, and the live `skills/mcp.json`
passing schema validation.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2008-mcp-projector.json`.

**Remaining.** No boot, no MCP server launch and no live `.mcp.json` change ran;
the live registry is only dry-run validated. Reader reload after an atomic
replacement is still asserted only at the file level, not against a running
harness. The distinction between persistence counters and planned counters is
now visible in the run summary but has no separate telemetry sink.

**Governed paths changed.** `scripts/project-mcp-servers.mjs`,
`tests/config/mcp-projector.test.mjs` (new).
