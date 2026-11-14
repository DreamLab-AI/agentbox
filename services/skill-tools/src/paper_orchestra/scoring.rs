//! Refinement-loop arithmetic: decision bands, the accept/revert/halt rules and
//! score trajectories.
//!
//! Derived from `decision_band.py`, `score_delta.py` and `score_trajectory.py`.
//! The decision band is the *absolute* quality target; the delta rules are the
//! *relative* accept/revert logic.

use std::fmt::Write as _;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::json_util::{as_float, float_or_zero, Ordered};

/// The six reviewer axes, in rubric order.
pub const AXES: [&str; 6] = [
    "scientific_depth",
    "technical_execution",
    "logical_flow",
    "writing_clarity",
    "evidence_presentation",
    "academic_style",
];

/// Default lower bound of the Accept band.
pub const DEFAULT_ACCEPT_MIN: f64 = 80.0;
/// Default lower bound of the Minor Revision band.
pub const DEFAULT_MINOR_MIN: f64 = 65.0;
/// Default lower bound of the Major Revision band.
pub const DEFAULT_MAJOR_MIN: f64 = 50.0;

/// A decision band, worst to best.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Band {
    /// Below the major-revision bound.
    Reject,
    /// Major revision.
    Major,
    /// Minor revision.
    Minor,
    /// Accept.
    Accept,
}

impl Band {
    /// Display name (`Accept`, `Minor Revision`, `Major Revision`, `Reject`).
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Band::Accept => "Accept",
            Band::Minor => "Minor Revision",
            Band::Major => "Major Revision",
            Band::Reject => "Reject",
        }
    }

    /// Rank, 0 (Reject) to 3 (Accept).
    #[must_use]
    pub fn rank(self) -> u8 {
        self as u8
    }
}

/// Maps a 0–100 score to its band.
///
/// ```
/// use skill_tools::paper_orchestra::scoring::{band_for, Band};
/// assert_eq!(band_for(80.0, 80.0, 65.0, 50.0), Band::Accept);
/// assert_eq!(band_for(74.6, 80.0, 65.0, 50.0), Band::Minor);
/// assert_eq!(band_for(49.9, 80.0, 65.0, 50.0), Band::Reject);
/// ```
#[must_use]
pub fn band_for(score: f64, accept_min: f64, minor_min: f64, major_min: f64) -> Band {
    if score >= accept_min {
        Band::Accept
    } else if score >= minor_min {
        Band::Minor
    } else if score >= major_min {
        Band::Major
    } else {
        Band::Reject
    }
}

/// Thresholds echoed by [`BandOutput`].
#[derive(Debug, Serialize)]
pub struct Thresholds {
    /// Accept lower bound.
    pub accept_min: f64,
    /// Minor revision lower bound.
    pub minor_min: f64,
    /// Major revision lower bound.
    pub major_min: f64,
}

/// JSON emitted by `decision-band`.
#[derive(Debug, Serialize)]
pub struct BandOutput {
    /// The score.
    pub overall_score: f64,
    /// Band name.
    pub decision_band: &'static str,
    /// Band rank.
    pub band_rank: u8,
    /// Thresholds used.
    pub thresholds: Thresholds,
}

/// Computes the `decision-band` output. Thresholds must be strictly descending.
///
/// # Errors
///
/// A message when the thresholds are not `accept > minor > major`.
pub fn decision_band(
    score: f64,
    accept: f64,
    minor: f64,
    major: f64,
) -> Result<BandOutput, String> {
    if !(accept > minor && minor > major) {
        return Err("thresholds must satisfy accept-min > minor-min > major-min".into());
    }
    let band = band_for(score, accept, minor, major);
    Ok(BandOutput {
        overall_score: score,
        decision_band: band.name(),
        band_rank: band.rank(),
        thresholds: Thresholds {
            accept_min: accept,
            minor_min: minor,
            major_min: major,
        },
    })
}

