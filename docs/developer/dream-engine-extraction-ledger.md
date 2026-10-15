# Dream engine extraction ledger

Companion to [ADR-2141](../adr/ADR-2141-extract-the-dream-engine-core-into-a-standalone-permissive-repo.md). It records what
left `services/dream-engine`, where it went, what behaviour changed on purpose,
and where every test that left the crate went. The adapter that stays here is
AGPL-3.0-only; the extracted crates (`pairwise-gate`, `failure-fingerprint`,
`dream-gate`, `dream-core`) are permissive and live in their own repository.

## Source files

| file | before | after | disposition |
|---|---:|---:|---|
| `candidate.rs` | 314 | deleted | `dream_core::candidate` (+ `run`, which adds the guard-first ordering) |
| `compile.rs` | 385 | deleted | mechanism in `dream_core::compile`; the agentbox wording is `src/prompt/nightly.tmpl` + `prompt.rs` |
| `context.rs` | 587 | deleted | `dream_core::context` (env reads moved to `estate.rs`) |
| `gate.rs` | 639 | deleted | `dream_gate::gate` |
| `ledger.rs` | 935 | deleted | `dream_core::ledger` |
| `manifest.rs` | 522 | deleted | `dream_gate::manifest` (`baseline_of` stays as `baseline.rs`) |
| `persist.rs` | 891 | deleted | `dream_core::persist` + `seams::{Forge, GhForge}` |
| `readiness.rs` | 417 | deleted | `dream_core::readiness` |
| `receipts.rs` | 484 | deleted | `dream_gate::receipts` |
| `roster.rs` | 227 | deleted | `dream_core::roster` (`default_path` stays in `estate.rs`) |
| `runstate.rs` | 340 | deleted | `dream_core::runstate` |
| `source.rs` | 1513 | deleted | `dream_core::source` (env reads and the key-file deny entry moved to `estate.rs`) |
| `sweep.rs` | 474 | deleted | `dream_core::sweep` |
| `verdict.rs` | 1006 | deleted | `dream_gate::verdict` |
| `witness.rs` | 151 | deleted | `dream_gate::witness` |
| `config.rs` | 789 | 501 | document types and validation are `dream_gate::config`; `RuntimeConfig`, placeholder expansion, discovery, slot rotation and the estate defaults stay |
| `runner.rs` | 276 | 81 | `SshRunner` only; the seam, `LocalRunner` and `ScriptedRunner` are `dream_core::runner` |
| `engine.rs` | 2756 | 1956 | composition root; the mechanism it called is gone, the ledger/blocked/handoff/sweep/carry-over bookkeeping moved to `records.rs` |
| `dispatch.rs` | 309 | 406 | gains `clone_repo_and_siblings` / `annexe_subpath` from `engine.rs`; `shell_quote` and `ExecOutcome` come from `dream_gate::outcome` |

New adapter files: `estate.rs`, `policy.rs`, `candidate_flow.rs`, `prompt.rs`,
`present.rs`, `notify.rs`, `records.rs`, `baseline.rs`, plus `LlmAdapter` in
`llm.rs` and `RuVectorSink` in `ruvector.rs`. `zone_crypto.rs` is untouched.

## Behaviour changes, all by design

| # | change | where it shows |
|---|---|---|
| a | A patch touching a protected path is now a REJECT (`CandidateState::Protected`) before any git command, build or evaluator runs; an unparseable or otherwise unsafe patch is `Refused` (INCONCLUSIVE). | `candidate_flow::tests::a_protected_patch_never_reaches_git_an_evaluator_or_the_model` |
| b | The candidate tree's `dream.config.json` digest is compared with the frozen one; drift not caused by the patch is BLOCKED-ENV. A tree with no config skips the check. An uncommitted edit to a repo's `dream.config.json` makes every such night BLOCKED-ENV until it is committed, because the manifest digests the working file and the candidate is cut from HEAD. | `engine.rs` step 9 |
| c | The dry streak now advances on REJECT and INCONCLUSIVE, resets on ACCEPT; BLOCKED-ENV and HANDOFF neither advance nor reset. **The old engine reset it on REJECT** (a falsified hypothesis counted as progress). | `engine::tests::the_roster_reads_the_new_dry_streak_rule_from_the_repos_ledger` |
| d | The same harness failures recurring unchanged on consecutive BLOCKED-ENV nights raise `Notice::HarnessStuck` (inbox alert). The failure manifest is `failures-<repo>-<hash>.json` in the artefact directory. | `engine::tests::the_same_harness_failures_twice_raise_harness_stuck` |

