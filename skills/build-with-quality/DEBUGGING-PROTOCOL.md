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

**Loop temporarily blocked:** Stop. List what you tried. Ask for environment
access, artifacts (HAR, logs, core dumps), or permission to add production
instrumentation. Do not proceed without a signal — the signal exists, you just
can't reach it yet.

**Loop permanently impossible by construction:** Different case. When there is no
runtime at all — no shell, no compiler, no test runner; you are implementing from
a spec, restoring a stub, or reasoning offline and cannot run anything ever — do
**not** stop and do **not** declare success on faith. Switch to Static-Oracle
Mode below. This is the implement-from-spec regime, not a blocked debugger.

## Reasoning Without a Runtime (Static-Oracle Mode)

The feedback-loop-first discipline assumes you can run something. When you
provably cannot, the discipline inverts: you **derive** the correct
implementation from the visible code, then **hand-prove** it against the tests.
The test block (e.g. `#[cfg(test)]`) is your *static oracle* — it specifies the
required behaviour exactly but cannot execute itself, so you execute it by hand.

### Step 1 — Reconstruct from the code surface (do this first)

The answer is almost always already constrained by code you can see. Mine these,
in priority order, before writing the body:

1. **Doc comments** on the function and its type — often state the exact format,
   ordering, or invariant in words (e.g. `varint(codec) || key_bytes`). Implement
   it *literally as documented*, don't improvise an equivalent.
2. **The inverse function** — if you must write `encode`, find `decode`; it is
   usually implemented and *fully constrains* you. Mirror it step-for-step,
   reusing its constants and helpers. Same for `to_*`/`from_*`, `serialize`/
   `deserialize`.
3. **Sibling helpers** on the same type — compose existing methods; reuse beats
   reinvention and inherits their correctness.
4. **Constants and the error enum** — your lookup table. Use named constants, not
   magic numbers. Open the error enum and read every variant's **exact name,
   fields, and field types** — a `match` over it *is* the implementation.
5. **Test/spec assertions** — pin every remaining ambiguity: which error on which
   bad input, exact field values, exact lengths, expected prefixes/literals.

Write the body in the vocabulary the surrounding code already established, not in
vocabulary you invented.

### Step 2 — Hand-trace every assertion against the static oracle

Go assertion by assertion (not test by test) and confirm both sides agree:

- **Error paths:** return the exact variant with exact field names and values the
  test matches on (`codec: "p-256"` must match the literal/constant character-for-
  character).
- **Exact values:** substitute the real constant values mentally and compute —
  lengths, bytes at an index, counts, prefixes. Never "about right."
- **Roundtrip/inverse:** trace one concrete example end-to-end through your
  function and its inverse; confirm you land back on the input byte-for-byte.
- **Return shape:** the exact type, variant, wrapper (`Vec<u8>` vs `[u8; N]`),
  `Ok`/`Err`, and every struct/tuple field. A total failure (0 of all tests)
  almost always means a *shape* mismatch here, not a logic bug.

### Step 3 — Be the compiler (you have none)

Before finishing: every name you reference (constant, variant, field, method)
appears verbatim in the visible code; every variant's fields are fully set; types
line up (slice vs owned vs fixed array; `u64` vs `usize`; `String` vs `&str`,
adding the conversion idiom a sibling uses); every path returns the declared type.

### The cardinal rule

**Never substitute a narrative for a signal.** Restating what the tests *should*
verify ("roundtrip works ✓", "unknown codec rejected ✓") is not evidence — it is
the failure mode that ships unrun code. A checkmark is earned **only** by a
substituted-value trace, never by paraphrasing the test's intent. This is the
static-oracle form of the EDD rule that narrative evidence is auto-rejected.

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

## Diagram-Driven Diagnosis

Use when: a bug spans many functions or modules; you suspect duplicate or parallel implementations of the same concern (multiple writers, divergent validators, shadow copies of an algorithm); or you are chasing and hacking symptoms without finding root cause.

### Phase 1 — Cartography

Spawn N Sonnet agents, one per concern. Each agent renders its slice of the system as a renderable Mermaid sequence or flow diagram built **from the actual code, not from docs**. Concerns are domain-specific — for example, in a settings/graph/GPU system: settings flow (client/wire/server/db), data population and socket handoff, interaction events, update and backoff logic, wire/analytics data types, GPU physics, analysis/clustering.

Each agent maps **all** code paths into its diagram and explicitly flags any parallel or duplicate implementation it finds.

### Phase 2 — Queen Synthesis

One Opus coordinator collates the diagrams into a single ranked anomaly register (e.g. `00-anomaly-register.md`) containing:
- a Mermaid mindmap of anomaly themes
- a revert-vs-reconcile table for each duplication
- git archaeology identifying the commit that introduced each divergence

### Phase 3 — QE Fleet

Brief QE agents to write **failing repro tests** that depend only on the model/pure layer (no GPU, no network) to prove each anomaly objectively before any fix is attempted. This converts "I suspect X" into a red test.

### Phase 4 — Fix with Live Diagrams

Implement fixes (deleting or deprecating parallel paths where they are not integrated), updating each Mermaid diagram as you go so resolutions visibly click into place. The red repro tests flip green as proof.

**Why it works:** forcing every parallel implementation into one visible artefact makes divergent authorities obvious — for example, one layer reads `metadata.type` while another reads a top-level `type` field, or two modularity functions that disagree on the same input. Failing repro tests prevent symptom-chasing and premature hacks.

---

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
