---
expectation_id: EXP-AC-003
parent_spec: PRD-augmentation-conditions FR3.4
linked_adrs: [ADR-2011, ADR-2087]
git_sha: bc4a9b259483b99e57bc8ba73feeac54c7dae19e
produced_by: agent:claude-opus
produced_at: 2026-09-14T15:30:00Z
repo: agentbox
audited_by: agent:claude-sonnet-5
audited_at: 2026-09-14T00:00:00Z
auditor_verdict: fail
auditor_counter_examples_attempted: 2
auditor_counter_examples_found: 1
---

# Evidence: EXP-AC-003 — the effective tier derives from operator task properties, and a request can only tighten it

**Scope note.** EXP-AC-003 spans two substrates. `nostr-bbs-core` owns
`TaskProperties`, `effective_tier()` and the relay projection; agentbox owns the
clause verified here: *"agentbox `governance_request_action` for a
`zero-tolerance` action class emits `tp-reversibility=irreversible` and the
authority gate stamps the triple on its 31402."* The pure-function table, the
relay default folding and the member-suppression rule are out of this repo's
scope and are not claimed by this file.

## Scenario 1 — the derivation and the tightening lattice

Command:

```
HOME=$SCRATCH node_modules/.bin/jest --config management-api/package.json \
  --rootDir . tests/sovereign/task-properties.test.js
```

Raw output (trimmed to the result block):

```
    ✓ the three axes carry exactly the ADR-2011 values, loosest first (2 ms)
    ✓ tag names are the wire contract the forum reads
  task-properties.reversibilityFor (the authority_class seed)
    ✓ ADR-2011: zero-tolerance ⇒ irreversible
    ✓ ADR-2011: recoverable ⇒ compensable
    ✓ an unclassified (escalation-required) action is treated as irreversible — fail-closed (1 ms)
  task-properties.derive
    ✓ EXP-AC-003: a zero-tolerance action class derives reversibility=irreversible (15 ms)
    ✓ a recoverable action class derives compensable with its declared axes
    ✓ an action class with no per-class entry falls to the manifest defaults (1 ms)
    ✓ with no manifest at all the defaults are partial / irreversible / significant (fail-closed)
    ✓ SKILL.md frontmatter sets verifiability and stakes like authority_class does
    ✓ frontmatter authority_class re-seeds reversibility
    ✓ COUNTER-EXAMPLE: frontmatter may not LOOSEN the derived reversibility (1 ms)
    ✓ COUNTER-EXAMPLE: an agent-requested triple may only tighten, never loosen
    ✓ an agent-requested triple that TIGHTENS is honoured (1 ms)
    ✓ a malformed requested value is ignored, not fatal
    ✓ loadTaskPropertyTable drops malformed manifest entries (1 ms)
  task-properties.merge (tightening-only, total over all 27×27)
    ✓ PROPERTY: merge(base, other) is never looser than base on any axis (180 ms)
  task-properties tags (the 31402 wire form)
    ✓ toTags always emits all three tags in a stable order
    ✓ fromTags round-trips, and returns null for a legacy untagged event
    ✓ isTaskProperties rejects anything not a complete, valid triple

Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
Snapshots:   0 total
Time:        0.403 s, estimated 1 s
Ran all test suites matching /tests\/sovereign\/task-properties.test.js/i.
```

Covers, in that suite: `zero-tolerance ⇒ irreversible`, `recoverable ⇒
compensable`, unclassified ⇒ `irreversible` (fail-closed), manifest and
frontmatter overrides, and a **property test over all 27×27 triple pairs**
asserting `merge(base, other)` is never looser than `base` on any axis —
the EXP-AC-003 tightening invariant, stated for agentbox's producer side.

**Verdict: PASS.**

## Scenario 2 — the authority gate stamps the triple on its own 31402

Command:

```
HOME=$SCRATCH node_modules/.bin/jest --config management-api/package.json \
  --rootDir . tests/sovereign/authority-augmentation.test.js
```

Raw output (trimmed):

