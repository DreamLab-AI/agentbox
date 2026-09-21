//! Scoring and reporting.
//!
//! The headline number is accuracy, but it is never the whole story here, so
//! three things are always reported beside it: soft accuracy (the label is in
//! the top three, which is what the router's advisory line actually shows the
//! model), the per-subgroup breakdown, and the failures. A run that answered
//! 60 of 86 cases and scored 100% on those is not a 100% run, and this module
//! is built so that cannot be reported.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use system_one_core::wire::Sso;

use crate::client::{Outcome, Routed};
use crate::corpus::Case;

/// The question name the router uses, and the key the `sso` block is under.
const QUESTION: &str = "skill";

/// One case, scored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scored {
    /// Case index in the corpus.
    pub index: usize,
    /// The label.
    pub expected: String,
    /// The pick, when there was one.
    pub choice: Option<String>,
    /// Whether the pick equals the label.
    pub correct: bool,
    /// Whether the label is in the top three.
    pub soft_correct: bool,
    /// Probability of the pick.
    pub confidence: Option<f64>,
    /// Wall time.
    pub ms: u64,
    /// Engine-reported input tokens.
    pub input_tokens: u64,
    /// Cost of this call.
    pub usd: f64,
    /// Corpus class: `none` | `near-neighbour` | `boundary` | `single`.
    pub class: String,
    /// Whether the discriminative clause sits late in the expected rubric.
    pub late_discriminator: bool,
    /// Why the backend did not answer, when it did not.
    pub failure: Option<String>,
}

/// The option that means "no skill applies", shared with the router.
const NONE: &str = "none";

/// Score one outcome against its label.
pub fn score(
    index: usize,
    case: &Case,
    late_discriminator: bool,
    outcome: &Outcome,
    usd_per_mtok_in: f64,
) -> Scored {
    let base = Scored {
        index,
        expected: case.expected_skill.clone(),
        choice: None,
        correct: false,
        soft_correct: false,
        confidence: None,
        ms: 0,
        input_tokens: 0,
        usd: 0.0,
        class: case.class.clone(),
        late_discriminator,
        failure: None,
    };
    match outcome {
        Outcome::Failed { reason, ms } => Scored {
            ms: *ms,
            failure: Some(reason.clone()),
            ..base
        },
        Outcome::Routed(routed) => {
            let routed = routed.as_ref();
            let Routed {
                choice,
                confidence,
                ms,
                input_tokens,
                ..
            } = routed;
            Scored {
                choice: Some(choice.clone()),
                correct: *choice == case.expected_skill,
                soft_correct: routed.within(&case.expected_skill, 3),
                confidence: Some(*confidence),
                ms: *ms,
                input_tokens: *input_tokens,
                usd: routed.usd(usd_per_mtok_in),
                ..base
            }
        }
    }
}

/// Accuracy over one subgroup.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Subgroup {
    /// Cases in the subgroup.
    pub n: usize,
    /// Cases the backend answered.
    pub answered: usize,
    /// Top-1 hits.
    pub correct: usize,
    /// Top-3 hits.
    pub soft_correct: usize,
}

impl Subgroup {
    /// Top-1 accuracy over ALL cases in the subgroup, answered or not.
    pub fn accuracy(&self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            self.correct as f64 / self.n as f64
        }
    }

    /// Top-3 accuracy over ALL cases in the subgroup.
    pub fn soft_accuracy(&self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            self.soft_correct as f64 / self.n as f64
        }
    }
}

/// What the façade had to do to the request, averaged over answered cases.
///
/// Only the sovereign façade reports an `sso` block; against TypeSafe's Jev
/// this is `None`, which is itself the honest answer — a cloud backend that
/// takes 15,000 tokens whole did not adapt anything.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SsoSummary {
    /// Answered cases that carried an `sso` block.
    pub samples: usize,
    /// Mean options offered to the façade.
    pub mean_options_from: f64,
    /// Mean options actually judged after shortlisting.
    pub mean_options_to: f64,
    /// Mean windows the state was split into.
    pub mean_windows: f64,
    /// Mean compressed option, in estimated tokens.
    pub mean_option_tokens: f64,
    /// Largest compressed rubric seen, in estimated tokens.
    pub max_option_tokens: u64,
    /// Mean façade wall time, milliseconds.
    pub mean_facade_ms: f64,
    /// Mean engine wall time, milliseconds.
    pub mean_engine_ms: f64,
    /// Mean hypotheses scored per route, where the façade reported it.
    pub mean_hypotheses_scored: f64,
    /// The decline threshold in force, when one was applied.
    pub none_threshold: Option<f64>,
    /// Answered cases where the decline threshold decided the answer.
    pub declines: usize,
    /// Mean best-option absolute score, over cases with a decline record.
    pub mean_best_score: f64,
}

