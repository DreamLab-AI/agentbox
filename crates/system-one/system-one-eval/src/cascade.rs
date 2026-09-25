//! The escalation cascade: a judge-free ranker answers when it is sure, and the
//! judge is asked only when it is not.
//!
//! ADR-2095 left this as the one design its measurements made viable but did
//! not build: rank cheaply, escalate on the cases where the judge's advantage
//! is concentrated. This module measures it. Each case is answered locally by
//! the ranker's top option when the ranker's **margin** — the gap between its
//! best and second-best scores — reaches a cutoff `τ`, and by the judge's
//! recorded answer otherwise. Every escalation is a judge call, so the
//! escalation rate is simultaneously the fraction of turns that leave the
//! machine (for a cloud judge), the fraction that pay the judge's latency, and
//! the fraction that are billed.
//!
//! ## Reading the numbers honestly
//!
//! Two results are reported per ranker and they answer different questions.
//!
//! * **In-sample frontier.** Every breakpoint of `τ` is enumerated (the same
//!   exhaustive rule as [`crate::copy::Ranker::grid`]) and the cascade is scored
//!   on the very corpus the cutoff was read from. This is the shape of the
//!   trade-off and it is optimistic by construction.
//! * **Leave-one-out.** For each case, `τ` is chosen on the *other* cases —
//!   the fewest escalations whose accuracy there is no worse than the judge's
//!   own there, less `tolerance` — and then applied to the held-out case. The
//!   resulting accuracy and escalation rate are what a deployed cutoff would
//!   have done on turns it never saw, and the exact McNemar test compares that
//!   per-item against the judge alone.
//!
//! ## The margin signal
//!
//! The signal is fixed per ranker before anything is measured, so the choice
//! of signal is not itself a tuned parameter: BM25 uses the **relative** margin
//! `(s1 − s2) / s1`, because raw BM25 scores grow with prompt length and an
//! absolute gap on a long prompt means less than the same gap on a short one;
//! cosine and reciprocal-rank-fusion scores are bounded, so they use the
//! **absolute** gap `s1 − s2`.
//!
//! The local answer is never `none`: a ranker has no rubric for it. A turn that
//! should be declined is only answered correctly if its margin is low enough to
//! escalate, which is the behaviour a cascade in front of a judge should have.

use serde::{Deserialize, Serialize};

use crate::copy::Ranker;
use crate::metrics::Report;

/// The reciprocal-rank-fusion constant from Cormack, Clarke & Büttcher (2009).
pub const RRF_K: f64 = 60.0;

/// How a ranker's per-case confidence is read from its scores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Signal {
    /// `s1 − s2`, for bounded scores.
    AbsoluteMargin,
    /// `(s1 − s2) / |s1|`, for scores whose scale varies with the input.
    RelativeMargin,
}

impl Signal {
    /// The name printed in the report.
    pub fn describe(self) -> &'static str {
        match self {
            Signal::AbsoluteMargin => "absolute margin s1-s2",
            Signal::RelativeMargin => "relative margin (s1-s2)/s1",
        }
    }
}

/// The margin of one case's scores under `signal`.
///
/// Fewer than two options, or a zero best score under the relative signal,
/// yield `0.0`: no evidence of separation, so the case escalates at any
/// positive cutoff.
///
/// ```
/// # use system_one_eval::cascade::{margin, Signal};
/// assert!((margin(&[0.2, 0.9, 0.5], Signal::AbsoluteMargin) - 0.4).abs() < 1e-12);
/// assert!((margin(&[2.0, 8.0, 6.0], Signal::RelativeMargin) - 0.25).abs() < 1e-12);
/// assert_eq!(margin(&[0.0, 0.0], Signal::RelativeMargin), 0.0);
/// ```
pub fn margin(scores: &[f64], signal: Signal) -> f64 {
    let (mut s1, mut s2) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for &s in scores {
        if s > s1 {
            s2 = s1;
            s1 = s;
        } else if s > s2 {
            s2 = s;
        }
    }
    if !s2.is_finite() {
        return 0.0;
    }
    match signal {
        Signal::AbsoluteMargin => s1 - s2,
        Signal::RelativeMargin if s1.abs() > f64::EPSILON => (s1 - s2) / s1.abs(),
        Signal::RelativeMargin => 0.0,
    }
}

