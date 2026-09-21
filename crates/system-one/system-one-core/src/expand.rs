//! Re-expanding a shortlisted answer over the caller's original options.
//!
//! # The hard rule
//!
//! A façade may show the engine eight of a caller's 115 options. The caller must
//! never find out by being handed a narrower world. So:
//!
//! * `choice` is **always** one of the caller's original keys;
//! * `probabilities` covers **every** original key, in the caller's original
//!   order, with shortlisted-away options at exactly `0.0`;
//! * no key the caller did not send ever appears.
//!
//! The estate's skill router ranks `Object.entries(probabilities)` directly, so
//! an omitted key is not a cosmetic difference — it silently removes a candidate
//! from the advisory line. [`expand_choice`] is the one place that rule is
//! implemented, and [`crate::validate::validate_response`] is the one place it
//! is checked.
//!
//! ```
//! use indexmap::IndexMap;
//! use system_one_core::expand::expand_choice;
//!
//! let original = ["alpha", "bravo", "charlie", "none"];
//! let shortlisted: IndexMap<String, f64> =
//!     [("charlie".into(), 0.8), ("none".into(), 0.2)].into_iter().collect();
//!
//! let answer = expand_choice(&original, &shortlisted).unwrap();
//! let (choice, probabilities) = answer.as_choice().unwrap();
//!
//! assert_eq!(choice, "charlie");
//! assert_eq!(probabilities.keys().collect::<Vec<_>>(), vec!["alpha", "bravo", "charlie", "none"]);
//! assert_eq!(probabilities["alpha"], 0.0); // dropped, not missing
//! ```

use indexmap::IndexMap;

use crate::error::ExpandError;
use crate::wire::Answer;

/// Expand a shortlisted distribution back over `original`, producing the
/// [`Answer::Choice`] the caller is owed.
///
/// The distribution is renormalised so the result sums to one even if the
/// backend's own numbers did not quite, and `confidence` is the chosen option's
/// probability after that renormalisation. The winner is the highest
/// probability, ties broken by the caller's original order — deterministic, and
/// biased towards the option the caller listed first, which is the only
/// tie-break the caller can predict.
///
/// # Errors
///
/// * [`ExpandError::NoOriginalOptions`] — `original` is empty.
/// * [`ExpandError::DuplicateOriginalOption`] — `original` repeats a key, so
///   the mapping back would be ambiguous.
/// * [`ExpandError::EmptyDistribution`] — nothing to expand.
/// * [`ExpandError::InventedOption`] — the backend returned a key that was
///   never on the caller's menu.
/// * [`ExpandError::NonFinite`] — a probability is NaN or infinite.
/// * [`ExpandError::DegenerateDistribution`] — every probability was zero, so
///   no original option can honestly be selected.
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_core::{expand::expand_choice, ExpandError};
///
/// let invented: IndexMap<String, f64> = [("delta".into(), 1.0)].into_iter().collect();
/// let err = expand_choice(&["alpha", "bravo"], &invented).unwrap_err();
/// assert_eq!(err, ExpandError::InventedOption { option: "delta".into() });
/// ```
pub fn expand_choice<S: AsRef<str>>(
    original: &[S],
    shortlisted: &IndexMap<String, f64>,
) -> Result<Answer, ExpandError> {
    if original.is_empty() {
        return Err(ExpandError::NoOriginalOptions);
    }
    if shortlisted.is_empty() {
        return Err(ExpandError::EmptyDistribution);
    }

    let mut probabilities: IndexMap<String, f64> = IndexMap::with_capacity(original.len());
    for key in original {
        let key = key.as_ref();
        if probabilities.contains_key(key) {
            return Err(ExpandError::DuplicateOriginalOption {
                option: key.to_owned(),
            });
        }
        probabilities.insert(key.to_owned(), 0.0);
    }

    let mut mass = 0.0f64;
    for (option, probability) in shortlisted {
        let Some(slot) = probabilities.get_mut(option) else {
            return Err(ExpandError::InventedOption {
                option: option.clone(),
            });
        };
        if !probability.is_finite() {
            return Err(ExpandError::NonFinite {
                option: option.clone(),
            });
        }
        let clamped = probability.max(0.0);
        *slot = clamped;
        mass += clamped;
    }

    if mass <= 0.0 {
        // Every shortlisted option came back at zero. There is no honest winner,
        // and inventing one is exactly what this module exists to prevent.
        return Err(ExpandError::DegenerateDistribution);
    }
    for value in probabilities.values_mut() {
        *value /= mass;
    }

    let (choice, confidence) = probabilities
        .iter()
        .fold(
            None::<(&str, f64)>,
            |best, (option, probability)| match best {
                Some((_, top)) if top >= *probability => best,
                _ => Some((option.as_str(), *probability)),
            },
        )
        .map(|(option, probability)| (option.to_owned(), probability))
        .ok_or(ExpandError::NoOriginalOptions)?;

    Ok(Answer::Choice {
        choice,
        confidence,
        probabilities,
        action: None,
    })
}