impl SsoSummary {
    /// Summarise the `sso` blocks of a run, or `None` if there were none.
    pub fn from_samples(samples: &[Sso]) -> Option<Self> {
        if samples.is_empty() {
            return None;
        }
        let n = samples.len() as f64;
        let mut summary = SsoSummary {
            samples: samples.len(),
            ..Default::default()
        };
        let mut scored_declines = 0.0f64;
        for block in samples {
            if let Some(shortlisted) = block.shortlisted.get(QUESTION) {
                summary.mean_options_from += shortlisted.from as f64;
                summary.mean_options_to += shortlisted.to as f64;
                if let Some(compressed) = shortlisted.compressed_option_tokens {
                    summary.max_option_tokens =
                        summary.max_option_tokens.max(compressed.max as u64);
                    summary.mean_option_tokens += compressed.mean;
                }
            }
            summary.mean_windows += block
                .windowed
                .get(QUESTION)
                .map_or(1.0, |w| w.windows as f64);
            summary.mean_facade_ms += block.facade_ms as f64;
            summary.mean_engine_ms += block.engine_ms as f64;
            summary.mean_hypotheses_scored += block.hypotheses_scored.unwrap_or(0) as f64;
            if let Some(decline) = block.decline.get(QUESTION) {
                summary.none_threshold = Some(decline.threshold);
                summary.declines += usize::from(decline.fired);
                summary.mean_best_score += decline.best_score.unwrap_or(0.0);
                scored_declines += 1.0;
            }
        }
        if scored_declines > 0.0 {
            summary.mean_best_score /= scored_declines;
        }
        summary.mean_option_tokens /= n;
        summary.mean_options_from /= n;
        summary.mean_options_to /= n;
        summary.mean_windows /= n;
        summary.mean_facade_ms /= n;
        summary.mean_engine_ms /= n;
        summary.mean_hypotheses_scored /= n;
        Some(summary)
    }
}

/// A whole run against one backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Report {
    /// Backend label.
    pub backend: String,
    /// Backend URL.
    pub url: String,
    /// Model the backend reported.
    pub model: String,
    /// Candidate options offered, `none` included.
    pub candidates: usize,
    /// Overall subgroup: every case.
    pub overall: Subgroup,
    /// Per corpus class.
    pub by_class: BTreeMap<String, Subgroup>,
    /// Late- versus early-discriminator cases.
    pub by_discriminator: BTreeMap<String, Subgroup>,
    /// How the backend used the `none` option, over every case.
    ///
    /// Accuracy on the `none` class alone hides the other half of the story: a
    /// backend can score well on `none` cases by declining everything. Recall
    /// and precision together are what the threshold sweep is choosing between.
    pub none: NoneBehaviour,
    /// Median latency, milliseconds.
    pub p50_ms: u64,
    /// 95th percentile latency, milliseconds.
    pub p95_ms: u64,
    /// Mean latency, milliseconds.
    pub mean_ms: u64,
    /// Mean engine-reported input tokens per answered case.
    pub mean_input_tokens: u64,
    /// Total cost of the run.
    pub total_usd: f64,
    /// Mean cost per answered route.
    pub usd_per_route: f64,
    /// Failure reasons and their counts.
    pub failures: BTreeMap<String, usize>,
    /// Labels in the corpus that no live skill provides.
    pub unscorable_labels: Vec<String>,
    /// What the façade had to adapt, when the backend reported it.
    pub sso: Option<SsoSummary>,
    /// Every scored case.
    pub cases: Vec<Scored>,
}

/// How often `none` was the right answer, and how often it was the given one.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NoneBehaviour {
    /// Cases whose label is `none`.
    pub expected: usize,
    /// Cases where the backend answered `none`.
    pub picked: usize,
    /// Cases where it answered `none` and that was right.
    pub correct: usize,
}