/// Fuse rankers by reciprocal rank: each option scores `Σ 1 / (k + rank)`,
/// rank counted from 1 in each input ranker, ties keeping candidate-map order.
///
/// Rank fusion rather than score fusion because BM25 and cosine live on
/// unrelated scales; ranks are the only thing the two share.
pub fn rrf(rankers: &[&Ranker], names: &[String], k: f64) -> Ranker {
    let cases = rankers.first().map_or(0, |r| r.scores.len());
    let scores: Vec<Vec<f64>> = (0..cases)
        .map(|case| {
            let mut fused = vec![0.0; names.len()];
            for ranker in rankers {
                let row = &ranker.scores[case];
                let mut order: Vec<usize> = (0..row.len()).collect();
                order.sort_by(|a, b| {
                    row[*b]
                        .partial_cmp(&row[*a])
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                for (rank, option) in order.into_iter().enumerate() {
                    fused[option] += 1.0 / (k + rank as f64 + 1.0);
                }
            }
            fused
        })
        .collect();
    let label = format!(
        "fused (RRF k={k}: {})",
        rankers
            .iter()
            .map(|r| r.label.as_str())
            .collect::<Vec<_>>()
            .join(" + ")
    );
    Ranker::from_scores(&label, scores, names)
}

/// The cascade's outcome at one cutoff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    /// Cases with margin below this escalate. `-inf`-like values escalate none.
    pub threshold: f64,
    /// Top-1 accuracy of the cascade over the cases considered.
    pub accuracy: f64,
    /// Cases sent to the judge.
    pub escalations: usize,
    /// Cases considered.
    pub n: usize,
}

impl Point {
    /// Escalations as a fraction of cases.
    pub fn escalation_rate(&self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            self.escalations as f64 / self.n as f64
        }
    }
}

/// Every cutoff that can change the cascade: below the smallest margin
/// (escalate nothing, the ranker alone), each midpoint, and above the largest
/// (escalate everything, the judge alone). Exhaustive for the same reason as
/// [`crate::copy::Ranker::grid`].
fn breakpoints(signal: &[f64]) -> Vec<f64> {
    let mut s: Vec<f64> = signal.iter().copied().filter(|x| x.is_finite()).collect();
    if s.is_empty() {
        return vec![0.0];
    }
    s.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
    s.dedup();
    let mut out = Vec::with_capacity(s.len() + 1);
    out.push(s[0] - 1.0);
    out.extend(s.windows(2).map(|p| f64::midpoint(p[0], p[1])));
    out.push(s[s.len() - 1] + 1.0);
    out
}

/// Score the cascade at `threshold` over the cases in `idx`.
fn score(local: &[bool], judge: &[bool], signal: &[f64], idx: &[usize], threshold: f64) -> Point {
    let (mut right, mut escalations) = (0usize, 0usize);
    for &i in idx {
        if signal[i] < threshold {
            escalations += 1;
            right += usize::from(judge[i]);
        } else {
            right += usize::from(local[i]);
        }
    }
    Point {
        threshold,
        accuracy: if idx.is_empty() {
            0.0
        } else {
            right as f64 / idx.len() as f64
        },
        escalations,
        n: idx.len(),
    }
}