```
PASS tests/sovereign/authority-augmentation.test.js
  EXP-AC-003 — the gate stamps the task-property triple on its 31402
    ✓ a zero-tolerance action publishes tp-reversibility=irreversible (4 ms)
    ✓ an escalation-required (unclassified) action is stamped irreversible — fail-closed
    ✓ a caller-supplied task_properties may tighten but never loosen (1 ms)
    ✓ the resolved triple is returned on the gate result for the caller to record
    ✓ a recoverable action still reports its triple with no publish
  EXP-AC-007 — no-decision-surface returns a structured manual-continuation hint
    ✓ the deny carries code + hint naming governance_manual_continue (1 ms)
  EXP-AC-004 — every deny path journals an authority.deny record
    ✓ deny path "no decision surface wired" is journalled with stage + reason (1 ms)
    ✓ deny path "missing or invalid operation" is journalled with stage + reason (2 ms)
    ✓ deny path "publish failed" is journalled with stage + reason (2 ms)
    ✓ deny path "producer returned no request id" is journalled with stage + reason (1 ms)
    ✓ deny path "producer signed a different payload" is journalled with stage + reason (1 ms)
    ✓ deny path "decision wait errored" is journalled with stage + reason (2 ms)
    ✓ deny path "no signed response (timeout)" is journalled with stage + reason (1 ms)
    ✓ deny path "unverified signature" is journalled with stage + reason (1 ms)
    ✓ deny path "a decision that is not an approval" is journalled with stage + reason (2 ms)
    ✓ an ALLOW journals nothing — only denials are recorded
    ✓ an approved zero-tolerance release journals nothing (1 ms)
    ✓ a journal that throws never converts a deny into an exception
    ✓ the gate still works with no journal wired (backward compatible) (1 ms)

Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
Snapshots:   0 total
Time:        0.231 s, estimated 1 s
Ran all test suites matching /tests\/sovereign\/authority-augmentation.test.js/i.
```

The first five cases are EXP-AC-003's: the published (unsigned) 31402 carries
`tp-verifiability` / `tp-reversibility` / `tp-stakes` tags and a
`fields.task_properties` object; a caller-supplied looser triple is discarded;
the resolved triple is returned on the gate result for the caller to record.

**Verdict: PASS.**

## Scenario 3 — the counter-example, read against the REAL manifest

This is the load-bearing scenario: the test below loads the running
`agentbox.toml`, not a fixture, so it fails if the manifest keys are wired to the
wrong path even when the unit tests pass.

Command:

