---
id: ADR-2024
title: Dream cycles are evidence-gated and human-merge-gated, and darwin evaluators must emit surface-dependent output
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: any change to the recall band, the nightly window, or the darwin sandbox contract
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-052 (dream machine HP annexe), ADR-065 (darwin evaluator liveness contract), ADR-070 (self-GC dream evidence governance); recall band reuses the LEARNING harness gate (ADR-2018)
---

# ADR-2024 — Dream cycles are evidence-gated and human-merge-gated, and darwin evaluators must emit surface-dependent output

## Context

The nightly dream-engine evolves nominated repos overnight on the HP annexe,
and agentbox contains the very crate that dreams it (`services/dream-engine`) —
a self-modifying surface. Two failure modes to foreclose: a self-referential
change slipping in unwitnessed, and a darwin evaluator running the default
`--sandbox real` mode, which is surface-independent and therefore silently
no-ops (ADR-065). Prior art: ADR-052 (HP annexe), ADR-070 (dream evidence
governance).

## Decision

The dream-engine may self-modify only under **extra review scrutiny** and
**never bypasses the human-merge gate** — cycles stay evidence-gated and
witnessed. Every `@metaharness/darwin` entrypoint MUST run `--sandbox mock` (or
`--sandbox agent`), never the no-op `real` default, so it provably produces
surface-dependent output. Configuration declares recall-band thresholds
(`recall_band_self_min = 175`, `recall_band_true_min = 102`, reused from the
LEARNING harness) and a nightly 1–5 UTC window, dispatched to HP. These are
configuration requirements; the current source review does not establish a
deterministic candidate gate or re-certify the historical live deployment.
The merge-gate and darwin-liveness rules rely on config/toml discipline rather
than central policy code — hence implementation partial.

## Consequences

- Human merge remains required before an overnight change reaches `main`.
  Evaluator failure must also veto acceptance; current failure text alone does
  not enforce that requirement.
- The recall band expresses the intended rejection policy. The current service
  passes evaluator output to the model without a deterministic required-check
  veto and does not rerun evaluation on the emitted patch; regression rejection
  is therefore not established by the configured band alone.
- Cost/caveat: the discipline lives in `dream.config.json` + `[dream_machine]`,
  so a repo that omits the `--sandbox` flag or mis-declares its evaluators can
  still no-op until caught by review; there is no single enforcing policy engine.
  Governing detail in `docs/GOVERNANCE-capabilities.md`.

## Verification

At `cbe7335b9`, `dream.config.json` `extraDisciplines` (:57-58) states the
self-referential rule and "never let a self-modifying hypothesis bypass the
human-merge gate". `agentbox.toml` `[dream_machine]` (:1560-1595): mandatory
`--sandbox mock` evaluator-liveness note, `recall_band_self_min = 175`,
`recall_band_true_min = 102`, nightly window `window_start = 1`/`window_end = 5`
UTC, dispatched to `john@10.10.10.1`.

## Closeout extension — 2026-09-04

Work packages: CP-01/07/08. Owner remains `jjohare`, with dream runtime and evaluation maintainers responsible for the composed acceptance path. Partial implementation remains appropriate.

Source reinspection and repeated synthetic verdict probes establish that evaluation runs before patch emission and that failure text can coexist with ACCEPT. Human merging remains a separate boundary. A witnessed report identifies the report/base; it does not prove the emitted candidate passed required checks.

**Acceptance condition:** freeze the complete baseline/candidate/dependency manifest; apply the candidate in isolation; rerun typed required evaluators; reject blocked/silent/failing results before any acceptance label; persist raw receipts and a restart-safe run identity. Exercise a deliberately broken candidate and interrupted persistence. Dependencies include shared-memory repair, fair roster scheduling and explicit human review. Reopen on any evaluation, verdict, witness or patch-application change.

See [self-improvement review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/self-improvement.md) and [reproduced parser results](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/dream-snapshot.json). No nightly dispatch, provider call, external publication or production mutation ran for this review.

## Acceptance progress — 2026-09-05

Work packages CP-01/07/08/09. The composed acceptance path named in the 2026-09-04 closeout is now implemented in `services/dream-engine` with tests. `implementation_status` stays `partial`: the deterministic gate exists in code and is green offline, but no live nightly dispatch has yet exercised it end to end, and the human-merge boundary remains a process rather than a code control. `verified_commit` is unchanged (`cbe7335b9`) — it records the source review, not this work.

