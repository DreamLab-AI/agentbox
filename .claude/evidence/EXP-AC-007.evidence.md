---
expectation_id: EXP-AC-007
parent_spec: PRD-augmentation-conditions FR7.1, FR7.3
linked_adrs: [ADR-2010, ADR-2011, ADR-2087]
git_sha: bc4a9b259483b99e57bc8ba73feeac54c7dae19e
produced_by: agent:claude-opus
produced_at: 2026-09-14T15:36:00Z
repo: agentbox
audited_by:
---

# Evidence: EXP-AC-007 — an operator can execute an approved action by hand during an outage and leave a signed, bound receipt

**Scope note.** agentbox owns the tool and the receipt (FR7.1) and the gate's
structured hint (FR7.3). The relay's admission rule — *"accepts
`applied-manually` only from an admin pubkey and only for a case in
`Decided(Approve)`"* — is nostr-rust-forum's and is not claimed here.

## Scenario 1 — the binding, the human, and the refusals

Command:

```
HOME=$SCRATCH node --test management-api/tests/governance-manual-continue.test.js
```

Raw output:

```
ok 1 - isHumanDid accepts only a well-formed did:nostr
ok 2 - the happy path writes applied-manually, mints PROV-O and posts the receipt
ok 3 - COUNTER-EXAMPLE: a case with no local approval is refused
ok 4 - COUNTER-EXAMPLE: a REJECTED case can never be continued manually
ok 5 - COUNTER-EXAMPLE: executed_by being an AGENT DID is refused
ok 6 - COUNTER-EXAMPLE: executed_by being the container's OWN did is refused
ok 7 - a malformed executed_by is refused before anything is written
ok 8 - evidence is mandatory — an unevidenced manual act is not a receipt
ok 9 - an operation digest that does not match the approval is refused
ok 10 - a matching supplied operation is accepted
ok 11 - a case already applied cannot be continued manually a second time
ok 12 - EXP-AC-007: an unreachable forum queues the receipt — the act is never lost
# tests 12
# pass 12
# fail 0
```

The happy path writes `applied-manually` with `acknowledgement {manual: true,
executed_by, evidence}`, mints `urn:agentbox:activity:<human-hex>:sha256-12-…`
and a PROV-O record whose `prov:wasAssociatedWith` is the human DID, and posts
the receipt.

Every counter-example in the expectation is a test:

| Counter-example | Refusal |
|---|---|
| `applied-manually` for a case never approved | `no-approved-receipt` |
| `applied-manually` for a rejected case | `not-approved` |
| a different operation than the approved one | `operation-digest-mismatch` |
| a case already resolved | `already-resolved` |
| `executed_by` being an agent DID | `executor-not-human` |
| `executed_by` being this container's own DID | `executor-not-human` |
| a malformed `executed_by` | `invalid-executed_by` |
| no evidence | `missing-evidence` |

The last line of the suite is the outage case itself: with the publisher
returning `{ok: false, queued: true}`, the local receipt and the provenance
record are still written and the result reports `posted: false, queued: true`.
The act is recorded; the mirror is retried. **Receipt lost when the forum is
down** cannot occur.

**Verdict: PASS.**

## Scenario 2 — the tool surface, end to end, against the real manifest

Command:

```
HOME=$SCRATCH node --test mcp/servers/__tests__/governance-bridge.test.mjs
```

Raw output:

```
ok 1 - the tool table advertises both augmentation-condition tools
ok 2 - EXP-AC-003: a zero-tolerance action class emits tp-reversibility=irreversible
ok 3 - a recoverable action class emits compensable
ok 4 - an UNDECLARED action class still emits all three tags, at the tightest reversibility
ok 5 - COUNTER-EXAMPLE: a caller cannot loosen the operator triple
ok 6 - a caller CAN tighten the operator triple
ok 7 - EXP-AC-007: manual continuation refuses a case with no approval
ok 8 - EXP-AC-007: manual continuation refuses an agent executor
ok 9 - EXP-AC-007: manual continuation validates the executor shape before anything else
ok 10 - EXP-AC-007: an approved case is continued, bound and evidenced
# tests 10
# pass 10
# fail 0
```

Four of these ten cases are EXP-AC-007's: the tool is advertised with
`[case_id, executed_by, evidence]` required; an unapproved case, an agent
executor and a malformed DID are each refused through the MCP boundary; and a
seeded approval is continued, yielding `stage: applied-manually`, a human-scoped
activity URN, and `posted: false, queued: true` (no forum is configured in the
test environment, so the receipt queues — recorded, never claimed as posted).

**Verdict: PASS.**

## Scenario 3 — the operator learns the option at the moment of denial (FR7.3)

Command:

```
HOME=$SCRATCH node_modules/.bin/jest --config management-api/package.json \
  --rootDir . tests/sovereign/authority-augmentation.test.js
```

Raw output (the FR7.3 case):

```
  EXP-AC-007 — no-decision-surface returns a structured manual-continuation hint
    ✓ the deny carries code + hint naming governance_manual_continue (1 ms)
```

The `no-decision-surface` deny returns
`{code: "no-decision-surface", hint: "governance_manual_continue"}` while
preserving the legacy `reason` field, so existing consumers are unaffected.

**Verdict: PASS.**

## Not claimed

- The relay's admission rule for `applied-manually` (admin-only, Decided(Approve)
  only) — nostr-rust-forum.
- Activation: no forum endpoint is deployed and `forum_auth_api` is unset, so no
  `applied-manually` receipt has reached a live relay. The queue-and-replay path
  is what is evidenced.
