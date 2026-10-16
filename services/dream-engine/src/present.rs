//! How a night's evidence and decision are *worded* for the model, the ledger
//! and the draft pull request.
//!
//! The judging is `dream_gate`'s; these are the engine's presentation choices:
//! the receipt block shown to the model, the ledger finding for a vetoed
//! ACCEPT, and the draft-PR title.

use dream_gate::gate::GateDecision;
use dream_gate::receipts::EvaluatorReceipt;
use dream_gate::verdict::{clip_words, ledger_cell_ok};

/// Render a typed receipt as the prompt-facing text block: the verdict-relevant
/// facts first (outcome, exit code, duration), then the raw streams.
///
/// The model used to see stdout alone, which is precisely how a non-zero exit
/// became invisible to it.
pub fn render_receipt(r: &EvaluatorReceipt) -> String {
    let mut out = format!(
        "outcome={} exit={} duration={}ms required={}\n",
        r.outcome.label(),
        r.exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "-".into()),
        r.duration_ms,
        r.required
    );
    if !r.stdout.trim().is_empty() {
        out.push_str("--- stdout ---\n");
        out.push_str(&r.stdout);
        if !r.stdout.ends_with('\n') {
            out.push('\n');
        }
    }
    if !r.stderr.trim().is_empty() {
        out.push_str("--- stderr ---\n");
        out.push_str(&r.stderr);
        if !r.stderr.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

/// `name=outcome` for each receipt, for a journal `tool.completed` payload.
pub fn receipt_outcomes(receipts: &[EvaluatorReceipt]) -> Vec<String> {
    receipts
        .iter()
        .map(|r| format!("{}={}", r.name, r.outcome.label()))
        .collect()
}

/// The ledger finding for a night whose claimed ACCEPT the gate vetoed.
///
/// A contract-satisfying `base` keeps its text behind a single `VETOED: `
/// prefix (an existing prefix is not doubled), clipped on a word boundary to
/// fit the cell. A `base` that breaks the contract — typically the "Given …"
/// hypothesis or the "see report" fallback — is not dressed up with the prefix,
/// which would slip a hypothesis past the `^given` rule; the gate's own result
/// line is written instead.
pub fn vetoed_finding(base: &str, decision: &GateDecision) -> String {
    let mut core = base.trim();
    while let Some(rest) = core.strip_prefix("VETOED:") {
        core = rest.trim_start();
    }
    if ledger_cell_ok(core) {
        let prefixed = format!("VETOED: {}", clip_words(core, 80 - "VETOED: ".len()));
        if ledger_cell_ok(&prefixed) {
            return prefixed;
        }
    }
    gate_result_line(decision)
}

/// A contract-satisfying finding that states what the gate decided: its
/// summary clipped to the cell, or, when the summary itself breaks the
/// contract, the bare model-versus-gate verdicts.
pub fn gate_result_line(decision: &GateDecision) -> String {
    let line = clip_words(&decision.summary, 80);
    if ledger_cell_ok(&line) {
        return line;
    }
    let bare = if decision.vetoes.is_empty() {
        format!(
            "gate verdict {} (model claimed {})",
            decision.verdict, decision.model_verdict
        )
    } else {
        format!(
            "{} vetoed → {} by the required-check gate",
            decision.model_verdict, decision.verdict
        )
    };
    clip_words(&bare, 80)
}

/// Longest finding text in a PR title, in chars, ellipsis included.
const PR_TITLE_FINDING_MAX: usize = 60;

/// The draft-PR title for a gated ACCEPT: `dream(<deep>): <finding head>`.
///
/// The head comes from `cell`, the ledger finding, when it is a
/// contract-satisfying result (a whole statement of at most 80 chars);
/// otherwise from the first line of `full`, the uncapped finding, since a
/// failing cell is a capped hypothesis or a pointer. Either way it is the
/// start of the text, clipped on a word boundary with an ellipsis.
pub fn pr_title(deep: &str, cell: &str, full: &str) -> String {
    let source = if ledger_cell_ok(cell) {
        cell
    } else {
        full.lines().next().unwrap_or("")
    };
    format!(
        "dream({}): {}",
        deep,
        clip_words(source, PR_TITLE_FINDING_MAX)
    )
}

/// Last `max` bytes of a string, on a char boundary.
pub fn tail(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

#[cfg(test)]
mod tests {
    use super::*;
    use dream_gate::gate::{Veto, VetoClass};
    use dream_gate::outcome::ExecOutcome;
    use dream_gate::receipts::Phase;

    fn vetoed_decision(verdict: &str, reason: &str) -> GateDecision {
        GateDecision {
            accepted: false,
            verdict: verdict.into(),
            model_verdict: "ACCEPT".into(),
            vetoes: vec![Veto {
                class: VetoClass::Evidence,
                subject: "darwin-smoke".into(),
                reason: reason.into(),
            }],
            required_outcomes: vec![("darwin-smoke".into(), "failed".into())],
            summary: format!("ACCEPT vetoed → {verdict}: darwin-smoke: {reason}"),
        }
    }

    /// A "Given …" fallback must not be laundered through the prefix:
    /// `VETOED: Given …` passes `^given` but is still hypothesis text.
    #[test]
    fn vetoed_finding_replaces_a_hypothesis_with_the_gate_result() {
        let d = vetoed_decision("REJECT", "exit 1 on candidate tree");
        let base = "Given the Darwin evaluator at commit 7c30573a, when the cap is lifted, then…";
        let f = vetoed_finding(base, &d);
        assert!(ledger_cell_ok(&f), "{f}");
        assert!(!f.to_ascii_lowercase().contains("given"), "{f}");
        assert_eq!(
            f,
            "ACCEPT vetoed → REJECT: darwin-smoke: exit 1 on candidate tree"
        );
        // A pointer fallback is not a result either.
        let f = vetoed_finding("INCONCLUSIVE — see report", &d);
        assert_eq!(
            f,
            "ACCEPT vetoed → REJECT: darwin-smoke: exit 1 on candidate tree"
        );
    }

    #[test]
    fn vetoed_finding_prefixes_a_compliant_result_once() {
        let d = vetoed_decision("REJECT", "exit 1");
        assert_eq!(
            vetoed_finding("cap lifted to 8 candidates per generation", &d),
            "VETOED: cap lifted to 8 candidates per generation"
        );
        assert_eq!(
            vetoed_finding("VETOED: cap lifted to 8 candidates", &d),
            "VETOED: cap lifted to 8 candidates"
        );
        assert_eq!(
            vetoed_finding("VETOED: VETOED: cap lifted", &d),
            "VETOED: cap lifted"
        );
        // Long but compliant: clipped on a word boundary, still under the cap.
        let long =
            "cap lifted to eight candidates per generation and the smoke run finished in time";
        let f = vetoed_finding(long, &d);
        assert!(f.starts_with("VETOED: cap lifted"), "{f}");
        assert!(f.ends_with('…'), "{f}");
        assert!(ledger_cell_ok(&f), "{f}");
    }

    /// The gate summary can be long or carry a pointer; the fallback still
    /// states the gate's result and passes the contract.
    #[test]
    fn gate_result_line_is_always_compliant() {
        let d = vetoed_decision("BLOCKED-ENV", &"evaluator timed out after 600s ".repeat(5));
        let f = gate_result_line(&d);
        assert!(ledger_cell_ok(&f), "{f}");
        assert!(f.starts_with("ACCEPT vetoed → BLOCKED-ENV"), "{f}");
        let d = vetoed_decision("REJECT", "see report for the trace");
        let f = gate_result_line(&d);
        assert!(ledger_cell_ok(&f), "{f}");
        assert_eq!(f, "ACCEPT vetoed → REJECT by the required-check gate");
    }

    /// 2026-10-06: titles were `tail(&finding, 60)` of a finding already cut
    /// to 80 chars, so they lost both ends ("andidatesPerGeneration … out").
    #[test]
    fn pr_title_takes_the_head_of_the_full_finding_on_a_word_boundary() {
        let full =
            "Given the darwin evaluator caps candidatesPerGeneration at four, when the cap is \
                    lifted to eight, then the smoke run completes without timing out";
        let cell: String = full.chars().take(80).collect();
        let title = pr_title("evaluator", &cell, full);
        let tail_part = title.strip_prefix("dream(evaluator): ").expect(&title);
        assert!(tail_part.chars().count() <= 60, "{title}");
        assert!(tail_part.ends_with('…'), "{title}");
        assert_eq!(
            tail_part,
            "Given the darwin evaluator caps candidatesPerGeneration at…"
        );
        let head = tail_part.trim_end_matches('…');
        assert!(full.starts_with(head), "{title}");
        assert_eq!(
            full.as_bytes()[head.len()],
            b' ',
            "cut on a word boundary: {title}"
        );
    }

    /// A contract-satisfying result in the cell is the better title; a short
    /// one is used whole.
    #[test]
    fn pr_title_prefers_a_result_cell_and_keeps_short_findings_whole() {
        let full = "Given a long hypothesis that the cell replaced with tonight's result line";
        assert_eq!(
            pr_title(
                "cache",
                "warm cache halves p50 latency (412ms → 198ms)",
                full
            ),
            "dream(cache): warm cache halves p50 latency (412ms → 198ms)"
        );
        // Multi-line full findings title from their first line only.
        assert_eq!(
            pr_title("x", "Given a b", "Given a b\n\nGate: ACCEPT upheld"),
            "dream(x): Given a b"
        );
    }

    #[test]
    fn tail_respects_char_boundaries() {
        let s = "héllo wörld";
        let t = tail(s, 4);
        assert!(t.len() <= 5);
        assert!(s.ends_with(t));
    }

    #[test]
    fn receipts_render_the_outcome_before_the_streams() {
        let r = EvaluatorReceipt::from_exec(
            "tests",
            "cargo test",
            Phase::Baseline,
            true,
            60,
            ExecOutcome {
                exit_code: Some(101),
                stdout: "running 1 test".into(),
                stderr: "boom".into(),
                duration_ms: 12,
                transport_error: None,
                timed_out: false,
                started_at: "2026-10-01T01:00:00Z".into(),
            },
        );
        let text = render_receipt(&r);
        assert!(text.starts_with("outcome="), "{text}");
        assert!(text.contains("exit=101"));
        assert!(text.contains("--- stdout ---\nrunning 1 test\n"));
        assert!(text.contains("--- stderr ---\nboom\n"));
        assert_eq!(receipt_outcomes(&[r]).len(), 1);
    }
}