impl NoneBehaviour {
    /// Of the cases that should have declined, how many did.
    pub fn recall(&self) -> f64 {
        if self.expected == 0 {
            0.0
        } else {
            self.correct as f64 / self.expected as f64
        }
    }

    /// Of the cases that declined, how many should have.
    pub fn precision(&self) -> f64 {
        if self.picked == 0 {
            0.0
        } else {
            self.correct as f64 / self.picked as f64
        }
    }
}

fn percentile(sorted: &[u64], fraction: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let position = (fraction * (sorted.len() - 1) as f64).round() as usize;
    sorted[position.min(sorted.len() - 1)]
}

/// Aggregate scored cases into a report.
pub fn summarise(
    backend: &str,
    url: &str,
    model: &str,
    candidates: usize,
    unscorable_labels: Vec<String>,
    cases: Vec<Scored>,
    sso: Option<SsoSummary>,
) -> Report {
    let mut overall = Subgroup::default();
    let mut by_class: BTreeMap<String, Subgroup> = BTreeMap::new();
    let mut by_discriminator: BTreeMap<String, Subgroup> = BTreeMap::new();
    let mut failures: BTreeMap<String, usize> = BTreeMap::new();
    let mut latencies: Vec<u64> = Vec::new();
    let mut tokens = 0u64;
    let mut total_usd = 0.0;
    let mut none = NoneBehaviour::default();

    for case in &cases {
        let class = if case.class.is_empty() {
            "unclassified"
        } else {
            case.class.as_str()
        };
        let discriminator = if case.late_discriminator {
            "late"
        } else {
            "early"
        };
        for group in [
            &mut overall,
            by_class.entry(class.to_string()).or_default(),
            by_discriminator
                .entry(discriminator.to_string())
                .or_default(),
        ] {
            group.n += 1;
            if case.failure.is_none() {
                group.answered += 1;
            }
            group.correct += usize::from(case.correct);
            group.soft_correct += usize::from(case.soft_correct);
        }
        none.expected += usize::from(case.expected == NONE);
        if case.choice.as_deref() == Some(NONE) {
            none.picked += 1;
            none.correct += usize::from(case.correct);
        }
        match &case.failure {
            Some(reason) => *failures.entry(reason.clone()).or_insert(0) += 1,
            None => {
                latencies.push(case.ms);
                tokens += case.input_tokens;
                total_usd += case.usd;
            }
        }
    }

    latencies.sort_unstable();
    let answered = overall.answered.max(1) as u64;
    Report {
        backend: backend.to_string(),
        url: url.to_string(),
        model: model.to_string(),
        candidates,
        p50_ms: percentile(&latencies, 0.5),
        p95_ms: percentile(&latencies, 0.95),
        mean_ms: latencies.iter().sum::<u64>() / answered,
        mean_input_tokens: tokens / answered,
        total_usd,
        usd_per_route: total_usd / answered as f64,
        overall,
        by_class,
        by_discriminator,
        none,
        failures,
        unscorable_labels,
        sso,
        cases,
    }
}

/// One case where two backends disagreed.
#[derive(Debug, Clone, Serialize)]
pub struct Disagreement {
    /// Case index.
    pub index: usize,
    /// The label.
    pub expected: String,
    /// What backend A picked.
    pub a: Option<String>,
    /// What backend B picked.
    pub b: Option<String>,
    /// Whether the discriminative clause sits late in the expected rubric.
    pub late_discriminator: bool,
}

/// A backend-versus-backend comparison over one corpus.
#[derive(Debug, Clone, Serialize)]
pub struct Parity {
    /// Report for backend A.
    pub a: Report,
    /// Report for backend B.
    pub b: Report,
    /// Cases both backends answered.
    pub compared: usize,
    /// Cases where both picked the same option.
    pub agreed: usize,
    /// Cases where A was right and B was wrong.
    pub a_only_correct: usize,
    /// Cases where B was right and A was wrong.
    pub b_only_correct: usize,
    /// Every disagreement, for reading.
    pub disagreements: Vec<Disagreement>,
}

