---
id: ADR-2081
title: Annexe mirrors workspace depth; evaluator receipts carry the producer's exit code; a no-patch ACCEPT is unproven, not a harness fault
date: 2026-09-07
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 1b43b70ff09b971b440c9964743402aec45ef515
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