/// Options for [`score_delta`].
#[derive(Debug, Clone, Copy)]
pub struct DeltaOpts {
    /// Smallest `overall_delta` that does not count as a small improvement.
    pub plateau_threshold: f64,
    /// Consecutive small improvements that trigger `HALT_PLATEAU`.
    pub plateau_streak: i64,
    /// Small improvements so far (maintained by the calling loop).
    pub consecutive_small: i64,
    /// Score at or above which the paper is in the Accept band.
    pub accept_threshold: f64,
    /// Report the band but never halt on reaching it.
    pub no_target_halt: bool,
}

impl Default for DeltaOpts {
    fn default() -> Self {
        Self {
            plateau_threshold: 1.0,
            plateau_streak: 3,
            consecutive_small: 0,
            accept_threshold: DEFAULT_ACCEPT_MIN,
            no_target_halt: false,
        }
    }
}

/// JSON emitted by `score-delta`.
#[derive(Debug, Serialize)]
pub struct DeltaOutput {
    /// `ACCEPT_IMPROVED`, `ACCEPT_TIED_NON_NEGATIVE`, `REVERT_*`, `HALT_PLATEAU` or `HALT_TARGET_MET`.
    pub decision: &'static str,
    /// Process exit code (0 accept, 1/2 revert, 4 plateau, 5 target met).
    pub exit_code: i32,
    /// Previous overall score.
    pub overall_prev: f64,
    /// Current overall score.
    pub overall_curr: f64,
    /// Current minus previous.
    pub overall_delta: f64,
    /// Band of the previous score.
    pub decision_band_prev: &'static str,
    /// Band of the current score.
    pub decision_band_curr: &'static str,
    /// Whether the band rose.
    pub band_improved: bool,
    /// Whether the target-met halt fired.
    pub target_met: bool,
    /// The accept threshold used.
    pub accept_threshold: f64,
    /// Per-axis deltas in rubric order.
    pub subaxis_deltas: Ordered<f64>,
    /// Sum of the axis deltas.
    pub net_subaxis: f64,
    /// Whether the overall delta is below the plateau threshold.
    pub is_small_delta: bool,
    /// Updated count of consecutive small deltas.
    pub consecutive_small: i64,
    /// The plateau threshold used.
    pub plateau_threshold: f64,
    /// The plateau streak used.
    pub plateau_streak: i64,
    /// Whether the plateau halt fired.
    pub plateau_triggered: bool,
}

fn axis_score(scores: &Value, axis: &str) -> Result<f64, String> {
    match scores.get("axis_scores").and_then(|a| a.get(axis)) {
        Some(entry) if entry.is_object() => float_or_zero(entry, "score"),
        _ => Ok(0.0),
    }
}

/// Applies the halt rules to two score documents.
///
/// # Errors
///
/// A message when a score is present but not numeric.
pub fn score_delta(prev: &Value, curr: &Value, opts: DeltaOpts) -> Result<DeltaOutput, String> {
    let p = float_or_zero(prev, "overall_score")?;
    let c = float_or_zero(curr, "overall_score")?;
    let delta = c - p;
    let mut deltas = Vec::with_capacity(AXES.len());
    for ax in AXES {
        deltas.push((
            ax.to_string(),
            axis_score(curr, ax)? - axis_score(prev, ax)?,
        ));
    }
    let net: f64 = deltas.iter().map(|d| d.1).sum();

    let (mut decision, mut exit_code) = if c > p {
        ("ACCEPT_IMPROVED", 0)
    } else if c == p {
        if net >= 0.0 {
            ("ACCEPT_TIED_NON_NEGATIVE", 0)
        } else {
            ("REVERT_TIED_NEGATIVE_SUBAXIS", 2)
        }
    } else {
        ("REVERT_OVERALL_DECREASED", 1)
    };

    let (minor, major) = (DEFAULT_MINOR_MIN, DEFAULT_MAJOR_MIN);
    let band_prev = band_for(p, opts.accept_threshold, minor, major);
    let band_curr = band_for(c, opts.accept_threshold, minor, major);

    let small = delta < opts.plateau_threshold;
    let streak = if small { opts.consecutive_small + 1 } else { 0 };
    let mut plateau = false;
    let mut target = false;
    if exit_code == 0 && !opts.no_target_halt && c >= opts.accept_threshold {
        decision = "HALT_TARGET_MET";
        exit_code = 5;
        target = true;
    } else if exit_code == 0 && streak >= opts.plateau_streak {
        decision = "HALT_PLATEAU";
        exit_code = 4;
        plateau = true;
    }
    Ok(DeltaOutput {
        decision,
        exit_code,
        overall_prev: p,
        overall_curr: c,
        overall_delta: delta,
        decision_band_prev: band_prev.name(),
        decision_band_curr: band_curr.name(),
        band_improved: band_curr > band_prev,
        target_met: target,
        accept_threshold: opts.accept_threshold,
        subaxis_deltas: Ordered(deltas),
        net_subaxis: net,
        is_small_delta: small,
        consecutive_small: streak,
        plateau_threshold: opts.plateau_threshold,
        plateau_streak: opts.plateau_streak,
        plateau_triggered: plateau,
    })
}