/// The result of expanding a choice under a decline threshold.
#[derive(Clone, Debug, PartialEq)]
pub struct DeclineOutcome {
    /// The answer, honest over every original option as usual.
    pub answer: Answer,
    /// Whether the decline option won.
    pub fired: bool,
    /// The best *real* option's absolute score, decline excluded.
    pub best_score: f64,
}

/// Expand a choice whose options were scored **independently**, letting a
/// threshold decide when nothing applies.
///
/// # Why this is a different function
///
/// [`expand_choice`] takes a probability distribution: the options have already
/// competed for a fixed mass, so their numbers are relative and a threshold on
/// them would mean a different thing for every request — with 115 rivals the
/// winner's share is small however obviously right it is. An engine that scores
/// each option independently produces *absolute* scores, and then the question
/// "does anything actually apply?" has an answer that does not depend on how
/// many rivals there were.
///
/// The construction is deliberately the simplest one that stays consistent:
/// the decline option enters the field with a **fixed score equal to the
/// threshold**, and the ordinary argmax runs. Nothing clears the bar, and
/// declining wins; something does, and it beats the bar on its own merits. The
/// answer's `probabilities` therefore still agree with its `choice`, which a
/// post-hoc override of the winner would break.
///
/// `scores` are absolute, non-negative option scores keyed by the caller's
/// option keys; any score the engine gave the decline key itself is replaced by
/// the threshold. If every score is zero and the threshold is zero, the decline
/// option takes the whole mass: nothing was entailed, which is precisely a
/// decline.
///
/// # Errors
///
/// Everything [`expand_choice`] returns, plus
/// [`ExpandError::DeclineNotOffered`] when `decline_key` is not among
/// `original`, and [`ExpandError::NonFinite`] for a non-finite threshold.
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_core::expand::expand_choice_with_decline;
///
/// let original = ["alpha", "bravo", "none"];
/// let weak: IndexMap<String, f64> =
///     [("alpha".into(), 0.31), ("bravo".into(), 0.12)].into_iter().collect();
///
/// // Nothing clears 0.5, so the judge declines.
/// let out = expand_choice_with_decline(&original, &weak, "none", 0.5).unwrap();
/// assert!(out.fired);
/// assert_eq!(out.answer.as_choice().unwrap().0, "none");
///
/// // Lower the bar and the same scores route.
/// let out = expand_choice_with_decline(&original, &weak, "none", 0.25).unwrap();
/// assert!(!out.fired);
/// assert_eq!(out.answer.as_choice().unwrap().0, "alpha");
/// ```
pub fn expand_choice_with_decline<S: AsRef<str>>(
    original: &[S],
    scores: &IndexMap<String, f64>,
    decline_key: &str,
    threshold: f64,
) -> Result<DeclineOutcome, ExpandError> {
    if !original.iter().any(|k| k.as_ref() == decline_key) {
        return Err(ExpandError::DeclineNotOffered {
            option: decline_key.to_owned(),
        });
    }
    if !threshold.is_finite() {
        return Err(ExpandError::NonFinite {
            option: decline_key.to_owned(),
        });
    }

    let mut best_score = 0.0f64;
    let mut field: IndexMap<String, f64> = IndexMap::with_capacity(scores.len() + 1);
    for (option, score) in scores {
        if option == decline_key {
            continue;
        }
        if !score.is_finite() {
            return Err(ExpandError::NonFinite {
                option: option.clone(),
            });
        }
        let score = score.max(0.0);
        best_score = best_score.max(score);
        field.insert(option.clone(), score);
    }
    if field.is_empty() {
        return Err(ExpandError::EmptyDistribution);
    }

    let floor = threshold.max(0.0);
    // Nothing scored and no bar to clear: the decline option is the only
    // honest answer, so it takes the mass rather than the expansion failing.
    let decline = if floor <= 0.0 && best_score <= 0.0 {
        1.0
    } else {
        floor
    };
    field.insert(decline_key.to_owned(), decline);

    let answer = expand_choice(original, &field)?;
    let fired = answer
        .as_choice()
        .map(|(choice, _)| choice == decline_key)
        .unwrap_or(false);
    Ok(DeclineOutcome {
        answer,
        fired,
        best_score,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dist(pairs: &[(&str, f64)]) -> IndexMap<String, f64> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
    }

    #[test]
    fn expansion_never_invents_a_key_and_covers_every_original() {
        let original = ["a", "b", "c", "d", "none"];
        let answer = expand_choice(&original, &dist(&[("b", 0.6), ("none", 0.4)])).unwrap();
        let (choice, probabilities) = answer.as_choice().unwrap();

        assert_eq!(choice, "b");
        assert_eq!(probabilities.len(), original.len());
        for key in original {
            assert!(probabilities.contains_key(key));
        }
        for key in probabilities.keys() {
            assert!(original.contains(&key.as_str()));
        }
        assert_eq!(probabilities["a"], 0.0);
        assert_eq!(probabilities["c"], 0.0);
    }

    #[test]
    fn probabilities_sum_to_one() {
        for raw in [
            dist(&[("a", 0.6), ("b", 0.4)]),
            dist(&[("a", 0.61), ("b", 0.41)]), // 1.02 from a rounding backend
            dist(&[("a", 3.0), ("b", 1.0)]),   // unnormalised logits-as-scores
            dist(&[("a", 1.0)]),
        ] {
            let answer = expand_choice(&["a", "b", "c"], &raw).unwrap();
            let (_, probabilities) = answer.as_choice().unwrap();
            let sum: f64 = probabilities.values().sum();
            assert!((sum - 1.0).abs() < 1e-9, "sum={sum}");
        }
    }

    #[test]
    fn original_order_is_preserved_not_shortlist_order() {
        let answer = expand_choice(&["z", "y", "x"], &dist(&[("x", 0.7), ("z", 0.3)])).unwrap();
        let (_, probabilities) = answer.as_choice().unwrap();
        assert_eq!(
            probabilities.keys().collect::<Vec<_>>(),
            vec!["z", "y", "x"]
        );
    }

    #[test]
    fn ties_break_towards_the_first_original_option() {
        let answer = expand_choice(&["a", "b"], &dist(&[("b", 0.5), ("a", 0.5)])).unwrap();
        assert_eq!(answer.as_choice().unwrap().0, "a");
    }

    #[test]
    fn confidence_is_the_winners_probability() {
        let answer = expand_choice(&["a", "b", "c"], &dist(&[("c", 0.75), ("a", 0.25)])).unwrap();
        match answer {
            Answer::Choice {
                choice,
                confidence,
                probabilities,
                ..
            } => {
                assert_eq!(choice, "c");
                assert!((confidence - probabilities["c"]).abs() < f64::EPSILON);
                assert!((confidence - 0.75).abs() < 1e-9);
            }
            other => panic!("expected a choice, got {other:?}"),
        }
    }

    #[test]
    fn the_threshold_decides_and_the_distribution_agrees_with_it() {
        let original = ["a", "b", "none"];
        let scores = dist(&[("a", 0.31), ("b", 0.12)]);

        let declined = expand_choice_with_decline(&original, &scores, "none", 0.5).unwrap();
        assert!(declined.fired);
        let (choice, probabilities) = declined.answer.as_choice().unwrap();
        assert_eq!(choice, "none");
        // The hard rule still holds, and the winner is the argmax.
        assert_eq!(probabilities.len(), 3);
        assert!((probabilities.values().sum::<f64>() - 1.0).abs() < 1e-9);
        assert!(probabilities["none"] > probabilities["a"]);
        assert!((declined.best_score - 0.31).abs() < 1e-9);

        let routed = expand_choice_with_decline(&original, &scores, "none", 0.2).unwrap();
        assert!(!routed.fired);
        assert_eq!(routed.answer.as_choice().unwrap().0, "a");
    }

    #[test]
    fn the_engines_own_score_for_the_decline_key_is_replaced_by_the_threshold() {
        // An NLI judge will happily score "no skill applies" as an hypothesis.
        // That number is not what the threshold is about, so it is overridden.
        let scores = dist(&[("a", 0.4), ("none", 0.99)]);
        let out = expand_choice_with_decline(&["a", "none"], &scores, "none", 0.1).unwrap();
        assert!(!out.fired, "0.99 for `none` must not outvote a real option");
        assert_eq!(out.answer.as_choice().unwrap().0, "a");
    }

    #[test]
    fn a_zero_threshold_over_zero_scores_declines_rather_than_failing() {
        let out =
            expand_choice_with_decline(&["a", "none"], &dist(&[("a", 0.0)]), "none", 0.0).unwrap();
        assert!(out.fired);
        assert_eq!(out.answer.as_choice().unwrap().1["none"], 1.0);
    }

    #[test]
    fn declining_into_an_option_the_caller_never_offered_is_refused() {
        assert_eq!(
            expand_choice_with_decline(&["a", "b"], &dist(&[("a", 0.9)]), "none", 0.5).unwrap_err(),
            ExpandError::DeclineNotOffered {
                option: "none".into()
            }
        );
        assert_eq!(
            expand_choice_with_decline(&["a", "none"], &dist(&[("a", 0.9)]), "none", f64::NAN)
                .unwrap_err(),
            ExpandError::NonFinite {
                option: "none".into()
            }
        );
        assert_eq!(
            expand_choice_with_decline(&["a", "none"], &dist(&[("none", 0.9)]), "none", 0.5)
                .unwrap_err(),
            ExpandError::EmptyDistribution,
            "a field of nothing but the decline key is not a choice"
        );
    }

    #[test]
    fn a_sweep_of_thresholds_is_monotone_in_declining() {
        // The property the eval sweep depends on: raising the bar can only ever
        // turn routes into declines, never the other way round.
        let original = ["a", "b", "c", "none"];
        let scores = dist(&[("a", 0.62), ("b", 0.44), ("c", 0.05)]);
        let mut seen_decline = false;
        for step in 0..=20 {
            let threshold = f64::from(step) / 20.0;
            let out = expand_choice_with_decline(&original, &scores, "none", threshold).unwrap();
            if out.fired {
                seen_decline = true;
            } else {
                assert!(!seen_decline, "declines must not un-fire as the bar rises");
                assert_eq!(out.answer.as_choice().unwrap().0, "a");
            }
        }
        assert!(seen_decline);
    }

    #[test]
    fn every_rejection_is_typed() {
        assert_eq!(
            expand_choice::<&str>(&[], &dist(&[("a", 1.0)])).unwrap_err(),
            ExpandError::NoOriginalOptions
        );
        assert_eq!(
            expand_choice(&["a"], &IndexMap::new()).unwrap_err(),
            ExpandError::EmptyDistribution
        );
        assert_eq!(
            expand_choice(&["a", "a"], &dist(&[("a", 1.0)])).unwrap_err(),
            ExpandError::DuplicateOriginalOption { option: "a".into() }
        );
        assert_eq!(
            expand_choice(&["a"], &dist(&[("q", 1.0)])).unwrap_err(),
            ExpandError::InventedOption { option: "q".into() }
        );
        assert_eq!(
            expand_choice(&["a"], &dist(&[("a", f64::NAN)])).unwrap_err(),
            ExpandError::NonFinite { option: "a".into() }
        );
        assert_eq!(
            expand_choice(&["a", "b"], &dist(&[("a", 0.0), ("b", 0.0)])).unwrap_err(),
            ExpandError::DegenerateDistribution
        );
    }
}
