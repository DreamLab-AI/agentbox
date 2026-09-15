---
expectation_id: EXP-AC-003
parent_spec: PRD-augmentation-conditions FR3.4
linked_adrs: [ADR-2011, ADR-2087]
git_sha: 37a1a1988
produced_by: agent:claude-opus
produced_at: 2026-09-14T15:30:00Z
repo: agentbox
audited_by: agent:claude-sonnet-5
audited_at: 2026-09-14T00:00:00Z
auditor_verdict: fail
auditor_counter_examples_attempted: 2
auditor_counter_examples_found: 1
status: re-audit-pending
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

## Iteration after audit

The auditor's counter-example is closed. `classifyAction` no longer lets a
SKILL.md `authority_class` win outright over the operator's manifest entry: the
two are resolved on a TIGHTENING LATTICE (`authorityRank`: `recoverable` = 0,
`zero-tolerance` / `escalation-required` = 1), so the tighter class wins
whichever surface it came from. A refused loosening is never silent — it is
named on a structured `authority.frontmatter-loosening-ignored` log line
carrying `{action_class, manifest_class, frontmatter_class}` and appended to the
hash-chained authority journal beside the deny it causes (best-effort on the
same terms as `authority.deny`: a journal failure never converts a refusal into
an exception).

Where the operator has tabled NOTHING for an action class, frontmatter remains
the sole declaration and still classifies. That is deliberate and is not the
reported hole: rule 1 of `lib/authority.js` says an action carried on neither
surface escalates, which makes frontmatter a legitimate place to classify an
untabled action. What it may never do is demote one the operator HAS tabled.

`lib/task-properties.js` `derive()` closes the second half. A SKILL.md
`task_properties` block used to run through `applyOperatorOverride`, which SETS
verifiability and stakes freely; it now runs through `merge` — the same
tightening lattice an agent-supplied request triple goes through. A SKILL.md
ships with the skill and is not the operator's `agentbox.toml`, so exactly one
surface may loosen anything, and it is the manifest. `applyOperatorOverride` is
retained and re-documented as the manifest-only path.

Docstrings updated on both modules: rule 1 in `lib/authority.js` now states the
tightening invariant, and the WHO MAY LOOSEN block in `lib/task-properties.js`
enumerates the three tightening-only surfaces rather than calling frontmatter an
operator surface.

Files changed: `management-api/lib/authority.js`,
`management-api/lib/task-properties.js`, `tests/sovereign/authority.test.js`,
`tests/sovereign/task-properties.test.js`.

### Scenario 4 — the counter-example, as a failing test then a passing one

Written red first. Before the fix, against HEAD `5d0fb6e51`:

```
Test Suites: 2 failed, 2 total
Tests:       12 failed, 39 passed, 51 total
```

Command:

```
cd management-api && HOME=$SCRATCH ../node_modules/.bin/jest \
  ../tests/sovereign/authority.test.js --verbose
```

Raw output (result block):

```
    ✓ produces 31402 requests, consumes 31403 responses (1 ms)
    ✓ malformed class entries are dropped; enabled + default honoured (1 ms)
    ✓ classifies known action classes from the config table (1 ms)
    ✓ FALSIFICATION 1: an unclassified action defaults to escalation-required, NOT permissive
    ✓ SKILL.md frontmatter authority_class overrides the table (1 ms)
    ✓ a recoverable action proceeds with NO blocking wait and NO decision call (1 ms)
    ✓ a zero-tolerance action BLOCKS, publishes a 31402, and releases on a verified approve (1 ms)
    ✓ FALSIFICATION 2a: a zero-tolerance action with NO decision surface is DENIED (fail-closed)
    ✓ FALSIFICATION 2b: a timed-out / absent signed response DENIES, never proceeds
    ✓ FALSIFICATION 2c: a REJECT decision denies the action (1 ms)
    ✓ an UNVERIFIED signature denies (consume the forum signing, trust nothing blind) (1 ms)
    ✓ an unclassified action also escalates through the block-on-signed-response path (1 ms)
    ✓ FALSIFICATION 3: the gate never signs a 31403 — it only builds 31402 requests
  EXP-AC-003 — frontmatter authority_class may only TIGHTEN the manifest class
    ✓ COUNTER-EXAMPLE: zero-tolerance in the manifest is NOT loosened to recoverable by frontmatter (1 ms)
    ✓ tightening is still honoured: recoverable in the manifest → zero-tolerance on the skill
    ✓ where the operator declared NOTHING, frontmatter is the sole declaration and classifies
    ✓ an ignored loosening is NAMED in a structured log line (action, manifest class, frontmatter class) (2 ms)
    ✓ a TIGHTENING frontmatter logs nothing — only a refused loosening is reported
    ✓ the onLoosening hook reports the attempt for callers that journal it
    ✓ the gate BLOCKS a zero-tolerance action carrying a loosening frontmatter
    ✓ the gate JOURNALS the refused loosening alongside the deny (1 ms)
    ✓ a journal that throws on the loosening record never converts the gate into an exception
  EXP-AC-003 — against the REAL agentbox.toml
    ✓ ontology_axiom_load is zero-tolerance in the running manifest
    ✓ COUNTER-EXAMPLE: a skill claiming authority_class=recoverable cannot demote it
    ✓ COUNTER-EXAMPLE: and the derived triple stays irreversible / opaque / critical
Test Suites: 1 passed, 1 total
Tests:       25 passed, 25 total
```

