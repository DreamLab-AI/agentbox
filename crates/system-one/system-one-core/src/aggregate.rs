//! Combining per-window answers into the single answer the caller asked for.
//!
//! When a state has been split by [`crate::window`], each question is answered
//! once per evaluated window and those answers have to become one. The three
//! primitives do not combine the same way, and the difference is not a matter of
//! taste:
//!
//! * **`noul`** takes the **maximum** across windows. A noul asks whether
//!   something is true of the state; a fact present in *any* window is present
//!   in the state, and averaging it with the windows that happen not to mention
//!   it would dilute a true answer towards false in proportion to how long the
//!   state is. Relevance weights are deliberately ignored here.
//! * **`choice`** takes the **relevance-weighted sum, renormalised**. Each
//!   window votes with its distribution, weighted by how relevant that window
//!   was to the question, and the result is a probability distribution again.
//! * **`score`** takes the **relevance-weighted mean**. A score is a position on
//!   a scale, so the windows' positions average; weighting keeps an irrelevant
//!   window from dragging the scale.
//!
//! * **absolute option scores** — what an engine that scores each option
//!   independently returns instead of a distribution — take the **maximum**
//!   per option, for the noul's reason rather than the choice's: they are not
//!   competing for a fixed mass, so there is nothing to renormalise, and an
//!   option that applies in any window applies to the state. See
//!   [`aggregate_absolute_scores`].
//!
//! These are the contract's defaults and the defaults the evaluator measures.
//!
//! # Relevance weights
//!
//! Relevance is normally a cosine similarity, which can be negative. Negative
//! weights are clamped to zero: a window that is *anti*-similar should not vote
//! against, it should simply not vote. If every weight ends up zero the
//! functions fall back to a uniform weighting rather than failing — having
//! evaluated the windows, refusing to answer because the ranker was flat would
//! discard real information.
//!
//! ```
//! use indexmap::IndexMap;
//! use system_one_core::aggregate::{aggregate_choice, aggregate_noul, WindowResult};
//!
//! let a: IndexMap<String, f64> = [("x".into(), 0.9), ("y".into(), 0.1)].into_iter().collect();
//! let b: IndexMap<String, f64> = [("x".into(), 0.2), ("y".into(), 0.8)].into_iter().collect();
//!
//! let merged = aggregate_choice(&[
//!     WindowResult::new(0.9, a),
//!     WindowResult::new(0.1, b),
//! ])
//! .unwrap();
//! assert!((merged.values().sum::<f64>() - 1.0).abs() < 1e-9);
//! assert!(merged["x"] > merged["y"]);
//!
//! // A fact seen in one window is a fact.
//! let seen = aggregate_noul(&[WindowResult::new(0.9, 0.05), WindowResult::new(0.1, 0.97)]).unwrap();
//! assert_eq!(seen, 0.97);
//! ```

use indexmap::IndexMap;

use crate::error::AggregateError;

/// Tolerance used when checking that a distribution sums to one.
///
/// Generous enough for the rounding a backend does when it serialises
/// probabilities to a few decimal places, tight enough that a genuinely
/// unnormalised distribution is caught.
pub const PROBABILITY_TOLERANCE: f64 = 1e-6;

/// One window's answer, with how relevant that window was to the question.
#[derive(Clone, Debug, PartialEq)]
pub struct WindowResult<T> {
    /// Relevance of the window to the question, normally a cosine similarity.
    /// Negative values are clamped to zero by the aggregation functions.
    pub relevance: f64,
    /// The answer the engine gave for this window.
    pub value: T,
}

impl<T> WindowResult<T> {
    /// Pair a relevance with a value.
    ///
    /// ```
    /// use system_one_core::aggregate::WindowResult;
    /// let r = WindowResult::new(0.42, 0.9);
    /// assert_eq!(r.relevance, 0.42);
    /// ```
    pub fn new(relevance: f64, value: T) -> Self {
        Self { relevance, value }
    }
}

/// Clamp relevances to non-negative weights, falling back to uniform if they
/// are all zero. Returns an error for a non-finite relevance.
fn weights<T>(windows: &[WindowResult<T>]) -> Result<Vec<f64>, AggregateError> {
    if windows.is_empty() {
        return Err(AggregateError::NoWindows);
    }
    let mut out = Vec::with_capacity(windows.len());
    for (index, window) in windows.iter().enumerate() {
        if !window.relevance.is_finite() {
            return Err(AggregateError::NonFinite {
                window: index,
                field: "relevance",
            });
        }
        out.push(window.relevance.max(0.0));
    }
    if out.iter().sum::<f64>() <= 0.0 {
        out.fill(1.0);
    }
    Ok(out)
}

