---
id: ADR-2015
title: The trajectory recorder is transcript-driven and fails open except on honesty and privacy
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 08e817f394a908264c378745193bf7a0bbf6ec0e
verified_paths: [config/hooks/trajectory-recorder.cjs, config/hooks/lib/trajectory-util.cjs]
owner: jjohare
review_trigger: A Claude Code build lands where a successful Bash tool_response carries an exit code, or the redaction pattern set changes
repo: agentbox
domain: LEARNING-memory
lineage: "legacy PRD-018 / ADR-036 (honest producer), DDD-016 (I04 outcome honesty, I10 privacy fail-closed)."
---

# ADR-2015 — The trajectory recorder is transcript-driven and fails open except on honesty and privacy

## Context
The learning corpus is only as trustworthy as its producer. On this Claude Code
build a successful Bash `tool_response` carries no exit code, and `PostToolUse`
does not fire for non-zero exits — so a per-call hook would grade blind. The
transcript, by contrast, records `tool_result.is_error` (DDD-016 I04). A learning
hook must never crash a session (fail-open), yet two things must never be guessed:
an undetermined outcome must not default to success (I04), and a command that
cannot be safely redacted must not be persisted raw (I10, DDD-016).

## Decision
The recorder is driven off `Stop` / `SubagentStop`: it scans the session
transcript from a per-session line watermark and grades each new Bash call by its
recorded `is_error`, persisting one step each. It rejects the `PostToolUse`
route. It is fail-open everywhere — any error exits 0 — **except** two deliberate
fail-closed inversions: `gradeResult` returns `null` (writes nothing) when
`is_error` is absent or the call was `interrupted` rather than defaulting to
success; and `redact` returns `null` on any redaction failure, so the step is
skipped, never persisted raw. This rejects indeterminate grading and thrown redaction failures. It does not
prove that every secret-bearing command is recognised; the closeout extension
records counterexamples to the broader privacy claim.

## Consequences
- The corpus records only determinable outcomes; ambiguous calls leave no trace,
  biasing the aggregates toward honesty at the cost of recall.
- A hook error can never break a user's session, but it can silently drop a step.
- Redaction is conservative (over-redacts), so some benign commands are skipped.
- The whole subsystem is gated default-off and byte-identical to the pre-learning
  product unless both learning env flags are on.

## Verification
implementation_status = complete at verified_commit cbe7335b9. Confirmed by grep:
`config/hooks/trajectory-recorder.cjs:16-26` documents transcript-driven grading
and the PostToolUse rejection, `:309` calls `util.gradeResult(...)`, `:480` gates
on `RUVECTOR_MEMORY_LEARNING_ENABLED` + `RUVECTOR_RECORD_TRAJECTORIES`, `:491-493`
registers only `Stop`/`SubagentStop`. `config/hooks/lib/trajectory-util.cjs`:
`gradeResult` (function body lines 203-213) returns `null` on `interrupted` (line
204) and on absent `is_error` (line 212); `redact` (line 116) returns `null`
fail-closed on non-string input (line 117) and on a thrown redaction (line 125).
Activation is live but gated default-off.

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `11804ba4b` (single egress redaction contract): `config/hooks/lib/trajectory-util.cjs` +178 and `config/hooks/trajectory-recorder.cjs` +109. The change hardens the redactor — a shared `SECRET_WORD` class plus quoted-scalar patterns, and a new `hasResidualSecret()` rejection arm (`trajectory-util.cjs:165-182`) wired into `redact` at `:201`, so a command that still looks secret-bearing after substitution returns `null` instead of being persisted. That directly closes the closeout's counterexamples (quoted-password suffixes, short JSON password values) and strengthens the I10 fail-closed inversion rather than relaxing it, so the decision still holds. The `cbe7335b9` citations above have drifted; at HEAD: transcript-driven grading and the `PostToolUse` rejection are documented at `config/hooks/trajectory-recorder.cjs:16-26`, `util.gradeResult(...)` is called at `:340`, the double gate on `RUVECTOR_MEMORY_LEARNING_ENABLED` + `RUVECTOR_RECORD_TRAJECTORIES` is at `:559`, and only `Stop`/`SubagentStop` are registered at `:569-572`. In `config/hooks/lib/trajectory-util.cjs`, `gradeResult` is at `:285` and returns `null` on `interrupted` (`:286`) and on absent `is_error` (`:294`); `redact` is at `:196` and returns `null` on non-string input (`:197`), on residual secret (`:201`) and on a thrown redaction (`:207`). Executed directly (`node -e` against the module, since `tests/sovereign/trajectory-util.test.js` is Jest-shaped and no runner is wired): interrupted → null, absent `is_error` → null, `is_error:true` → `{success:false,quality:0}`, non-string → null, `--password="hunter2"` and `{"password": "s3cr3t"}` both redacted — 6/6. `implementation_status` stays `partial`: the CP-07/CP-08 persistence, watermark-recovery and live-loop obligations are untouched by this change. Commands: `git diff 960394b145fc2f9ab1c3191b682f87079c712e9e..HEAD -- config/hooks/trajectory-recorder.cjs config/hooks/lib/trajectory-util.cjs`, the `node -e` probe above.

## Closeout extension — 2026-09-04

Work packages: CP-04/07/08. Owner remains `jjohare`, with learning/privacy and operations maintainers responsible for acceptance across persistence boundaries.

The actual redactor leaves quoted-password suffixes and short JSON password values in synthetic probes. Skip-on-redaction-error is implemented, but the blanket no-secret-retention guarantee is not established. Missing pg module advances the persisted watermark; connection/query failure does not.