/// The cutoff with the fewest escalations whose accuracy over `idx` is at least
/// the judge's own there, less `tolerance` (a fraction). Always exists: the
/// escalate-everything cutoff reproduces the judge exactly. Ties go to the
/// higher accuracy, then the lower cutoff.
fn select(local: &[bool], judge: &[bool], signal: &[f64], idx: &[usize], tolerance: f64) -> Point {
    let target =
        idx.iter().filter(|i| judge[**i]).count() as f64 / idx.len().max(1) as f64 - tolerance;
    let cut: Vec<f64> = idx.iter().map(|i| signal[*i]).collect();
    breakpoints(&cut)
        .into_iter()
        .map(|t| score(local, judge, signal, idx, t))
        .filter(|p| p.accuracy + 1e-12 >= target)
        .min_by(|a, b| {
            a.escalations.cmp(&b.escalations).then(
                b.accuracy
                    .partial_cmp(&a.accuracy)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
        })
        .expect("escalating every case always meets the judge's own accuracy")
}

/// Two-sided exact McNemar p-value over the discordant pairs `b` and `c`.
///
/// ```
/// # use system_one_eval::cascade::mcnemar_exact;
/// assert_eq!(mcnemar_exact(0, 0), 1.0);
/// assert!((mcnemar_exact(0, 5) - 0.0625).abs() < 1e-12);
/// ```
pub fn mcnemar_exact(b: usize, c: usize) -> f64 {
    let n = b + c;
    if n == 0 {
        return 1.0;
    }
    let k = b.min(c);
    let mut pmf = 0.5f64.powi(n as i32);
    let mut tail = pmf;
    for j in 0..k {
        pmf *= (n - j) as f64 / (j + 1) as f64;
        tail += pmf;
    }
    (2.0 * tail).min(1.0)
}

/// The held-out result for one ranker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeldOut {
    /// Cascade top-1 accuracy with every cutoff chosen without its own case.
    pub accuracy: f64,
    /// Cases escalated under their held-out cutoff.
    pub escalations: usize,
    /// Cases.
    pub n: usize,
    /// Judge right, cascade wrong.
    pub judge_only: usize,
    /// Cascade right, judge wrong.
    pub cascade_only: usize,
    /// Exact McNemar p against the judge alone.
    pub p_value: f64,
    /// `none`-labelled cases the cascade answered locally (and so got wrong).
    pub none_answered_locally: usize,
}

/// One ranker's cascade against one judge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    /// Ranker label.
    pub ranker: String,
    /// The margin signal in force.
    pub signal: Signal,
    /// The ranker alone: nothing escalates.
    pub ranker_alone: f64,
    /// The in-sample operating point chosen by the same rule as the held-out one.
    pub in_sample: Point,
    /// The in-sample Pareto frontier: best accuracy at each escalation count.
    pub frontier: Vec<Point>,
    /// The leave-one-out result.
    pub held_out: HeldOut,
}

/// The whole cascade report over one judge run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cascade {
    /// Judge backend label.
    pub judge_backend: String,
    /// Judge model.
    pub judge_model: String,
    /// Judge top-1 accuracy alone.
    pub judge_accuracy: f64,
    /// Judge mean latency, milliseconds.
    pub judge_mean_ms: f64,
    /// Judge cost per call, US dollars.
    pub judge_usd_per_route: f64,
    /// Accuracy the selection rule may give up, as a fraction.
    pub tolerance: f64,
    /// Cases.
    pub cases: usize,
    /// One row per ranker.
    pub rows: Vec<Row>,
}