/// Aggregate a `noul` across windows by taking the maximum probability.
///
/// Relevance is ignored by design — see the module documentation.
///
/// # Errors
///
/// [`AggregateError::NoWindows`] if there are none, or
/// [`AggregateError::NonFinite`] if a probability is NaN or infinite.
///
/// ```
/// use system_one_core::aggregate::{aggregate_noul, WindowResult};
///
/// let p = aggregate_noul(&[
///     WindowResult::new(1.0, 0.10),
///     WindowResult::new(0.1, 0.83),
///     WindowResult::new(0.5, 0.22),
/// ])
/// .unwrap();
/// assert_eq!(p, 0.83);
/// ```
pub fn aggregate_noul(windows: &[WindowResult<f64>]) -> Result<f64, AggregateError> {
    if windows.is_empty() {
        return Err(AggregateError::NoWindows);
    }
    let mut best = f64::NEG_INFINITY;
    for (index, window) in windows.iter().enumerate() {
        if !window.value.is_finite() {
            return Err(AggregateError::NonFinite {
                window: index,
                field: "noul",
            });
        }
        best = best.max(window.value);
    }
    Ok(best)
}

/// Aggregate **absolute** per-option scores across windows by taking each
/// option's maximum.
///
/// This is the counterpart of [`aggregate_choice`] for an engine that scores
/// each option independently, and it follows [`aggregate_noul`]'s reasoning
/// rather than [`aggregate_choice`]'s: an absolute score is a claim about
/// whether an option applies to the state, and an option that applies in *any*
/// window applies to the state. Averaging it across the windows that happen not
/// to mention it would dilute a true answer in proportion to how long the state
/// is — and unlike a distribution, these numbers are not competing for a fixed
/// mass, so there is nothing to renormalise.
///
/// Relevance is ignored, for the same reason it is ignored for a noul. The
/// result covers the union of the windows' keys in first-seen order.
///
/// # Errors
///
/// [`AggregateError::NoWindows`] or [`AggregateError::NonFinite`].
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_core::aggregate::{aggregate_absolute_scores, WindowResult};
///
/// let early: IndexMap<String, f64> =
///     [("x".into(), 0.10), ("y".into(), 0.40)].into_iter().collect();
/// let late: IndexMap<String, f64> = [("x".into(), 0.92)].into_iter().collect();
///
/// let merged = aggregate_absolute_scores(&[
///     WindowResult::new(0.9, early),
///     WindowResult::new(0.1, late),
/// ])
/// .unwrap();
/// assert_eq!(merged["x"], 0.92); // seen once is seen
/// assert_eq!(merged["y"], 0.40);
/// ```
pub fn aggregate_absolute_scores(
    windows: &[WindowResult<IndexMap<String, f64>>],
) -> Result<IndexMap<String, f64>, AggregateError> {
    if windows.is_empty() {
        return Err(AggregateError::NoWindows);
    }
    let mut merged: IndexMap<String, f64> = IndexMap::new();
    for (index, window) in windows.iter().enumerate() {
        for (option, score) in &window.value {
            if !score.is_finite() {
                return Err(AggregateError::NonFinite {
                    window: index,
                    field: "score",
                });
            }
            let slot = merged.entry(option.clone()).or_insert(f64::NEG_INFINITY);
            *slot = slot.max(*score);
        }
    }
    Ok(merged)
}

/// Aggregate a `choice` across windows: relevance-weighted sum of the
/// per-window distributions, renormalised to sum to one.
///
/// The result covers the union of every window's option keys, in first-seen
/// order, so a window that omitted an option contributes zero for it rather
/// than removing it.
///
/// # Errors
///
/// [`AggregateError::NoWindows`], [`AggregateError::NonFinite`] for a NaN or
/// infinite probability or relevance, or
/// [`AggregateError::DegenerateDistribution`] if the weighted mass is zero and
/// so no option can be selected.
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_core::aggregate::{aggregate_choice, WindowResult};
///
/// // The second window never mentions "z"; it is kept at its weighted mass.
/// let a: IndexMap<String, f64> =
///     [("x".into(), 0.5), ("z".into(), 0.5)].into_iter().collect();
/// let b: IndexMap<String, f64> = [("x".into(), 1.0)].into_iter().collect();
///
/// let merged = aggregate_choice(&[WindowResult::new(1.0, a), WindowResult::new(1.0, b)]).unwrap();
/// assert_eq!(merged.keys().collect::<Vec<_>>(), vec!["x", "z"]);
/// assert!((merged["x"] - 0.75).abs() < 1e-9);
/// ```
pub fn aggregate_choice(
    windows: &[WindowResult<IndexMap<String, f64>>],
) -> Result<IndexMap<String, f64>, AggregateError> {
    let weights = weights(windows)?;

    let mut totals: IndexMap<String, f64> = IndexMap::new();
    for (index, window) in windows.iter().enumerate() {
        let weight = weights[index];
        for (option, probability) in &window.value {
            if !probability.is_finite() {
                return Err(AggregateError::NonFinite {
                    window: index,
                    field: "probability",
                });
            }
            *totals.entry(option.clone()).or_insert(0.0) += weight * probability.max(0.0);
        }
    }

    if totals.is_empty() {
        return Err(AggregateError::DegenerateDistribution);
    }
    let mass: f64 = totals.values().sum();
    if mass <= 0.0 {
        return Err(AggregateError::DegenerateDistribution);
    }
    for value in totals.values_mut() {
        *value /= mass;
    }
    Ok(totals)
}

