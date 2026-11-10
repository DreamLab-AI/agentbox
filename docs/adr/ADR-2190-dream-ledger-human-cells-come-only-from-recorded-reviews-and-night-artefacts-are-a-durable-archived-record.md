---
id: ADR-2190
title: Dream ledger human cells come only from recorded reviews, and night artefacts are a durable, archived record
date: 2026-11-10
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 062487becfcb5758ad0dfa74c11e1aa18b87aaae
verified_paths: [services/dream-engine/src/review.rs, services/dream-engine/src/archive.rs, services/dream-engine/src/engine.rs, services/dream-engine/src/main.rs, services/dream-engine/src/config.rs, services/dream-engine/src/estate.rs, services/dream-engine/src/digest.rs, services/dream-engine/src/governance.rs, config/tmux-autostart.sh, schema/agentbox.toml.schema.json, setup/agentbox.default.toml]
owner: jjohare
review_trigger: a forge identity that separates agent merges from human merges (a dedicated agent account or signed human approvals), which would reopen merge events as review evidence; a review tool that authenticates its reviewer; any change that prunes, relocates or stops archiving the artefact directory; a dream-core release that changes the ledger row or the witness
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: amends ADR-2087 (decision point 5, the source of the Reviewer and Review-minutes cells)
relates: [ADR-2087, ADR-2024, ADR-2071, ADR-2115, ADR-2141]
evidence_class: source+test
acceptance_boundary: "cargo test --offline in services/dream-engine at 062487bec passes 236 unit (26 in review.rs; 14 in archive.rs, including runs against a local bare remote), 11 and 2 integration tests. Not shown: a night run by the rebuilt image, a real import into a live ledger, or a push to the private archive repository. Those are the activation evidence."
---

# ADR-2190: Dream ledger human cells come only from recorded reviews, and night artefacts are a durable, archived record

## Context

- ADR-2087 point 5 gave every dream ledger row two human cells, `Reviewer` and `Review-minutes`, to be filled from the pull request's merge event (`merged_by`, and `merged_at − pr_opened_at`). Helpers were written on both sides: `dream_core::ledger::review_from_merge` and `management-api/lib/dream-ledger.js` `reviewFromMergeEvent`. Neither has a production caller, and the engine only ever wrote the cells empty. By the operator's count, about 350 rows carry empty human cells.
- A merge event cannot carry this measurement. In this estate, agents open and merge pull requests under the operator's own forge account, so `merged_by` cannot tell a person from an agent. Open-to-merge time is queueing time, not review time. Filling the cells from merges would turn the ledger's only measure of human attention into a record of agent activity attributed to the operator.
- Night artefacts (report, receipts, frozen manifest, gate decision) were written to `/home/devuser/workspace/.tmp/dream-annexe-artefacts` by default. That is a temporary path. Nights before 6 October 2026 were lost from it. A row's witness can be recomputed, and a review checked against the night it judges, only while that night's folder exists.
- The engine's own commits (candidate worktrees, ledger rows) used whatever identity each checkout had, and failed where a checkout had none.

## Decision

The `Reviewer` and `Review-minutes` cells are filled only from an explicit record of a human review, never from a merge event. That record is the night's `review.json` (schema 1, `<artefact_dir>/<date>-<repo>/review.json`), written by `dream-engine review import` from JSON Lines or by any tool that writes the same shape. Each record is validated against its night folder: the witness is recomputed from `report.md` and the manifest's baseline revision, and a mismatch is refused. A backfill at the start of every night writes the reviewer and the measured active minutes into the one row with that date and short witness, only when both cells are empty. Every other byte of the ledger is preserved. Unmeasured minutes leave the cell empty. Night artefacts are durable control-plane state: the default directory is `/home/devuser/workspace/dream-artefacts` (`[dream_machine].artefact_dir` or `--artefact-dir` override it), and nothing may prune it. When that directory is the checkout of a private archive repository with a remote, each night ends by committing it and pushing it, never forced. A failure is fail-open, journalled as `archive.push` and raised as an inbox alert. Engine commits use the identity in `[dream_machine].git_author_name` / `git_author_email`, exported as `GIT_AUTHOR_*`/`GIT_COMMITTER_*` before the runtime starts, so `dream-core`'s own git calls use it too.

