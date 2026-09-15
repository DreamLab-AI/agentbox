---
id: EXP-AC-007
parent_spec: PRD-augmentation-conditions FR7
linked_adrs: [ADR-2010, ADR-2011]
priority: high
regression_critical: true
evidence_category: executable
status: accepted
authored_by: pair
---

## Expectation: An operator can execute an approved action by hand during an outage and leave a signed, bound receipt

`governance_manual_continue { case_id, executed_by, evidence }` succeeds only when a local application receipt for an `Approve` decision exists for `case_id` with a matching operation digest; it writes stage `applied-manually` with `executed_by` a `did:nostr` human, mints a PROV-O activity whose agent is that human, and posts the receipt to the forum endpoint (queued to the outbox if the forum is unreachable, flushed later, never dropped). The relay accepts `applied-manually` only from an admin pubkey and only for a case in `Decided(Approve)`; otherwise 403/409. The authority gate's `no-decision-surface` deny returns `{code: "no-decision-surface", hint: "governance_manual_continue"}`.

### In scope
- Binding to approved operation digest
- Outbox queuing under forum outage
- Relay admission rule

### Out of scope (intentionally)
- Manual continuation for cases never approved (that is a fresh decision, not a continuation)

### Counter-examples (must NOT happen)
- `applied-manually` recorded for a `Reject`ed or `Open` case
- `executed_by` being an agent DID
- Receipt lost when the forum is down
