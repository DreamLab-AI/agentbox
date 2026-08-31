---
id: ADR-2015
title: The trajectory recorder is transcript-driven and fails open except on honesty and privacy
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
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
skipped, never persisted raw. This forecloses both optimistic grading and raw
secret leakage into a durable, searchable corpus.

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
