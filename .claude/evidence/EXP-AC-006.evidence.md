---
expectation_id: EXP-AC-006
parent_spec: PRD-augmentation-conditions FR6.6
linked_adrs: [ADR-2010, ADR-2087]
git_sha: bc4a9b259483b99e57bc8ba73feeac54c7dae19e
produced_by: agent:claude-opus
produced_at: 2026-09-14T15:34:00Z
repo: agentbox
audited_by: agent:claude-sonnet-5
audited_at: 2026-09-14T00:00:00Z
auditor_verdict: pass
auditor_counter_examples_attempted: 5
auditor_counter_examples_found: 0
---

# Evidence: EXP-AC-006 — the dream-cycle ledger measures the human, not only the agent

**Scope note.** EXP-AC-006 is overwhelmingly a forum expectation (reviewer
telemetry endpoint, delegation admission, calibration sampling, probe blindness)
plus a VisionClaw one (`CaseView.createdAt`). agentbox owns exactly one clause:
*"The dream-cycle ledger row schema includes `Reviewer` and `Review-minutes`."*
That is the only clause claimed here.

Nine of the ten ledger columns measure what the AGENT did on a given night.
Conditions C4 (deepening learning) and C6 (job purpose) are longitudinal and need
a HUMAN measurement, repeated; these two columns are the first one in this
ledger. Per DDD §6 invariant 9 the first reading is a BASELINE — a pass needs a
second measurement no earlier than 90 days later.

## Scenario 1 — the reader (cockpit): 12 columns, with the legacy width as the floor

Command:

```
HOME=$SCRATCH node_modules/.bin/jest --config management-api/package.json \
  --rootDir . tests/integration/dream-ledger-reviewer.test.js
```

Raw output:

```
PASS tests/integration/dream-ledger-reviewer.test.js
  the 12-column row schema
    ✓ LEDGER_KEYS gains reviewer and reviewMinutes, in that order, at the end (2 ms)
  parsing
    ✓ a 12-column row yields the reviewer and review minutes (1 ms)
    ✓ a did:nostr reviewer is preserved verbatim (1 ms)
    ✓ BACKWARD COMPATIBILITY: a legacy 10-column row parses with both fields null (1 ms)
    ✓ a 12-column ledger and a 10-column ledger can be read as one series (1 ms)
    ✓ ABSENCE RENDERS AS ABSENCE: empty / placeholder cells are null, never 0 or ""
    ✓ a non-numeric review-minutes cell is null, not NaN
    ✓ a negative review-minutes cell is rejected — a merge cannot precede its PR
    ✓ a row shorter than the legacy width is still skipped
  reviewFromMergeEvent
    ✓ a merged PR yields the merging identity and the elapsed review minutes
    ✓ a did:nostr merger is preserved; a login object is read by `login`
    ✓ minutes round to the nearest whole minute
    ✓ NEVER FABRICATED: an unmerged, absent or unparseable event yields nulls (1 ms)
    ✓ a merge recorded BEFORE the PR opened is refused rather than negated
  reviewerStats — the human measurement
    ✓ counts reviews and reports median minutes per reviewer
    ✓ an even count takes the mean of the two middle values
    ✓ legacy rows count as UNREVIEWED, not as a reviewer named ""
    ✓ a reviewer with no timing yields a null median, never a zero (1 ms)
    ✓ tolerates an empty row set

Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
Snapshots:   0 total
Time:        0.222 s, estimated 1 s
Ran all test suites matching /tests\/integration\/dream-ledger-reviewer.test.js/i.
```

`LEDGER_KEYS` gains `reviewer` and `reviewMinutes` APPENDED, so every existing
cell still lands on the same key; `LEGACY_LEDGER_KEYS` is asserted to be the
unchanged first ten. A ten-column row parses with both fields `null`, and a
mixed-width file reads as one series.