## Consequences

- **Amends ADR-2087 point 5.** The two cells and their meaning stay, but their source changes from the merge event to a recorded review. The rest of ADR-2087 is unaffected. `review_from_merge` and `reviewFromMergeEvent` are now unused code that still documents the old rule. Their callers must not be revived without superseding this record.
- The existing ~350 empty rows stay empty unless someone records a review for a night whose folder survives. Rows from before 6 October 2026 cannot be filled, because their folders are gone and the backfill never widens a ten-column row. An empty cell continues to mean "no recorded review", not "zero minutes".
- The record is explicit but not authenticated. `reviewer` is free text supplied by the importing tool, and the witness check binds a review to a night, not to a person. Who may write `review.json` is therefore an operator and tool discipline, not something the engine can enforce. An authenticated review tool is a review trigger.
- `Review-minutes` now measures active review time reported by the tool (`active_seconds`, rounded to whole minutes), not elapsed time. Comparisons with any figure derived from merge timestamps are invalid.
- The artefact directory grows without bound. Storage is the cost of a checkable ledger. Pruning it would orphan every witness and is now a decision-level change.
- The night gains two journalled, fail-open side effects, `review.backfill` and `archive.push` (ADR-2071's Phase 2 count of side effects grows by two). A failed push reaches the governance panel the same night as a low-tier alert (ADR-2115). The human-merge gate (ADR-2024) is untouched. The archive push writes only the archive's own checkout. The backfill's ledger edit goes through the same `dream_core::ledger::commit_ledger` as the nightly row (`records.rs:68`, `review.rs:802`), which makes a local commit of the ledger file only, on the default branch only, and never pushes. Candidates stay draft pull requests.
- `config/tmux-autostart.sh` hardcodes the default directory for its fallback session and tees `loop.log` into it. Unless the archive's `.gitignore` excludes it, the log is archived nightly. The fallback ignores a configured `artefact_dir`.
- The archive repository's name, organisation and remote are deliberately not in this public repository. The engine pushes to whatever remote the checkout has.

### Rejected alternative

Keep ADR-2087's merge-event rule and wire `review_from_merge` into the night. It lost because, under a shared operator account, it would fill all ~350 rows with plausible-looking data that measures nothing human. A filtered variant (count only merges outside agent sessions) was also rejected: the forge records no such distinction, and inferring it from session logs is a guess presented as a measurement.

## Verification

At `062487becfcb5758ad0dfa74c11e1aa18b87aaae` (PR #43, `dream-review-ledger`):

- `engine.rs:1930-1939`: the row is written with empty human cells, with the reason stated. `engine.rs:190` runs the backfill at night start, and `:509` defines it. `engine.rs:396` archives the night before the governance publish, `:470` defines it, and `:499` raises the alert.
- `review.rs`: `ReviewRecord` (`deny_unknown_fields`), witness recomputation (`night_witness`), and a fill that refuses non-empty cells and never widens ten-column rows. 26 tests.
- `archive.rs`: never forced, upstream or single remote, failure step reported. `GitIdentity::env` sets the four `GIT_*` variables. 14 tests, some against a local bare remote.
- `estate.rs:38` holds the default directory, and `main.rs` resolves `--artefact-dir` over `[dream_machine].artefact_dir` over the default. `schema/agentbox.toml.schema.json:2981-2992` declares the three keys, and `setup/agentbox.default.toml:1513-1515` gives them as comments.
- `cargo test --offline` in `services/dream-engine`: 236 + 11 + 2 passed, 0 failed.
- No production caller of the merge-event rule. In this repository, `git grep -n review_from_merge` finds only the two comments that explain its withdrawal (`engine.rs`, `review.rs`), and `git grep -n reviewFromMergeEvent` finds the definition and export in `management-api/lib/dream-ledger.js` and `tests/integration/dream-ledger-reviewer.test.js`. In the pinned `dream-core` 0.4.1 registry source, `review_from_merge` is defined (`src/ledger.rs:128`) and called only by its own tests.

Activation (`staged` → `live`) needs a night run by the rebuilt image that pushes the artefact archive, and one real `review import` that fills a ledger row.
