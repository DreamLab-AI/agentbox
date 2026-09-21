//! Proving that a request is answerable and that a response is honest.
//!
//! Shape is enforced during parsing ([`crate::wire::Question::from_raw`]);
//! *meaning* is enforced here. A choice with one option parses perfectly and
//! cannot be answered; a response whose `probabilities` omit an option parses
//! perfectly and quietly narrows the caller's world. Both are rejected here.
//!
//! [`validate_response`] is the enforcement point for the protocol's hard rules
//! — a façade should run it against its own output before replying, so a bug in
//! shortlisting becomes a loud 500 rather than a silently wrong routing
//! decision.
//!
//! ```
//! use system_one_core::{validate, Question, Request};
//!
//! let request = Request::new("m", "state").with_question("q", Question::noul("true?"));
//! assert!(validate::validate(&request).is_ok());
//!
//! // A choice with a single option is not a decision.
//! let broken = Request::new("m", "state")
//!     .with_question("q", Question::choice("pick", [("only", "one")]));
//! assert!(validate::validate(&broken).is_err());
//! ```

use crate::aggregate::PROBABILITY_TOLERANCE;
use crate::error::{ResponseError, ValidationError};
use crate::tokens::estimate_state_tokens;
use crate::wire::{Answer, Question, QuestionKind, Request, Response};

/// Ceilings a server applies to an untrusted request.
///
/// These are a denial-of-service boundary, not a protocol rule: the defaults are
/// generous enough that no honest consumer meets them (the estate's largest
/// measured request is a single choice over 115 options with ~25,000 state
/// tokens) and small enough that one request cannot exhaust a façade.
///
/// ```
/// use system_one_core::validate::Limits;
///
/// let limits = Limits::default();
/// assert_eq!(limits.max_questions, 64);
/// assert_eq!(limits.max_options, 512);
/// assert_eq!(limits.max_state_tokens, 262_144);
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Most questions one request may carry. State is re-encoded per question,
    /// so this is the multiplier on the engine's work.
    pub max_questions: usize,
    /// Most options one choice may offer, before shortlisting.
    pub max_options: usize,
    /// Most estimated state tokens one request may carry.
    pub max_state_tokens: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_questions: 64,
            max_options: 512,
            max_state_tokens: 262_144,
        }
    }
}

/// Validate one question's cardinality.
///
/// # Errors
///
/// [`ValidationError::TooFewOptions`] or [`ValidationError::TooFewBands`].
///
/// ```
/// use system_one_core::{validate::validate_question, Question, ValidationError};
///
/// let err = validate_question("urgency", &Question::score("how urgent?", ["only"])).unwrap_err();
/// assert_eq!(err, ValidationError::TooFewBands { name: "urgency".into(), count: 1 });
/// ```
pub fn validate_question(name: &str, question: &Question) -> Result<(), ValidationError> {
    match question {
        Question::Choice { criteria, .. } if criteria.len() < 2 => {
            Err(ValidationError::TooFewOptions {
                name: name.to_owned(),
                count: criteria.len(),
            })
        }
        Question::Score { criteria, .. } if criteria.len() < 2 => {
            Err(ValidationError::TooFewBands {
                name: name.to_owned(),
                count: criteria.len(),
            })
        }
        _ => Ok(()),
    }
}

/// Validate a request's cardinality, with no size ceilings.
///
/// # Errors
///
/// [`ValidationError::NoQuestions`], or whatever [`validate_question`] returns.
pub fn validate(request: &Request) -> Result<(), ValidationError> {
    if request.questions.is_empty() {
        return Err(ValidationError::NoQuestions);
    }
    for (name, question) in &request.questions {
        validate_question(name, question)?;
    }
    Ok(())
}

/// Validate a request and apply the size ceilings a server needs.
///
/// # Errors
///
/// Everything [`validate`] returns, plus [`ValidationError::LimitExceeded`].
///
/// ```
/// use system_one_core::{validate::{validate_with_limits, Limits}, Question, Request, ValidationError};
///
/// let mut limits = Limits::default();
/// limits.max_questions = 1;
///
/// let request = Request::new("m", "s")
///     .with_question("a", Question::noul("one?"))
///     .with_question("b", Question::noul("two?"));
///
/// assert!(matches!(
///     validate_with_limits(&request, &limits).unwrap_err(),
///     ValidationError::LimitExceeded { what: "question count", .. }
/// ));
/// ```
pub fn validate_with_limits(request: &Request, limits: &Limits) -> Result<(), ValidationError> {
    validate(request)?;

    if request.questions.len() > limits.max_questions {
        return Err(ValidationError::LimitExceeded {
            what: "question count",
            actual: request.questions.len(),
            limit: limits.max_questions,
        });
    }

    let state_tokens = estimate_state_tokens(&request.state);
    if state_tokens > limits.max_state_tokens {
        return Err(ValidationError::LimitExceeded {
            what: "estimated state tokens",
            actual: state_tokens,
            limit: limits.max_state_tokens,
        });
    }

    for question in request.questions.values() {
        if let Question::Choice { criteria, .. } = question {
            if criteria.len() > limits.max_options {
                return Err(ValidationError::LimitExceeded {
                    what: "option count",
                    actual: criteria.len(),
                    limit: limits.max_options,
                });
            }
        }
    }

    Ok(())
}

