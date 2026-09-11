---
id: ADR-2081
title: Annexe mirrors workspace depth; evaluator receipts carry the producer's exit code; a no-patch ACCEPT is unproven, not a harness fault
date: 2026-09-07
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: b48847316f559c9fcb5d4ef4cc56c826ef440e7e
verified_paths: [services/dream-engine/src/engine.rs, services/dream-engine/src/runner.rs, services/dream-engine/src/gate.rs, services/dream-engine/src/verdict.rs]
owner: jjohare
review_trigger: next dream-engine image rebuild (activation of the supervised loop), or any change to annexe layout or receipt classification
repo: agentbox
---

# ADR-2081 — Annexe mirrors workspace depth; evaluator receipts carry the producer's exit code; a no-patch ACCEPT is unproven, not a harness fault

## Context
Seven nights of dream-cycle reports (2026-09-01 → 09-07, six repos) were harvested on 2026-09-07. Four engine defects explained most of the wasted nights:
1. `services/nostr-pod-bridge` path-deps climb `../../../../`; the annexe extracted agentbox at `remote_dir/agentbox` while the checkout is `workspace/project/agentbox`, so cargo sought the siblings one directory *above* the night dir (ADR-060 shipped them *inside* it). The REQUIRED `sovereign-mesh-bridge` gate failed at manifest load every night.
2. Evaluators ran under bare `bash -c`; every declared entrypoint ends in `| tail -N`, so the receipt recorded `tail`'s 0 and the failing build classified `PASSED` — a pipe-masked false positive that upheld an ACCEPT on 09-06 (PR #4).
3. `gate.rs` graded candidate-phase receipts whenever ACCEPT was claimed, so a measurement night that shipped no patch produced three "never ran" harness vetoes and a `BLOCKED-ENV` (website 09-07) over green baseline receipts.
4. The ledger finding cell was the frozen hypothesis truncated at 80 chars, breaking the ledger row contract (dream-engine PR #10) that the engine's own target repo now enforces.

## Decision
- **Depth law.** The annexe mirrors each repo's canonical path relative to the workspace root (`engine::annexe_subpath`): target at `remote_dir/project/agentbox`, siblings at `remote_dir/<sibling>`. Symlinked nominations resolve to their real depth. A repo outside the workspace falls back to its leaf name.
- **Honest receipts.** Both runners execute `bash -o pipefail -c`. Tailing output is allowed; masking status is not. Repos need no `set -o pipefail` in `dream.config.json`.
- **Unproven ≠ harness.** Candidate-phase receipts are graded only when a candidate tree was applied. An ACCEPT without a patch is an `unproven` veto → `INCONCLUSIVE` (counts toward the dry streak; raises no operator alert).
- **Ledger cell provenance.** `sanitise_finding` takes the report's own Step-19 ledger row cell when it satisfies the contract (≤80 chars, no "Given", no pointer), then a contract-satisfying `Finding:` line, and only then the hypothesis. `sanitise_finding_full` (memory rows, PR bodies) still carries the whole hypothesis.
- The two receipt changes land together: pipefail with the siblings still unresolved would have vetoed every annexe ACCEPT (PR #4's warning, upheld).

## Consequences
- `sovereign-mesh-bridge` is a real gate again; the FALLBACK rule from PR #4 is withdrawn (`docs/dream-cycle/evaluator-status-20260906.md`).
- Any entrypoint whose producer legitimately exits non-zero on a healthy tree (a `grep` with no matches, `cargo bench` without benches) now fails honestly; nominated repos were audited the same day (loom, forum, host project, VisionFlow, website) and their configs adjusted.
- With pipefail, `| tail -N` discards the *head* of a failing run; repos should tail generously (website bench raised to 60).
- The supervised loop still runs the Nix-store binary; the fix is live for `--once` runs from `services/dream-engine/target/release` and activates for the nightly loop at the next image rebuild (**HANDOFF (rebuild)**).

## Verification
`cargo test` in `services/dream-engine`: 155 passed (new: `annexe_subpath_mirrors_real_depth_under_the_workspace`, `local_runner_does_not_let_a_tail_pipe_mask_a_failure`, `accept_without_a_candidate_patch_is_unproven_not_a_harness_fault`, `sanitise_prefers_the_reports_own_ledger_row_cell`, `sanitise_ignores_a_ledger_row_cell_that_breaks_the_contract`, `sanitise_prefers_a_self_contained_finding_line_over_the_hypothesis`). Live check: `dream-engine --once --target agentbox` after this commit must show `sovereign-mesh-bridge` compiling the bridge against shipped siblings in `receipts/baseline/`.

## Independent source re-verification — 2026-09-07

The initial ADR gate correctly refused the older `verified_commit`: the four governed files changed in implementation commit `2c521c5bb364944547a31192268a7e68b0953c20`. The [original failed-check receipt](../../../../VisionFlow/docs/estate-review/evidence/2026-09-07/adr2081-provenance-failure.json) is retained, including its old/current blob identities. This annex follows fresh source inspection and executable verification; it does not waive that failure.

| Decision clause | Current implementation inspected | Verification boundary |
|---|---|---|
| Annexe depth law | `engine.rs:541-548` derives and uses canonical repo subpath; `:815-823` reuses it for candidate worktrees; `:1420-1468` ships siblings and resolves canonical workspace-relative paths, with leaf fallback | Local real-directory/symlink/outside-workspace test passes. No remote the connected node transfer/build was run. |
| Producer exit status | `runner.rs:64-84` wraps SSH commands in `bash -o pipefail -c`; `:97-105` applies the same inner shell locally | Local failing producer piped through `tail` retains exit 101; wrapper quoting and timeout tests pass. No SSH execution claimed. |
| Candidate receipt grading | `gate.rs:216-253` marks no-patch ACCEPT unproven and grades evaluator receipts only for `CandidateState::Applied` | No-patch ACCEPT is INCONCLUSIVE rather than a harness fault; broken and valid candidate rerun tests pass. |
| Ledger finding selection | `verdict.rs:347-414` prefers a contract-valid dated table finding, then a valid Finding line; `:417-430` retains the full hypothesis selection path for full findings | Preferred/invalid ledger cell, Finding fallback, table safety and full-hypothesis tests pass. The source's older preference-order doc comment remains stale; the executable branch above governs. |

`cargo test --locked --offline --lib` in `services/dream-engine` passed **155 tests, 0 failed** on the inspected clean governed source paths. [Exact output](../../../../VisionFlow/docs/estate-review/evidence/2026-09-07/adr2081-dream-engine-tests.log) and the [source/test receipt](../../../../VisionFlow/docs/estate-review/evidence/2026-09-07/adr2081-reverification.json) bind this run to the updated revision and working-file hashes. The four source blobs are unchanged between the implementation commit and that revision. No implementation code changed during re-verification.

Retain **accepted / complete / staged** for this source-and-local-test scope. The supervised Nix-store process, rebuilt image, actual the connected node annexe layout and live evaluator receipts were not inspected or exercised. The original rebuild/activation acceptance remains required.