/// Build the cascade report for each `(ranker, signal)` against `report`.
pub fn build(report: &Report, rankers: &[(&Ranker, Signal)], tolerance: f64) -> Cascade {
    let n = report.cases.len();
    let expected: Vec<&str> = report.cases.iter().map(|c| c.expected.as_str()).collect();
    let judge: Vec<bool> = report.cases.iter().map(|c| c.correct).collect();
    let all: Vec<usize> = (0..n).collect();

    let rows = rankers
        .iter()
        .map(|(ranker, signal)| {
            let local: Vec<bool> = ranker
                .picks
                .iter()
                .zip(&expected)
                .map(|(p, want)| p.top.first().is_some_and(|t| t == want))
                .collect();
            let sig: Vec<f64> = ranker.scores.iter().map(|s| margin(s, *signal)).collect();

            let mut frontier: Vec<Point> = Vec::new();
            for t in breakpoints(&sig) {
                let p = score(&local, &judge, &sig, &all, t);
                match frontier.iter_mut().find(|q| q.escalations == p.escalations) {
                    Some(q) if q.accuracy >= p.accuracy => {}
                    Some(q) => *q = p,
                    None => frontier.push(p),
                }
            }
            frontier.sort_by_key(|p| p.escalations);
            // Pareto: drop any point no more accurate than a cheaper one.
            let mut best = f64::NEG_INFINITY;
            frontier.retain(|p| {
                let keep = p.accuracy > best + 1e-12;
                best = best.max(p.accuracy);
                keep
            });

            let (mut right, mut escalations, mut judge_only, mut cascade_only, mut none_local) =
                (0, 0, 0, 0, 0);
            for i in 0..n {
                let rest: Vec<usize> = all.iter().copied().filter(|j| *j != i).collect();
                let t = select(&local, &judge, &sig, &rest, tolerance).threshold;
                let escalated = sig[i] < t;
                let ok = if escalated { judge[i] } else { local[i] };
                escalations += usize::from(escalated);
                right += usize::from(ok);
                judge_only += usize::from(judge[i] && !ok);
                cascade_only += usize::from(ok && !judge[i]);
                none_local += usize::from(!escalated && expected[i] == "none");
            }

            Row {
                ranker: ranker.label.clone(),
                signal: *signal,
                ranker_alone: local.iter().filter(|b| **b).count() as f64 / n.max(1) as f64,
                in_sample: select(&local, &judge, &sig, &all, tolerance),
                frontier,
                held_out: HeldOut {
                    accuracy: right as f64 / n.max(1) as f64,
                    escalations,
                    n,
                    judge_only,
                    cascade_only,
                    p_value: mcnemar_exact(judge_only, cascade_only),
                    none_answered_locally: none_local,
                },
            }
        })
        .collect();

    let answered: Vec<_> = report
        .cases
        .iter()
        .filter(|c| c.failure.is_none())
        .collect();
    Cascade {
        judge_backend: report.backend.clone(),
        judge_model: report.model.clone(),
        judge_accuracy: judge.iter().filter(|b| **b).count() as f64 / n.max(1) as f64,
        judge_mean_ms: answered.iter().map(|c| c.ms as f64).sum::<f64>()
            / answered.len().max(1) as f64,
        judge_usd_per_route: answered.iter().map(|c| c.usd).sum::<f64>()
            / answered.len().max(1) as f64,
        tolerance,
        cases: n,
        rows,
    }
}

