# Debugging Protocol — Feedback Loop First

Reference material for build-with-quality Phase 0 (debugging entry mode).
Adapted from Matt Pocock's `diagnose` methodology.

## Core Discipline

No investigation without a runnable pass/fail signal first. If you have a fast,
deterministic, agent-runnable feedback loop for the bug, you will find the cause.
Without one, code reading is guesswork.

## Phase 0: Build a Feedback Loop

**Construction methods (try in order, stop at first success):**

1. Failing test (unit, integration, or e2e)
2. curl/HTTP script against dev server
3. CLI invocation with fixture, diffed against snapshot
4. Headless browser script (Playwright / qe-browser)
5. Replay captured trace/HAR from disk
6. Throwaway harness exercising the bug's code path
7. Property/fuzz loop (for intermittent bugs — target >50% repro rate)
8. Bisection harness (for regressions between known-good states)
9. Differential loop (compare two versions/configs)
10. HITL bash script (last resort — structured, not ad-hoc)

**Optimise the loop:** faster (cache setup, narrow scope), sharper (assert on
the specific symptom, not a proxy), deterministic (pin time, seed RNG, isolate
filesystem).

**Non-deterministic bugs:** loop/parallelise to push repro rate above 50%.
Inject stress, narrow timing windows, add sleep probes.

**Cannot build a loop:** Stop. List what you tried. Ask for environment access,
artifacts (HAR, logs, core dumps), or permission to add production
instrumentation. Do not proceed without a signal.

## Phase 1: Reproduce

Run the loop. Confirm it produces the user's exact failure mode — not an
adjacent bug. Note the exact symptom for later verification.

## Phase 2: Hypothesise

Generate 3–5 ranked hypotheses, each with a falsifiable prediction:

> "If X is the cause, then changing Y will eliminate the bug."

Present the ranked list before testing. Domain knowledge often eliminates
hypotheses instantly.

## Phase 3: Instrument

One variable at a time. Each probe maps to a Phase 2 prediction.

**Tool priority:** debugger/REPL → targeted boundary logs → never "log
everything and grep."

Tag all debug output with a unique prefix: `[DEBUG-xxxx]`. Single-grep cleanup.

For performance regressions: baseline measurement (timing harness, profiler
snapshot, query plan) then bisect. Logs are the wrong tool.

## Phase 4: Fix + Regression Test

1. Convert minimised repro into a permanent test (only when a correct seam
   exists — exercises the real bug pattern, not a shallow mock)
2. Verify test fails
3. Apply fix
4. Verify test passes
5. Re-run Phase 0 loop against original scenario
6. Hand off to EDD stabilisation (Phase 3.5 in main workflow) if regression-critical

## Phase 5: Cleanup

**All required:**

- [ ] Original repro no longer reproduces
- [ ] Regression test passes (or absence documented with reason)
- [ ] All `[DEBUG-*]` prefixed lines removed (grep to verify)
- [ ] Throwaway harnesses and temp files deleted
- [ ] Correct hypothesis stated in commit message

## Design Interrogation Protocol

When requirements are ambiguous before building or debugging, use this protocol
to stress-test the plan:

1. Ask questions **one at a time**, each with a recommended answer
2. Check the codebase for the answer before asking the user
3. Walk every branch of the decision tree sequentially
4. If terminology conflicts with existing domain glossary, surface immediately
5. Continue until shared understanding on all decision points
6. Create an ADR only when: hard to reverse + surprising without context +
   genuine tradeoff. Skip otherwise.
