//! Typed errors for every rejection this crate can make.
//!
//! Each family is a separate enum so a caller can handle exactly the class it
//! cares about — a façade wants to map [`BudgetError::OptionsUnfittable`] onto
//! the wire error code `options_unfittable` and nothing else — and [`enum@Error`]
//! unions them for callers that just want one `?`-able type.
//!
//! Every variant carries the numbers needed to explain the rejection to a human
//! without re-deriving them; that is why, for example,
//! [`BudgetError::OptionsUnfittable`] reports both the budget and the cost of
//! the smallest shortlist that would still be a choice.

use thiserror::Error;

/// A request (or one question inside it) is not a well-formed typed decision.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum ValidationError {
    /// The `type` discriminant is not one of `choice`, `score`, `noul`.
    #[error(
        "question `{name}`: unknown question type `{found}` (expected `choice`, `score` or `noul`)"
    )]
    UnknownQuestionType {
        /// The question's key in the request's `questions` map.
        name: String,
        /// The `type` value that was sent.
        found: String,
    },

    /// A required field was absent.
    #[error("question `{name}`: missing required field `{field}`")]
    MissingField {
        /// The question's key in the request's `questions` map.
        name: String,
        /// The absent field.
        field: &'static str,
    },

    /// A field was present with the wrong JSON type.
    #[error("question `{name}`: field `{field}` must be {expected}, got {found}")]
    WrongFieldType {
        /// The question's key in the request's `questions` map.
        name: String,
        /// The offending field.
        field: &'static str,
        /// What the protocol requires, e.g. `an object of option -> rubric`.
        expected: &'static str,
        /// The JSON type that was actually sent, e.g. `array`.
        found: &'static str,
    },

    /// A `choice` offered fewer than two options, so there is nothing to choose.
    #[error("question `{name}`: a choice needs at least 2 options, got {count}")]
    TooFewOptions {
        /// The question's key in the request's `questions` map.
        name: String,
        /// How many options were offered.
        count: usize,
    },

    /// A `score` offered fewer than two bands, so the scale is degenerate.
    #[error("question `{name}`: a score needs at least 2 bands, got {count}")]
    TooFewBands {
        /// The question's key in the request's `questions` map.
        name: String,
        /// How many bands were offered.
        count: usize,
    },

    /// The request asked nothing.
    #[error("request carries no questions")]
    NoQuestions,

    /// A configured limit was exceeded.
    #[error("{what} exceeds the configured limit: {actual} > {limit}")]
    LimitExceeded {
        /// Which limit, e.g. `question count` or `state length in characters`.
        what: &'static str,
        /// The observed value.
        actual: usize,
        /// The configured ceiling.
        limit: usize,
    },
}

/// A response does not satisfy the protocol's hard rules for the request it answers.
#[derive(Debug, Clone, PartialEq, Error)]
#[non_exhaustive]
pub enum ResponseError {
    /// A question in the request has no answer in the response.
    #[error("question `{name}` was asked but not answered")]
    MissingAnswer {
        /// The unanswered question.
        name: String,
    },

    /// The response answers something that was never asked.
    #[error("answer `{name}` does not correspond to any question in the request")]
    UnknownAnswer {
        /// The surplus answer key.
        name: String,
    },

    /// The answer shape does not match the question type.
    #[error("question `{name}` is a {expected} but the answer is a {found}")]
    AnswerKindMismatch {
        /// The question's key.
        name: String,
        /// The question type asked.
        expected: &'static str,
        /// The answer shape received.
        found: &'static str,
    },

    /// A chosen key is not one of the caller's original options. This is the
    /// single most important rule in the protocol: shortlisting must never be
    /// visible to the caller as an invented option.
    #[error(
        "question `{name}`: chosen option `{choice}` is not one of the caller's original options"
    )]
    ChoiceNotOriginal {
        /// The question's key.
        name: String,
        /// The key the backend chose.
        choice: String,
    },

    /// The probability map does not cover every original option (shortlisted-away
    /// options must be reported at `0.0`, not omitted).
    #[error("question `{name}`: probabilities omit original option `{option}`")]
    ProbabilitiesIncomplete {
        /// The question's key.
        name: String,
        /// The option that was dropped from the map.
        option: String,
    },

    /// The probability map contains a key that was never an option.
    #[error("question `{name}`: probabilities contain unknown option `{option}`")]
    ProbabilitiesInvented {
        /// The question's key.
        name: String,
        /// The invented key.
        option: String,
    },

    /// The probability mass is not 1.0 within tolerance.
    #[error("question `{name}`: probabilities sum to {sum}, expected 1.0 +/- {tolerance}")]
    ProbabilityMass {
        /// The question's key.
        name: String,
        /// The observed sum.
        sum: f64,
        /// The tolerance applied.
        tolerance: f64,
    },

    /// A probability, score or confidence was NaN or infinite.
    #[error("question `{name}`: field `{field}` is not a finite number")]
    NonFinite {
        /// The question's key.
        name: String,
        /// The offending field.
        field: &'static str,
    },
}

