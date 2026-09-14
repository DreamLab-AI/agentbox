---
expectation_id: EXP-AC-004
parent_spec: PRD-augmentation-conditions FR4.2, FR4.4
linked_adrs: [ADR-2010, ADR-2087]
git_sha: bc4a9b259483b99e57bc8ba73feeac54c7dae19e
produced_by: agent:claude-opus
produced_at: 2026-09-14T15:32:00Z
repo: agentbox
audited_by:
---

# Evidence: EXP-AC-004 — a human learns whether their decision applied, and no denial is silent

**Scope note.** EXP-AC-004 spans three substrates. agentbox owns two clauses:
*"`broker-bridge` posts the receipt after `ApplicationReceiptStore.begin/finish`;
a failed post writes an `authority.receipt-post-failed` journal record"* (FR4.2)
and *"authority-gate denials append `authority.deny {stage, reason}` to the
execution journal and appear at `/v1/agent-events`"* (FR4.4). The endpoint's own
stage machine and 409/403 semantics, the relay ageing cron, and VisionClaw's
`ElevationActor` TTL are other repos' and are not claimed here.

## Scenario 1 — every deny path is journalled, with a stage and a reason

Command:

```
HOME=$SCRATCH node_modules/.bin/jest --config management-api/package.json \
  --rootDir . tests/sovereign/authority-augmentation.test.js
```

Raw output (the EXP-AC-004 block):

```
    ✓ a zero-tolerance action publishes tp-reversibility=irreversible (4 ms)
    ✓ an escalation-required (unclassified) action is stamped irreversible — fail-closed (1 ms)
    ✓ a caller-supplied task_properties may tighten but never loosen (1 ms)
    ✓ the resolved triple is returned on the gate result for the caller to record
    ✓ a recoverable action still reports its triple with no publish (1 ms)
    ✓ the deny carries code + hint naming governance_manual_continue (1 ms)
  EXP-AC-004 — every deny path journals an authority.deny record
    ✓ deny path "no decision surface wired" is journalled with stage + reason (2 ms)
    ✓ deny path "missing or invalid operation" is journalled with stage + reason (1 ms)
    ✓ deny path "publish failed" is journalled with stage + reason (2 ms)
    ✓ deny path "producer returned no request id" is journalled with stage + reason (2 ms)
    ✓ deny path "producer signed a different payload" is journalled with stage + reason (1 ms)
    ✓ deny path "decision wait errored" is journalled with stage + reason (1 ms)
    ✓ deny path "no signed response (timeout)" is journalled with stage + reason (1 ms)
    ✓ deny path "unverified signature" is journalled with stage + reason (2 ms)
    ✓ deny path "a decision that is not an approval" is journalled with stage + reason (1 ms)
    ✓ an ALLOW journals nothing — only denials are recorded (1 ms)
    ✓ an approved zero-tolerance release journals nothing (3 ms)
    ✓ a journal that throws never converts a deny into an exception
    ✓ the gate still works with no journal wired (backward compatible)
```

All nine deny paths in `lib/authority.js` are enumerated as a table-driven case
each — no-decision-surface, invalid operation, publish failure, missing request
id, payload substitution, await error, timeout, unverified signature, and a
non-approving outcome — and each asserts `type`, `stage`, `reason`,
`action_class`, `authority_class`, `agent_did`, `task_properties` and
`operation_sha256` on the record. The last three cases pin the negative space:
an allow journals nothing, a throwing journal never converts a deny into an
exception, and a gate with no journal wired still behaves as before.

**Verdict: PASS.**

## Scenario 2 — the record is hash-chained AND reaches /v1/agent-events

Command:

```
HOME=$SCRATCH node_modules/.bin/jest --config management-api/package.json \
  --rootDir . tests/sovereign/authority-journal.test.js
```

Raw output:

```
PASS tests/sovereign/authority-journal.test.js
  buildAuthorityJournal
    ✓ dispatches a hash-chainable authority.deny event through the events adapter (4 ms)
    ✓ emits to the agent-event publisher so /v1/agent-events shows the denial (1 ms)
    ✓ a stage or reason is mandatory — an unlabelled denial is not a record (11 ms)
    ✓ a failing events adapter is reported, not swallowed, and the publisher still sees it
    ✓ with no events adapter the record still reaches /v1/agent-events
    ✓ a failing publisher does not prevent the hash-chained append (1 ms)
    ✓ both sinks failing surfaces an explicit unrecorded result — never a silent success
  FR4.2 — the same journal carries receipt-post failures
    ✓ a receipt-post-failed record selects its own event kind (1 ms)
    ✓ an unknown type falls back to authority.deny rather than minting a new kind

Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        0.219 s, estimated 1 s
Ran all test suites matching /tests\/sovereign\/authority-journal.test.js/i.
```

The record is dispatched through the ADR-005 events adapter with
`kind: 'authority.deny'` (which is what gives it the ADR-039 `prev_hash`/`hash`
chain) *and* emitted to the agent-event publisher that backs `/v1/agent-events`.
Each sink can fail independently and the result says which took the record; two
failing sinks produce an explicit `{journalled: false, published: false, error}`
rather than a silent success.