/// Aggregate a `score` across windows as the relevance-weighted mean.
///
/// # Errors
///
/// [`AggregateError::NoWindows`], or [`AggregateError::NonFinite`] for a NaN or
/// infinite score or relevance.
///
/// ```
/// use system_one_core::aggregate::{aggregate_score, WindowResult};
///
/// let s = aggregate_score(&[
///     WindowResult::new(3.0, 2.0),
///     WindowResult::new(1.0, 0.0),
/// ])
/// .unwrap();
/// assert!((s - 1.5).abs() < 1e-9); // (3*2 + 1*0) / 4
/// ```
pub fn aggregate_score(windows: &[WindowResult<f64>]) -> Result<f64, AggregateError> {
    let weights = weights(windows)?;

    let mut weighted = 0.0;
    for (index, window) in windows.iter().enumerate() {
        if !window.value.is_finite() {
            return Err(AggregateError::NonFinite {
                window: index,
                field: "score",
            });
        }
        weighted += weights[index] * window.value;
    }
    let mass: f64 = weights.iter().sum();
    Ok(weighted / mass)
}

/// Aggregate the band distributions that accompany a `score`, as a
/// relevance-weighted mean renormalised to sum to one.
///
/// Every window must report the same number of bands, because the bands are the
/// caller's and do not change between windows; a mismatch is a backend bug and
/// is reported rather than padded over.
///
/// # Errors
///
/// [`AggregateError::NoWindows`], [`AggregateError::NonFinite`] (also used when
/// a window's band count differs from the first window's), or
/// [`AggregateError::DegenerateDistribution`].
///
/// ```
/// use system_one_core::aggregate::{aggregate_score_distribution, WindowResult};
///
/// let d = aggregate_score_distribution(&[
///     WindowResult::new(1.0, vec![1.0, 0.0]),
///     WindowResult::new(1.0, vec![0.0, 1.0]),
/// ])
/// .unwrap();
/// assert_eq!(d, vec![0.5, 0.5]);
/// ```
pub fn aggregate_score_distribution(
    windows: &[WindowResult<Vec<f64>>],
) -> Result<Vec<f64>, AggregateError> {
    let weights = weights(windows)?;
    let bands = windows[0].value.len();
    if bands == 0 {
        return Err(AggregateError::DegenerateDistribution);
    }

    let mut totals = vec![0.0f64; bands];
    for (index, window) in windows.iter().enumerate() {
        if window.value.len() != bands {
            return Err(AggregateError::NonFinite {
                window: index,
                field: "distribution length",
            });
        }
        for (band, probability) in window.value.iter().enumerate() {
            if !probability.is_finite() {
                return Err(AggregateError::NonFinite {
                    window: index,
                    field: "distribution",
                });
            }
            totals[band] += weights[index] * probability.max(0.0);
        }
    }

    let mass: f64 = totals.iter().sum();
    if mass <= 0.0 {
        return Err(AggregateError::DegenerateDistribution);
    }
    for value in &mut totals {
        *value /= mass;
    }
    Ok(totals)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_scores_take_the_maximum_not_the_mean() {
        let early: IndexMap<String, f64> = [("x".to_string(), 0.1)].into_iter().collect();
        let late: IndexMap<String, f64> = [("x".to_string(), 0.9), ("y".to_string(), 0.3)]
            .into_iter()
            .collect();
        let merged = aggregate_absolute_scores(&[
            WindowResult::new(0.95, early),
            WindowResult::new(0.05, late),
        ])
        .unwrap();
        assert_eq!(
            merged["x"], 0.9,
            "an irrelevant window still carries a fact"
        );
        assert_eq!(merged["y"], 0.3);
        assert_eq!(merged.keys().collect::<Vec<_>>(), vec!["x", "y"]);
    }

    #[test]
    fn absolute_scores_reject_nonsense_rather_than_propagating_it() {
        assert_eq!(
            aggregate_absolute_scores(&[]).unwrap_err(),
            AggregateError::NoWindows
        );
        let bad: IndexMap<String, f64> = [("x".to_string(), f64::NAN)].into_iter().collect();
        assert!(matches!(
            aggregate_absolute_scores(&[WindowResult::new(1.0, bad)]).unwrap_err(),
            AggregateError::NonFinite {
                window: 0,
                field: "score"
            }
        ));
    }

    fn dist(pairs: &[(&str, f64)]) -> IndexMap<String, f64> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
    }

    #[test]
    fn choice_aggregation_always_sums_to_one() {
        let cases = vec![
            vec![
                WindowResult::new(0.9, dist(&[("a", 0.7), ("b", 0.3)])),
                WindowResult::new(0.2, dist(&[("a", 0.1), ("b", 0.9)])),
            ],
            vec![
                WindowResult::new(-0.5, dist(&[("a", 1.0), ("b", 0.0)])),
                WindowResult::new(0.4, dist(&[("a", 0.25), ("b", 0.75)])),
            ],
            vec![WindowResult::new(0.0, dist(&[("a", 0.5), ("b", 0.5)]))],
        ];
        for windows in cases {
            let merged = aggregate_choice(&windows).unwrap();
            let sum: f64 = merged.values().sum();
            assert!((sum - 1.0).abs() < PROBABILITY_TOLERANCE, "sum={sum}");
        }
    }

    #[test]
    fn a_negative_relevance_does_not_vote_against() {
        let merged = aggregate_choice(&[
            WindowResult::new(-1.0, dist(&[("a", 1.0), ("b", 0.0)])),
            WindowResult::new(1.0, dist(&[("a", 0.0), ("b", 1.0)])),
        ])
        .unwrap();
        assert_eq!(merged["b"], 1.0);
        assert_eq!(merged["a"], 0.0);
    }

    #[test]
    fn flat_relevance_falls_back_to_uniform() {
        let merged = aggregate_choice(&[
            WindowResult::new(0.0, dist(&[("a", 1.0), ("b", 0.0)])),
            WindowResult::new(0.0, dist(&[("a", 0.0), ("b", 1.0)])),
        ])
        .unwrap();
        assert!((merged["a"] - 0.5).abs() < PROBABILITY_TOLERANCE);
        assert_eq!(
            aggregate_score(&[WindowResult::new(0.0, 1.0), WindowResult::new(0.0, 3.0)]).unwrap(),
            2.0
        );
    }

    #[test]
    fn noul_takes_the_maximum_and_ignores_relevance() {
        let p = aggregate_noul(&[
            WindowResult::new(100.0, 0.01),
            WindowResult::new(0.000_1, 0.99),
        ])
        .unwrap();
        assert_eq!(p, 0.99);
    }

    #[test]
    fn empty_input_is_rejected_for_all_three() {
        assert_eq!(aggregate_noul(&[]).unwrap_err(), AggregateError::NoWindows);
        assert_eq!(aggregate_score(&[]).unwrap_err(), AggregateError::NoWindows);
        assert_eq!(
            aggregate_choice(&[]).unwrap_err(),
            AggregateError::NoWindows
        );
    }

    #[test]
    fn non_finite_numbers_are_rejected_not_propagated() {
        assert!(matches!(
            aggregate_noul(&[WindowResult::new(1.0, f64::NAN)]).unwrap_err(),
            AggregateError::NonFinite { window: 0, .. }
        ));
        assert!(matches!(
            aggregate_score(&[WindowResult::new(f64::INFINITY, 1.0)]).unwrap_err(),
            AggregateError::NonFinite {
                field: "relevance",
                ..
            }
        ));
        assert!(matches!(
            aggregate_choice(&[WindowResult::new(1.0, dist(&[("a", f64::NAN)]))]).unwrap_err(),
            AggregateError::NonFinite {
                field: "probability",
                ..
            }
        ));
    }

    #[test]
    fn a_zero_mass_distribution_is_degenerate_not_a_guess() {
        let err = aggregate_choice(&[WindowResult::new(1.0, dist(&[("a", 0.0), ("b", 0.0)]))])
            .unwrap_err();
        assert_eq!(err, AggregateError::DegenerateDistribution);
    }

    #[test]
    fn the_union_of_option_keys_is_kept_in_first_seen_order() {
        let merged = aggregate_choice(&[
            WindowResult::new(1.0, dist(&[("z", 0.5), ("a", 0.5)])),
            WindowResult::new(1.0, dist(&[("m", 1.0)])),
        ])
        .unwrap();
        assert_eq!(merged.keys().collect::<Vec<_>>(), vec!["z", "a", "m"]);
    }

    #[test]
    fn band_distributions_must_agree_on_the_band_count() {
        let err = aggregate_score_distribution(&[
            WindowResult::new(1.0, vec![0.5, 0.5]),
            WindowResult::new(1.0, vec![1.0]),
        ])
        .unwrap_err();
        assert!(matches!(
            err,
            AggregateError::NonFinite {
                field: "distribution length",
                ..
            }
        ));
    }
}