The three load-bearing cases run against the REAL `agentbox.toml` (loaded via
`manifest-loader.loadManifest()` with `AGENTBOX_MANIFEST_PATH`, not a fixture):
`ontology_axiom_load` is `zero-tolerance` in the running manifest; a skill
claiming `authority_class: recoverable` on it still classifies
`zero-tolerance`; and the derived triple stays
`{opaque, irreversible, critical}` even when the frontmatter ALSO declares
`{inspectable, reversible, bounded}`.

**Verdict: PASS.**

### Scenario 5 — the frontmatter triple on the tightening lattice

Command:

```
cd management-api && HOME=$SCRATCH ../node_modules/.bin/jest \
  ../tests/sovereign/task-properties.test.js --verbose
```

Raw output (result block):

```
PASS ../tests/sovereign/task-properties.test.js
    ✓ the three axes carry exactly the ADR-2011 values, loosest first (3 ms)
    ✓ tag names are the wire contract the forum reads (1 ms)
    ✓ ADR-2011: zero-tolerance ⇒ irreversible
    ✓ ADR-2011: recoverable ⇒ compensable
    ✓ an unclassified (escalation-required) action is treated as irreversible — fail-closed
    ✓ EXP-AC-003: a zero-tolerance action class derives reversibility=irreversible (18 ms)
    ✓ a recoverable action class derives compensable with its declared axes (1 ms)
    ✓ an action class with no per-class entry falls to the manifest defaults
    ✓ with no manifest at all the defaults are partial / irreversible / significant (fail-closed)
    ✓ SKILL.md frontmatter sets verifiability and stakes like authority_class does (1 ms)
    ✓ frontmatter authority_class re-seeds reversibility
    ✓ COUNTER-EXAMPLE: frontmatter may not LOOSEN the derived reversibility
    ✓ COUNTER-EXAMPLE: an agent-requested triple may only tighten, never loosen
    ✓ an agent-requested triple that TIGHTENS is honoured
    ✓ a malformed requested value is ignored, not fatal (1 ms)
    ✓ loadTaskPropertyTable drops malformed manifest entries
    ✓ PROPERTY: merge(base, other) is never looser than base on any axis (203 ms)
    ✓ toTags always emits all three tags in a stable order (1 ms)
    ✓ fromTags round-trips, and returns null for a legacy untagged event
    ✓ isTaskProperties rejects anything not a complete, valid triple (1 ms)
    ✓ COUNTER-EXAMPLE: frontmatter cannot loosen verifiability or stakes
    ✓ a frontmatter triple that TIGHTENS is still honoured on every axis
    ✓ COUNTER-EXAMPLE: frontmatter authority_class cannot loosen the manifest seed
    ✓ frontmatter authority_class may still TIGHTEN an operator-recoverable class
    ✓ PROPERTY: no frontmatter triple, on any action class, is ever looser than the manifest derivation (12 ms)
    ✓ derive threads a logger through to classifyAction so a refused loosening is reported
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total
```

The property case is exhaustive over the action classes × all 27 frontmatter
triples: no frontmatter triple, on any class, is ever looser than the manifest
derivation on any axis.

**Verdict: PASS.**

### Scenario 6 — whole-tree regression

Command:

```
cd management-api && HOME=$SCRATCH ../node_modules/.bin/jest
```

Raw output:

```
Test Suites: 86 passed, 86 total
Tests:       3 skipped, 34 todo, 1399 passed, 1436 total
Snapshots:   0 total
Time:        6.274 s
Ran all test suites.
```

Baseline at HEAD `5d0fb6e51` on the same runner: 86 suites, 1381 passed. The
delta is +18 passing tests and zero regressions.

The two `node:test` suites the repo runs for this surface are also green,
unchanged:

```
$ AGENTBOX_MANIFEST_PATH=$PWD/agentbox.toml node --test mcp/servers/__tests__/governance-bridge.test.mjs
# tests 10
# pass 10
# fail 0

$ cd management-api && node --test ../tests/contract/harness-bridge.contract.spec.js \
    ../tests/contract/upstream_vectors/all_fixtures.test.js
# tests 56
# pass 56
# fail 0
```

**Verdict: PASS.**

### Still not claimed

The scope note at the top stands unchanged: `effective_tier()`, the relay
default folding, the member-suppression rule and activation (no rebuild) remain
out of this repo's scope. The production call sites the auditor checked still do
not pass `params.frontmatter` into `guard()`, so this remains a fix to the
shared module's contract ahead of its first caller — the difference is that the
contract now holds.

## Post-merge config-gate triage (main 93456a8f3)

After the merge into `main`, `./node_modules/.bin/jest --config package.json`
reported 2 suites / 72 tests / **10 failed**. Split by bisecting against a
detached worktree at the pre-merge `main` (`5b4d63846`), same command, same
runner:

| Failure | Origin |
|---|---|
| 9 × `tests/config/semantic-rules.test.js` (E016 "valid: no unknown keys", `skills.ontology` gate, W017 ×2, W031, W038, W039 ×2, W041) | **Introduced by the merge** — fixed below |
| 1 × `tests/config/multi-user-regression.test.js` "admin-users routes module exists and is a stub returning 501" | **Pre-existing at 5b4d63846** — the guard greps the routes module's docstring for `/PRD-007/` and that file cites its endpoints and `[sovereign_mesh.multi_user]` but never names PRD-007; unrelated to this branch, left as found. |

Baseline at `5b4d63846`: 1 failed / 70 passed / 1 skipped. Merged `main` after
the fix: **1 failed / 70 passed / 1 skipped** — identical, so the merge now adds
no config-gate failure of its own.

### The cause was not the schema

The suspicion was that the new `[skills.authority.task_properties]` sub-sections
were unknown to `schema/agentbox.toml.schema.json`. They are not: the nine cases
all assert `exitCode === 0` on a **fixture** manifest, and every one of them was
failing on the same unrelated error, visible only by running the validator by
hand:

```
$ node scripts/agentbox-config-validate.js /tmp/base.toml
E-SKILL1: skill-count drift — skills/SKILL-DIRECTORY.md:3 states 129 skills but skills/*/SKILL.md counts 130
E-SKILL1: ... SKILL-DIRECTORY.md:35 ... :41 ... :307 ... CLAUDE.md:34
EXIT=1
```

`scripts/agentbox-config-validate.js` runs the RES-d repo-wide skill-count check
regardless of which manifest file it is handed, so a documentation count drift
fails the validator for EVERY fixture and takes all nine "expect exit 0" cases
with it. `feat/augmentation-conditions` added a 130th skill (`diagrams-as-code`,
commit 690847280) and the merge carried it to `main`, while five prose claims
still said 129.

The rest of that skill's discovery wiring had landed correctly — its
`SKILL-DIRECTORY.md` rows, its `skill-router/references/section-map.json` entry
and its `skills/registered-skills.txt` registration are all present, and
`skills/lint-skills.sh` was already passing and already reporting 130. Only the
counts were stale, so the fix is the five lines the checker names, not a schema
or a wiring change.

```
$ node scripts/skill-count-check.js   # after
count 130
all ok: True
```

### Counts after the fix

```
$ cd management-api && HOME=$SCRATCH ../node_modules/.bin/jest
Test Suites: 86 passed, 86 total
Tests:       3 skipped, 34 todo, 1399 passed, 1436 total

$ cd management-api && HOME=$SCRATCH npm run test:node
# suites 9
# pass 56
# fail 0

$ HOME=$SCRATCH ./node_modules/.bin/jest --config package.json
Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 1 skipped, 70 passed, 72 total    # the pre-existing PRD-007 guard
```