// ------------------------------------------------------------- trajectory

const COLUMN_WIDTH: usize = 22;

/// One history row of the trajectory report.
#[derive(Debug, Serialize)]
pub struct HistoryEntry {
    /// Iteration number.
    pub iter: u64,
    /// The scores document.
    pub scores: Value,
    /// Mean of the six dimensions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overall: Option<f64>,
    /// Per-dimension change from the previous iteration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deltas: Option<Ordered<f64>>,
    /// Change of the overall mean from the previous iteration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overall_delta: Option<f64>,
}

/// JSON report of `score-trajectory`.
#[derive(Debug, Serialize)]
pub struct TrajectoryReport {
    /// `ok`, `regression` or `plateau`.
    pub status: &'static str,
    /// Per-dimension change of the latest iteration.
    pub latest_deltas: Ordered<f64>,
    /// Every iteration.
    pub history: Vec<HistoryEntry>,
}

/// Printed output, exit code and report of [`analyse_trajectory`].
#[derive(Debug)]
pub struct TrajectoryOutcome {
    /// Text for stdout.
    pub text: String,
    /// 0 ok, 1 regression or plateau.
    pub exit: i32,
    /// The JSON report.
    pub report: TrajectoryReport,
}

/// Scores of each iteration, ordered by iteration number.
pub type IterScores = Vec<(u64, Value)>;

/// Loads `iterN/scores.json` from `dir`, ordered by `N`. Unreadable files are
/// returned as warnings.
///
/// # Errors
///
/// A message when `dir` is not a directory.
pub fn load_scores(dir: &Path) -> Result<(IterScores, Vec<String>), String> {
    if !dir.is_dir() {
        return Err(format!("scores-dir not found: {}", dir.display()));
    }
    let mut entries = Vec::new();
    let mut warnings = Vec::new();
    let rd = std::fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for item in rd.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        let Some(n) = name.strip_prefix("iter").and_then(|d| {
            (!d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))
                .then(|| d.parse::<u64>().ok())?
        }) else {
            continue;
        };
        let file = item.path().join("scores.json");
        if !item.path().is_dir() || !file.exists() {
            continue;
        }
        match std::fs::read_to_string(&file)
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string()))
        {
            Ok(v) => entries.push((n, v)),
            Err(e) => warnings.push(format!("Could not load {}: {e}", file.display())),
        }
    }
    entries.sort_by_key(|e| e.0);
    Ok((entries, warnings))
}

fn dim(scores: &Value, d: &str) -> f64 {
    scores.get(d).and_then(Value::as_f64).unwrap_or(0.0)
}

fn overall(scores: &Value) -> f64 {
    AXES.iter().map(|d| dim(scores, d)).sum::<f64>() / AXES.len() as f64
}

fn deltas(prev: &Value, curr: &Value) -> Ordered<f64> {
    Ordered(
        AXES.iter()
            .map(|d| ((*d).to_string(), dim(curr, d) - dim(prev, d)))
            .collect(),
    )
}