**Acceptance condition:** Define supported command retention and reject/redact unsafe forms; test privacy sentinels, missing-module recovery, partial inserts, retries and consistency between steps, rollups and event emits.

Dependencies: shared-memory value/vector recovery, release identity and an explicit outcome/retention policy. Reopen on grader, redactor, transcript shape, persistence or promotion changes. Existing verification/activation fields retain their historical scope; this annex is source/helper evidence, not a live-loop certification.

See [learning evidence review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/learning-evidence.md) and [receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/learning-snapshot.json).

## Accounting closeout extension — 2026-09-05

CP-01/07/08: the [CTC consumer review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/transaction-cost-accounting.md) verifies forwarding with seventeen existing tests, while distinguishing turn totals attached to each Bash step from cumulative DAG cost. Define usage identity/deduplication, delegation scope, missing versus zero, typed verification and complete delivery beyond the 200-event cap before accepting per-DAG reporting. Five synthetic helper assertions supplement source inspection; no live recorder-to-dashboard workflow ran. Preserve the earlier privacy and recovery obligations.

## Failure telemetry closeout extension — 2026-09-05

CP-01/06/07/08: the [failure review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/failure-telemetry.md) reproduces disagreement between the recorder's metadata mode and the publisher's top-level `unmapped` value. Sixteen existing tests and six additional route assertions verify selected boundaries, not every failure. Define a canonical field, account for skipped and missing steps, and prove durable deduplicated metrics across the receiver. QE and process-loss census remains open.

## Acceptance progress — 2026-09-05

**Implemented — privacy.** A **command retention policy** is now stated in
`trajectory-util.cjs` and enforced in two phases. Phase 1 redacts every
enumerated secret-bearing form. Phase 2 re-inspects the redacted output for a
secret keyword still sitting in an assignment or flag position with a live value;
if one survives, the command is unsupported, `redact()` returns null and the
recorder skips the step. We reject what we cannot prove safe rather than widening
regular expressions until they look convincing. Both reproduced escapes are
closed: a quoted, space-containing `--password "correct horse battery staple"` is
consumed whole, and a short JSON `"password":"x"` is redacted — the pre-closeout
patterns keyed on `=` and never saw the colon form. A keyword in prose (`git
commit -m "add password reset flow"`) is deliberately untouched: the policy
rejects unsafe *value positions*, not the English word.

**Implemented — persistence.** The watermark now follows durability. It advances
in exactly two places: when there was nothing to persist, and after a successful
persist. A missing `pg` module returns without writing it, so those transcript
lines are retried instead of being skipped forever — the asymmetry the review
found between a missing module and a connection failure is gone. Re-scanning is
safe because step ids are content-addressed from the tool-use id and the inserts
are `ON CONFLICT DO NOTHING`, and because the quality counters are only committed
on the same successful path.

**Implemented — accounting (09-05 extension).** `token_count` is a whole-turn
figure, so summing it across a turn's sibling steps double counts. The fix is not
to divide the cost — attributing a share of a turn to a tool would be a guess —
but to make the allocation visible: every step now carries `usage_id` (the
identity of the turn the number came from), `token_count_scope:'assistant-turn'`,
`turn_tool_uses` and `token_count_shared`. Summing over distinct `usage_id`s
gives the true turn cost, and summing over steps can no longer be done by
accident. The 200-event cap became a **queue**: the overflow is carried in the
session stash and drained FIFO on the next Stop, the rollup records
`ctc_emit_queued` and `ctc_emit_carried_in`, and an overflow past the queue bound
is logged as explicit incompleteness rather than silently dropped.

**Implemented — failure telemetry (09-05 extension).** The canonical field is the
**top-level `failure_mode`** on the agent-events envelope. The emit route was
dropping it entirely (no schema slot, no forwarding), which is the mechanical
reason the publisher re-derived `unmapped`; it now accepts and forwards it. The
mapper sets the top level alongside the metadata mirror, and the publisher
**promotes** `metadata.failure_mode` when the top level carries none, then writes
the resolved tag back into the mirror so both locations always agree. The
reproduced "FM-1.2 in metadata, `unmapped` at top level" disagreement cannot
recur.

**Tests and results.** `tests/sovereign/learning-evidence-closeout.test.js` — 33
pass, 0 fail: ten privacy sentinels, the phase-2 residual backstop, watermark
behaviour under an absent pg module (forced by a require interceptor rather than
a test-only backdoor in production code), watermark behaviour under a connection
failure, the safe advance when nothing was gradeable, usage-identity stability
and sharing, and the canonical-failure-field promotion. Adjacent suites still
pass: `trajectory-util` 13, `ctc-emitter-wire` 8, `failure-taxonomy` and
`agent-events-taxonomy` unchanged.

**Receipts.**
`docs/estate-closeout/2026-09-05/adr-2015-trajectory-privacy-accounting.json`.

**Governed paths changed.** `config/hooks/lib/trajectory-util.cjs`,
`config/hooks/trajectory-recorder.cjs`,
`management-api/utils/agent-event-publisher.js`,
`management-api/routes/agent-events.js`,
`tests/sovereign/learning-evidence-closeout.test.js` (new).

**Remaining.** No live recorder-to-dashboard workflow ran; the emit transport
still does not check HTTP status, and the queue drains only on a subsequent Stop.
The accounting unit is now *described* on the wire, but no consumer has been
shown to deduplicate on `usage_id` — the dashboard is not in this repo. The
failure-source census stays open: skipped and ungradeable results, non-Bash work,
crash-before-Stop and the QE fleet are still outside any denominator.
`implementation_status` remains `partial`.
