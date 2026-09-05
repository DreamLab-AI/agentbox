---
id: ADR-2060
title: Give cross-store erasure a reverse tombstone into RuVector and a restorable memory backup
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: any right-to-erasure design touching agent memory, a RuVector backup mechanism landing, or a reverse-tombstone path being wired from the Pod
repo: agentbox
domain: LEARNING-memory
lineage: LEARNING-memory D5; VisionClaw DATA-authority-erasure (the estate-wide erasure authority)
---

# ADR-2060 — Give cross-store erasure a reverse tombstone into RuVector and a restorable memory backup

## Context

Agent memory is primary in RuVector; the VisionClaw Solid Pod is a separate write-master
for other agent state. The two stores have no erasure link:

- `deleteAgentMemory()` deletes the Pod copy and has **no reverse tombstone into
  RuVector**, so the RuVector-held memory survives a deletion the user believes was
  honoured. This is the estate's largest erasure hole. It is recorded as **D5** in
  `docs/LEARNING-memory.md` and drawn in **AB-20.7** and, from the estate side, in
  **ES-07.9** / **ES-08.9**.
- There is **no point-in-time RuVector backup**. `scripts/backup-sqlite.sh` is
  SQLite-only, so there is no cross-store consistent restore and no RPO or RTO for memory.
  A mistaken erasure is therefore as unrecoverable as a missed one is undetectable.

The gap spans two lanes: the RuVector side is this lane's, the Pod path is
vc-knowledge's, and the erasure *authority* is VisionClaw's `DATA-authority-erasure`
document. Neither lane can close it alone, which is why it has stayed open.

One point of precision, confirmed against the code: **VisionClaw has no RuVector write
client at all** — there is no `RuVectorAdapter` anywhere in `src/` or `crates/`, and
VisionClaw's only RuVector touchpoint is the observational memory-flash WebSocket
broadcast. Any design that assumes VisionClaw can delete from RuVector directly is wrong
from the start; the tombstone must travel as a message to a RuVector-side consumer.

## Decision

**Proposed, not implemented** — this is deliberately larger than a bounded fix, and it
requires both lanes plus a decision recorded in the VisionClaw DATA document. This ADR
states the target so the gap is designed rather than re-discovered.

The decision, when taken:

1. **Erasure is a cross-store operation with one initiator and an acknowledgement.**
   Deleting agent memory emits a tombstone naming the `(agent_id, key)` pair — or the
   subject identifier the erasure request is scoped to — which a RuVector-side consumer
   applies through the governed `memStore`/delete path, never raw SQL, and acknowledges.
   An erasure is complete only when both stores have acknowledged; a partial erasure is a
   recorded, retryable failure, not a silent success.
2. **The tombstone is durable and replayable**, so a consumer that is down at deletion
   time still applies it on recovery. An in-memory notification is not sufficient: the
   whole failure mode here is a deletion that appears to succeed.
3. **RuVector gains a point-in-time backup** with a stated RPO and RTO, so an erasure can
   be audited and a mistaken one recovered. Until it exists, no erasure flow can claim to
   be reversible, and that limitation is stated wherever the flow is documented.
4. **The authority is VisionClaw's `DATA-authority-erasure`.** This ADR is the agentbox-
   side record and does not create a competing authority; the invariant belongs in that
   document, cross-referenced from `docs/LEARNING-memory.md`.

Until all four land, `docs/LEARNING-memory.md` D5 stays open and is cited before any
right-to-erasure work. The gap is not narrowed by documentation alone.

## Consequences

- Named as proposed, the hole stops being folklore split across two lanes' divergence
  lists and becomes one design with an owner and an acceptance test.
- Cost: this is real cross-repo work — a durable message path, an idempotent consumer, a
  backup mechanism with an operational target, and a co-designed decision in the DATA
  document. It is correctly out of scope for a bounded remediation pass.
- Interim honesty: any erasure surface shipped before this lands must say that deletion
  removes the Pod copy only and does **not** revoke RuVector-held memory. Claiming
  otherwise would be the more serious fault.
- Sequencing note: item 3 (backup) is independently valuable and has no cross-repo
  dependency, so it need not wait for the tombstone design.

## Verification

Verification ran on the **uncommitted working tree** above
`89301ec7c911eab270c00a0cf81596d0d4f15535` and must be re-run at the landing commit;
`verified_paths` is therefore empty. `implementation_status: none` — this records a
decision and a plan, not a change.

- **D5 is recorded** in `docs/LEARNING-memory.md` under "Known divergences & open items",
  and is drawn in this lane's **AB-20.7** with a cross-reference to
  `docs/DATA-authority-erasure.md`.
- **The Pod-side deletion exists and is client-side:**
  `client/src/services/SolidPodService.ts:363` `public async deleteAgentMemory(agentId,
  key)`, delegating to the imported `_deleteAgentMemory` (`:55`). No RuVector call
  accompanies it.
- **No RuVector write client exists in VisionClaw** — independently grepped across `src/`
  and `crates/` by the estate lane; the only touchpoint is the observational memory-flash
  WebSocket broadcast (`src/handlers/memory_flash_handler.rs`, routed from
  `src/main.rs`). Confirmed here that this lane's diagrams contain no `RuVectorAdapter`
  reference and make no VisionClaw-writes-RuVector claim.
- **Backup coverage:** `scripts/backup-sqlite.sh` is the only backup script in the tree
  and is SQLite-only. No RuVector/Postgres point-in-time backup mechanism was found.

**Acceptance test for the landing change:** delete an agent memory via the Pod path with
the RuVector-side consumer stopped; restart it; the tombstone is applied on recovery and
`memory_retrieve` for that key returns nothing from either store. With both stores live,
the deletion acknowledges from both before reporting success, and a forced failure of
either side reports a partial erasure that can be retried to completion.