**Design note, stated for the auditor.** The PRD says "execution journal". The
ADR-057 `ExecutionJournal` has a CLOSED, turn-scoped vocabulary
(`turn.started` … `turn.completed`) and a per-session contiguous `seq`; a gate
denial is neither turn-scoped nor session-contiguous. Widening that vocabulary
would have changed an ADR-057 schema invariant to carry an event it was not
designed for. The denial therefore rides the SAME events adapter the journal
rides — which is where the hash chain actually lives — under its own kind. The
property the expectation asks for (hash-chained, readable at
`/v1/agent-events`) holds; the mechanism differs from a literal reading.

**Verdict: PASS, with the design note above.**

## Scenario 3 — broker-bridge posts both stages, in ladder order

Command:

```
HOME=$SCRATCH node --test management-api/tests/broker-bridge-receipts.test.js
```

Raw output:

```
ok 1 - FR4.2: an applied decision posts consumer-received then applied, in ladder order
ok 2 - FR4.2: a decision whose write-back did not commit posts not-applied
ok 3 - an UNKNOWN outcome posts no terminal receipt — absence is not fabricated as not-applied
ok 4 - a recoverable decision mirrors nothing — there is no signed approval to report on
ok 5 - a publisher that throws never fails the decision — the mutation already happened
ok 6 - a queued (unreachable-forum) receipt still leaves the decision successful
# tests 6
# pass 6
# fail 0
```

`consumer-received` is posted after `begin` and BEFORE the mutation is attempted,
so a crash in between leaves the human looking at an honest "in flight" rather
than silence; the terminal stage is posted after `finish`. A write-back that did
not commit posts `not-applied` (and the route still returns 502). A publisher
that throws, or that queues because the forum is unreachable, never fails the
decision — the mutation has already happened.

The PRD's counter-example — *"a decision projected `projection-committed` forever
while the mutation failed, with no receipt"* — is covered by the `not-applied`
case.

## Scenario 4 — a failed post is journalled and queued, never dropped

Command:

```
HOME=$SCRATCH node_modules/.bin/jest --config management-api/package.json \
  --rootDir . tests/sovereign/governance-receipt-publisher.test.js
```

Raw output:

```
    ✓ the four application stages are exactly the protocol ladder (3 ms)
  posting a receipt
    ✓ POSTs the stage to the forum endpoint with a NIP-98 Authorization header (2 ms)
    ✓ carries acknowledgement, executed_by and evidence when supplied (1 ms)
    ✓ the NIP-98 token is bound to the exact method, url and body (1 ms)
    ✓ rejects a stage outside the ladder and an invalid response id (25 ms)
  failure handling — never silent, never dropped
    ✓ a network failure journals authority.receipt-post-failed and queues for retry (3 ms)
    ✓ a 5xx is retryable — queued (1 ms)
    ✓ a 409 regression is TERMINAL — journalled, but never queued for retry
    ✓ a 403 is TERMINAL — the receipt is not authorised, retrying cannot help (1 ms)
    ✓ an unconfigured forum endpoint queues rather than discarding the receipt (1 ms)
    ✓ an unavailable NIP-98 signer queues rather than posting unsigned (2 ms)
    ✓ the env var overrides the manifest base url
  the retry flusher
    ✓ a queued receipt is replayed and removed on success (2 ms)
    ✓ a still-failing receipt stays queued with its attempt history (2 ms)
    ✓ a 409 on replay retires the entry — the forum already has a later stage (1 ms)
    ✓ an exhausted entry is kept on disk as `failed`, never deleted (2 ms)
    ✓ flushing an empty (or absent) outbox is a no-op

Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
Snapshots:   0 total
Time:        0.29 s, estimated 1 s
Ran all test suites matching /tests\/sovereign\/governance-receipt-publisher.test.js/i.
```

A network failure or 5xx journals `authority.receipt-post-failed` and writes a
durable queue entry; a 409 stage regression and a 403 are journalled and
retired, because a retry cannot change that answer; an unconfigured endpoint or
an unavailable NIP-98 signer QUEUES rather than posting unsigned or discarding.
An exhausted entry is parked on disk as `failed` and never deleted.

**Verdict: PASS.**

## Not claimed

- The forum endpoint's own stage machine, its 409-on-regression and 403-on-
  non-admin behaviour (nostr-rust-forum). agentbox's tests exercise its
  *reaction* to those statuses, against a fetch double.
- The relay ageing cron and `escalated-on-age` idempotency.
- VisionClaw `ElevationActor` TTL, boot reconciliation, `expired` receipts.
- Activation: `[sovereign_mesh.relay].forum_auth_api` is empty and the endpoint
  is not deployed, so no receipt has yet posted to a live forum. Every attempt
  in that state is journalled and queued — which is the intended degraded
  behaviour, not a passing integration.