fn signed(delta: f64) -> String {
    format!("{}{delta:>9.1}", if delta > 0.0 { "+" } else { "" })
}

fn score_table(entries: &[(u64, Value)]) -> String {
    let labels: Vec<String> = entries.iter().map(|(n, _)| format!("iter{n}")).collect();
    let mut out = String::new();
    let mut header = format!("{:<COLUMN_WIDTH$}", "Dimension");
    for l in &labels {
        let _ = write!(header, "{l:>10}");
    }
    let rule = "-".repeat(header.chars().count());
    let _ = writeln!(out, "{header}\n{rule}");
    for d in AXES {
        let mut row = format!("{d:<COLUMN_WIDTH$}");
        for (_, s) in entries {
            match s.get(d).and_then(Value::as_f64) {
                Some(v) => {
                    let _ = write!(row, "{v:>10.1}");
                }
                None => {
                    let _ = write!(row, "{:>10}", "N/A");
                }
            }
        }
        let _ = writeln!(out, "{row}");
    }
    let _ = writeln!(out, "{rule}");
    let mut row = format!("{:<COLUMN_WIDTH$}", "OVERALL");
    for (_, s) in entries {
        let _ = write!(row, "{:>10.1}", overall(s));
    }
    let _ = writeln!(out, "{row}\n");
    if entries.len() > 1 {
        out.push_str("Per-dimension deltas (current vs previous iteration):\n");
        let mut dh = format!("{:<COLUMN_WIDTH$}", "Dimension");
        for l in &labels[1..] {
            let _ = write!(dh, "{:>10}", format!("Δ{l}"));
        }
        let dr = "-".repeat(dh.chars().count());
        let _ = writeln!(out, "{dh}\n{dr}");
        for d in AXES {
            let mut row = format!("{d:<COLUMN_WIDTH$}");
            for w in entries.windows(2) {
                row.push_str(&signed(dim(&w[1].1, d) - dim(&w[0].1, d)));
            }
            let _ = writeln!(out, "{row}");
        }
        let mut row = format!("{:<COLUMN_WIDTH$}", "OVERALL Δ");
        for w in entries.windows(2) {
            row.push_str(&signed(overall(&w[1].1) - overall(&w[0].1)));
        }
        let _ = writeln!(out, "{dr}\n{row}\n");
    }
    out
}

