//! The deterministic required-check gate.
//!
//! ADR-2024's closeout named the defect precisely: evaluation ran *before*
//! patch emission, the emitted candidate was never re-evaluated, and evaluator
//! failure did not veto — so failure text and an ACCEPT label could coexist in
//! one report. This module is the veto that closes it.
//!
//! The gate is a **pure function** of three inputs — the frozen manifest, the
//! typed receipts, and the strict verdict parse — and it is consulted *after*
//! the candidate has been applied and the required evaluators re-run. The model
//! cannot argue with it: a required evaluator that is missing, silent, blocked,
//! timed out, explicitly failing or non-zero vetoes acceptance regardless of
//! what the report says.
//!
//! Vetoes carry a class, and the class picks the substituted verdict:
//!
//! | class | cause | verdict |
//! |---|---|---|
//! | harness | missing / silent / blocked / timed out / patch would not apply | `BLOCKED-ENV` |
//! | evidence | non-zero exit / explicit FAIL | `REJECT` |
//! | unproven | no candidate patch / unreadable verdict line | `INCONCLUSIVE` |
//!
//! `BLOCKED-ENV` is deliberate for harness faults: a broken annexe is not
//! evidence against the repository and must not park a healthy repo on the dry
//! streak.

use serde::{Deserialize, Serialize};

use crate::manifest::{EvaluatorIdentity, ExperimentManifest};
use crate::receipts::{EvaluatorOutcome, EvaluatorReceipt, Phase};
use crate::verdict::{Verdict, VerdictParseError};

/// What kind of thing went wrong, which decides the substituted verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VetoClass {
    /// The evidence could not be gathered — an operational fault.
    Harness,
    /// The evidence was gathered and it is against the candidate.
    Evidence,
    /// There was nothing to test, or nothing readable to act on.
    Unproven,
}

/// One reason acceptance was refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Veto {
    pub class: VetoClass,
    /// Evaluator name, or a pseudo-name for structural vetoes.
    pub subject: String,
    pub reason: String,
}

impl Veto {
    fn harness(subject: &str, reason: impl Into<String>) -> Self {
        Self { class: VetoClass::Harness, subject: subject.into(), reason: reason.into() }
    }
    fn evidence(subject: &str, reason: impl Into<String>) -> Self {
        Self { class: VetoClass::Evidence, subject: subject.into(), reason: reason.into() }
    }
    fn unproven(subject: &str, reason: impl Into<String>) -> Self {
        Self { class: VetoClass::Unproven, subject: subject.into(), reason: reason.into() }
    }
}

/// The gate's ruling.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDecision {
    /// True only when the candidate earned ACCEPT: a clean strict parse of
    /// `ACCEPT`, an applied candidate, and every required evaluator passing on
    /// the candidate tree.
    pub accepted: bool,
    /// The verdict that goes in the ledger.
    pub verdict: String,
    pub model_verdict: String,
    pub vetoes: Vec<Veto>,
    /// Every required evaluator and how it landed on the candidate tree.
    pub required_outcomes: Vec<(String, String)>,
    pub summary: String,
}

impl GateDecision {
    pub fn verdict_enum(&self) -> Verdict {
        match self.verdict.as_str() {
            "ACCEPT" => Verdict::Accept,
            "REJECT" => Verdict::Reject,
            "BLOCKED-ENV" => Verdict::BlockedEnv,
            "HANDOFF" => Verdict::Handoff,
            _ => Verdict::Inconclusive,
        }
    }
}

/// Turn one required evaluator's outcome into a veto, or `None` if it passed.
fn veto_for(name: &str, outcome: &EvaluatorOutcome) -> Option<Veto> {
    match outcome {
        EvaluatorOutcome::Passed => None,
        EvaluatorOutcome::Missing => Some(Veto::harness(
            name,
            "required evaluator produced no receipt — it never ran",
        )),
        EvaluatorOutcome::Silent => Some(Veto::harness(
            name,
            "required evaluator exited 0 with no output on either stream — \
             surface-independent, so it proves nothing (ADR-065)",
        )),
        EvaluatorOutcome::Blocked { detail } => {
            Some(Veto::harness(name, format!("required evaluator was blocked: {detail}")))
        }
        EvaluatorOutcome::TimedOut { after_secs } => Some(Veto::harness(
            name,
            format!("required evaluator exceeded its {after_secs}s budget and was killed"),
        )),
        EvaluatorOutcome::Failed { exit_code } => Some(Veto::evidence(
            name,
            format!("required evaluator exited {exit_code}"),
        )),
        EvaluatorOutcome::ExplicitFail { marker } => Some(Veto::evidence(
            name,
            format!("required evaluator declared failure: {marker}"),
        )),
    }
}

