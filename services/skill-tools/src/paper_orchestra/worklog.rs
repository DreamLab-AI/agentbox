//! Append-only refinement worklog (derived from `apply_worklog.py`).
//!
//! The worklog is the canonical history of the refinement loop. Entries are
//! only ever appended; `best_iter` is recomputed as the accepted iteration with
//! the highest overall score (the first one wins a tie).
//!
//! Deviation from upstream: a decision counts as *accepted* when it starts with
//! `ACCEPT` **or** is `HALT_TARGET_MET` / `HALT_PLATEAU`. `score-delta` emits the
//! latter two for iterations it has accepted, so under upstream's rule the best
//! and final draft could never be chosen.

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::json_util::truthy;
use super::scoring::overall_score_of;

/// One iteration entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    /// Iteration number.
    pub iter: i64,
    /// UTC ISO-8601 timestamp with microseconds.
    pub timestamp: String,
    /// Decision string.
    pub decision: String,
    /// Review document, or null.
    pub review: Value,
    /// Score document, or null.
    pub score: Value,
    /// Agent's worklog block, or null.
    pub actions: Value,
}

/// The worklog document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worklog {
    /// Entries in append order.
    #[serde(default)]
    pub iterations: Vec<Value>,
    /// Why the loop halted, if it did.
    #[serde(default)]
    pub halted_because: Option<String>,
    /// Best accepted iteration, if any.
    #[serde(default)]
    pub best_iter: Option<i64>,
    /// Any other top-level fields, preserved.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

impl Default for Worklog {
    fn default() -> Self {
        Self {
            iterations: Vec::new(),
            halted_because: None,
            best_iter: None,
            extra: serde_json::Map::new(),
        }
    }
}

/// True for decisions that keep the iteration's draft.
#[must_use]
pub fn is_accepted(decision: &str) -> bool {
    decision.starts_with("ACCEPT") || matches!(decision, "HALT_TARGET_MET" | "HALT_PLATEAU")
}

/// Appends an entry and recomputes `best_iter`.
///
/// # Errors
///
/// A message when an accepted entry carries a score without a numeric
/// `overall_score`; the worklog is left with the entry appended only on success.
pub fn append(wl: &mut Worklog, entry: Entry, halted_because: Option<&str>) -> Result<(), String> {
    let mut staged = wl.clone();
    append_unchecked(&mut staged, entry, halted_because)?;
    *wl = staged;
    Ok(())
}

fn append_unchecked(
    wl: &mut Worklog,
    entry: Entry,
    halted_because: Option<&str>,
) -> Result<(), String> {
    wl.iterations
        .push(serde_json::to_value(entry).expect("entry serialises"));
    if let Some(h) = halted_because {
        wl.halted_because = Some(h.to_string());
    }
    let mut best: Option<(f64, i64)> = None;
    for it in &wl.iterations {
        let accepted = it
            .get("decision")
            .and_then(Value::as_str)
            .is_some_and(is_accepted);
        let Some(score) = it.get("score").filter(|s| truthy(s)) else {
            continue;
        };
        if !accepted {
            continue;
        }
        let iter = it.get("iter").and_then(Value::as_i64).unwrap_or(-1);
        let overall = overall_score_of(score)
            .map_err(|e| format!("iteration {iter}: score has no usable overall_score: {e}"))?;
        // Strictly greater: the first maximal entry wins, as Python's max() does.
        if best.is_none_or(|(b, _)| overall > b) {
            best = Some((overall, iter));
        }
    }
    if let Some((_, i)) = best {
        wl.best_iter = Some(i);
    }
    Ok(())
}

/// Counts the trailing accepted iterations whose gain over the previous
/// accepted iteration is below `threshold`: the `HALT_PLATEAU` streak.
///
/// Reverted iterations are skipped (they never replace the accepted draft). The
/// first accepted iteration is a baseline with no gain, so it ends the count.
///
/// ```
/// use skill_tools::paper_orchestra::worklog::{small_gain_streak, Worklog};
/// let wl: Worklog = serde_json::from_value(serde_json::json!({"iterations": [
///     {"iter": 0, "decision": "ACCEPT_IMPROVED", "score": {"overall_score": 60.0}},
///     {"iter": 1, "decision": "ACCEPT_IMPROVED", "score": {"overall_score": 60.5}},
///     {"iter": 2, "decision": "REVERT_OVERALL_DECREASED", "score": {"overall_score": 40.0}},
///     {"iter": 3, "decision": "ACCEPT_TIED_NON_NEGATIVE", "score": {"overall_score": 60.5}}
/// ]})).unwrap();
/// assert_eq!(small_gain_streak(&wl, 1.0).unwrap(), 2);
/// ```
///
/// # Errors
///
/// A message when an accepted iteration lacks a numeric `score.overall_score`.
pub fn small_gain_streak(wl: &Worklog, threshold: f64) -> Result<i64, String> {
    let mut scores = Vec::new();
    for it in &wl.iterations {
        if !it
            .get("decision")
            .and_then(Value::as_str)
            .is_some_and(is_accepted)
        {
            continue;
        }
        let iter = it.get("iter").and_then(Value::as_i64).unwrap_or(-1);
        let score = it
            .get("score")
            .filter(|s| truthy(s))
            .ok_or_else(|| format!("accepted iteration {iter} has no score"))?;
        scores
            .push(overall_score_of(score).map_err(|e| {
                format!("iteration {iter}: score has no usable overall_score: {e}")
            })?);
    }
    Ok(scores
        .windows(2)
        .rev()
        .take_while(|w| w[1] - w[0] < threshold)
        .count()
        .try_into()
        .unwrap_or(i64::MAX))
}