/// Option shortlisting could not be made to fit the engine's head budget.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum BudgetError {
    /// Fewer than two options were supplied, so there was never a choice to fit.
    #[error("a choice needs at least 2 options, got {available}")]
    TooFewOptions {
        /// How many options were supplied.
        available: usize,
    },

    /// Even the smallest admissible shortlist exceeds the budget. The façade
    /// maps this onto the wire error code `options_unfittable` and returns it
    /// rather than guessing (see the protocol's shortlisting rules, step 5).
    #[error(
        "options_unfittable: the smallest admissible shortlist ({floor_k} options) costs \
         {required_tokens} tokens against a head budget of {head_max_tokens}"
    )]
    OptionsUnfittable {
        /// The engine's head budget, in estimated tokens.
        head_max_tokens: usize,
        /// The cost of the smallest shortlist that would still be a choice.
        required_tokens: usize,
        /// The size of that smallest shortlist — `max(2, pinned options)`.
        floor_k: usize,
    },

    /// Reserved head tokens (instructions, template) already consume the budget.
    #[error(
        "no headroom: {reserved_tokens} reserved tokens against a head budget of {head_max_tokens}"
    )]
    NoHeadroom {
        /// The engine's head budget, in estimated tokens.
        head_max_tokens: usize,
        /// Tokens reserved before any option is rendered.
        reserved_tokens: usize,
    },
}

impl BudgetError {
    /// The wire error code this rejection is reported as.
    ///
    /// ```
    /// use system_one_core::BudgetError;
    /// let e = BudgetError::TooFewOptions { available: 1 };
    /// assert_eq!(e.code(), "invalid_request");
    /// ```
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::OptionsUnfittable { .. } => "options_unfittable",
            Self::TooFewOptions { .. } | Self::NoHeadroom { .. } => "invalid_request",
        }
    }
}

/// Per-window results could not be aggregated into one answer.
#[derive(Debug, Clone, PartialEq, Error)]
#[non_exhaustive]
pub enum AggregateError {
    /// No window results were supplied.
    #[error("cannot aggregate zero windows")]
    NoWindows,

    /// A value or relevance was NaN or infinite. Aggregation is arithmetic; a
    /// NaN in means a silently wrong answer out, so it is rejected at the door.
    #[error("window {window}: {field} is not a finite number")]
    NonFinite {
        /// The index of the offending window result.
        window: usize,
        /// Which number was not finite.
        field: &'static str,
    },

    /// Every candidate ended up with zero mass, so there is no answer to give.
    #[error("aggregated probability mass is zero; no option can be selected")]
    DegenerateDistribution,
}

/// A shortlisted answer could not be re-expanded over the caller's original options.
#[derive(Debug, Clone, PartialEq, Error)]
#[non_exhaustive]
pub enum ExpandError {
    /// The original option set was empty.
    #[error("the original option set is empty")]
    NoOriginalOptions,

    /// The original option set repeats a key, so re-expansion is ambiguous.
    #[error("the original option set repeats the key `{option}`")]
    DuplicateOriginalOption {
        /// The repeated key.
        option: String,
    },

    /// The backend chose something that was never on the caller's menu.
    #[error("chosen option `{choice}` is not one of the caller's original options")]
    ChoiceNotOriginal {
        /// The key the backend chose.
        choice: String,
    },

    /// The backend returned a probability for a key that was never on the menu.
    #[error("probabilities contain `{option}`, which is not one of the caller's original options")]
    InventedOption {
        /// The invented key.
        option: String,
    },

    /// A probability was NaN or infinite.
    #[error("probability for `{option}` is not a finite number")]
    NonFinite {
        /// The offending key.
        option: String,
    },

    /// There were no probabilities to expand.
    #[error("the shortlisted answer carries no probabilities")]
    EmptyDistribution,

    /// Every shortlisted option came back at zero probability, so no original
    /// option can honestly be selected. Inventing a winner here is precisely
    /// what re-expansion exists to prevent.
    #[error("every shortlisted option has zero probability; no option can be selected")]
    DegenerateDistribution,

    /// A decline threshold was asked for against an option the caller never
    /// offered. The judge cannot be made to decline into a key that is not on
    /// the menu, because the answer must name one of the caller's options.
    #[error("decline option `{option}` is not one of the caller's original options")]
    DeclineNotOffered {
        /// The decline key that was asked for.
        option: String,
    },
}

/// The union of every error this crate produces, plus JSON decoding.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    /// The bytes were not the JSON this protocol expects.
    #[error("malformed JSON: {0}")]
    Json(#[from] serde_json::Error),

    /// A request was not a well-formed typed decision.
    #[error(transparent)]
    Validation(#[from] ValidationError),

    /// A response broke one of the protocol's hard rules.
    #[error(transparent)]
    Response(#[from] ResponseError),

    /// Option shortlisting could not be fitted to the engine budget.
    #[error(transparent)]
    Budget(#[from] BudgetError),

    /// Per-window results could not be aggregated.
    #[error(transparent)]
    Aggregate(#[from] AggregateError),

    /// A shortlisted answer could not be re-expanded.
    #[error(transparent)]
    Expand(#[from] ExpandError),
}