/// Complete the receipt set: every required evaluator in the manifest that has
/// no receipt for `phase` gets a [`EvaluatorOutcome::Missing`] one.
///
/// This is what makes "missing" a veto rather than a silent pass — an evaluator
/// the dispatcher skipped is otherwise simply absent from the evidence.
pub fn complete_receipts(
    required: &[&EvaluatorIdentity],
    receipts: &[EvaluatorReceipt],
    phase: Phase,
) -> Vec<EvaluatorReceipt> {
    let mut out: Vec<EvaluatorReceipt> = receipts
        .iter()
        .filter(|r| r.phase == phase)
        .cloned()
        .collect();
    for id in required {
        if !out.iter().any(|r| r.name == id.name) {
            out.push(EvaluatorReceipt::missing(&id.name, &id.command, phase, true));
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// The environment pre-check on the **baseline** receipts.
///
/// A baseline evaluator is allowed to fail — that failure is often the very
/// finding the night is about. What is not allowed is a baseline evaluator that
/// could not run: if the harness is broken there is nothing to reason over, and
/// the night is `BLOCKED-ENV` before a token is spent on the model.
pub fn environment_vetoes(
    manifest: &ExperimentManifest,
    baseline: &[EvaluatorReceipt],
) -> Vec<Veto> {
    let required = manifest.required();
    complete_receipts(&required, baseline, Phase::Baseline)
        .iter()
        .filter(|r| r.required && r.outcome.is_harness_fault())
        .filter_map(|r| veto_for(&r.name, &r.outcome))
        .collect()
}

/// Structural facts about the candidate, established before the gate runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CandidateState {
    /// A patch was extracted, applied cleanly and re-evaluated.
    Applied { tree_hash: String },
    /// The report claimed a result but emitted no `dream-patch` block.
    NoPatch,
    /// A patch was emitted but would not apply to the baseline tree.
    DidNotApply { detail: String },
    /// The model did not claim ACCEPT, so no candidate was built. The gate
    /// still records the required outcomes, but there is nothing to veto.
    NotAttempted,
}

/// The deterministic gate.
///
/// `strict` is [`crate::verdict::parse_verdict_strict`]'s result — the only
/// reading of the model's verdict that acceptance consults.
pub fn decide(
    manifest: &ExperimentManifest,
    strict: &Result<Verdict, VerdictParseError>,
    candidate: &CandidateState,
    candidate_receipts: &[EvaluatorReceipt],
) -> GateDecision {
    let required = manifest.required();
    let completed = complete_receipts(&required, candidate_receipts, Phase::Candidate);
    let required_outcomes: Vec<(String, String)> = completed
        .iter()
        .filter(|r| r.required)
        .map(|r| (r.name.clone(), r.outcome.label().to_string()))
        .collect();

    let model_verdict = match strict {
        Ok(v) => v.as_str().to_string(),
        Err(e) => format!("UNPARSED ({e})"),
    };

    let mut vetoes: Vec<Veto> = Vec::new();

    // 1. The model must have declared ACCEPT, readably. Anything else is not a
    //    veto so much as an absence of a claim to accept.
    let claimed_accept = matches!(strict, Ok(Verdict::Accept));
    if let Err(e) = strict {
        vetoes.push(Veto::unproven("verdict", format!("strict verdict parse failed: {e}")));
    }

    // 2. A claim of ACCEPT must come with a candidate that was applied and
    //    re-evaluated. "Accepted" with nothing to test is unearned.
    if claimed_accept {
        match candidate {
            CandidateState::Applied { .. } => {}
            CandidateState::NoPatch => vetoes.push(Veto::unproven(
                "candidate",
                "report declared ACCEPT but emitted no ```dream-patch block, \
                 so no candidate tree could be built or re-evaluated",
            )),
            CandidateState::DidNotApply { detail } => vetoes.push(Veto::harness(
                "candidate",
                format!("candidate patch did not apply to the baseline tree: {detail}"),
            )),
            CandidateState::NotAttempted => vetoes.push(Veto::unproven(
                "candidate",
                "report declared ACCEPT but the candidate rerun was never attempted",
            )),
        }
    }

    // 3. Required evaluators on the candidate tree. This is the veto proper,
    //    and it applies whatever the report's prose says — but only when a
    //    candidate tree exists to have been evaluated. An ACCEPT that shipped
    //    no patch (2026-09-07 dreamlab-ai-website) has nothing to run: grading
    //    its absent receipts as "never ran" turned a model failing into three
    //    false harness vetoes, a BLOCKED-ENV verdict and an operator alert
    //    about a harness that had in fact passed every baseline evaluator.
    //    That case is `unproven` → INCONCLUSIVE, which is what step 2 records.
    if matches!(candidate, CandidateState::Applied { .. }) {
        for r in completed.iter().filter(|r| r.required) {
            if let Some(v) = veto_for(&r.name, &r.outcome) {
                vetoes.push(v);
            }
        }
    }

    let accepted = claimed_accept && vetoes.is_empty();
    let verdict = if accepted {
        Verdict::Accept
    } else if !claimed_accept {
        // No acceptance was claimed: keep the model's own reading, and fall
        // back to INCONCLUSIVE when it could not be read at all.
        match strict {
            Ok(v) => *v,
            Err(_) => Verdict::Inconclusive,
        }
    } else if vetoes.iter().any(|v| v.class == VetoClass::Harness) {
        Verdict::BlockedEnv
    } else if vetoes.iter().any(|v| v.class == VetoClass::Evidence) {
        Verdict::Reject
    } else {
        Verdict::Inconclusive
    };

    let summary = if accepted {
        format!(
            "ACCEPT upheld: {} required evaluator(s) passed on candidate tree {}",
            required_outcomes.len(),
            match candidate {
                CandidateState::Applied { tree_hash } => &tree_hash[..tree_hash.len().min(12)],
                _ => "-",
            }
        )
    } else if claimed_accept {
        format!(
            "ACCEPT vetoed → {}: {}",
            verdict.as_str(),
            vetoes
                .iter()
                .map(|v| format!("{}: {}", v.subject, v.reason))
                .collect::<Vec<_>>()
                .join("; ")
        )
    } else {
        format!("no acceptance claimed (model verdict {model_verdict})")
    };

    GateDecision {
        accepted,
        verdict: verdict.as_str().to_string(),
        model_verdict,
        vetoes,
        required_outcomes,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{digest, ModelIdentity};
    use crate::runner::ExecOutcome;

    fn ident(name: &str, required: bool) -> EvaluatorIdentity {
        let cmd = format!("run-{name}");
        EvaluatorIdentity {
            name: name.into(),
            command_digest: digest(cmd.as_bytes()),
            command: cmd,
            required,
            deeps: vec![],
            timeout_secs: 900,
        }
    }

    fn manifest(evaluators: Vec<EvaluatorIdentity>) -> ExperimentManifest {
        ExperimentManifest {
            schema: 1,
            run_id: "0123456789abcdef".into(),
            night_id: "2026-09-05-agentbox".into(),
            repo: "agentbox".into(),
            repo_slug: "DreamLab-AI/agentbox".into(),
            date: "2026-09-05".into(),
            day_int: 20260905,
            deep: "dream-engine".into(),
            scan: vec![],
            baseline_revision: "a".repeat(40),
            baseline_tree_hash: "b".repeat(40),
            config_digest: digest(b"cfg"),
            evaluators,
            model: ModelIdentity {
                provider: "loom".into(),
                model: "qwen3.8-27B".into(),
                max_tokens: 16384,
                fallback: None,
            },
            engine_version: "0.1.0".into(),
            created_at: "2026-09-05T01:00:00Z".into(),
        }
    }

    fn receipt(name: &str, phase: Phase, code: i32, stdout: &str) -> EvaluatorReceipt {
        EvaluatorReceipt::from_exec(
            name,
            &format!("run-{name}"),
            phase,
            true,
            900,
            ExecOutcome {
                exit_code: Some(code),
                stdout: stdout.into(),
                stderr: String::new(),
                duration_ms: 10,
                transport_error: None,
                timed_out: false,
                started_at: "2026-09-05T01:00:00Z".into(),
            },
        )
    }

    fn applied() -> CandidateState {
        CandidateState::Applied { tree_hash: "c".repeat(40) }
    }

    #[test]
    fn clean_accept_survives_the_gate() {
        let m = manifest(vec![ident("tests", true), ident("lint", false)]);
        let d = decide(
            &m,
            &Ok(Verdict::Accept),
            &applied(),
            &[receipt("tests", Phase::Candidate, 0, "42 passed")],
        );
        assert!(d.accepted, "{}", d.summary);
        assert_eq!(d.verdict, "ACCEPT");
        assert!(d.vetoes.is_empty());
        assert_eq!(d.required_outcomes, vec![("tests".to_string(), "PASSED".to_string())]);
    }

    /// The headline case from the ADR closeout: a deliberately broken candidate
    /// cannot receive ACCEPT, however confidently the report asserts it.
    #[test]
    fn a_broken_candidate_cannot_receive_accept() {
        let m = manifest(vec![ident("tests", true)]);
        let d = decide(
            &m,
            &Ok(Verdict::Accept),
            &applied(),
            &[receipt("tests", Phase::Candidate, 101, "error[E0308]: mismatched types")],
        );
        assert!(!d.accepted);
        assert_eq!(d.verdict, "REJECT", "a failing required evaluator is evidence, not a harness fault");
        assert_eq!(d.model_verdict, "ACCEPT", "the model's own claim is still recorded");
        assert_eq!(d.vetoes.len(), 1);
        assert_eq!(d.vetoes[0].class, VetoClass::Evidence);
    }

    #[test]
    fn failure_text_with_a_zero_exit_still_vetoes() {
        // "Failure text can coexist with ACCEPT" — the exact reproduced defect.
        let m = manifest(vec![ident("recall", true)]);
        let d = decide(
            &m,
            &Ok(Verdict::Accept),
            &applied(),
            &[receipt("recall", Phase::Candidate, 0, "band check\nFAIL: true 91/120\n")],
        );
        assert!(!d.accepted);
        assert_eq!(d.verdict, "REJECT");
        assert!(d.vetoes[0].reason.contains("declared failure"), "{:?}", d.vetoes);
    }

    #[test]
    fn a_missing_required_evaluator_vetoes_as_a_harness_fault() {
        let m = manifest(vec![ident("tests", true), ident("hooks", true)]);
        let d = decide(
            &m,
            &Ok(Verdict::Accept),
            &applied(),
            &[receipt("tests", Phase::Candidate, 0, "ok")],
        );
        assert!(!d.accepted);
        assert_eq!(d.verdict, "BLOCKED-ENV");
        assert_eq!(d.vetoes.len(), 1);
        assert_eq!(d.vetoes[0].subject, "hooks");
        assert_eq!(d.vetoes[0].class, VetoClass::Harness);
    }

    #[test]
    fn a_silent_required_evaluator_vetoes() {
        let m = manifest(vec![ident("darwin", true)]);
        let d = decide(&m, &Ok(Verdict::Accept), &applied(), &[receipt("darwin", Phase::Candidate, 0, "")]);
        assert!(!d.accepted);
        assert_eq!(d.verdict, "BLOCKED-ENV");
        assert!(d.vetoes[0].reason.contains("no output"), "{:?}", d.vetoes);
    }

    #[test]
    fn a_timed_out_required_evaluator_vetoes() {
        let m = manifest(vec![ident("tests", true)]);
        let mut r = receipt("tests", Phase::Candidate, 0, "partial");
        r.outcome = EvaluatorOutcome::TimedOut { after_secs: 900 };
        let d = decide(&m, &Ok(Verdict::Accept), &applied(), &[r]);
        assert!(!d.accepted);
        assert_eq!(d.verdict, "BLOCKED-ENV");
    }

    #[test]
    fn a_blocked_required_evaluator_vetoes() {
        let m = manifest(vec![ident("tests", true)]);
        let mut r = receipt("tests", Phase::Candidate, 0, "x");
        r.outcome = EvaluatorOutcome::Blocked { detail: "ssh: no route to host".into() };
        let d = decide(&m, &Ok(Verdict::Accept), &applied(), &[r]);
        assert!(!d.accepted);
        assert_eq!(d.verdict, "BLOCKED-ENV");
    }

    #[test]
    fn an_advisory_evaluator_never_vetoes() {
        let m = manifest(vec![ident("tests", true), ident("lint", false)]);
        let mut lint = receipt("lint", Phase::Candidate, 1, "style nits");
        lint.required = false;
        let d = decide(
            &m,
            &Ok(Verdict::Accept),
            &applied(),
            &[receipt("tests", Phase::Candidate, 0, "ok"), lint],
        );
        assert!(d.accepted, "{}", d.summary);
    }

    /// 2026-09-07 dreamlab-ai-website: bench/lint/pin-parity all PASSED on
    /// baseline, the model claimed ACCEPT without a patch, and the gate
    /// reported "required evaluator produced no receipt — it never ran" three
    /// times → BLOCKED-ENV. No patch means nothing to re-run; that is the
    /// model's failing (unproven), not the harness's.
    #[test]
    fn accept_without_a_candidate_patch_is_unproven_not_a_harness_fault() {
        let m = manifest(vec![ident("tests", true)]);
        let d = decide(&m, &Ok(Verdict::Accept), &CandidateState::NoPatch, &[]);
        assert!(!d.accepted);
        assert_eq!(d.verdict, "INCONCLUSIVE", "{}", d.summary);
        assert!(d.vetoes.iter().any(|v| v.subject == "candidate"), "{:?}", d.vetoes);
        assert!(
            d.vetoes.iter().all(|v| v.class != VetoClass::Harness),
            "absent candidate receipts must not read as a broken harness: {:?}",
            d.vetoes
        );
    }

    #[test]
    fn a_patch_that_will_not_apply_is_a_harness_fault() {
        let m = manifest(vec![ident("tests", true)]);
        let d = decide(
            &m,
            &Ok(Verdict::Accept),
            &CandidateState::DidNotApply { detail: "hunk #2 failed".into() },
            &[receipt("tests", Phase::Candidate, 0, "ok")],
        );
        assert!(!d.accepted);
        assert_eq!(d.verdict, "BLOCKED-ENV");
    }

    #[test]
    fn an_unreadable_verdict_never_reaches_accept() {
        let m = manifest(vec![ident("tests", true)]);
        for err in [
            VerdictParseError::Missing,
            VerdictParseError::Ambiguous(vec!["ACCEPT".into(), "REJECT".into()]),
            VerdictParseError::Noisy("ACCEPT because".into()),
            VerdictParseError::Unknown("MAYBE".into()),
        ] {
            let d = decide(&m, &Err(err.clone()), &applied(), &[receipt("tests", Phase::Candidate, 0, "ok")]);
            assert!(!d.accepted, "{err:?} must not accept");
            assert_eq!(d.verdict, "INCONCLUSIVE", "{err:?}");
        }
    }

    #[test]
    fn a_reject_verdict_passes_through_untouched() {
        let m = manifest(vec![ident("tests", true)]);
        let d = decide(&m, &Ok(Verdict::Reject), &CandidateState::NotAttempted, &[]);
        assert!(!d.accepted);
        assert_eq!(d.verdict, "REJECT");
        assert!(d.vetoes.is_empty(), "nothing to veto when nothing was claimed");
    }

    #[test]
    fn environment_vetoes_ignore_a_legitimately_failing_baseline() {
        let m = manifest(vec![ident("tests", true)]);
        // A baseline failure is the finding, not a fault.
        let v = environment_vetoes(&m, &[receipt("tests", Phase::Baseline, 1, "3 tests failed")]);
        assert!(v.is_empty(), "{v:?}");
        // A baseline evaluator that could not run is a fault.
        let mut blocked = receipt("tests", Phase::Baseline, 0, "");
        blocked.outcome = EvaluatorOutcome::Blocked { detail: "no such file".into() };
        assert_eq!(environment_vetoes(&m, &[blocked]).len(), 1);
        // As is one that never ran at all.
        assert_eq!(environment_vetoes(&m, &[]).len(), 1);
    }

    #[test]
    fn evaluators_scoped_to_another_deep_are_not_required_tonight() {
        let mut other = ident("hooks", true);
        other.deeps = vec!["hooks-pipeline".into()];
        let m = manifest(vec![ident("tests", true), other]);
        let d = decide(
            &m,
            &Ok(Verdict::Accept),
            &applied(),
            &[receipt("tests", Phase::Candidate, 0, "ok")],
        );
        assert!(d.accepted, "{}", d.summary);
    }
}