/// Builds an entry stamped with the current UTC time.
#[must_use]
pub fn new_entry(iter: i64, decision: &str, review: Value, score: Value, actions: Value) -> Entry {
    Entry {
        iter,
        timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false),
        decision: decision.to_string(),
        review,
        score,
        actions,
    }
}

/// Reads an optional JSON file; an absent path or file gives `null`.
///
/// # Errors
///
/// A message when the file exists but is not valid JSON.
pub fn load_optional(path: Option<&std::path::Path>) -> Result<Value, String> {
    match path {
        Some(p) if p.exists() => {
            let t = std::fs::read_to_string(p)
                .map_err(|e| format!("cannot read {}: {e}", p.display()))?;
            serde_json::from_str(&t).map_err(|e| format!("invalid JSON in {}: {e}", p.display()))
        }
        _ => Ok(Value::Null),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn e(iter: i64, decision: &str, score: f64) -> Entry {
        new_entry(
            iter,
            decision,
            Value::Null,
            json!({"overall_score": score}),
            Value::Null,
        )
    }

    #[test]
    fn appends_and_tracks_best_with_first_tie_winning() {
        let mut wl = Worklog::default();
        append(&mut wl, e(0, "ACCEPT_IMPROVED", 60.0), None).unwrap();
        append(&mut wl, e(1, "REVERT_OVERALL_DECREASED", 90.0), None).unwrap();
        append(&mut wl, e(2, "ACCEPT_IMPROVED", 70.0), None).unwrap();
        append(&mut wl, e(3, "ACCEPT_TIED_NON_NEGATIVE", 70.0), None).unwrap();
        assert_eq!(wl.iterations.len(), 4);
        assert_eq!(wl.best_iter, Some(2));
    }

    #[test]
    fn halt_decisions_count_as_accepted() {
        let mut wl = Worklog::default();
        append(&mut wl, e(0, "ACCEPT_IMPROVED", 60.0), None).unwrap();
        append(&mut wl, e(1, "HALT_TARGET_MET", 81.0), Some("target met")).unwrap();
        assert_eq!(wl.best_iter, Some(1));
        assert_eq!(wl.halted_because.as_deref(), Some("target met"));
    }

    #[test]
    fn entry_without_score_is_never_best_and_existing_fields_survive() {
        let mut wl: Worklog = serde_json::from_value(json!({
            "iterations": [], "halted_because": null, "best_iter": null, "note": "keep"
        }))
        .unwrap();
        append(
            &mut wl,
            new_entry(0, "ACCEPT_IMPROVED", Value::Null, Value::Null, Value::Null),
            None,
        )
        .unwrap();
        assert_eq!(wl.best_iter, None);
        assert_eq!(wl.extra["note"], "keep");
    }

    #[test]
    fn an_accepted_score_without_overall_is_refused_and_nothing_is_appended() {
        let mut wl = Worklog::default();
        let bad = new_entry(
            0,
            "ACCEPT_IMPROVED",
            Value::Null,
            json!({"overall": 70}),
            Value::Null,
        );
        assert!(append(&mut wl, bad, None).is_err());
        assert!(wl.iterations.is_empty());
    }

    #[test]
    fn streak_counts_trailing_small_accepted_gains() {
        let mut wl = Worklog::default();
        for (i, d, s) in [
            (0, "ACCEPT_IMPROVED", 60.0),
            (1, "ACCEPT_IMPROVED", 65.0),
            (2, "ACCEPT_IMPROVED", 65.4),
            (3, "REVERT_OVERALL_DECREASED", 20.0),
            (4, "ACCEPT_TIED_NON_NEGATIVE", 65.4),
        ] {
            append(&mut wl, e(i, d, s), None).unwrap();
        }
        assert_eq!(small_gain_streak(&wl, 1.0).unwrap(), 2);
        assert_eq!(small_gain_streak(&wl, 0.1).unwrap(), 1);
        assert_eq!(small_gain_streak(&Worklog::default(), 1.0).unwrap(), 0);
    }

    #[test]
    fn timestamp_is_utc_microseconds() {
        let t = e(0, "X", 1.0).timestamp;
        assert!(t.ends_with("+00:00") && t.contains('.'), "{t}");
    }
}
