//! The agentbox nightly prompt.
//!
//! The substitution mechanism and the section renderers (bonus dives,
//! competitors, evaluators, build step) live in `dream_core::compile`. What
//! stays here is the estate's *wording*: [`TEMPLATE`], the methodology for a
//! single completion (ADR-2114) — what the engine has already done and will do
//! after the reply, the hypothesis -> candidate-diff method, evidence grading,
//! the proposed ledger row and the frozen-hypothesis discipline. It never asks
//! the model to run, publish or persist anything: the engine owns every side
//! effect.

use dream_core::compile::{compile as compile_with, PromptTemplate, TemplateError};
use dream_gate::config::{DreamConfig, Slot};

/// The agentbox nightly prompt template (`{{name}}` placeholders).
pub const TEMPLATE: &str = include_str!("prompt/nightly.tmpl");

/// The template as a [`PromptTemplate`].
pub fn template() -> PromptTemplate {
    PromptTemplate::new(TEMPLATE)
}

/// Compile a deterministic nightly prompt from config + tonight's slot.
pub fn compile(
    cfg: &DreamConfig,
    slot: &Slot,
    day_int: u32,
    bonus_dives: &[String],
) -> Result<String, TemplateError> {
    compile_with(cfg, slot, day_int, bonus_dives, &template())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{apply_estate_defaults, DreamConfig};

    fn test_config() -> DreamConfig {
        let mut cfg = DreamConfig::from_json(
            br#"{
              "repo": "DreamLab-AI/test",
              "cron": "0 3 * * *",
              "slots": [
                {"deep": "compiler-parity", "scan": ["config-schema", "golden-snapshots"]},
                {"deep": "ledger-signals", "scan": ["witness"]}
              ],
              "buildStep": {"cmd": "cargo build"},
              "evaluatorEntrypoints": {"bench": "cargo test"},
              "competitors": ["Sakana AI Scientist"],
              "labels": ["dream-cycle"]
            }"#,
        )
        .unwrap();
        apply_estate_defaults(&mut cfg);
        cfg
    }

    fn prompt() -> String {
        let cfg = test_config();
        compile(&cfg, &cfg.slots[0], 20260815, &[]).unwrap()
    }

    #[test]
    fn the_template_is_valid() {
        template().validate().unwrap();
    }

    /// The prompt the engine sent before the extraction, byte for byte, for
    /// the same config and two bonus dives. The only permitted difference is
    /// the estate tag dream-core's neutral evaluator section no longer carries.
    #[test]
    fn the_prompt_matches_the_pre_extraction_golden() {
        let cfg = test_config();
        let got = compile(
            &cfg,
            &cfg.slots[0],
            20260815,
            &["Dive A".to_string(), "Dive B".to_string()],
        )
        .unwrap();
        let golden =
            include_str!("../tests/fixtures/prompt-golden.txt").replace(" (agentbox ADR-2024)", "");
        assert_eq!(got, golden);
    }

    #[test]
    fn prompt_is_deterministic() {
        assert_eq!(prompt(), prompt());
    }

    #[test]
    fn prompt_contains_repo_and_deep() {
        let p = prompt();
        assert!(p.contains("DreamLab-AI/test"));
        assert!(p.contains("compiler-parity"));
        assert!(p.contains("config-schema, golden-snapshots"));
    }

    #[test]
    fn prompt_contains_evaluator() {
        assert!(prompt().contains("cargo test"));
    }

    #[test]
    fn prompt_contains_verdict_instructions() {
        let p = prompt();
        assert!(p.contains("VERDICT: ACCEPT"));
        assert!(p.contains("VERDICT: REJECT"));
        assert!(p.contains("VERDICT: INCONCLUSIVE"));
    }

    #[test]
    fn human_review_policy_when_no_auto_merge() {
        assert!(prompt().contains("Human-review-only"));
    }

    #[test]
    fn prompt_assigns_side_effects_to_the_engine() {
        let p = prompt();
        // ADR-2114: the model is one completion with no tools. The prompt must
        // say so and must not ask it to run, publish or persist anything —
        // the old agent-shaped steps produced narrated ACCEPTs with no diff.
        assert!(p.contains("single model call"));
        assert!(p.contains("Never claim to have run"));
        for banned in [
            "Publish gist",
            "Create issue",
            "Append one ledger row",
            "check its current GitHub state",
            "Run every evaluator entrypoint",
        ] {
            assert!(
                !p.contains(banned),
                "prompt still asks the model to: {banned}"
            );
        }
        // Prior-night fates and reviewer columns are engine-filled now.
        assert!(p.contains(
            "engine fills the issue, PR, witness, prior-night-fate and reviewer columns"
        ));
    }

    #[test]
    fn proposed_ledger_row_parses_as_a_ledger_row() {
        let row = prompt()
            .lines()
            .map(str::trim)
            .find(|l| l.starts_with("`| 2026-08-15 | compiler-parity |"))
            .expect("row template present")
            .trim_matches('`')
            .to_string();
        // The ledger row needs at least 12 `|` cells, ISO date first.
        assert!(row.split('|').count() >= 12, "{row}");
    }

    #[test]
    fn prompt_forbids_accept_without_patch() {
        let p = prompt();
        assert!(p.contains("An ACCEPT without it is vetoed by the engine"));
        assert!(p.contains("Never write a hunk inside an elided region"));
    }

    #[test]
    fn prompt_forbids_opaque_findings() {
        let p = prompt();
        // The finding column must be concrete — "see report" is banned so the ledger
        // stays useful as cross-night memory and INCONCLUSIVE blockers stay legible
        // to the dry-streak / duplicate-direction signals.
        assert!(p.contains("see report"));
        assert!(p.contains("name the blocker itself"));
    }

    #[test]
    fn prompt_asks_for_a_dream_patch_block() {
        let p = prompt();
        // ADR-061 (amended by ADR-2114): ACCEPT must emit the candidate as a
        // ```dream-patch block the engine applies, re-evaluates and — only if
        // the gate upholds it — opens as a draft PR.
        assert!(p.contains("```dream-patch"));
        assert!(p.contains("draft"));
    }
}