Smaller effects of the same move: `dream-gate` validates `dream.config.json`
more strictly than the old loader (`owner/name` slug, cron fields, integer
`bonusModuli` keys, `adrConvention` shape). `ontomark/dream.config.json`
declares `"adrConvention": "ADR-OM-NNN"` and no longer loads, so that repo's
night is a FAILED night until its config is corrected. The evaluators section
of the prompt no longer carries the "(agentbox ADR-2024)" tag (it is
`dream_core::compile`'s neutral text); every other byte of the prompt is
pinned by `prompt::tests::the_prompt_matches_the_pre_extraction_golden`.

## Seams and the adapter

| seam | adapter implementation | note |
|---|---|---|
| `Llm` | `llm::LlmAdapter` (Z.AI, Loom) | `max_tokens` honoured, `temperature` ignored (providers pin their own) |
| `EvaluatorRunner` | `runner::SshRunner` | keeps the `timeout` + `bash -o pipefail` wrapper |
| `MemorySink` | `ruvector::RuVectorSink` | direct SQL stays a documented exception: `bge-small-en-v1.5`, `check_dims` asserts 384 before any SQL. `MemoryRecord` carries `deep`, `night_date`, `witness` and `source` as typed fields; the stored row is unchanged (golden test) |
| `Notifier` | `notify::{InboxNotifier, JournalNotifier, Notifiers}` | `LostPr` and `HarnessStuck` become inbox alerts; every notice is journalled. Relay, digest and governance are **not** notifiers: they publish the whole night's state, not one `Notice`, and a per-notice forum post would be new behaviour |
| `Forge` | `GhForge` from dream-core | unchanged |

`replay::capture` **is** adopted. `dream_core::replay::NightInputs` carries
`PolicyExtras` (the self-referential flag and extra protected globs); `policy::for_night`
builds the night's policy through `replay::night_policy` from the same
`PolicyExtras` (`policy::extras_for`) that is stored with the night, so the
live guard, the gate and a later `replay verify` use one protected set. The
engine judges through `judge::judge` (capture, falling back to `replay::decide`
on a storage error, never to a different judgement), once for every night that
reaches the gate, and records under the night's artefact directory:
`replay.json` (schema 2), `decision.json`, `candidate.patch` and the files
`dream_core::replay` documents. The patch recorded is the one the final state
came from (the corrected diff after an apply-repair). Nights that end before the
gate (baseline unusable, policy unbuildable) record nothing, because there is no
gate decision to replay. Replay schema 1 records are refused with an error saying
a recapture is needed.

### API mismatches

Resolved upstream (dream-core, additively) and the adapter workarounds deleted:

- `replay::NightInputs` could not carry the self-referential flag or extra globs → `PolicyExtras` + `replay::night_policy`, replay schema 2.
- `candidate::Attempt` lost the typed `PersistError` → `Attempt::error: Option<AttemptError>`; the `patch did not apply: ` prefix is now only used to *format* the combined repair-failure text, never to decide anything.
- `MemoryRecord` had no `deep`/`date`/`witness`/`source` → typed optional fields (`deep`, `night_date`, `witness`, `source`); the RuVector sink no longer smuggles them through `kind` and a JSON `body`. The stored row is pinned by a golden test (`ruvector::tests::the_stored_row_matches_what_the_old_engine_wrote`): the same `jsonb` value as the pre-extraction `store_finding`, whose row construction is textually unchanged. Postgres normalises `jsonb`, so this is "same value", not "same text".

Still open, by design:

- **No `Notice` variant for relay, digest or governance.** That is a deliberate boundary, not a gap: those publish the whole night's state, not one event, and stay night-level drivers in this crate. No `Notice::Verdict`-style variant was added because nothing duplicates `NightSummary::render` here.
- `manifest::baseline_of` was not extracted (it shells out to git); it lives in `baseline.rs`.
- `DreamConfig` leaves `ledgerPath`, `branchPrefix` and `adrConvention` empty; `config::apply_estate_defaults` fills them.

### Call-order invariant

`candidate_flow` is the only caller of candidate machinery and always goes
through `dream_core::candidate::run`, which runs `guard::check` before any git
command, build or evaluator; the apply-repair pass re-enters `run`, so a
corrected diff is guarded again. The adapter contains no call to `prepare`,
`build_branch_worktree` or `git apply`, and no direct `gate::decide` or
`GateContext` (the test `judge::tests::the_adapter_has_one_way_to_judge_and_no_way_around_the_guard`
fails the build if one appears). `GateContext` has public fields upstream, so a
struct literal is possible in principle; the grep test is what keeps this
crate to the one judging path, `judge::judge` → `replay::capture` → `gate::decide`
with the night's policy; `policy::for_night` refuses config bytes
the manifest did not freeze and the night is BLOCKED-ENV, never run with a
weaker policy. The self-referential flag, and the `services/dream-engine`
glob, are set when `services/dream-engine/Cargo.toml` names `dream-engine` or
`crates/dream-gate` exists.

## Test accounting

The crate had 283 tests. 57 (digest 7, governance 18, inbox 9, journal 6, relay 8,
zone_crypto 9) belong to modules that did not move and are unchanged. The other
226 are accounted below, one row each: 1 CHANGED BY DESIGN, 1 dropped, 42 kept in adapter, 182 moved.

| old test | disposition | where it lives now |
|---|---|---|
| `candidate::tests::a_deliberately_broken_candidate_cannot_receive_accept` | moved | dream-core `candidate::tests::a_candidate_that_breaks_the_evaluator_is_vetoed` (renamed) |
| `candidate::tests::a_good_candidate_is_applied_isolated_and_passes_the_rerun` | moved | `candidate::tests::a_good_candidate_is_applied_isolated_and_passes_the_rerun` |
| `candidate::tests::a_patch_that_does_not_apply_is_reported_not_swallowed` | moved | dream-core `candidate::tests::a_patch_that_does_not_apply_is_a_harness_class_error` (renamed) |
| `candidate::tests::preparing_the_candidate_never_touches_the_operator_working_tree` | moved | dream-core `candidate::tests::a_good_candidate_is_applied_isolated_and_passes_the_rerun` (asserts the checkout is untouched); adapter `candidate_flow::tests::a_good_patch_is_applied_and_the_required_evaluators_rerun_on_it` asserts it again |
| `candidate::tests::the_baseline_is_evaluated_green_so_the_veto_is_the_patch_not_the_repo` | dropped | was a guard for the sibling test passing for the wrong reason; the renamed sibling in dream-core asserts a passing receipt on the same scratch repo, which only exists if the tree is green |
| `compile::tests::human_review_policy_when_no_auto_merge` | kept in adapter | `prompt::tests::human_review_policy_when_no_auto_merge` |
| `compile::tests::prompt_asks_for_a_dream_patch_block` | kept in adapter | `prompt::tests::prompt_asks_for_a_dream_patch_block` |
| `compile::tests::prompt_assigns_side_effects_to_the_engine` | kept in adapter | `prompt::tests::prompt_assigns_side_effects_to_the_engine` |
| `compile::tests::prompt_contains_evaluator` | kept in adapter | `prompt::tests::prompt_contains_evaluator` |
| `compile::tests::prompt_contains_repo_and_deep` | kept in adapter | `prompt::tests::prompt_contains_repo_and_deep` |
| `compile::tests::prompt_contains_verdict_instructions` | kept in adapter | `prompt::tests::prompt_contains_verdict_instructions` |
| `compile::tests::prompt_forbids_accept_without_patch` | kept in adapter | `prompt::tests::prompt_forbids_accept_without_patch` |
| `compile::tests::prompt_forbids_opaque_findings` | kept in adapter | `prompt::tests::prompt_forbids_opaque_findings` |
| `compile::tests::prompt_is_deterministic` | kept in adapter | `prompt::tests::prompt_is_deterministic` |
| `compile::tests::proposed_ledger_row_parses_as_a_ledger_row` | kept in adapter | `prompt::tests::proposed_ledger_row_parses_as_a_ledger_row` |
| `config::tests::accepts_darwin_evaluator_with_mock_or_agent_sandbox` | moved | `config::tests::accepts_darwin_evaluator_with_mock_or_agent_sandbox` |
| `config::tests::annexe_include_parses_and_defaults` | moved | dream-gate `config::tests::sibling_repos_parses` (the `annexeInclude` alias and the empty default) |
| `config::tests::bonus_moduli` | kept in adapter | `config::tests::bonus_moduli` |
| `config::tests::non_darwin_evaluators_unaffected` | moved | `config::tests::non_darwin_evaluators_unaffected` |
| `config::tests::placeholders::a_placeholder_in_the_middle_is_left_alone` | kept in adapter | `config::tests::placeholders::a_placeholder_in_the_middle_is_left_alone` |
| `config::tests::placeholders::a_placeholder_resolves_from_the_environment` | kept in adapter | `config::tests::placeholders::a_placeholder_resolves_from_the_environment` |
| `config::tests::placeholders::a_plain_value_passes_through` | kept in adapter | `config::tests::placeholders::a_plain_value_passes_through` |
| `config::tests::placeholders::an_empty_variable_counts_as_unset` | kept in adapter | `config::tests::placeholders::an_empty_variable_counts_as_unset` |
| `config::tests::placeholders::an_infix_placeholder_expands_inside_a_composite_value` | kept in adapter | `config::tests::placeholders::an_infix_placeholder_expands_inside_a_composite_value` |
| `config::tests::placeholders::an_unresolvable_manifest_placeholder_falls_back_to_the_default` | kept in adapter | `config::tests::placeholders::an_unresolvable_manifest_placeholder_falls_back_to_the_default` |
| `config::tests::placeholders::an_unset_infix_placeholder_poisons_the_whole_value` | kept in adapter | `config::tests::placeholders::an_unset_infix_placeholder_poisons_the_whole_value` |
| `config::tests::placeholders::an_unset_placeholder_is_absent_not_a_literal` | kept in adapter | `config::tests::placeholders::an_unset_placeholder_is_absent_not_a_literal` |
| `config::tests::placeholders::the_annexe_dir_literal_no_longer_reaches_a_live_ssh_command` | kept in adapter | `config::tests::placeholders::the_annexe_dir_literal_no_longer_reaches_a_live_ssh_command` |
| `config::tests::placeholders::the_manifest_placeholder_no_longer_reaches_the_loom_client` | kept in adapter | `config::tests::placeholders::the_manifest_placeholder_no_longer_reaches_the_loom_client` |
| `config::tests::rejects_darwin_evaluator_without_sandbox_flag` | moved | `config::tests::rejects_darwin_evaluator_without_sandbox_flag` |
| `config::tests::rejects_empty_slots` | moved | `config::tests::rejects_empty_slots` |
| `config::tests::shared_remotes_flags_two_checkouts_of_one_repo` | kept in adapter | `config::tests::shared_remotes_flags_two_checkouts_of_one_repo` |
| `config::tests::slot_rotation` | kept in adapter | `config::tests::slot_rotation` |
| `context::tests::clip_middle_marks_elision_and_respects_boundaries` | moved | `context::tests::clip_middle_marks_elision_and_respects_boundaries` |
| `context::tests::materialise_budget_degrades_prior_to_fold_but_not_tonight` | moved | `context::tests::materialise_budget_degrades_prior_to_fold_but_not_tonight` |
| `context::tests::materialise_folds_carry_recovery_pointer` | moved | `context::tests::materialise_folds_carry_recovery_pointer` |
| `context::tests::parse_plan_drops_unknown_actions` | moved | `context::tests::parse_plan_drops_unknown_actions` |
| `context::tests::parse_plan_tolerates_fences_and_prose` | moved | `context::tests::parse_plan_tolerates_fences_and_prose` |
| `context::tests::persist_and_reload_round_trip` | moved | `context::tests::persist_and_reload_round_trip` |
| `context::tests::validate_defaults_cover_unmentioned_objects` | moved | `context::tests::validate_defaults_cover_unmentioned_objects` |
| `context::tests::validate_drops_unknown_targets` | moved | `context::tests::validate_drops_unknown_targets` |
| `context::tests::validate_protects_tonight_receipts` | moved | `context::tests::validate_protects_tonight_receipts` |
| `dispatch::tests::annexe_probe_writes_before_it_measures` | kept in adapter | `dispatch::tests::annexe_probe_writes_before_it_measures` |
| `dispatch::tests::parse_avail_kb_reads_the_marker_line_only` | kept in adapter | `dispatch::tests::parse_avail_kb_reads_the_marker_line_only` |
| `dispatch::tests::shell_quote_handles_spaces_and_single_quotes` | kept in adapter | `dispatch::tests::shell_quote_handles_spaces_and_single_quotes` |
| `engine::tests::annexe_subpath_mirrors_real_depth_under_the_workspace` | kept in adapter | `dispatch::tests::annexe_subpath_mirrors_real_depth_under_the_workspace` |
| `engine::tests::conninfo_conversion` | kept in adapter | `estate::tests::conninfo_conversion` |
| `engine::tests::conninfo_defaults` | kept in adapter | `estate::tests::conninfo_defaults` |
| `engine::tests::dry_streak_counts_trailing_inconclusive` | moved | dream-core `streak::tests::dry_streak_counts_trailing_reject_and_inconclusive` |
| `engine::tests::dry_streak_empty_and_header_only` | moved | dream-core `streak::tests::next_dry_streak_rules`; adapter `engine::tests::the_roster_reads_the_new_dry_streak_rule_from_the_repos_ledger` (no ledger reads 0) |
| `engine::tests::dry_streak_reset_by_decisive_verdict` | CHANGED BY DESIGN | asserted that a REJECT resets the streak; under the new rule REJECT advances it and only ACCEPT resets. Replaced by dream-core `streak::tests::next_dry_streak_rules`, `operational_rows_neither_advance_nor_reset_the_streak` and adapter `engine::tests::the_roster_reads_the_new_dry_streak_rule_from_the_repos_ledger` |
| `engine::tests::env_u32_falls_back_on_absence_and_garbage` | kept in adapter | `estate::tests::env_u32_falls_back_on_absence_and_garbage` |
| `engine::tests::gate_result_line_is_always_compliant` | kept in adapter | `present::tests::gate_result_line_is_always_compliant` |
| `engine::tests::pr_title_prefers_a_result_cell_and_keeps_short_findings_whole` | kept in adapter | `present::tests::pr_title_prefers_a_result_cell_and_keeps_short_findings_whole` |
| `engine::tests::pr_title_takes_the_head_of_the_full_finding_on_a_word_boundary` | kept in adapter | `present::tests::pr_title_takes_the_head_of_the_full_finding_on_a_word_boundary` |
| `engine::tests::tail_respects_char_boundaries` | kept in adapter | `present::tests::tail_respects_char_boundaries` |
| `engine::tests::vetoed_finding_prefixes_a_compliant_result_once` | kept in adapter | `present::tests::vetoed_finding_prefixes_a_compliant_result_once` |
| `engine::tests::vetoed_finding_replaces_a_hypothesis_with_the_gate_result` | kept in adapter | `present::tests::vetoed_finding_replaces_a_hypothesis_with_the_gate_result` |
| `gate::tests::a_blocked_required_evaluator_vetoes` | moved | `gate::tests::a_blocked_required_evaluator_vetoes` |
| `gate::tests::a_broken_candidate_cannot_receive_accept` | moved | `gate::tests::a_broken_candidate_cannot_receive_accept` |
| `gate::tests::a_missing_required_evaluator_vetoes_as_a_harness_fault` | moved | `gate::tests::a_missing_required_evaluator_vetoes_as_a_harness_fault` |
| `gate::tests::a_patch_that_will_not_apply_is_a_harness_fault` | moved | `gate::tests::a_patch_that_will_not_apply_is_a_harness_fault` |
| `gate::tests::a_reject_verdict_passes_through_untouched` | moved | `gate::tests::a_reject_verdict_passes_through_untouched` |
| `gate::tests::a_silent_required_evaluator_vetoes` | moved | `gate::tests::a_silent_required_evaluator_vetoes` |
| `gate::tests::a_timed_out_required_evaluator_vetoes` | moved | `gate::tests::a_timed_out_required_evaluator_vetoes` |
| `gate::tests::accept_without_a_candidate_patch_is_unproven_not_a_harness_fault` | moved | `gate::tests::accept_without_a_candidate_patch_is_unproven_not_a_harness_fault` |
| `gate::tests::an_advisory_evaluator_never_vetoes` | moved | `gate::tests::an_advisory_evaluator_never_vetoes` |
| `gate::tests::an_unreadable_verdict_never_reaches_accept` | moved | `gate::tests::an_unreadable_verdict_never_reaches_accept` |
| `gate::tests::clean_accept_survives_the_gate` | moved | `gate::tests::clean_accept_survives_the_gate` |
| `gate::tests::environment_vetoes_ignore_a_legitimately_failing_baseline` | moved | `gate::tests::environment_vetoes_ignore_a_legitimately_failing_baseline` |
| `gate::tests::evaluators_scoped_to_another_deep_are_not_required_tonight` | moved | `gate::tests::evaluators_scoped_to_another_deep_are_not_required_tonight` |
| `gate::tests::failure_text_with_a_zero_exit_still_vetoes` | moved | `gate::tests::failure_text_with_a_zero_exit_still_vetoes` |
| `ledger::tests::append_adds_exactly_one_line` | moved | `ledger::tests::append_adds_exactly_one_line` |
| `ledger::tests::append_row_never_writes_a_non_compliant_row` | moved | `ledger::tests::append_row_never_writes_a_non_compliant_row` |
| `ledger::tests::bootstraps_missing_file` | moved | `ledger::tests::bootstraps_missing_file` |
| `ledger::tests::commit_ledger_commits_only_the_ledger_on_the_default_branch` | moved | `ledger::tests::commit_ledger_commits_only_the_ledger_on_the_default_branch` |
| `ledger::tests::commit_ledger_leaves_a_feature_branch_alone` | moved | `ledger::tests::commit_ledger_leaves_a_feature_branch_alone` |
| `ledger::tests::enforce_contract_leaves_a_compliant_row_alone` | moved | `ledger::tests::enforce_contract_leaves_a_compliant_row_alone` |
| `ledger::tests::enforce_contract_repairs_every_cell_rule` | moved | `ledger::tests::enforce_contract_repairs_every_cell_rule` |
| `ledger::tests::enforce_contract_replaces_a_failing_finding_with_the_fallback` | moved | `ledger::tests::enforce_contract_replaces_a_failing_finding_with_the_fallback` |
| `ledger::tests::enforce_contract_uses_a_last_resort_line_when_the_fallback_also_fails` | moved | `ledger::tests::enforce_contract_uses_a_last_resort_line_when_the_fallback_also_fails` |
| `ledger::tests::escape_cell_neutralises_pipes_and_newlines` | moved | `ledger::tests::escape_cell_neutralises_pipes_and_newlines` |
| `ledger::tests::escaping_keeps_row_parseable` | moved | `ledger::tests::escaping_keeps_row_parseable` |
| `ledger::tests::handles_file_without_trailing_newline` | moved | `ledger::tests::handles_file_without_trailing_newline` |
| `ledger::tests::review_from_merge_never_fabricates_a_duration` | moved | `ledger::tests::review_from_merge_never_fabricates_a_duration` |
| `ledger::tests::review_from_merge_reads_the_merge_event` | moved | `ledger::tests::review_from_merge_reads_the_merge_event` |
| `ledger::tests::review_from_merge_rounds_to_the_nearest_minute` | moved | `ledger::tests::review_from_merge_rounds_to_the_nearest_minute` |
| `ledger::tests::round_trip_parses_into_twelve_cells` | moved | `ledger::tests::round_trip_parses_into_twelve_cells` |
| `ledger::tests::row_violations_mirror_the_typescript_contract` | moved | `ledger::tests::row_violations_mirror_the_typescript_contract` |
| `ledger::tests::unreviewed_leaves_the_human_columns_empty` | moved | `ledger::tests::unreviewed_leaves_the_human_columns_empty` |
| `llm::timeout_tests::zai_timeout_scales_with_the_token_budget` | kept in adapter | `llm::timeout_tests::zai_timeout_scales_with_the_token_budget` |
| `manifest::tests::evaluator_identity_digests_the_command` | moved | `manifest::tests::evaluator_identity_digests_the_command` |
| `manifest::tests::evaluator_order_is_stable_regardless_of_map_order` | moved | `manifest::tests::evaluator_order_is_stable_regardless_of_map_order` |
| `manifest::tests::freeze_archives_a_diverged_manifest_instead_of_overwriting` | moved | `manifest::tests::freeze_archives_a_diverged_manifest_instead_of_overwriting` |
| `manifest::tests::freeze_writes_once_and_resumes_identically` | moved | `manifest::tests::freeze_writes_once_and_resumes_identically` |
| `manifest::tests::required_filters_by_deep_and_requirement` | moved | `manifest::tests::required_filters_by_deep_and_requirement` |
| `manifest::tests::run_id_is_deterministic_and_input_sensitive` | moved | `manifest::tests::run_id_is_deterministic_and_input_sensitive` |
| `manifest::tests::the_digest_ignores_the_timestamp_but_not_the_content` | moved | `manifest::tests::the_digest_ignores_the_timestamp_but_not_the_content` |
| `manifest::tests::write_atomic_replaces_content_wholesale` | moved | `manifest::tests::write_atomic_replaces_content_wholesale` |
| `persist::tests::a_fence_inside_the_diff_does_not_end_the_block` | moved | `patch::tests::a_fence_inside_the_diff_does_not_end_the_block` |
| `persist::tests::apply_attempts_order_and_three_way_gate` | moved | `persist::tests::apply_attempts_order_and_three_way_gate` |
| `persist::tests::binary_deletion_is_detected_per_file` | moved | `patch::tests::binary_deletion_is_detected_per_file` |
| `persist::tests::branch_name_slugifies_and_dates` | moved | `persist::tests::branch_name_slugifies_and_dates` |
| `persist::tests::build_branch_worktree_applies_patch_in_isolation` | moved | `persist::tests::build_branch_worktree_applies_patch_in_isolation` |
| `persist::tests::extract_patch_none_when_absent_or_empty` | moved | `patch::tests::extract_patch_none_when_absent_or_empty` |
| `persist::tests::extract_patch_pulls_the_fenced_diff` | moved | `patch::tests::extract_patch_pulls_the_fenced_diff` |
| `persist::tests::headerless_two_file_patch_lands_after_normalising` | moved | `persist::tests::headerless_two_file_patch_lands_after_normalising` |
| `persist::tests::lost_pr_alert_names_the_branch_and_the_recovery` | moved | adapter `notify::tests::the_lost_pr_alert_names_the_branch_and_the_recovery` (the old assertions verbatim, including the `workspace/<repo>` recovery path; the engine builds the notice with `notify::lost_pr`) and dream-core `seams::tests::lost_pr_text_names_the_branch_and_the_recovery_commands` |
| `persist::tests::mid_file_hunk_without_trailing_context_lands_after_normalising` | moved | `persist::tests::mid_file_hunk_without_trailing_context_lands_after_normalising` |
| `persist::tests::miscounted_hunk_lands_via_recount` | moved | `persist::tests::miscounted_hunk_lands_via_recount` |
| `persist::tests::normalising_leaves_eof_hunks_and_repeated_paths_alone` | moved | `patch::tests::normalising_leaves_eof_hunks_and_repeated_paths_alone` |
| `persist::tests::normalising_never_changes_an_added_or_removed_line` | moved | `patch::tests::normalising_never_changes_an_added_or_removed_line` |
| `persist::tests::unappliable_patch_reports_last_strategy_detail` | moved | dream-core `persist::tests::unappliable_patch_reports_last_strategy_detail_and_cleans_up` (renamed) |
| `persist::tests::worktree_can_be_pinned_to_an_older_base` | moved | `persist::tests::worktree_can_be_pinned_to_an_older_base` |
| `readiness::tests::a_nonexistent_script_command_is_refused` | moved | `readiness::tests::a_nonexistent_script_command_is_refused` |
| `readiness::tests::a_real_command_is_admitted_and_reports_its_roster` | moved | `readiness::tests::a_real_command_is_admitted_and_reports_its_roster` |
| `readiness::tests::a_script_behind_a_cd_resolves_relative_to_that_directory` | moved | `readiness::tests::a_script_behind_a_cd_resolves_relative_to_that_directory` |
| `readiness::tests::a_wrong_deep_evaluator_leaves_the_night_with_nothing_to_run` | moved | `readiness::tests::a_wrong_deep_evaluator_leaves_the_night_with_nothing_to_run` |
| `readiness::tests::an_all_advisory_roster_cannot_veto_and_is_refused` | moved | `readiness::tests::an_all_advisory_roster_cannot_veto_and_is_refused` |
| `readiness::tests::an_empty_evaluator_map_is_refused` | moved | `readiness::tests::an_empty_evaluator_map_is_refused` |
| `readiness::tests::an_inline_echo_command_is_refused_as_non_probative` | moved | `readiness::tests::an_inline_echo_command_is_refused_as_non_probative` |
| `readiness::tests::cat_of_a_file_is_surface_dependent_but_a_bare_cat_is_not` | moved | `readiness::tests::cat_of_a_file_is_surface_dependent_but_a_bare_cat_is_not` |
| `readiness::tests::darwin_without_a_sandbox_flag_is_refused_at_admission_too` | moved | `readiness::tests::darwin_without_a_sandbox_flag_is_refused_at_admission_too` |
| `receipts::tests::explicit_fail_text_beats_a_zero_exit` | moved | `receipts::tests::explicit_fail_text_beats_a_zero_exit` |
| `receipts::tests::green_cargo_output_is_not_an_explicit_fail` | moved | `receipts::tests::green_cargo_output_is_not_an_explicit_fail` |
| `receipts::tests::nonzero_exit_fails_with_the_code` | moved | `receipts::tests::nonzero_exit_fails_with_the_code` |
| `receipts::tests::only_passed_counts_as_a_pass` | moved | `receipts::tests::only_passed_counts_as_a_pass` |
| `receipts::tests::receipts_round_trip_through_disk_with_raw_streams` | moved | `receipts::tests::receipts_round_trip_through_disk_with_raw_streams` |
| `receipts::tests::timeout_is_typed_from_flag_or_exit_code` | moved | `receipts::tests::timeout_is_typed_from_flag_or_exit_code` |
| `receipts::tests::transport_error_is_blocked_not_failed` | moved | `receipts::tests::transport_error_is_blocked_not_failed` |
| `receipts::tests::zero_exit_with_no_output_is_silent` | moved | `receipts::tests::zero_exit_with_no_output_is_silent` |
| `receipts::tests::zero_exit_with_output_passes` | moved | `receipts::tests::zero_exit_with_output_passes` |
| `roster::tests::a_broken_harness_still_costs_a_turn` | moved | `roster::tests::a_broken_harness_still_costs_a_turn` |
| `roster::tests::an_empty_roster_is_alphabetical_and_capped` | moved | `roster::tests::an_empty_roster_is_alphabetical_and_capped` |
| `roster::tests::every_repo_gets_a_turn_before_any_repeats` | moved | `roster::tests::every_repo_gets_a_turn_before_any_repeats` |
| `roster::tests::pruning_forgets_retired_repos` | moved | `roster::tests::pruning_forgets_retired_repos` |
| `roster::tests::selection_is_deterministic_for_identical_state` | moved | `roster::tests::selection_is_deterministic_for_identical_state` |
| `roster::tests::state_survives_a_round_trip_and_a_missing_file` | moved | `roster::tests::state_survives_a_round_trip_and_a_missing_file` |
| `roster::tests::the_least_recently_run_repo_leads` | moved | `roster::tests::the_least_recently_run_repo_leads` |
| `runner::tests::local_runner_captures_streams_and_exit_code` | moved | `runner::tests::local_runner_captures_streams_and_exit_code` |
| `runner::tests::local_runner_does_not_let_a_tail_pipe_mask_a_failure` | moved | `runner::tests::local_runner_does_not_let_a_tail_pipe_mask_a_failure` |
| `runner::tests::local_runner_enforces_the_timeout` | moved | `runner::tests::local_runner_enforces_the_timeout` |
| `runner::tests::local_runner_runs_in_the_given_directory` | moved | `runner::tests::local_runner_runs_in_the_given_directory` |
| `runner::tests::scripted_runner_blocks_on_unscripted_commands` | moved | `runner::tests::scripted_runner_blocks_on_unscripted_commands` |
| `runner::tests::timeout_wrapper_quotes_the_command_and_the_directory` | kept in adapter | `runner::tests::timeout_wrapper_quotes_the_command_and_the_directory` |
| `runstate::tests::a_completed_run_is_never_silently_repeated` | moved | `runstate::tests::a_completed_run_is_never_silently_repeated` |
| `runstate::tests::a_corrupt_journal_does_not_wedge_the_night` | moved | `runstate::tests::a_corrupt_journal_does_not_wedge_the_night` |
| `runstate::tests::a_different_run_id_starts_a_fresh_journal` | moved | `runstate::tests::a_different_run_id_starts_a_fresh_journal` |
| `runstate::tests::a_first_attempt_is_fresh_and_durable` | moved | `runstate::tests::a_first_attempt_is_fresh_and_durable` |
| `runstate::tests::advance_never_moves_backwards` | moved | `runstate::tests::advance_never_moves_backwards` |
| `runstate::tests::an_interrupted_run_resumes_from_its_last_phase` | moved | `runstate::tests::an_interrupted_run_resumes_from_its_last_phase` |
| `runstate::tests::attempts_are_bounded_and_exhaustion_is_terminal` | moved | `runstate::tests::attempts_are_bounded_and_exhaustion_is_terminal` |
| `ruvector::tests::embedding_length_validation` | kept in adapter | `ruvector::tests::embedding_length_validation` |
| `ruvector::tests::importance_tiers` | kept in adapter | `ruvector::tests::importance_tiers` |
| `ruvector::tests::vector_formatting` | kept in adapter | `ruvector::tests::vector_formatting` |
| `ruvector::tests::vector_formatting_shape` | kept in adapter | `ruvector::tests::vector_formatting_shape` |
| `source::tests::apply_repair_prompt_carries_the_error_and_file_but_no_receipts` | moved | `source::tests::apply_repair_prompt_carries_the_error_and_file_but_no_receipts` |
| `source::tests::denylist_covers_key_material` | moved | `source::tests::denylist_covers_key_material` |
| `source::tests::env_knobs_fall_back_to_defaults` | moved | adapter `estate::tests::source_knobs_default_to_dream_cores_and_read_the_dream_source_vars` (the env reads moved to the adapter; dream-core's `SourceConfig::default()` is covered in its own source tests) |
| `source::tests::failing_excerpt_is_verbatim_and_clamped` | moved | `source::tests::failing_excerpt_is_verbatim_and_clamped` |
| `source::tests::failing_hunk_is_read_from_git_apply_errors` | moved | `source::tests::failing_hunk_is_read_from_git_apply_errors` |
| `source::tests::index_is_shallow_first_filtered_and_capped` | moved | `source::tests::index_is_shallow_first_filtered_and_capped` |
| `source::tests::key_material_files_are_withheld_whole` | moved | `source::tests::key_material_files_are_withheld_whole` |
| `source::tests::key_material_is_detected` | moved | `source::tests::key_material_is_detected` |
| `source::tests::line_ranges_parse_and_reject_nonsense` | moved | `source::tests::line_ranges_parse_and_reject_nonsense` |
| `source::tests::mentioned_paths_strip_locations_and_ignore_untracked` | moved | `source::tests::mentioned_paths_strip_locations_and_ignore_untracked` |
| `source::tests::parses_ls_tree_blobs_and_skips_submodules` | moved | `source::tests::parses_ls_tree_blobs_and_skips_submodules` |
| `source::tests::plan_parsing_accepts_both_shapes_and_fences` | moved | `source::tests::plan_parsing_accepts_both_shapes_and_fences` |
| `source::tests::reads_blobs_at_a_commit_not_the_worktree` | moved | `source::tests::reads_blobs_at_a_commit_not_the_worktree` |
| `source::tests::repair_record_round_trips_for_restart_reuse` | moved | `source::tests::repair_record_round_trips_for_restart_reuse` |
| `source::tests::repair_reply_classification` | moved | `source::tests::repair_reply_classification` |
| `source::tests::repair_runs_only_for_accept_without_patch` | moved | `source::tests::repair_runs_only_for_accept_without_patch` |
| `source::tests::section_formatting_budget_and_unreadable` | moved | `source::tests::section_formatting_budget_and_unreadable` |
| `source::tests::select_prefers_planner_dedups_and_caps` | moved | `source::tests::select_prefers_planner_dedups_and_caps` |
| `source::tests::slicing_and_clipping_mark_what_is_missing` | moved | `source::tests::slicing_and_clipping_mark_what_is_missing` |
| `source::tests::validation_refuses_traversal_absolute_denied_and_untracked` | moved | `source::tests::validation_refuses_traversal_absolute_denied_and_untracked` |
| `sweep::tests::landed_branches_go_whatever_their_age` | moved | `sweep::tests::landed_branches_go_whatever_their_age` |
| `sweep::tests::open_prs_get_a_week` | moved | `sweep::tests::open_prs_get_a_week` |
| `sweep::tests::plan_and_apply_against_a_scratch_repo` | moved | `sweep::tests::plan_and_apply_against_a_scratch_repo` |
| `sweep::tests::pr_state_parses_gh_json` | moved | `sweep::tests::pr_state_parses_gh_json` |
| `sweep::tests::prless_branches_get_a_week` | moved | `sweep::tests::prless_branches_get_a_week` |
| `sweep::tests::refs_merge_local_and_remote` | moved | `sweep::tests::refs_merge_local_and_remote` |
| `sweep::tests::the_checked_out_branch_is_never_touched` | moved | `sweep::tests::the_checked_out_branch_is_never_touched` |
| `verdict::tests::clip_words_cuts_on_a_word_boundary_with_an_ellipsis` | moved | `verdict::tests::clip_words_cuts_on_a_word_boundary_with_an_ellipsis` |
| `verdict::tests::defaults_to_inconclusive` | moved | `verdict::tests::defaults_to_inconclusive` |
| `verdict::tests::embedded_keyword_is_not_a_match` | moved | `verdict::tests::embedded_keyword_is_not_a_match` |
| `verdict::tests::falls_back_to_last_standalone_keyword` | moved | `verdict::tests::falls_back_to_last_standalone_keyword` |
| `verdict::tests::finding_violations_mirror_the_typescript_contract` | moved | `verdict::tests::finding_violations_mirror_the_typescript_contract` |
| `verdict::tests::from_label_round_trips_every_verdict` | moved | `verdict::tests::from_label_round_trips_every_verdict` |
| `verdict::tests::handoff_is_a_non_significant_operational_verdict` | moved | `verdict::tests::handoff_is_a_non_significant_operational_verdict` |
| `verdict::tests::last_verdict_line_wins` | moved | `verdict::tests::last_verdict_line_wins` |
| `verdict::tests::mid_document_keyword_does_not_override_trailing_verdict_line` | moved | `verdict::tests::mid_document_keyword_does_not_override_trailing_verdict_line` |
| `verdict::tests::parses_trailing_verdict_line` | moved | `verdict::tests::parses_trailing_verdict_line` |
| `verdict::tests::parses_verdict_field` | moved | `verdict::tests::parses_verdict_field` |
| `verdict::tests::parses_verdict_section` | moved | `verdict::tests::parses_verdict_section` |
| `verdict::tests::sanitise_first_non_heading_line` | moved | `verdict::tests::sanitise_first_non_heading_line` |
| `verdict::tests::sanitise_full_keeps_whole_hypothesis_past_80_chars` | moved | `verdict::tests::sanitise_full_keeps_whole_hypothesis_past_80_chars` |
| `verdict::tests::sanitise_ignores_a_ledger_row_cell_that_breaks_the_contract` | moved | `verdict::tests::sanitise_ignores_a_ledger_row_cell_that_breaks_the_contract` |
| `verdict::tests::sanitise_ignores_rows_dated_for_another_night` | moved | `verdict::tests::sanitise_ignores_rows_dated_for_another_night` |
| `verdict::tests::sanitise_inconclusive_fallback` | moved | `verdict::tests::sanitise_inconclusive_fallback` |
| `verdict::tests::sanitise_is_table_safe_and_truncated` | moved | `verdict::tests::sanitise_is_table_safe_and_truncated` |
| `verdict::tests::sanitise_matches_bold_hypothesis` | moved | `verdict::tests::sanitise_matches_bold_hypothesis` |
| `verdict::tests::sanitise_prefers_a_self_contained_finding_line_over_the_hypothesis` | moved | `verdict::tests::sanitise_prefers_a_self_contained_finding_line_over_the_hypothesis` |
| `verdict::tests::sanitise_prefers_given_hypothesis` | moved | `verdict::tests::sanitise_prefers_given_hypothesis` |
| `verdict::tests::sanitise_prefers_the_reports_own_ledger_row_cell` | moved | `verdict::tests::sanitise_prefers_the_reports_own_ledger_row_cell` |
| `verdict::tests::sanitise_strips_blockquote_from_given` | moved | `verdict::tests::sanitise_strips_blockquote_from_given` |
| `verdict::tests::sanitise_takes_tonights_backticked_row_not_an_earlier_nights_quoted_row` | moved | `verdict::tests::sanitise_takes_tonights_backticked_row_not_an_earlier_nights_quoted_row` |
| `verdict::tests::sanitise_uses_finding_line` | moved | `verdict::tests::sanitise_uses_finding_line` |
| `verdict::tests::sanitise_uses_main_lesson` | moved | `verdict::tests::sanitise_uses_main_lesson` |
| `verdict::tests::strict_accepts_a_single_clean_declaration` | moved | `verdict::tests::strict_accepts_a_single_clean_declaration` |
| `verdict::tests::strict_accepts_repeated_agreeing_declarations` | moved | `verdict::tests::strict_accepts_repeated_agreeing_declarations` |
| `verdict::tests::strict_refuses_a_report_with_no_declaration` | moved | `verdict::tests::strict_refuses_a_report_with_no_declaration` |
| `verdict::tests::strict_refuses_conflicting_declarations` | moved | `verdict::tests::strict_refuses_conflicting_declarations` |
| `verdict::tests::strict_refuses_trailing_prose_on_the_verdict_line` | moved | `verdict::tests::strict_refuses_trailing_prose_on_the_verdict_line` |
| `verdict::tests::strict_refuses_unknown_and_lowercase_tokens` | moved | `verdict::tests::strict_refuses_unknown_and_lowercase_tokens` |
| `verdict::tests::verdict_line_tolerates_punctuation_and_indent` | moved | `verdict::tests::verdict_line_tolerates_punctuation_and_indent` |
| `verdict::tests::verdict_str_and_significance` | moved | `verdict::tests::verdict_str_and_significance` |
| `witness::tests::accepts_boundary_lengths` | moved | `witness::tests::accepts_boundary_lengths` |
| `witness::tests::commit_is_trimmed_and_lowercased` | moved | `witness::tests::commit_is_trimmed_and_lowercased` |
| `witness::tests::different_commit_changes_witness` | moved | `witness::tests::different_commit_changes_witness` |
| `witness::tests::is_deterministic` | moved | `witness::tests::is_deterministic` |
| `witness::tests::matches_reference_vector` | moved | `witness::tests::matches_reference_vector` |
| `witness::tests::rejects_bad_commits` | moved | `witness::tests::rejects_bad_commits` |
| `witness::tests::report_hash_is_64_char_lowercase_hex` | moved | `witness::tests::report_hash_is_64_char_lowercase_hex` |
| `witness::tests::short_handles_undersized_input` | moved | `witness::tests::short_handles_undersized_input` |
| `witness::tests::single_byte_report_change_changes_witness` | moved | `witness::tests::single_byte_report_change_changes_witness` |

### Tests added in the adapter


- `baseline::tests::a_directory_that_is_not_a_repo_is_an_error`
- `baseline::tests::head_commit_and_tree_are_full_hashes`
- `candidate_flow::tests::a_binary_deletion_is_refused_before_any_git_command`
- `candidate_flow::tests::a_declined_repair_leaves_a_did_not_apply_state_with_the_reason`
- `candidate_flow::tests::a_good_patch_is_applied_and_the_required_evaluators_rerun_on_it`
- `candidate_flow::tests::a_protected_patch_never_reaches_git_an_evaluator_or_the_model`
- `candidate_flow::tests::a_repaired_patch_that_touches_a_protected_path_is_protected`
- `candidate_flow::tests::an_unappliable_patch_gets_exactly_one_recorded_repair`
- `candidate_flow::tests::the_candidate_trees_config_digest_is_what_the_gate_compares`
- `config::tests::a_config_the_gate_rejects_is_an_error`
- `config::tests::estate_defaults_fill_what_the_gate_leaves_empty`
- `engine::tests::a_decisive_night_after_a_stall_is_not_a_stall`
- `engine::tests::per_test_evidence_needs_a_declared_format`
- `engine::tests::the_roster_reads_the_new_dry_streak_rule_from_the_repos_ledger`
- `engine::tests::the_same_harness_failures_twice_raise_harness_stuck`
- `estate::tests::estate_defaults_are_the_documented_ones`
- `estate::tests::self_gc_switches_read_the_dream_self_gc_vars`
- `estate::tests::source_knobs_default_to_dream_cores_and_read_the_dream_source_vars`
- `estate::tests::the_session_mirror_key_file_is_denied`
- `llm::adapter_tests::a_zai_adapter_without_a_key_reports_missing_credentials`
- `llm::adapter_tests::errors_map_onto_the_seam_vocabulary`
- `llm::adapter_tests::identity_is_the_frozen_manifest_shape`
- `notify::tests::fan_out_is_infallible_with_a_disabled_journal`
- `notify::tests::journal_tool_classes_are_stable`
- `notify::tests::only_lost_prs_and_stalled_harnesses_are_inbox_alerts`
- `notify::tests::the_lost_pr_alert_names_the_branch_and_the_recovery`
- `policy::tests::a_checkout_of_the_gate_crates_is_self_referential_too`
- `policy::tests::an_unrelated_services_dir_is_not_self_referential`
- `policy::tests::config_bytes_the_manifest_did_not_freeze_are_refused`
- `policy::tests::the_default_ledger_and_the_evaluator_script_are_protected`
- `policy::tests::the_engines_own_source_is_protected_when_it_is_the_target`
- `present::tests::receipts_render_the_outcome_before_the_streams`
- `prompt::tests::the_prompt_matches_the_pre_extraction_golden`
- `prompt::tests::the_template_is_valid`
- `runner::tests::an_unconfigured_host_is_a_transport_fault_not_a_pass`
- `ruvector::tests::a_corrupt_payload_is_a_sink_error_not_a_panic`
- `ruvector::tests::operational_verdicts_do_not_clear_the_storage_bar`
- `ruvector::tests::the_seam_record_round_trips_every_stored_field`

## Pinning

`Cargo.toml` carries the two direct dependencies as path dependencies for
development; `pairwise-gate` and `failure-fingerprint` come in through them.
Once the extracted repository is pushed, each line becomes a git dependency on
the **same** revision (one line per crate, both must move together, otherwise
two copies of `dream-gate` link and their types stop unifying):

```toml
dream-core = { git = "https://github.com/DreamLab-AI/dream-engine", rev = "<sha>" }
dream-gate = { git = "https://github.com/DreamLab-AI/dream-engine", rev = "<sha>" }
```

Then refresh `services/dream-engine/Cargo.lock`, and only then add the pin to
`lib/dream-engine.nix` (it cannot build with path dependencies that point
outside the repository; it is untouched here).