/// Analyses an ordered list of iteration scores; `None` when the list is empty.
///
/// Regression: any dimension of the latest iteration fell by more than
/// `regression_threshold` (a negative number). Plateau: the overall mean moved
/// by less than 1.0 over the last two or more consecutive iterations.
#[must_use]
pub fn analyse_trajectory(
    entries: &[(u64, Value)],
    regression_threshold: f64,
) -> Option<TrajectoryOutcome> {
    if entries.is_empty() {
        return None;
    }
    let mut text = String::new();
    if entries.len() == 1 {
        let _ = writeln!(
            text,
            "Only one iteration found (iter{}). No trajectory to analyse.",
            entries[0].0
        );
        text.push_str(&score_table(entries));
        return Some(TrajectoryOutcome {
            text,
            exit: 0,
            report: TrajectoryReport {
                status: "ok",
                latest_deltas: Ordered(vec![]),
                history: vec![HistoryEntry {
                    iter: entries[0].0,
                    scores: entries[0].1.clone(),
                    overall: None,
                    deltas: None,
                    overall_delta: None,
                }],
            },
        });
    }
    text.push_str(&score_table(entries));
    let last = entries.len() - 1;
    let (prev, curr) = (&entries[last - 1], &entries[last]);
    let latest = deltas(&prev.1, &curr.1);
    let latest_overall = overall(&curr.1) - overall(&prev.1);
    let regressed: Vec<&(String, f64)> = latest
        .0
        .iter()
        .filter(|d| d.1 < regression_threshold)
        .collect();

    let mut plateau_count = 0;
    for w in entries.windows(2) {
        if (overall(&w[1].1) - overall(&w[0].1)).abs() < 1.0 {
            plateau_count += 1;
        } else {
            plateau_count = 0;
        }
    }
    let plateau = plateau_count >= 2;

    let history = entries
        .iter()
        .enumerate()
        .map(|(i, (n, s))| HistoryEntry {
            iter: *n,
            scores: s.clone(),
            overall: Some(overall(s)),
            deltas: (i > 0).then(|| deltas(&entries[i - 1].1, s)),
            overall_delta: (i > 0).then(|| overall(s) - overall(&entries[i - 1].1)),
        })
        .collect();

    let mut status = "ok";
    let mut exit = 0;
    let mut messages = Vec::new();
    if !regressed.is_empty() {
        status = "regression";
        exit = 1;
        for (d, v) in &regressed {
            messages.push(format!(
                "REGRESSION: {d} dropped {v:.1} points in iter{} (threshold: {regression_threshold})",
                curr.0
            ));
        }
    }
    if plateau && status == "ok" {
        status = "plateau";
        exit = 1;
        messages.push(format!(
            "PLATEAU: overall score change < 1.0 for {plateau_count} consecutive iterations — \
             further refinement unlikely to yield gains"
        ));
    }
    if messages.is_empty() {
        let _ = writeln!(
            text,
            "[OK] No regression or plateau detected in latest iteration."
        );
        let _ = writeln!(
            text,
            "     Overall delta iter{} → iter{}: {latest_overall:+.1}",
            prev.0, curr.0
        );
    } else {
        for m in &messages {
            let _ = writeln!(text, "[{}] {m}", status.to_uppercase());
        }
        text.push('\n');
    }
    Some(TrajectoryOutcome {
        text,
        exit,
        report: TrajectoryReport {
            status,
            latest_deltas: latest,
            history,
        },
    })
}