/// Compare two reports over the same corpus, case by case.
pub fn compare(a: Report, b: Report) -> Parity {
    let mut compared = 0usize;
    let mut agreed = 0usize;
    let mut a_only = 0usize;
    let mut b_only = 0usize;
    let mut disagreements = Vec::new();

    for (left, right) in a.cases.iter().zip(b.cases.iter()) {
        if left.failure.is_some() || right.failure.is_some() {
            continue;
        }
        compared += 1;
        if left.choice == right.choice {
            agreed += 1;
        } else {
            disagreements.push(Disagreement {
                index: left.index,
                expected: left.expected.clone(),
                a: left.choice.clone(),
                b: right.choice.clone(),
                late_discriminator: left.late_discriminator,
            });
        }
        match (left.correct, right.correct) {
            (true, false) => a_only += 1,
            (false, true) => b_only += 1,
            _ => {}
        }
    }

    Parity {
        a,
        b,
        compared,
        agreed,
        a_only_correct: a_only,
        b_only_correct: b_only,
        disagreements,
    }
}

/// Render a report as the text an operator reads in a terminal.
pub fn render(report: &Report) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "backend   {} ({})\nmodel     {}\ncandidates {} options + none\n\n",
        report.backend, report.url, report.model, report.candidates
    ));
    out.push_str(&format!(
        "accuracy       {:>6.1}%  ({}/{})\nsoft accuracy  {:>6.1}%  (label in top 3)\n\
         answered       {:>6}    of {}\n",
        report.overall.accuracy() * 100.0,
        report.overall.correct,
        report.overall.n,
        report.overall.soft_accuracy() * 100.0,
        report.overall.answered,
        report.overall.n,
    ));
    out.push_str(&format!(
        "latency        p50 {} ms · p95 {} ms · mean {} ms\n\
         tokens         {} input per route (engine-reported)\n\
         cost           ${:.5} total · ${:.5} per route\n\n",
        report.p50_ms,
        report.p95_ms,
        report.mean_ms,
        report.mean_input_tokens,
        report.total_usd,
        report.usd_per_route,
    ));

    if let Some(sso) = &report.sso {
        out.push_str(&format!(
            "adaptation     {:.0} options judged of {:.0} offered · {:.1} state windows · \
             rubrics compressed to {:.0} tokens mean (largest {})\n\
             timing split   facade {:.0} ms of which engine {:.0} ms\n\n",
            sso.mean_options_to,
            sso.mean_options_from,
            sso.mean_windows,
            sso.mean_option_tokens,
            sso.max_option_tokens,
            sso.mean_facade_ms,
            sso.mean_engine_ms,
        ));
        if let Some(threshold) = sso.none_threshold {
            out.push_str(&format!(
                "decline rule   threshold {threshold:.3} · fired on {} of {} answered · \
                 mean best score {:.3}\n",
                sso.declines, sso.samples, sso.mean_best_score,
            ));
        }
        if sso.mean_hypotheses_scored > 0.0 {
            out.push_str(&format!(
                "work done      {:.0} hypotheses scored per route\n",
                sso.mean_hypotheses_scored
            ));
        }
        out.push('\n');
    }

    out.push_str("by class\n");
    for (class, group) in &report.by_class {
        out.push_str(&format!(
            "  {class:<16} n={:<4} acc {:>5.1}%  soft {:>5.1}%\n",
            group.n,
            group.accuracy() * 100.0,
            group.soft_accuracy() * 100.0
        ));
    }
    out.push_str(&format!(
        "\nnone behaviour  expected {} · picked {} · right {} · recall {:.1}% · precision {:.1}%\n",
        report.none.expected,
        report.none.picked,
        report.none.correct,
        report.none.recall() * 100.0,
        report.none.precision() * 100.0,
    ));

    out.push_str(
        "\nby discriminator position (late = the boundary clause sits beyond the option budget,\n\
         i.e. the cases naive 48-token truncation destroys)\n",
    );
    for (position, group) in &report.by_discriminator {
        out.push_str(&format!(
            "  {position:<16} n={:<4} acc {:>5.1}%  soft {:>5.1}%\n",
            group.n,
            group.accuracy() * 100.0,
            group.soft_accuracy() * 100.0
        ));
    }
    if !report.failures.is_empty() {
        out.push_str("\nfailures\n");
        for (reason, count) in &report.failures {
            out.push_str(&format!("  {reason:<40} {count}\n"));
        }
    }
    if !report.unscorable_labels.is_empty() {
        out.push_str("\nlabels with no live skill (corpus bug, counted as wrong)\n");
        for label in &report.unscorable_labels {
            out.push_str(&format!("  {label}\n"));
        }
    }
    out
}