/// The name of an answer's shape, for error messages.
fn answer_shape(answer: &Answer) -> &'static str {
    match answer.kind() {
        QuestionKind::Choice => "choice",
        QuestionKind::Score => "score",
        QuestionKind::Noul => "noul",
    }
}

/// Check a response against the request it answers, enforcing every hard rule
/// of the protocol.
///
/// Specifically: every question is answered and nothing else is; each answer's
/// shape matches its question; a chosen option is one the caller offered;
/// `probabilities` covers exactly the caller's original options and sums to one;
/// and no number is NaN or infinite.
///
/// # Errors
///
/// A [`ResponseError`] naming the offending question.
///
/// ```
/// use indexmap::IndexMap;
/// use system_one_core::{validate::validate_response, Answer, Question, Request, Response, ResponseError};
///
/// let request = Request::new("m", "s")
///     .with_question("pick", Question::choice("pick", [("a", "A"), ("b", "B")]));
///
/// // A backend that forgot the shortlisted-away option is caught here.
/// let narrow: IndexMap<String, f64> = [("a".to_string(), 1.0)].into_iter().collect();
/// let response = Response::new("m").with_answer(
///     "pick",
///     Answer::choice("a", 1.0, narrow),
/// );
///
/// assert!(matches!(
///     validate_response(&request, &response).unwrap_err(),
///     ResponseError::ProbabilitiesIncomplete { .. }
/// ));
/// ```
pub fn validate_response(request: &Request, response: &Response) -> Result<(), ResponseError> {
    for name in response.answers.keys() {
        if !request.questions.contains_key(name) {
            return Err(ResponseError::UnknownAnswer { name: name.clone() });
        }
    }

    for (name, question) in &request.questions {
        let answer = response
            .answers
            .get(name)
            .ok_or_else(|| ResponseError::MissingAnswer { name: name.clone() })?;

        if answer.kind() != question.kind() {
            return Err(ResponseError::AnswerKindMismatch {
                name: name.clone(),
                expected: question.kind().as_str(),
                found: answer_shape(answer),
            });
        }

        match (question, answer) {
            (
                Question::Choice { criteria, .. },
                Answer::Choice {
                    choice,
                    confidence,
                    probabilities,
                    ..
                },
            ) => {
                if !criteria.contains_key(choice) {
                    return Err(ResponseError::ChoiceNotOriginal {
                        name: name.clone(),
                        choice: choice.clone(),
                    });
                }
                if !confidence.is_finite() {
                    return Err(ResponseError::NonFinite {
                        name: name.clone(),
                        field: "confidence",
                    });
                }
                for option in criteria.keys() {
                    if !probabilities.contains_key(option) {
                        return Err(ResponseError::ProbabilitiesIncomplete {
                            name: name.clone(),
                            option: option.clone(),
                        });
                    }
                }
                let mut sum = 0.0f64;
                for (option, probability) in probabilities {
                    if !criteria.contains_key(option) {
                        return Err(ResponseError::ProbabilitiesInvented {
                            name: name.clone(),
                            option: option.clone(),
                        });
                    }
                    if !probability.is_finite() {
                        return Err(ResponseError::NonFinite {
                            name: name.clone(),
                            field: "probabilities",
                        });
                    }
                    sum += probability;
                }
                if (sum - 1.0).abs() > PROBABILITY_TOLERANCE {
                    return Err(ResponseError::ProbabilityMass {
                        name: name.clone(),
                        sum,
                        tolerance: PROBABILITY_TOLERANCE,
                    });
                }
            }
            (
                Question::Score { .. },
                Answer::Score {
                    score,
                    distribution,
                    confidence,
                    ..
                },
            ) => {
                for (value, field) in [(score, "score"), (confidence, "confidence")] {
                    if !value.is_finite() {
                        return Err(ResponseError::NonFinite {
                            name: name.clone(),
                            field,
                        });
                    }
                }
                if distribution.iter().any(|p| !p.is_finite()) {
                    return Err(ResponseError::NonFinite {
                        name: name.clone(),
                        field: "distribution",
                    });
                }
            }
            (Question::Noul { .. }, Answer::Noul { noul }) => {
                if !noul.is_finite() {
                    return Err(ResponseError::NonFinite {
                        name: name.clone(),
                        field: "noul",
                    });
                }
            }
            // Unreachable: the kind equality above already matched the pair.
            _ => unreachable!("answer kind was checked against question kind"),
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;

    fn choice_request() -> Request {
        Request::new("m", "state").with_question(
            "pick",
            Question::choice("pick one", [("a", "A"), ("b", "B"), ("c", "C")]),
        )
    }

    fn probabilities(pairs: &[(&str, f64)]) -> IndexMap<String, f64> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
    }

    fn choice_answer(choice: &str, pairs: &[(&str, f64)]) -> Answer {
        Answer::choice(choice, 1.0, probabilities(pairs))
    }

    #[test]
    fn a_well_formed_response_passes() {
        let request = choice_request();
        let response = Response::new("m").with_answer(
            "pick",
            choice_answer("a", &[("a", 0.7), ("b", 0.3), ("c", 0.0)]),
        );
        assert!(validate_response(&request, &response).is_ok());
    }

    #[test]
    fn a_chosen_option_must_be_one_the_caller_offered() {
        let request = choice_request();
        let response = Response::new("m").with_answer(
            "pick",
            choice_answer("z", &[("a", 1.0), ("b", 0.0), ("c", 0.0)]),
        );
        assert!(matches!(
            validate_response(&request, &response).unwrap_err(),
            ResponseError::ChoiceNotOriginal { .. }
        ));
    }

    #[test]
    fn an_invented_probability_key_is_caught() {
        let request = choice_request();
        let response = Response::new("m").with_answer(
            "pick",
            choice_answer("a", &[("a", 0.5), ("b", 0.25), ("c", 0.15), ("q", 0.1)]),
        );
        assert!(matches!(
            validate_response(&request, &response).unwrap_err(),
            ResponseError::ProbabilitiesInvented { option, .. } if option == "q"
        ));
    }

    #[test]
    fn unnormalised_mass_is_caught() {
        let request = choice_request();
        let response = Response::new("m").with_answer(
            "pick",
            choice_answer("a", &[("a", 0.5), ("b", 0.2), ("c", 0.2)]),
        );
        assert!(matches!(
            validate_response(&request, &response).unwrap_err(),
            ResponseError::ProbabilityMass { .. }
        ));
    }

    #[test]
    fn missing_and_surplus_answers_are_caught() {
        let request = choice_request();
        assert!(matches!(
            validate_response(&request, &Response::new("m")).unwrap_err(),
            ResponseError::MissingAnswer { .. }
        ));

        let response = Response::new("m")
            .with_answer(
                "pick",
                choice_answer("a", &[("a", 1.0), ("b", 0.0), ("c", 0.0)]),
            )
            .with_answer("surplus", Answer::Noul { noul: 0.5 });
        assert!(matches!(
            validate_response(&request, &response).unwrap_err(),
            ResponseError::UnknownAnswer { .. }
        ));
    }

    #[test]
    fn an_answer_of_the_wrong_shape_is_caught() {
        let request = choice_request();
        let response = Response::new("m").with_answer("pick", Answer::Noul { noul: 0.5 });
        assert!(matches!(
            validate_response(&request, &response).unwrap_err(),
            ResponseError::AnswerKindMismatch {
                expected: "choice",
                found: "noul",
                ..
            }
        ));
    }

    #[test]
    fn nan_is_rejected_everywhere_it_can_appear() {
        let request = Request::new("m", "s").with_question("n", Question::noul("true?"));
        let response = Response::new("m").with_answer("n", Answer::Noul { noul: f64::NAN });
        assert!(matches!(
            validate_response(&request, &response).unwrap_err(),
            ResponseError::NonFinite { field: "noul", .. }
        ));
    }

    #[test]
    fn limits_are_enforced() {
        let limits = Limits {
            max_state_tokens: 4,
            ..Limits::default()
        };
        let request = Request::new("m", "x".repeat(400)).with_question("n", Question::noul("t?"));
        assert!(matches!(
            validate_with_limits(&request, &limits).unwrap_err(),
            ValidationError::LimitExceeded {
                what: "estimated state tokens",
                actual: 100,
                limit: 4
            }
        ));

        let limits = Limits {
            max_options: 2,
            ..Limits::default()
        };
        assert!(matches!(
            validate_with_limits(&choice_request(), &limits).unwrap_err(),
            ValidationError::LimitExceeded {
                what: "option count",
                ..
            }
        ));
    }

    #[test]
    fn a_request_with_no_questions_is_rejected() {
        assert_eq!(
            validate(&Request::new("m", "s")).unwrap_err(),
            ValidationError::NoQuestions
        );
    }
}