**Absence renders as absence** is tested explicitly: empty, `—`, `-`, `NONE` and
`n/a` all read back `null`; a non-numeric duration is `null`, not `NaN`; and a
negative duration is refused rather than recorded — a merge cannot precede its
PR. A fabricated `0` would read downstream as "reviewed instantly", which is the
same class of dishonesty as a fabricated rationale (the PRD's opening NFR).

`reviewerStats()` reports the denominator alongside the measurement
(`reviewed` / `unreviewed`), so a median over two measured nights out of ninety
cannot masquerade as a reviewer metric.

**Verdict: PASS.**

## Scenario 2 — the writer (dream engine): the columns are actually emitted

A column nothing writes is not a schema change. `services/dream-engine/src/ledger.rs`
now writes twelve columns, and `compile.rs` instructs the night's agent to fill
them from the PR merge event — and to leave them EMPTY when it merged nothing.

Command:

```
cd services/dream-engine && cargo test --offline ledger
```

Raw output:

```
test ledger::tests::escape_cell_neutralises_pipes_and_newlines ... ok
test ledger::tests::review_from_merge_never_fabricates_a_duration ... ok
test ledger::tests::review_from_merge_reads_the_merge_event ... ok
test ledger::tests::review_from_merge_rounds_to_the_nearest_minute ... ok
test ledger::tests::unreviewed_leaves_the_human_columns_empty ... ok
test verdict::tests::sanitise_ignores_a_ledger_row_cell_that_breaks_the_contract ... ok
test ledger::tests::bootstraps_missing_file ... ok
test ledger::tests::handles_file_without_trailing_newline ... ok
test verdict::tests::sanitise_prefers_the_reports_own_ledger_row_cell ... ok
test ledger::tests::escaping_keeps_row_parseable ... ok
test ledger::tests::append_adds_exactly_one_line ... ok
test ledger::tests::round_trip_parses_into_twelve_cells ... ok
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 154 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`review_from_merge()` mirrors the JS reader's rules exactly: whole minutes
rounded to nearest, empty on a missing or unparseable timestamp, empty on a merge
recorded before its PR opened. The full crate suite is 166 passed.

**Verdict: PASS.**

## Not claimed

- `GET /api/governance/reviewers` and every field in it (nostr-rust-forum).
- Delegation admission, calibration sampling bounds, probe blindness (relay).
- VisionClaw `CaseView.createdAt` and oldest-first queue ordering.
- That any reviewer has yet been MEASURED: the columns exist and are written
  empty until a night's PR merges with an available merge event. This evidence
  establishes the schema and the writer, not a data series. The C4/C6 baseline
  begins at the first populated row.

## Auditor adversarial probes

Re-ran the producer's two stated commands — both PASS as claimed (19/19 JS,
12 relevant Rust ledger tests + 154 filtered out of the full 166-test crate
suite), git sha `19463a588` HEAD or later on `feat/augmentation-conditions`.
Then five adversarial probes against `management-api/lib/dream-ledger.js`
(the agentbox-owned clause: the row schema includes `Reviewer` and
`Review-minutes`), on synthetic markdown built by hand rather than the
producer's fixtures, under `/tmp/audit-scratch` (not committed).

### Probe 1 — a genuine 10-column legacy row, WITH a pipe-escape in a data cell

```
| 2026-09-01 | yes | a race \| condition in X | #12 | #8 | yes | ACCEPT | fixed flaky test | agent-1 | #8:MERGED |
```

Output: `reviewer: null, reviewMinutes: null`, `finding` contains a literal
`|`. **PASS** — the legacy floor parses, and the pipe-escape does not corrupt
column alignment (a narrower probe than the producer's fixture, which did not
combine a legacy-width row with an escaped pipe in the same case).

### Probe 2 — one file containing BOTH a 10-column and a 12-column row (the exact "reads as one series" claim)

Ten-column row → `reviewer: null`; twelve-column row → `reviewer:
"did:nostr:dd…", reviewMinutes: 42`. **PASS.**

### Probe 3 — negative review-minutes via two different paths

`reviewFromMergeEvent({merged_at: <before> pr_opened_at})` → `reviewMinutes:
null` (refused, not negated). A ledger row with a literal `-5` in the
Review-minutes cell → also `null`, not `-5`. **PASS**, both paths agree
(the merge-event path was producer-tested; the literal-negative-cell path was
not).

### Probe 4 — a row one cell SHORT of the legacy floor (9 cells)

`cells.length < LEGACY_LEDGER_KEYS.length` (10) → row dropped entirely, not
partially parsed with a missing trailing field. **PASS**, `rows.length === 0`.

### Probe 5 — `reviewerStats()` on a mix of measured/unmeasured reviews by the SAME reviewer, plus a legacy row

Four rows: one legacy (no reviewer), three by `alice` (minutes `10`, empty,
`30`). Result: `unreviewed: 1`, `alice.reviews: 3`, `alice.measuredMinutes:
2`, `alice.medianReviewMinutes: 20` (median of `[10, 30]`, the empty-minutes
review correctly excluded from the median but still counted as a review).
**PASS** — this is a case the producer's suite exercises with single
reviewers per test; this probe forces a mixed measured/unmeasured set for one
identity within a single ledger.

**Overall verdict for EXP-AC-006 (agentbox scope only): PASS.** No
counter-example found in the schema, parser, or reviewer-statistics
aggregation.