/// Render a parity comparison.
pub fn render_parity(parity: &Parity) -> String {
    let mut out = String::new();
    out.push_str(&render(&parity.a));
    out.push_str("\n───────────────────────────────────────────────────────────\n\n");
    out.push_str(&render(&parity.b));
    out.push_str("\n───────────────────────────────────────────────────────────\n\n");
    let rate = if parity.compared == 0 {
        0.0
    } else {
        parity.agreed as f64 / parity.compared as f64 * 100.0
    };
    out.push_str(&format!(
        "parity: {}/{} cases agree ({rate:.1}%)\n  {} only {} right · {} only {} right\n",
        parity.agreed,
        parity.compared,
        parity.a.backend,
        parity.a_only_correct,
        parity.b.backend,
        parity.b_only_correct,
    ));
    if !parity.disagreements.is_empty() {
        out.push_str("\ndisagreements\n");
        for d in &parity.disagreements {
            out.push_str(&format!(
                "  #{:<3} expected {:<22} {} {:<22} {} {}{}\n",
                d.index,
                d.expected,
                parity.a.backend,
                d.a.clone().unwrap_or_else(|| "-".into()),
                parity.b.backend,
                d.b.clone().unwrap_or_else(|| "-".into()),
                if d.late_discriminator { "  [late]" } else { "" },
            ));
        }
    }
    out
}

/// One point of a threshold sweep: the threshold, and the whole run at it.
#[derive(Debug, Clone, Serialize)]
pub struct SweepPoint {
    /// The `none_threshold` sent with every request in this run.
    pub none_threshold: f64,
    /// The full report, so nothing the sweep summarises is unverifiable.
    pub report: Report,
}

/// A decline-threshold sweep over one corpus and one backend.
///
/// The measured failure this exists for: when the shared-head engine's options
/// went from 4 to 8, `none` accuracy collapsed from 35.7% to 7.1% — declining
/// was competing with the candidates for one probability mass. An engine that
/// scores options independently should not have that trade-off, and the way to
/// find out is to move the bar and watch, rather than to pick a number.
#[derive(Debug, Clone, Serialize)]
pub struct Sweep {
    /// Backend label.
    pub backend: String,
    /// Backend URL.
    pub url: String,
    /// The model that answered.
    pub model: String,
    /// One report per threshold, in ascending threshold order.
    pub points: Vec<SweepPoint>,
}

impl Sweep {
    /// The threshold with the best top-1 accuracy, ties going to the lower bar.
    ///
    /// Reported, never applied: choosing the deployment's threshold is an
    /// operator's decision, and a rig that silently picked one would be
    /// measuring and deciding at once.
    pub fn best(&self) -> Option<&SweepPoint> {
        self.points.iter().fold(None, |best, point| match best {
            Some(b) if b.report.overall.accuracy() >= point.report.overall.accuracy() => Some(b),
            _ => Some(point),
        })
    }
}

