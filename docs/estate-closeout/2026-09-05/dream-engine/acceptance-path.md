# Dream-engine acceptance path — implementation receipt, 2026-09-05

Scope: `services/dream-engine` (ADR-2024 closeout, work packages CP-01/07/08/09).
No nightly dispatch, SSH session, provider call, external publication or
production mutation ran while producing this. Every result below comes from the
crate's own offline test suite and a static probe of the checked-in configs.

## The composed path, in order

| # | Stage | Module | What it establishes |
|---|---|---|---|
| 0 | Evaluator-readiness admission | `readiness.rs` | A nomination whose evaluators cannot decide tonight's deep is refused **before scheduling** — no clone, no build, no model call. Disposition `HANDOFF`. |
| 1 | Frozen experiment manifest | `manifest.rs` | Baseline revision **and tree hash**, evaluator identities with `sha256(command)`, config digest, intended model, and a deterministic `run_id`. Written atomically **before any model call**. |
| 2 | Durable run journal | `runstate.rs` | Restart-safe identity. A finished night is skipped, not repeated; an interrupted one resumes from its recorded phase with the attempt counted; an exhausted one is abandoned loudly. |
| 3 | Baseline evaluation | `runner.rs`, `receipts.rs` | Each evaluator yields a typed receipt: exit code, both streams verbatim, duration, and a classified outcome. |
| 4 | Environment gate | `gate::environment_vetoes` | A baseline evaluator may *fail* (that is often the finding); it may not be missing, silent, blocked or timed out. If it is, the night is `BLOCKED-ENV` **before** the model is asked. |
| 5 | Model call | `engine.rs` | Unchanged, except the prompt now carries typed outcomes and names the required evaluators that will re-run against the candidate. |
| 6 | Strict verdict parse | `verdict::parse_verdict_strict` | Acceptance consults only a bare, unambiguous `VERDICT: <TOKEN>` line. Missing, noisy, conflicting or unknown ⇒ typed error, never a default. |
| 7 | Candidate rerun | `candidate.rs` | The emitted `dream-patch` is applied on an isolated git worktree at HEAD, the candidate **tree hash** recorded, and the required evaluators re-run **against that tree**. |
| 8 | Deterministic gate | `gate::decide` | Pure function of (manifest, strict verdict, candidate state, candidate receipts). Missing / silent / blocked / timed-out / non-zero / explicit-FAIL each veto ACCEPT regardless of report text. |
| 9 | Persist | `engine.rs` | Report, `manifest.json`, `candidate.json`, `gate.json`, raw receipts, ledger row, witness, RuVector. Draft PR **only** when the gate upheld ACCEPT; a vetoed candidate's branch is deleted. |

Human merge is unchanged and remains the promotion boundary: the gate can only
refuse an ACCEPT, never merge one.

## Veto class → verdict

| Class | Cause | Verdict |
|---|---|---|
| harness | required evaluator missing, silent, blocked, timed out; patch would not apply | `BLOCKED-ENV` |
| evidence | required evaluator exited non-zero, or declared `FAIL` | `REJECT` |
| unproven | ACCEPT with no candidate patch; unreadable verdict line | `INCONCLUSIVE` |

`BLOCKED-ENV` for harness faults is deliberate: a broken annexe is not evidence
against the repository and must not park a healthy repo on the dry streak.

## Config surface

The established `dream.config.json` `evaluatorEntrypoints` key is reused, not
replaced. Each value is either the historical bare string or an object:

```json
"evaluatorEntrypoints": {
  "tests": "cd services/dream-engine && cargo test 2>&1 | tail -15",
  "hooks": { "cmd": "bash scripts/hooks.sh", "required": false,
             "deeps": ["hooks-pipeline"], "timeoutSecs": 600 }
}
```

A bare string reads fail-closed: `required: true`, every deep, 1800 s budget.
Load-time validation additionally rejects an empty command, a zero timeout and a
`deeps` entry naming no declared slot.

## Evidence

- `cargo-test.txt` — 150 tests, 0 failures (78 at `89301ec7c`).
- `cargo-clippy.txt` — clean, no warnings.
- `admission-probe-real-configs.txt` — every nominated repo loads under the new
  schema and every declared deep is admitted; no live nomination regresses.

## Operational note for repo owners

Because a bare-string evaluator now reads as **required**, every declared
evaluator can veto an ACCEPT for that repo. Where an evaluator is genuinely
advisory — a lint, a benchmark that reports rather than decides, a build known
to be unavailable on the annexe — declare it explicitly:

```json
"lint": { "cmd": "npx eslint .", "required": false }
```

At the time of writing no repo declares an advisory evaluator, so acceptance is
maximally conservative estate-wide.
