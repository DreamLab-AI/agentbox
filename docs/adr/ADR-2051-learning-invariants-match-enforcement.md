---
id: ADR-2051
title: State the LEARNING-memory invariants as the enforcement the code actually provides
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: any change to the ADR-2014 embedding fail-closed default or to consumerAdmission() in mcp/servers/lib/ruvector-gates.js
repo: agentbox
domain: LEARNING-memory
lineage: ADR-2014 (memory MCP-only, fail-closed), ADR-2017 (consumer-behind-producer W066)
---

# ADR-2051 — State the LEARNING-memory invariants as the enforcement the code actually provides

## Context

`docs/LEARNING-memory.md` Invariants 1 and 2 both hedge that the rule is *intended*
rather than enforced. Both hedges are now false, and each has since been closed by a
landed change:

- Invariant 1 says successful embedding "is not enforced on every write today".
  `mcp/servers/lib/memory-tools.js` documents the fail-closed default at its header and
  `memStore` rejects the write with `reason: 'embedding-unavailable'` when the embedding
  transport fails, unless `RUVECTOR_EMBED_REPAIR=true` admits an explicit repairable
  pending row (ADR-2014).
- Invariant 2 says "Validator W066 diagnoses but does not reject the inversion".
  ADR-2017's closeout added `consumerAdmission()` in `mcp/servers/lib/ruvector-gates.js`,
  a single runtime decision every consumer calls before applying an effect, so an env
  override on a running process is caught too.

Exposed by diagrams AB-20.2 and AB-21.7. An invariant that understates its own
enforcement invites a future change to weaken the code and call it compliant.

## Decision

The Invariants section of `docs/LEARNING-memory.md` states the rule the code enforces,
with no "intended policy" hedge. Invariant 1 is: an embedding failure rejects the write;
the only route to a row without an embedding is the explicit, repairable
`RUVECTOR_EMBED_REPAIR` path, which marks `embedding_state: 'pending'` for
`memory_repair_embeddings` to recover. Invariant 2 is: a learning consumer takes effect
only when `consumerAdmission()` admits it — master gate on, consumer gate on, and either
the producer capturing or an operator-named retained-corpus receipt that is non-empty,
dateable and fresher than `RUVECTOR_RETAINED_CORPUS_MAX_AGE_DAYS`; the static validator
rule (E066/W066) mirrors the same invariant at config time.

Where an invariant is genuinely aspirational it says so explicitly and names the gap.
The two dated "qualification" sections that carried the old hedges are marked resolved
rather than deleted, so the history stays readable.

## Consequences

- A reviewer can now test compliance directly: weaken either enforcement and the
  invariant is violated on its face, rather than arguably satisfied by intent.
- The dated closeout qualifications at the foot of the governing doc no longer contradict
  the Invariants section above them.
- Follow-on: none for the code — this ADR changes no behaviour. It is a documentation
  correction that makes the compliance surface honest.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty.

- Invariant 1 enforcement read directly in `mcp/servers/lib/memory-tools.js`: the
  header block documenting `FAIL-CLOSED (default) embedding failure REJECTS the write`,
  and the `memStore` branch returning
  `error: 'embedding unavailable — write rejected (ADR-2014 fail-closed)'`,
  `reason: 'embedding-unavailable'` with the `RUVECTOR_EMBED_REPAIR` remedy.
- Invariant 2 enforcement read directly in `mcp/servers/lib/ruvector-gates.js`:
  `consumerAdmission(which, obs)` returning `consumer-gate-off`, `master-learning-off`,
  `active-capture`, `producer-off-and-retained-corpus-not-accepted`,
  `retained-corpus-empty`, `retained-corpus-freshness-unknown`, `retained-corpus-stale`
  or `retained-corpus-accepted`, with the stated rationale that "an environment override
  cannot skip it — there is no boolean that means 'trust me'".
- `grep -n "not enforced on every write today\|does not reject the inversion" docs/LEARNING-memory.md`
  → no matches after the edit.