/// Render a sweep as the table an operator reads.
pub fn render_sweep(sweep: &Sweep) -> String {
    let mut out = format!(
        "threshold sweep  {} ({})\nmodel            {}\ncases            {}\n\n",
        sweep.backend,
        sweep.url,
        sweep.model,
        sweep.points.first().map_or(0, |p| p.report.overall.n),
    );
    out.push_str(
        "  thresh    acc    soft | none: n picked  right  recall    prec | late acc near acc | p50 ms\n",
    );
    for point in &sweep.points {
        let r = &point.report;
        let late = r.by_discriminator.get("late").cloned().unwrap_or_default();
        let near = r
            .by_class
            .get("near-neighbour")
            .cloned()
            .unwrap_or_default();
        out.push_str(&format!(
            "  {:>6.3} {:>6.1}% {:>6.1}% | {:>7} {:>6} {:>6} {:>7.1}% {:>7.1}% | {:>7.1}% {:>7.1}% | {:>6}\n",
            point.none_threshold,
            r.overall.accuracy() * 100.0,
            r.overall.soft_accuracy() * 100.0,
            r.none.expected,
            r.none.picked,
            r.none.correct,
            r.none.recall() * 100.0,
            r.none.precision() * 100.0,
            late.accuracy() * 100.0,
            near.accuracy() * 100.0,
            r.p50_ms,
        ));
    }
    if let Some(best) = sweep.best() {
        out.push_str(&format!(
            "\nbest top-1 accuracy at threshold {:.3}: {:.1}% (soft {:.1}%, none recall {:.1}%)\n\
             this is a measurement, not a recommendation — the operator sets the deployed \
             value.\n",
            best.none_threshold,
            best.report.overall.accuracy() * 100.0,
            best.report.overall.soft_accuracy() * 100.0,
            best.report.none.recall() * 100.0,
        ));
    }
    if sweep.points.iter().all(|p| {
        p.report
            .sso
            .as_ref()
            .and_then(|s| s.none_threshold)
            .is_none()
    }) {
        out.push_str(
            "\nNOTE: no run reported a decline rule. The backend's engine does not score options \
             independently, so the threshold was accepted and ignored — the numbers above are \
             one run repeated, not a sweep.\n",
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scored(
        index: usize,
        correct: bool,
        soft: bool,
        late: bool,
        failure: Option<&str>,
    ) -> Scored {
        Scored {
            index,
            expected: "target".into(),
            choice: failure.is_none().then(|| {
                if correct {
                    "target".into()
                } else {
                    "other".into()
                }
            }),
            correct,
            soft_correct: soft,
            confidence: Some(0.9),
            ms: 100 + index as u64,
            input_tokens: 1000,
            usd: 0.000042,
            class: if late {
                "boundary".into()
            } else {
                "single".into()
            },
            late_discriminator: late,
            failure: failure.map(String::from),
        }
    }

    #[test]
    fn a_failure_counts_against_accuracy_rather_than_vanishing() {
        let report = summarise(
            "sso",
            "http://x",
            "laya",
            115,
            vec![],
            vec![
                scored(0, true, true, false, None),
                scored(1, false, false, false, Some("engine_unavailable")),
            ],
            None,
        );
        assert_eq!(report.overall.n, 2);
        assert_eq!(report.overall.answered, 1);
        assert!(
            (report.overall.accuracy() - 0.5).abs() < 1e-9,
            "failures are not excluded"
        );
        assert_eq!(report.failures["engine_unavailable"], 1);
    }

    #[test]
    fn subgroups_split_late_from_early_discriminators() {
        let report = summarise(
            "sso",
            "http://x",
            "laya",
            115,
            vec![],
            vec![
                scored(0, true, true, true, None),
                scored(1, false, true, true, None),
                scored(2, true, true, false, None),
            ],
            None,
        );
        assert_eq!(report.by_discriminator["late"].n, 2);
        assert!((report.by_discriminator["late"].accuracy() - 0.5).abs() < 1e-9);
        assert!((report.by_discriminator["early"].accuracy() - 1.0).abs() < 1e-9);
        assert!((report.by_discriminator["late"].soft_accuracy() - 1.0).abs() < 1e-9);
        assert_eq!(report.by_class["boundary"].n, 2);
    }

    #[test]
    fn percentiles_are_taken_over_answered_cases_only() {
        let cases: Vec<Scored> = (0..20)
            .map(|i| scored(i, true, true, false, None))
            .collect();
        let report = summarise("sso", "u", "m", 1, vec![], cases, None);
        assert_eq!(report.p50_ms, 110);
        assert_eq!(report.p95_ms, 118, "nearest-rank over 20 samples");
        assert!(report.total_usd > 0.0);
    }

    #[test]
    fn parity_counts_agreement_and_lists_disagreements() {
        let a = summarise(
            "jev",
            "u",
            "m",
            1,
            vec![],
            vec![
                scored(0, true, true, false, None),
                scored(1, true, true, true, None),
            ],
            None,
        );
        let b = summarise(
            "sso",
            "u",
            "m",
            1,
            vec![],
            vec![
                scored(0, true, true, false, None),
                scored(1, false, true, true, None),
            ],
            None,
        );
        let parity = compare(a, b);
        assert_eq!(parity.compared, 2);
        assert_eq!(parity.agreed, 1);
        assert_eq!(parity.a_only_correct, 1);
        assert_eq!(parity.b_only_correct, 0);
        assert_eq!(parity.disagreements.len(), 1);
        assert!(parity.disagreements[0].late_discriminator);
    }
}
