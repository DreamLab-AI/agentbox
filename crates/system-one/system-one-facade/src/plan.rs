//! The server's own orchestration helpers.
//!
//! Everything that is *arithmetic* — fitting options into a head budget,
//! splitting a state into windows, merging per-window answers, re-expanding a
//! distribution over the caller's original keys — belongs to
//! [`system_one_core`] and is called from [`crate::service`], not
//! reimplemented here. What is left in this module is the part that is
//! genuinely the server's:
//!
//! * turning embeddings into the relevance *order* core's
//!   [`fit_options`](system_one_core::budget::fit_options) consumes;
//! * deciding what text to embed for a question when ranking state windows;
//! * mapping whatever the engine called the winning option back onto a key the
//!   caller actually sent, before core's re-expansion — which refuses an
//!   option it was never offered, as it should.

use indexmap::IndexMap;
use system_one_core::budget::FittedOption;
use system_one_core::wire::Question;

/// Order option keys for shortlisting, most relevant first.
///
/// Returns keys only, because that is what
/// [`fit_options`](system_one_core::budget::fit_options) takes as its `ranked`
/// argument: the compression and the fitting are core's, the *ranking* is the
/// façade's, since only the façade has embeddings. Pinned keys are not promoted
/// here — core does that from
/// [`OptionBudget::pinned`](system_one_core::budget::OptionBudget::pinned), and
/// two places deciding one thing is how they come to disagree.
///
/// Ties break on the caller's original order, so the same request always
/// produces the same shortlist.
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_facade::plan::rank_keys;
///
/// let criteria: IndexMap<String, String> = [("a", "x"), ("b", "y"), ("c", "z")]
///     .into_iter()
///     .map(|(k, v)| (k.to_string(), v.to_string()))
///     .collect();
/// let similarities: IndexMap<String, f32> = [("a", 0.1f32), ("b", 0.9), ("c", 0.5)]
///     .into_iter()
///     .map(|(k, v)| (k.to_string(), v))
///     .collect();
/// assert_eq!(rank_keys(&criteria, &similarities), vec!["b", "c", "a"]);
/// ```
pub fn rank_keys(
    criteria: &IndexMap<String, String>,
    similarities: &IndexMap<String, f32>,
) -> Vec<String> {
    let mut ranked: Vec<(usize, &String, f32)> = criteria
        .keys()
        .enumerate()
        .map(|(position, key)| (position, key, similarities.get(key).copied().unwrap_or(0.0)))
        .collect();
    ranked.sort_by(|a, b| {
        b.2.partial_cmp(&a.2)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0))
    });
    ranked.into_iter().map(|(_, key, _)| key.clone()).collect()
}

/// The text used to rank state windows for relevance to a question.
///
/// A question's instructions alone are often too short to embed usefully, so a
/// bounded sample of its options rides along. Bounded, because this is a
/// ranking query and bge-small stops reading at ~512 tokens: an unbounded
/// concatenation of 115 rubrics would push the instructions out of the part of
/// the text the encoder actually sees.
pub fn query_text(question: &Question) -> String {
    match question {
        Question::Choice {
            instructions,
            criteria,
        } => {
            let mut out = String::from(instructions);
            for (key, rubric) in criteria.iter().take(32) {
                out.push('\n');
                out.push_str(key);
                out.push_str(": ");
                out.push_str(&rubric.chars().take(160).collect::<String>());
            }
            out
        }
        Question::Score {
            instructions,
            criteria,
        } => format!("{instructions}\n{}", criteria.join(", ")),
        Question::Noul { instructions } => instructions.clone(),
    }
}

/// Map whatever the engine called the winning option back to a caller key.
///
/// The engine is sent `{key: compressed_rubric}`, so the ordinary case is an
/// exact key. The other two cases are real: an engine that answers with the
/// option *text*, and one that answers positionally. Anything else returns
/// `None`, and the caller turns that into an error —
/// [`expand_choice`](system_one_core::expand::expand_choice) would refuse an
/// invented option anyway, and this exists so that a merely *differently
/// spelled* option is not mistaken for an invented one.
///
/// ```
/// use system_one_core::budget::FittedOption;
/// use system_one_facade::plan::resolve_key;
///
/// let sent = vec![FittedOption {
///     key: "alpha".into(),
///     rubric: "does the thing".into(),
///     original_rubric: "does the thing, at length".into(),
///     tokens: 4,
///     compressed: true,
/// }];
/// assert_eq!(resolve_key("alpha", &sent).as_deref(), Some("alpha"));
/// assert_eq!(resolve_key("does the thing", &sent).as_deref(), Some("alpha"));
/// assert_eq!(resolve_key("0", &sent).as_deref(), Some("alpha"));
/// assert_eq!(resolve_key("omega", &sent), None);
/// ```
pub fn resolve_key(raw: &str, sent: &[FittedOption]) -> Option<String> {
    if let Some(found) = sent.iter().find(|o| o.key == raw) {
        return Some(found.key.clone());
    }
    if let Some(found) = sent.iter().find(|o| o.rubric == raw || o.text() == raw) {
        return Some(found.key.clone());
    }
    // Positional only for a bare integer. `opt1` is deliberately NOT treated as
    // position 1: an engine that answers with a name the façade never sent is
    // an engine to fail on, and inferring an index from an unrecognised name is
    // the guess this whole path exists to avoid.
    let trimmed = raw.trim();
    if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(index) = trimmed.parse::<usize>() {
            return sent.get(index).map(|o| o.key.clone());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(key: &str, rubric: &str) -> FittedOption {
        FittedOption {
            key: key.into(),
            rubric: rubric.into(),
            original_rubric: rubric.into(),
            tokens: 4,
            compressed: false,
        }
    }

    #[test]
    fn ranking_is_stable_for_equal_similarities() {
        let criteria: IndexMap<String, String> = (0..5)
            .map(|i| (format!("k{i}"), "rubric".to_string()))
            .collect();
        let flat: IndexMap<String, f32> = criteria.keys().map(|k| (k.clone(), 0.5f32)).collect();
        assert_eq!(
            rank_keys(&criteria, &flat),
            vec!["k0", "k1", "k2", "k3", "k4"]
        );
    }

    #[test]
    fn an_unranked_key_sorts_last_not_missing() {
        let criteria: IndexMap<String, String> = [("a", "x"), ("b", "y")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let partial: IndexMap<String, f32> = [("b".to_string(), 0.4f32)].into_iter().collect();
        assert_eq!(rank_keys(&criteria, &partial), vec!["b", "a"]);
    }

    #[test]
    fn query_text_samples_options_without_swamping_the_instructions() {
        let criteria: Vec<(String, String)> = (0..200)
            .map(|i| (format!("k{i}"), "r".repeat(400)))
            .collect();
        let question = Question::choice("which one?", criteria);
        let text = query_text(&question);
        assert!(text.starts_with("which one?"));
        assert!(
            text.len() < 32 * 200,
            "the sample is bounded: {} chars",
            text.len()
        );
    }

    #[test]
    fn resolution_handles_keys_text_and_positions() {
        let sent = vec![option("alpha", "first"), option("beta", "second")];
        assert_eq!(resolve_key("beta", &sent).as_deref(), Some("beta"));
        assert_eq!(resolve_key("second", &sent).as_deref(), Some("beta"));
        assert_eq!(resolve_key("1", &sent).as_deref(), Some("beta"));
        assert_eq!(resolve_key("opt1", &sent), None, "a name is not a position");
        assert_eq!(resolve_key("9", &sent), None, "out of range is not a guess");
    }
}
