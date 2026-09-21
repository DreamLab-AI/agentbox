//! Token estimation — a documented heuristic, not a tokeniser.
//!
//! # Why estimate at all
//!
//! Budgeting happens on the façade; tokenising happens in the engine, behind a
//! process boundary and a model-specific vocabulary. Calling the engine to find
//! out whether a request fits the engine is circular, and vendoring a tokeniser
//! would bind this crate to one model's vocabulary — the thing a façade exists
//! to keep swappable. So the budget arithmetic runs on an estimate, and the
//! estimate is deliberately cheap, deterministic and *documented*, so that when
//! it is wrong you can see exactly how wrong.
//!
//! # The heuristic and its provenance
//!
//! [`CHARS_PER_TOKEN`] is 4. That is OpenAI's long-published rule of thumb for
//! English text under a byte-level BPE vocabulary (~4 characters per token), and
//! it holds closely enough for the WordPiece and SentencePiece vocabularies used
//! by small encoders such as BERT-family models and bge-small.
//!
//! # Where it is wrong, and in which direction
//!
//! * **CJK, Thai, Devanagari**: roughly one token per character, so a 4:1 divisor
//!   *under*-estimates by up to 4x. A request that fits on paper may not fit.
//! * **Source code, JSON, base64**: punctuation-dense text tokenises closer to
//!   2–3 characters per token, so this under-estimates by 30–100%.
//! * **Long ordinary English prose**: accurate to within a few per cent.
//!
//! The mitigation is structural, not arithmetic: a façade should reserve
//! headroom (see [`crate::budget::OptionBudget::reserved_tokens`]) and treat a
//! backend's own reported usage as the truth after the fact. Never report an
//! estimate as [`crate::Usage::input_tokens`] — that field means what the engine
//! consumed.

use crate::wire::{Question, Request, State};

/// Characters per token, the divisor of the estimation heuristic.
///
/// Four, per OpenAI's published rule of thumb for English text under byte-level
/// BPE. See the module documentation for where this is wrong and by how much.
pub const CHARS_PER_TOKEN: usize = 4;

/// Estimate the token cost of a string.
///
/// Counts Unicode scalar values (not bytes) and rounds up, so any non-empty
/// string costs at least one token.
///
/// ```
/// use system_one_core::tokens::estimate_tokens;
///
/// assert_eq!(estimate_tokens(""), 0);
/// assert_eq!(estimate_tokens("abc"), 1);      // ceil(3/4)
/// assert_eq!(estimate_tokens("abcdefgh"), 2); // 8/4
/// // Counted in characters, not bytes: a 3-byte character is one character.
/// assert_eq!(estimate_tokens("日本語"), 1);
/// ```
#[must_use]
pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(CHARS_PER_TOKEN)
}

/// The number of characters that fits a token budget under the heuristic.
///
/// ```
/// use system_one_core::tokens::chars_for_tokens;
/// assert_eq!(chars_for_tokens(512), 2048);
/// ```
#[must_use]
pub fn chars_for_tokens(tokens: usize) -> usize {
    tokens.saturating_mul(CHARS_PER_TOKEN)
}

/// Estimate the token cost of a rendered state.
///
/// ```
/// use system_one_core::{State, tokens::estimate_state_tokens};
/// assert_eq!(estimate_state_tokens(&State::Text("abcdefgh".into())), 2);
/// ```
#[must_use]
pub fn estimate_state_tokens(state: &State) -> usize {
    estimate_tokens(&state.render())
}

/// Estimate the head cost of a question: instructions plus criteria.
///
/// This is what must be subtracted from the engine's context before any state
/// is windowed into it.
///
/// ```
/// use system_one_core::{Question, tokens::estimate_question_head_tokens};
/// let q = Question::noul("is the user asking to deploy?");
/// assert_eq!(estimate_question_head_tokens(&q), 8); // ceil(29/4)
/// ```
#[must_use]
pub fn estimate_question_head_tokens(question: &Question) -> usize {
    estimate_tokens(&question.head_text())
}

/// Estimate the total cost of a request as written: state plus every head.
///
/// This is what a *naive* backend would consume — the number that motivates a
/// capacity-adapting façade in the first place. What the engine actually
/// consumes after shortlisting and windowing is normally far lower.
///
/// ```
/// use system_one_core::{Question, Request, tokens::estimate_request_tokens};
///
/// let req = Request::new("m", "abcdefgh")
///     .with_question("q", Question::noul("abcd"));
/// assert_eq!(estimate_request_tokens(&req), 3); // 2 state + 1 head
/// ```
#[must_use]
pub fn estimate_request_tokens(request: &Request) -> usize {
    let mut total = estimate_state_tokens(&request.state);
    for question in request.questions.values() {
        total += estimate_question_head_tokens(question);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_up_and_never_undercounts_a_nonempty_string() {
        for n in 1..500usize {
            let s = "a".repeat(n);
            let est = estimate_tokens(&s);
            assert!(est >= 1);
            assert_eq!(est, n.div_ceil(CHARS_PER_TOKEN));
        }
    }

    #[test]
    fn counts_characters_not_bytes() {
        let cjk = "日本語日本語日本語日本語"; // 12 chars, 36 bytes
        assert_eq!(estimate_tokens(cjk), 3);
    }

    #[test]
    fn chars_for_tokens_is_the_inverse_on_multiples() {
        for tokens in 0..200usize {
            assert_eq!(
                estimate_tokens(&"x".repeat(chars_for_tokens(tokens))),
                tokens
            );
        }
    }

    #[test]
    fn request_cost_is_state_plus_heads() {
        let req = Request::new("m", "x".repeat(400))
            .with_question("a", Question::noul("y".repeat(40)))
            .with_question("b", Question::score("z".repeat(40), ["low", "high"]));
        let expected = 100
            + estimate_question_head_tokens(&req.questions["a"])
            + estimate_question_head_tokens(&req.questions["b"]);
        assert_eq!(estimate_request_tokens(&req), expected);
    }
}