/// Reads an `overall_score` from a score document.
///
/// # Errors
///
/// A message when the field is absent or not numeric.
pub fn overall_score_of(doc: &Value) -> Result<f64, String> {
    as_float(
        doc.get("overall_score")
            .ok_or("missing field overall_score")?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(overall: f64, axes: [f64; 6]) -> Value {
        let mut a = serde_json::Map::new();
        for (name, s) in AXES.iter().zip(axes) {
            a.insert((*name).to_string(), json!({"score": s}));
        }
        json!({"overall_score": overall, "axis_scores": a})
    }

    #[test]
    fn bands_follow_default_thresholds() {
        let b = |s| band_for(s, 80.0, 65.0, 50.0);
        assert_eq!(
            (b(80.0), b(79.9), b(65.0), b(64.9), b(50.0), b(49.9)),
            (
                Band::Accept,
                Band::Minor,
                Band::Minor,
                Band::Major,
                Band::Major,
                Band::Reject
            )
        );
        assert!(decision_band(70.0, 60.0, 65.0, 50.0).is_err());
        let o = decision_band(81.0, 80.0, 65.0, 50.0).unwrap();
        assert_eq!((o.decision_band, o.band_rank), ("Accept", 3));
    }

    #[test]
    fn accept_revert_rules() {
        let z = [60.0; 6];
        let better = score_delta(&doc(60.0, z), &doc(63.0, z), DeltaOpts::default()).unwrap();
        assert_eq!((better.decision, better.exit_code), ("ACCEPT_IMPROVED", 0));
        let worse = score_delta(&doc(63.0, z), &doc(60.0, z), DeltaOpts::default()).unwrap();
        assert_eq!(
            (worse.decision, worse.exit_code),
            ("REVERT_OVERALL_DECREASED", 1)
        );
        let mut lower = z;
        lower[0] = 55.0;
        let tied = score_delta(&doc(60.0, z), &doc(60.0, lower), DeltaOpts::default()).unwrap();
        assert_eq!(
            (tied.decision, tied.exit_code),
            ("REVERT_TIED_NEGATIVE_SUBAXIS", 2)
        );
        let tied_ok = score_delta(&doc(60.0, z), &doc(60.0, z), DeltaOpts::default()).unwrap();
        assert_eq!(tied_ok.exit_code, 0);
    }

    #[test]
    fn target_halt_beats_plateau_and_can_be_disabled() {
        let z = [80.0; 6];
        let o = DeltaOpts {
            consecutive_small: 5,
            ..DeltaOpts::default()
        };
        let r = score_delta(&doc(79.5, z), &doc(80.2, z), o).unwrap();
        assert_eq!(
            (r.decision, r.exit_code, r.target_met),
            ("HALT_TARGET_MET", 5, true)
        );
        let r = score_delta(
            &doc(79.5, z),
            &doc(80.2, z),
            DeltaOpts {
                no_target_halt: true,
                ..o
            },
        )
        .unwrap();
        assert_eq!(
            (r.decision, r.exit_code, r.plateau_triggered),
            ("HALT_PLATEAU", 4, true)
        );
        assert!(r.band_improved);
    }

    #[test]
    fn plateau_counts_streak_and_resets_on_a_big_gain() {
        let z = [50.0; 6];
        let o = DeltaOpts {
            consecutive_small: 2,
            ..DeltaOpts::default()
        };
        let r = score_delta(&doc(50.0, z), &doc(50.5, z), o).unwrap();
        assert_eq!((r.exit_code, r.consecutive_small), (4, 3));
        let r = score_delta(&doc(50.0, z), &doc(55.0, z), o).unwrap();
        assert_eq!((r.exit_code, r.consecutive_small), (0, 0));
    }

    #[test]
    fn delta_json_keeps_field_and_axis_order() {
        let z = [60.0; 6];
        let r = score_delta(&doc(60.0, z), &doc(61.0, z), DeltaOpts::default()).unwrap();
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.starts_with(r#"{"decision":"ACCEPT_IMPROVED","exit_code":0,"overall_prev":60.0"#));
        assert!(s.find("scientific_depth").unwrap() < s.find("academic_style").unwrap());
    }

    fn flat(v: f64) -> Value {
        let mut m = serde_json::Map::new();
        for d in AXES {
            m.insert(d.to_string(), json!(v));
        }
        Value::Object(m)
    }

    #[test]
    fn trajectory_flags_regression_and_plateau() {
        let ok = analyse_trajectory(&[(0, flat(50.0)), (1, flat(60.0))], -3.0).unwrap();
        assert_eq!((ok.report.status, ok.exit), ("ok", 0));
        assert!(ok.text.contains("Overall delta iter0 → iter1: +10.0"));
        let mut worse = flat(60.0);
        worse["logical_flow"] = json!(50.0);
        let reg = analyse_trajectory(&[(0, flat(60.0)), (1, worse)], -3.0).unwrap();
        assert_eq!((reg.report.status, reg.exit), ("regression", 1));
        assert!(reg.text.contains("logical_flow dropped -10.0"));
        let plat =
            analyse_trajectory(&[(0, flat(60.0)), (1, flat(60.3)), (2, flat(60.6))], -3.0).unwrap();
        assert_eq!((plat.report.status, plat.exit), ("plateau", 1));
        let one = analyse_trajectory(&[(0, flat(60.0))], -3.0).unwrap();
        assert!(analyse_trajectory(&[], -3.0).is_none());
        assert!(one.text.starts_with("Only one iteration found (iter0)"));
        assert!(one.report.history[0].overall.is_none());
    }

    #[test]
    fn load_scores_orders_numerically() {
        let d = tempfile::tempdir().unwrap();
        for n in [10, 2, 1] {
            let p = d.path().join(format!("iter{n}"));
            std::fs::create_dir(&p).unwrap();
            std::fs::write(p.join("scores.json"), flat(f64::from(n)).to_string()).unwrap();
        }
        std::fs::create_dir(d.path().join("iterx")).unwrap();
        let (e, w) = load_scores(d.path()).unwrap();
        assert_eq!(e.iter().map(|x| x.0).collect::<Vec<_>>(), [1, 2, 10]);
        assert!(w.is_empty());
        assert!(load_scores(&d.path().join("nope")).is_err());
    }
}