```
HOME=$SCRATCH AGENTBOX_MANIFEST_PATH=$PWD/agentbox.toml \
  node --test mcp/servers/__tests__/governance-bridge.test.mjs
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

`ontology_axiom_load` is `zero-tolerance` in the real
`[skills.authority.classes]`; the request it publishes carries
`tp-reversibility=irreversible`, `tp-verifiability=opaque`, `tp-stakes=critical`.
An undeclared action class still emits all three tags at the tightest
reversibility. A caller declaring `{inspectable, reversible, bounded}` on that
same class publishes `{opaque, irreversible, critical}` — the counter-example
"a request tag lowering `Irreversible` to `Reversible`" cannot occur.

**Verdict: PASS.**

## Not claimed

- `effective_tier()` and its boundary table (nostr-bbs-core).
- Relay storage of the effective tier on `broker_cases`, and NIP-11 default
  folding for an unlabelled 31402.
- The member-suppression rule for `Opaque` verifiability.
- Activation: the container has not been rebuilt, so no running agent has yet
  published a triple-tagged 31402 to the live relay.

## Auditor adversarial probes

Re-ran the producer's three stated commands first — all three PASS exactly as
claimed (20/20, 19/19, 10/10 tests, git sha `19463a588` HEAD or later on
`feat/augmentation-conditions`). Then ran probes the producer did not run.

### Probe 1 — an agent-requested triple loosening the class default (a variant of the producer's own `merge` test, run against the real manifest, not a fixture)

Command (`/tmp/audit-scratch/probe-ac003-1-loosen-request.js`, throwaway, not committed):

```js
const props = tp.derive('ontology_axiom_load', {
  manifest,                 // the REAL agentbox.toml
  authorityClass: 'zero-tolerance',
  requested: { verifiability: 'inspectable', reversibility: 'reversible', stakes: 'bounded' },
});
```

Output:

```
derived with LOOSENING request: {"verifiability":"opaque","reversibility":"irreversible","stakes":"critical"}
VERDICT: PASS (tightened, request loosening rejected)
```

**Verdict: no counter-example.** `derive()`'s `merge()` step held the tightest
triple against a fully-loosened request on the real manifest, not just the
test fixture.

### Probe 2 — a zero-tolerance class with a SKILL.md `authority_class` override to `recoverable` (the exact probe the mandate asked for: "which wins?")

The evidence's own scenarios never call `classifyAction`/`derive` with a
`frontmatter.authority_class` that DISAGREES with the manifest's classification
for the SAME action class — every frontmatter case in
`tests/sovereign/task-properties.test.js` and `authority-augmentation.test.js`
either matches the manifest or targets an undeclared class. This probe forces
that disagreement directly against the real `agentbox.toml`, where
`ontology_axiom_load` is `zero-tolerance`:

Command (`/tmp/audit-scratch/probe-ac003-2-skillmd-override.js`):

```js
const cls = authority.classifyAction('ontology_axiom_load', {
  table, frontmatter: { authority_class: 'recoverable' },
});
const props = tp.derive('ontology_axiom_load', { manifest, frontmatter: { authority_class: 'recoverable' } });
```

Output:

```
manifest classification for ontology_axiom_load: zero-tolerance
classifyAction() with SKILL.md frontmatter override authority_class=recoverable: recoverable
derived task-properties with the same override: {"verifiability":"opaque","reversibility":"compensable","stakes":"critical"}
VERDICT: FRONTMATTER WINS
```

**Verdict: CONFIRMED counter-example, inside EXP-AC-003 scope.** `lib/authority.js:123-132`
(`classifyAction`) checks `fm.authority_class` FIRST, ahead of the manifest
table. `lib/task-properties.js:190-197` (`derive`) calls `classifyAction` with
the SAME `frontmatter` before deriving reversibility from it. The result: a
`frontmatter.authority_class` of `recoverable` turns `zero-tolerance`'s
`irreversible` seed into `compensable` — the exact shape of counter-example
EXP-AC-003 names ("a request tag lowering `Irreversible` to `Reversible`"),
via a *different* input (`frontmatter.authority_class`, not
`taskProperties`/the "request tag" the expectation and the producer's tests
actually exercise). `lib/task-properties.js`'s own docstring asserts
"Reversibility is tightening-only against the `authority_class` seed on every
surface, so 'zero-tolerance ⇒ irreversible' is an invariant, not a default" —
that invariant does not hold once `frontmatter.authority_class` is allowed to
change the seed itself, because nothing downstream re-checks that a
frontmatter-selected class is at least as tight as the manifest's.

**Scope check (why this is not "PASS with a caveat"):** verified by reading
every production call site (`management-api/server.js:1121`,
`routes/broker-bridge.js:272`, `routes/llm-marketplace.js:71`,
`mcp/servers/governance-bridge.js`) — NONE of them currently pass
`params.frontmatter` into `guard()`, so this path is **not reachable through
any route wired today** (confirmed by `grep -rn frontmatter management-api/lib
management-api/routes management-api/server.js`, which shows `frontmatter`
used only inside `lib/authority.js` and `lib/task-properties.js` themselves).
It is a latent defect in the shared module's contract, not a live exploit —
but `guard()` accepts `frontmatter` as a first-class, documented parameter
specifically for this purpose (the module's own comments describe a per-skill
SKILL.md override as intended), so the gap is in the mechanism the PRD asks
for, waiting for its first caller.

Reported as a defect, not fixed (auditor mandate: find and report, not patch).