**Implemented.** (1) A frozen experiment manifest (`manifest.rs`) written atomically **before any model call**: baseline revision *and* tree hash, evaluator identities with `sha256(command)`, the `dream.config.json` digest, the intended model identity, and a deterministic `run_id` derived from those inputs. A restart recomputes the same id and resumes against the same document; a moved baseline archives the superseded manifest rather than overwriting it. (2) Candidate re-evaluation (`candidate.rs`): the emitted `dream-patch` is applied on an isolated git worktree at HEAD, its tree hash recorded, and the required evaluators re-run against **that** tree — the operator's working tree is never touched. (3) A deterministic required-check gate (`gate.rs`): a pure function of manifest, strict verdict, candidate state and candidate receipts. Missing, silent, blocked, timed-out, non-zero and explicit-`FAIL` evaluators each veto ACCEPT regardless of report text; harness-class vetoes yield `BLOCKED-ENV`, evidence-class vetoes `REJECT`, unproven ones `INCONCLUSIVE`. The verdict parser is now strict and typed (`verdict::parse_verdict_strict`): acceptance consults only a bare unambiguous `VERDICT: <TOKEN>` line, and missing, noisy, conflicting or unknown declarations are typed errors that can never reach ACCEPT. (4) Raw receipts (`receipts.rs`): exit code, both streams verbatim, duration and a typed outcome per evaluator, persisted per phase under the night directory, plus a durable run journal (`runstate.rs`) so an interrupted run resumes from its recorded phase, a completed one is skipped rather than silently repeated, and an exhausted one is abandoned with an operator alert. (5) Evaluator-readiness admission (`readiness.rs`): a nomination whose evaluators cannot decide tonight's deep — empty map, no evaluator for the deep, an all-advisory roster, an empty or non-probative command, a script absent from the checked-out tree, a darwin entrypoint without `--sandbox mock|agent` — is refused **before scheduling**, with the `HANDOFF` disposition, no clone, no build and no model call. (6) Fair roster scheduling (`roster.rs`): least-recently-dreamed ordering backed by a durable file, replacing alphabetical-sort-plus-truncate, so the nightly cap rotates through the whole roster and survives a restart.

The established configuration surface is reused rather than replaced: `evaluatorEntrypoints` values are still bare command strings, now additionally accepting `{cmd, required, deeps, timeoutSecs}`. A bare string reads fail-closed as `required: true`, all deeps, 1800 s. Load-time validation additionally rejects an empty command, a zero timeout and a `deeps` entry naming no declared slot. Verified against every nominated repo: all six load under the new reading and every declared deep is admitted, so no live nomination regresses. Because bare strings are required, repo owners should now declare genuinely advisory evaluators explicitly; none currently does, so acceptance is maximally conservative estate-wide.

**Tests and results.** `cargo test` in `services/dream-engine`: **150 passed, 0 failed** (78 at `89301ec7c`), `cargo clippy --all-targets` clean. The three cases this ADR asked for are covered by name: a deliberately broken candidate cannot receive ACCEPT (`candidate::tests::a_deliberately_broken_candidate_cannot_receive_accept` — a real git repo, a patch that breaks the surface its required evaluator checks, the evaluator run for real, the gate returning `REJECT` against a model verdict of `ACCEPT`); interrupted persistence recovers (`runstate::tests::an_interrupted_run_resumes_from_its_last_phase`, `a_completed_run_is_never_silently_repeated`, `attempts_are_bounded_and_exhaustion_is_terminal`, plus `manifest::tests::freeze_writes_once_and_resumes_identically` and `freeze_archives_a_diverged_manifest_instead_of_overwriting`); readiness refusal (`readiness::tests` — empty map, inline `echo`, nonexistent script, wrong deep, all-advisory roster, darwin without a sandbox flag). Two implementation defects were caught by these tests and fixed before landing: the manifest digest originally included its own timestamp, which would have made every restart read as a diverged experiment; and the strict parser rejected a backticked token.

**Governed paths changed.** `services/dream-engine/src/{lib,engine,config,compile,dispatch,persist,verdict,main}.rs` modified; `services/dream-engine/src/{manifest,receipts,runner,gate,readiness,runstate,roster,candidate}.rs` added. No `dream.config.json`, `agentbox.toml` or evaluator script was modified.

**Remaining.** A live nightly dispatch through the composed path (annexe clone → baseline receipts → model → candidate rerun → gate), which is the evidence needed to move `implementation_status` past `partial`; measurement of the review-conversion and candidate-rerun rates the estate review asks for; and the shared-memory repair tracked separately. Reopen on any evaluation, verdict, witness or patch-application change.

Receipts: [`docs/estate-closeout/2026-09-05/dream-engine/`](../estate-closeout/2026-09-05/dream-engine/) — `acceptance-path.md`, `cargo-test.txt`, `cargo-clippy.txt`, `admission-probe-real-configs.txt`. No nightly dispatch, provider call, SSH session, external publication or production mutation ran for this work.