/// Render the report as the text an operator reads.
pub fn render(c: &Cascade) -> String {
    let mut out = String::new();
    let bar = "=".repeat(86);
    out.push_str(&format!(
        "{bar}\nESCALATION CASCADE — a judge-free ranker answers when sure, the judge otherwise\n{bar}\n"
    ));
    out.push_str(&format!(
        "judge       {} / {}   top-1 {:.1}%   mean {:.0} ms   ${:.5}/call\n\
         cases       {}\n\
         rule        fewest escalations with accuracy >= judge's own{}\n\n",
        c.judge_backend,
        c.judge_model,
        c.judge_accuracy * 100.0,
        c.judge_mean_ms,
        c.judge_usd_per_route,
        c.cases,
        if c.tolerance > 0.0 {
            format!(" - {:.1} pts", c.tolerance * 100.0)
        } else {
            String::new()
        },
    ));
    for r in &c.rows {
        let h = &r.held_out;
        let rate = h.escalations as f64 / h.n.max(1) as f64;
        out.push_str(&format!("{}   [{}]\n", r.ranker, r.signal.describe()));
        out.push_str(&format!(
            "  ranker alone     top-1 {:>5.1}%   escalates   0.0%\n",
            r.ranker_alone * 100.0
        ));
        out.push_str(&format!(
            "  in-sample        top-1 {:>5.1}%   escalates {:>5.1}%   (cutoff {:.4}, OPTIMISTIC: read off this corpus)\n",
            r.in_sample.accuracy * 100.0,
            r.in_sample.escalation_rate() * 100.0,
            r.in_sample.threshold,
        ));
        out.push_str(&format!(
            "  LEAVE-ONE-OUT    top-1 {:>5.1}%   escalates {:>5.1}%   vs judge: -{} +{}  McNemar p={:.3}\n",
            h.accuracy * 100.0,
            rate * 100.0,
            h.judge_only,
            h.cascade_only,
            h.p_value,
        ));
        out.push_str(&format!(
            "                   → judge calls, egress and spend cut to {:.0}% · mean latency ≈ {:.0} ms · `none` answered locally {}\n",
            rate * 100.0,
            rate * c.judge_mean_ms,
            h.none_answered_locally,
        ));
        out.push_str("  frontier (escalated → top-1): ");
        let pts: Vec<String> = r
            .frontier
            .iter()
            .map(|p| {
                format!(
                    "{:.0}%→{:.1}",
                    p.escalation_rate() * 100.0,
                    p.accuracy * 100.0
                )
            })
            .collect();
        out.push_str(&pts.join("  "));
        out.push_str("\n\n");
    }
    out.push_str(
        "Latency is the judge's mean times the escalation rate; the local rankers cost \
         microseconds (BM25) or one embedding call (~tens of ms on the LAN) and are not added.\n",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::copy::Ranker;

    fn names() -> Vec<String> {
        ["a", "b", "c"].iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn breakpoints_span_both_extremes() {
        let b = breakpoints(&[0.1, 0.5, 0.5, 0.9]);
        assert_eq!(b.len(), 4);
        assert!(b[0] < 0.1 && b[3] > 0.9);
        assert!((b[1] - 0.3).abs() < 1e-12 && (b[2] - 0.7).abs() < 1e-12);
    }

    #[test]
    fn escalating_everything_reproduces_the_judge() {
        let local = [false, false, true];
        let judge = [true, true, false];
        let sig = [0.1, 0.2, 0.3];
        let p = score(&local, &judge, &sig, &[0, 1, 2], 1.0);
        assert_eq!(p.escalations, 3);
        assert!((p.accuracy - 2.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn selection_takes_the_fewest_escalations_meeting_the_judge() {
        // Confident cases are right locally; the unsure one needs the judge.
        let local = [true, true, false];
        let judge = [true, true, true];
        let sig = [0.9, 0.8, 0.1];
        let p = select(&local, &judge, &sig, &[0, 1, 2], 0.0);
        assert_eq!(p.escalations, 1);
        assert!((p.accuracy - 1.0).abs() < 1e-12);
    }

    #[test]
    fn rrf_rewards_agreement_between_rankers() {
        let a = Ranker::from_scores("a", vec![vec![3.0, 2.0, 1.0]], &names());
        let b = Ranker::from_scores("b", vec![vec![1.0, 3.0, 2.0]], &names());
        let fused = rrf(&[&a, &b], &names(), RRF_K);
        // a: ranks 1,2,3; b: ranks 3,1,2 → option b sums 1/62+1/61, the most.
        assert_eq!(fused.picks[0].top[0], "b");
        assert!(fused.label.starts_with("fused (RRF k=60: a + b"));
    }

    #[test]
    fn mcnemar_is_symmetric_and_bounded() {
        assert_eq!(mcnemar_exact(3, 7), mcnemar_exact(7, 3));
        assert!(mcnemar_exact(5, 5) <= 1.0);
        assert!((mcnemar_exact(1, 4) - 0.375).abs() < 1e-12);
    }
}
