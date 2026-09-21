//! The System One wire format: requests, questions, answers, usage and the
//! `sso` honesty block.
//!
//! These types are a faithful model of what the estate's System One consumers
//! already send and read, so the same structs serialise for a cloud endpoint and
//! for the sovereign façade. Two properties are load-bearing and are preserved
//! by construction rather than by convention:
//!
//! * **`state` is either an object or a plain string.** Both are in live use, so
//!   [`State`] deserialises from either and [`State::render`] flattens both to
//!   the one text form an encoder can consume.
//! * **Map order is the caller's order.** Questions, options and probabilities
//!   are [`IndexMap`]s, not `BTreeMap`s or `HashMap`s. Consumers rank
//!   `probabilities` by iterating it, so reordering the map silently reorders a
//!   tie-break, and options are ranked before shortlisting — order is data.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::ValidationError;

/// The conversation state a question is asked about.
///
/// ```
/// use system_one_core::State;
///
/// let from_object: State = serde_json::from_str(r#"{"user_request":"rank these"}"#).unwrap();
/// let from_string: State = serde_json::from_str(r#""rank these""#).unwrap();
///
/// assert_eq!(from_object.render(), "user_request: rank these");
/// assert_eq!(from_string.render(), "rank these");
/// ```
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum State {
    /// A pre-rendered block of text, sent verbatim.
    Text(String),
    /// Named fields, rendered one `key: value` line per entry in insertion order.
    Fields(IndexMap<String, Value>),
}

impl State {
    /// Render the state to the single text form an encoder consumes.
    ///
    /// Objects become one `key: value` line per field in the order the caller
    /// sent them; a string value is emitted bare, anything else as compact JSON.
    /// This is the text that gets embedded, windowed and token-counted, so every
    /// part of the stack must render identically — hence one function.
    ///
    /// ```
    /// use system_one_core::State;
    /// let s: State = serde_json::from_str(r#"{"a":"one","b":{"n":2}}"#).unwrap();
    /// assert_eq!(s.render(), "a: one\nb: {\"n\":2}");
    /// ```
    #[must_use]
    pub fn render(&self) -> String {
        match self {
            Self::Text(text) => text.clone(),
            Self::Fields(fields) => {
                let mut out = String::new();
                for (key, value) in fields {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(key);
                    out.push_str(": ");
                    match value {
                        Value::String(s) => out.push_str(s),
                        other => out.push_str(&other.to_string()),
                    }
                }
                out
            }
        }
    }

    /// Length of the rendered state in Unicode scalar values.
    ///
    /// ```
    /// # use system_one_core::State;
    /// assert_eq!(State::Text("abc".into()).len_chars(), 3);
    /// ```
    #[must_use]
    pub fn len_chars(&self) -> usize {
        self.render().chars().count()
    }
}

impl From<String> for State {
    fn from(text: String) -> Self {
        Self::Text(text)
    }
}

impl From<&str> for State {
    fn from(text: &str) -> Self {
        Self::Text(text.to_owned())
    }
}

/// Which of the three typed primitives a question asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum QuestionKind {
    /// Pick exactly one of a named set of options.
    Choice,
    /// Place the state on an ordered band scale.
    Score,
    /// Answer a yes/no proposition as a probability.
    Noul,
}

impl QuestionKind {
    /// The wire discriminant.
    ///
    /// ```
    /// # use system_one_core::QuestionKind;
    /// assert_eq!(QuestionKind::Noul.as_str(), "noul");
    /// ```
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Choice => "choice",
            Self::Score => "score",
            Self::Noul => "noul",
        }
    }
}

/// A question exactly as it arrives on the wire, before it has been proved to be
/// a well-formed typed decision.
///
/// This exists so that an unknown `type`, or `criteria` of the wrong JSON shape,
/// produces a [`ValidationError`] naming the question rather than a bare serde
/// message. [`Request::parse`] goes through it; so can you, via
/// [`Question::from_raw`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RawQuestion {
    /// The `type` discriminant as sent.
    #[serde(rename = "type")]
    pub question_type: String,
    /// The instruction text as sent, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// The criteria as sent, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criteria: Option<RawCriteria>,
}

/// The `criteria` field before its shape has been checked against the question type.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RawCriteria {
    /// `{"option": "rubric", ...}` — a choice's menu.
    Options(IndexMap<String, String>),
    /// `["low","mid","high"]` — a score's bands.
    Bands(Vec<String>),
    /// An object whose values are not all strings.
    MixedOptions(IndexMap<String, Value>),
    /// Anything else at all.
    Other(Value),
}

impl RawCriteria {
    /// A human-readable name for the JSON shape, used in error messages.
    #[must_use]
    pub fn shape(&self) -> &'static str {
        match self {
            Self::Options(_) => "an object of option -> rubric",
            Self::Bands(_) => "an array of band labels",
            Self::MixedOptions(_) => "an object with non-string values",
            Self::Other(value) => json_type_name(value),
        }
    }
}

/// The JSON type name of a value, for error messages.
fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

/// A validated question: one of the three typed primitives.
///
/// Deserialising a `Question` directly is supported and applies the same shape
/// rules; the question's name is unavailable at that point, so the error message
/// names it as `<unnamed>`. Prefer [`Request::parse`] when you have the whole
/// request, because its errors name the offending question.
///
/// ```
/// use system_one_core::{Question, QuestionKind};
///
/// let q: Question = serde_json::from_str(
///     r#"{"type":"score","instructions":"how urgent?","criteria":["low","high"]}"#,
/// )
/// .unwrap();
/// assert_eq!(q.kind(), QuestionKind::Score);
/// ```
#[derive(Clone, Debug, PartialEq)]
pub enum Question {
    /// Pick exactly one option.
    Choice {
        /// What the judge is being asked to do.
        instructions: String,
        /// Option key to rubric, in the caller's order.
        criteria: IndexMap<String, String>,
    },
    /// Place the state on an ordered scale of bands.
    Score {
        /// What the judge is being asked to do.
        instructions: String,
        /// Band labels from lowest to highest.
        criteria: Vec<String>,
    },
    /// Answer a proposition with a probability.
    Noul {
        /// The proposition.
        instructions: String,
    },
}

impl Question {
    /// Build a choice.
    ///
    /// ```
    /// # use system_one_core::Question;
    /// let q = Question::choice("pick a skill", [("a", "does A"), ("b", "does B")]);
    /// assert_eq!(q.option_keys(), vec!["a", "b"]);
    /// ```
    pub fn choice<I, K, V>(instructions: impl Into<String>, criteria: I) -> Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        Self::Choice {
            instructions: instructions.into(),
            criteria: criteria
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
        }
    }

    /// Build a score.
    ///
    /// ```
    /// # use system_one_core::{Question, QuestionKind};
    /// let q = Question::score("how urgent?", ["low", "mid", "high"]);
    /// assert_eq!(q.kind(), QuestionKind::Score);
    /// ```
    pub fn score<I, S>(instructions: impl Into<String>, criteria: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self::Score {
            instructions: instructions.into(),
            criteria: criteria.into_iter().map(Into::into).collect(),
        }
    }

    /// Build a noul.
    ///
    /// ```
    /// # use system_one_core::{Question, QuestionKind};
    /// assert_eq!(Question::noul("is this email?").kind(), QuestionKind::Noul);
    /// ```
    pub fn noul(instructions: impl Into<String>) -> Self {
        Self::Noul {
            instructions: instructions.into(),
        }
    }

    /// Which primitive this is.
    #[must_use]
    pub fn kind(&self) -> QuestionKind {
        match self {
            Self::Choice { .. } => QuestionKind::Choice,
            Self::Score { .. } => QuestionKind::Score,
            Self::Noul { .. } => QuestionKind::Noul,
        }
    }

    /// The instruction text, whatever the primitive.
    #[must_use]
    pub fn instructions(&self) -> &str {
        match self {
            Self::Choice { instructions, .. }
            | Self::Score { instructions, .. }
            | Self::Noul { instructions } => instructions,
        }
    }

    /// The option keys of a choice, in the caller's order; empty for other kinds.
    #[must_use]
    pub fn option_keys(&self) -> Vec<&str> {
        match self {
            Self::Choice { criteria, .. } => criteria.keys().map(String::as_str).collect(),
            _ => Vec::new(),
        }
    }

    /// The text the engine reads *before* the state: instructions plus criteria.
    ///
    /// This is both the head cost subtracted from the context budget and the
    /// text embedded to rank windows, so the two must agree — hence one method.
    ///
    /// ```
    /// # use system_one_core::Question;
    /// let q = Question::choice("pick", [("a", "does A")]);
    /// assert_eq!(q.head_text(), "pick\na: does A");
    /// ```
    #[must_use]
    pub fn head_text(&self) -> String {
        let mut out = self.instructions().to_owned();
        match self {
            Self::Choice { criteria, .. } => {
                for (key, rubric) in criteria {
                    out.push('\n');
                    out.push_str(key);
                    out.push_str(": ");
                    out.push_str(rubric);
                }
            }
            Self::Score { criteria, .. } => {
                for band in criteria {
                    out.push('\n');
                    out.push_str(band);
                }
            }
            Self::Noul { .. } => {}
        }
        out
    }

    /// Promote a raw question to a validated one, naming `name` in any error.
    ///
    /// Shape is enforced here — unknown `type`, criteria of the wrong JSON kind,
    /// missing `instructions`. Cardinality (a choice needs two options) is left
    /// to [`crate::validate::validate_question`] so that a round-trip through
    /// serde never changes a request's meaning.
    ///
    /// ```
    /// use system_one_core::{Question, RawQuestion, ValidationError};
    ///
    /// let raw = RawQuestion {
    ///     question_type: "vibes".into(),
    ///     instructions: Some("rank these".into()),
    ///     criteria: None,
    /// };
    /// let err = Question::from_raw("router", raw).unwrap_err();
    /// assert!(matches!(err, ValidationError::UnknownQuestionType { .. }));
    /// ```
    pub fn from_raw(name: &str, raw: RawQuestion) -> Result<Self, ValidationError> {
        let instructions = raw.instructions.ok_or(ValidationError::MissingField {
            name: name.to_owned(),
            field: "instructions",
        })?;

        match raw.question_type.trim() {
            "choice" => {
                let criteria = raw.criteria.ok_or(ValidationError::MissingField {
                    name: name.to_owned(),
                    field: "criteria",
                })?;
                match criteria {
                    RawCriteria::Options(criteria) => Ok(Self::Choice {
                        instructions,
                        criteria,
                    }),
                    other => Err(ValidationError::WrongFieldType {
                        name: name.to_owned(),
                        field: "criteria",
                        expected: "an object of option -> rubric",
                        found: other.shape(),
                    }),
                }
            }
            "score" => {
                let criteria = raw.criteria.ok_or(ValidationError::MissingField {
                    name: name.to_owned(),
                    field: "criteria",
                })?;
                match criteria {
                    RawCriteria::Bands(criteria) => Ok(Self::Score {
                        instructions,
                        criteria,
                    }),
                    other => Err(ValidationError::WrongFieldType {
                        name: name.to_owned(),
                        field: "criteria",
                        expected: "an array of band labels",
                        found: other.shape(),
                    }),
                }
            }
            "noul" => Ok(Self::Noul { instructions }),
            other => Err(ValidationError::UnknownQuestionType {
                name: name.to_owned(),
                found: other.to_owned(),
            }),
        }
    }

    /// Demote a validated question back to its wire shape.
    #[must_use]
    pub fn to_raw(&self) -> RawQuestion {
        RawQuestion {
            question_type: self.kind().as_str().to_owned(),
            instructions: Some(self.instructions().to_owned()),
            criteria: match self {
                Self::Choice { criteria, .. } => Some(RawCriteria::Options(criteria.clone())),
                Self::Score { criteria, .. } => Some(RawCriteria::Bands(criteria.clone())),
                Self::Noul { .. } => None,
            },
        }
    }
}

impl Serialize for Question {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_raw().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Question {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawQuestion::deserialize(deserializer)?;
        Self::from_raw("<unnamed>", raw).map_err(serde::de::Error::custom)
    }
}

/// A System One request: one state, one or more named questions about it.
///
/// ```
/// use system_one_core::{Question, Request};
///
/// let req = Request::new("laya-typed-decisions", "the user asked to deploy")
///     .with_question("is_deploy", Question::noul("is the user asking to deploy?"));
/// let json = serde_json::to_string(&req).unwrap();
/// assert!(json.contains(r#""type":"noul""#));
/// ```
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Request {
    /// The model or deployment name, e.g. `jev-latest` or `laya-typed-decisions`.
    #[serde(default)]
    pub model: String,
    /// What the questions are about.
    pub state: State,
    /// Named questions, answered under the same names.
    pub questions: IndexMap<String, Question>,
    /// Per-request façade levers, under the namespaced `sso` key.
    ///
    /// Absent from every cloud request and ignorable by any backend that does
    /// not implement it, which is what makes it safe to add to a frozen wire
    /// format.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sso: Option<RequestOptions>,
}

/// Per-request façade levers, sent under the namespaced `sso` key.
///
/// Both fields exist so that a *measurement* can sweep them without
/// redeploying the façade: the decline threshold is a hypothesis under test
/// (see [`Decline`]) and the offer limit is a latency lever, not a correctness
/// one. Absent fields mean "use the deployment's configured default", which is
/// why each is an `Option` rather than carrying a default of its own.
///
/// ```
/// use system_one_core::RequestOptions;
///
/// let options = RequestOptions::default().with_none_threshold(0.4).with_shortlist_k(16);
/// let json = serde_json::to_string(&options).unwrap();
/// assert_eq!(json, r#"{"none_threshold":0.4,"shortlist_k":16}"#);
///
/// // An empty object is valid and means "all defaults".
/// let empty: RequestOptions = serde_json::from_str("{}").unwrap();
/// assert_eq!(empty, RequestOptions::default());
/// ```
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RequestOptions {
    /// The decline threshold for this request, overriding the deployment's.
    ///
    /// Only meaningful on an engine that scores options independently — where
    /// options share one budget, a probability is relative to its rivals and a
    /// fixed threshold on it would mean a different thing for every request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub none_threshold: Option<f64>,
    /// How many options to offer the engine, overriding the deployment's.
    ///
    /// On a head-bounded engine this is a budget; on an unbounded one it is
    /// purely a latency lever and `None` means "offer them all".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortlist_k: Option<usize>,
}

impl RequestOptions {
    /// Set the decline threshold, builder style.
    #[must_use]
    pub fn with_none_threshold(mut self, threshold: f64) -> Self {
        self.none_threshold = Some(threshold);
        self
    }

    /// Set the offer limit, builder style.
    #[must_use]
    pub fn with_shortlist_k(mut self, k: usize) -> Self {
        self.shortlist_k = Some(k);
        self
    }
}

/// A request exactly as it arrives on the wire, before shape checking.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RawRequest {
    /// The model or deployment name.
    #[serde(default)]
    pub model: String,
    /// What the questions are about.
    pub state: State,
    /// Named questions, unvalidated.
    pub questions: IndexMap<String, RawQuestion>,
    /// Per-request façade levers, unvalidated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sso: Option<RequestOptions>,
}

impl Request {
    /// A request with no questions yet.
    #[must_use]
    pub fn new(model: impl Into<String>, state: impl Into<State>) -> Self {
        Self {
            model: model.into(),
            state: state.into(),
            questions: IndexMap::new(),
            sso: None,
        }
    }

    /// Add a question, builder style.
    #[must_use]
    pub fn with_question(mut self, name: impl Into<String>, question: Question) -> Self {
        self.questions.insert(name.into(), question);
        self
    }

    /// Set the per-request façade levers, builder style.
    ///
    /// ```
    /// use system_one_core::{Question, Request, RequestOptions};
    ///
    /// let req = Request::new("m", "s")
    ///     .with_question("q", Question::choice("pick", [("a", "A"), ("b", "B")]))
    ///     .with_sso(RequestOptions::default().with_none_threshold(0.35));
    /// assert_eq!(req.sso.unwrap().none_threshold, Some(0.35));
    /// ```
    #[must_use]
    pub fn with_sso(mut self, options: RequestOptions) -> Self {
        self.sso = Some(options);
        self
    }

    /// Parse and validate a request from JSON, naming the offending question in
    /// any error.
    ///
    /// This is the front door for a server: it applies both shape rules and the
    /// cardinality rules of [`crate::validate`], so what it returns is a request
    /// that can actually be answered.
    ///
    /// ```
    /// use system_one_core::{Request, Error, ValidationError};
    ///
    /// let bad = r#"{"model":"m","state":"s","questions":{"q":{"type":"choice",
    ///               "instructions":"pick","criteria":{"only":"one"}}}}"#;
    /// let err = Request::parse(bad).unwrap_err();
    /// assert!(matches!(err, Error::Validation(ValidationError::TooFewOptions { .. })));
    /// ```
    pub fn parse(json: &str) -> Result<Self, crate::error::Error> {
        let raw: RawRequest = serde_json::from_str(json)?;
        let request = Self::from_raw(raw)?;
        crate::validate::validate(&request)?;
        Ok(request)
    }

    /// Promote a raw request, naming the offending question in any error.
    pub fn from_raw(raw: RawRequest) -> Result<Self, ValidationError> {
        let mut questions = IndexMap::with_capacity(raw.questions.len());
        for (name, question) in raw.questions {
            let question = Question::from_raw(&name, question)?;
            questions.insert(name, question);
        }
        Ok(Self {
            model: raw.model,
            state: raw.state,
            questions,
            sso: raw.sso,
        })
    }
}

/// One answer. The variant is chosen by which key is present, exactly as the
/// wire format does it.
///
/// ```
/// use system_one_core::Answer;
///
/// let a: Answer = serde_json::from_str(r#"{"noul":0.87}"#).unwrap();
/// assert_eq!(a.as_noul(), Some(0.87));
///
/// let c: Answer = serde_json::from_str(
///     r#"{"type":"choice","choice":"x","confidence":0.91,
///         "probabilities":{"x":0.91,"y":0.09},"action":{"act_probability":0.55}}"#,
/// ).unwrap();
/// assert_eq!(c.as_choice().unwrap().0, "x");
/// ```
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Answer {
    /// A choice: the selected key, its confidence, and the full distribution.
    Choice {
        /// The selected option key. Always one of the caller's original keys.
        choice: String,
        /// Confidence in the selection, normally the chosen key's probability.
        #[serde(default)]
        confidence: f64,
        /// Probability per option, covering every original option key.
        #[serde(default)]
        probabilities: IndexMap<String, f64>,
        /// The engine's own act metadata, when it reports any.
        ///
        /// Carried through verbatim rather than dropped: it costs nothing, it
        /// is the backend's, and a field this crate silently discards is a
        /// field a consumer can never adopt.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        action: Option<ChoiceAction>,
    },
    /// A score: the position on the band scale, plus the band distribution.
    Score {
        /// The aggregate position on the scale, in band index units.
        score: f64,
        /// Probability per band, in band order.
        #[serde(default)]
        distribution: Vec<f64>,
        /// Confidence in the score.
        #[serde(default)]
        confidence: f64,
        /// Band index (as a string key) to the band's label, when the backend
        /// echoes the scale back.
        #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
        legend: IndexMap<String, String>,
        /// Band index (as a string key) to probability — the same numbers as
        /// `distribution`, keyed rather than positional. Backends send both;
        /// neither is dropped here, because a consumer reading one and a
        /// backend filling only the other is a silent zero.
        #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
        probabilities: IndexMap<String, f64>,
    },
    /// A noul: the probability that the proposition holds.
    Noul {
        /// Probability in `[0, 1]`.
        noul: f64,
    },
}

/// An engine's own metadata about a choice.
///
/// Laya reports an `act_probability` alongside a choice. The protocol neither
/// requires nor interprets it; it is preserved so that a consumer which learns
/// to use it does not need this crate to change first.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChoiceAction {
    /// The engine's probability that the chosen option should be acted on.
    #[serde(default)]
    pub act_probability: f64,
}

impl Answer {
    /// Build a choice answer with no engine metadata.
    ///
    /// Prefer this to the struct literal: the variant carries backend-supplied
    /// fields that may grow, and a constructor keeps that growth from being a
    /// breaking change for every caller.
    ///
    /// ```
    /// use indexmap::IndexMap;
    /// use system_one_core::Answer;
    ///
    /// let probabilities: IndexMap<String, f64> =
    ///     [("a".to_string(), 1.0), ("b".to_string(), 0.0)].into_iter().collect();
    /// let answer = Answer::choice("a", 1.0, probabilities);
    /// assert_eq!(answer.as_choice().unwrap().0, "a");
    /// ```
    #[must_use]
    pub fn choice(
        choice: impl Into<String>,
        confidence: f64,
        probabilities: IndexMap<String, f64>,
    ) -> Self {
        Self::Choice {
            choice: choice.into(),
            confidence,
            probabilities,
            action: None,
        }
    }

    /// Build a score answer from its band distribution.
    ///
    /// ```
    /// use system_one_core::Answer;
    /// let answer = Answer::score(1.84, vec![0.04, 0.08, 0.88], 0.8);
    /// assert_eq!(answer.as_score(), Some(1.84));
    /// ```
    #[must_use]
    pub fn score(score: f64, distribution: Vec<f64>, confidence: f64) -> Self {
        Self::Score {
            score,
            distribution,
            confidence,
            legend: IndexMap::new(),
            probabilities: IndexMap::new(),
        }
    }

    /// The primitive this answer is for.
    #[must_use]
    pub fn kind(&self) -> QuestionKind {
        match self {
            Self::Choice { .. } => QuestionKind::Choice,
            Self::Score { .. } => QuestionKind::Score,
            Self::Noul { .. } => QuestionKind::Noul,
        }
    }

    /// The chosen key and its distribution, if this is a choice.
    #[must_use]
    pub fn as_choice(&self) -> Option<(&str, &IndexMap<String, f64>)> {
        match self {
            Self::Choice {
                choice,
                probabilities,
                ..
            } => Some((choice.as_str(), probabilities)),
            _ => None,
        }
    }

    /// The score, if this is a score.
    #[must_use]
    pub fn as_score(&self) -> Option<f64> {
        match self {
            Self::Score { score, .. } => Some(*score),
            _ => None,
        }
    }

    /// The probability, if this is a noul.
    #[must_use]
    pub fn as_noul(&self) -> Option<f64> {
        match self {
            Self::Noul { noul } => Some(*noul),
            _ => None,
        }
    }
}

/// What the engine actually consumed.
///
/// `input_tokens` counts what reached the *engine*, not what the caller sent —
/// after shortlisting and windowing those differ, sometimes by an order of
/// magnitude, and the honest number is the one that was paid for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Usage {
    /// Tokens consumed by the engine across every internal call.
    #[serde(default)]
    pub input_tokens: u64,
    /// Tokens generated. A typed decision generates none, so this is normally 0.
    #[serde(default)]
    pub output_tokens: u64,
}

/// How many options a question started with and how many survived shortlisting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Shortlisted {
    /// Options the caller sent.
    pub from: usize,
    /// Options the engine actually saw.
    pub to: usize,
    /// What deliberate rubric compression cost, when the façade reports it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compressed_option_tokens: Option<CompressedOptionTokens>,
}

/// Token counts for the compressed option rubrics of one question.
///
/// The engine caps every option at 48 tokens whatever the façade does, so
/// `max` reaching 48 is the signal that compression is the binding constraint
/// and the rubrics, not the shortlist, are what needs attention.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CompressedOptionTokens {
    /// The largest compressed option, in tokens.
    pub max: usize,
    /// The mean compressed option, in tokens.
    pub mean: f64,
}

/// How many windows the state was split into and how many were evaluated.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Windowed {
    /// Windows the state produced.
    pub windows: usize,
    /// Windows actually sent to the engine.
    pub selected: usize,
    /// Whether the state was kept from its tail rather than its head, for a
    /// question whose answer depends on recency.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncate_left: Option<bool>,
}

/// The honesty channel: what the façade had to do to make the request fit.
///
/// No consumer is required to read it; every consumer is entitled to. If a
/// 115-option choice was cut to 8, that is here, and the alternative — silently
/// answering a different question from the one that was asked — is the failure
/// mode this block exists to make impossible to hide.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Sso {
    /// Per question, the option counts before and after shortlisting.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub shortlisted: IndexMap<String, Shortlisted>,
    /// Per question, the window counts produced and evaluated.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub windowed: IndexMap<String, Windowed>,
    /// Per question, how the decline threshold was applied, when it was.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub decline: IndexMap<String, Decline>,
    /// What the engine declared at `/v1/models`, and therefore which
    /// adaptations the façade applied at all.
    ///
    /// This is the field that makes capability-driven behaviour auditable: an
    /// operator comparing two runs can see whether the façade compressed
    /// rubrics or sent them verbatim, and *why*, without reading the config.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<crate::capability::EngineCapabilities>,
    /// How many option hypotheses the engine actually scored across every
    /// internal call — options times evaluated windows.
    ///
    /// On an engine that scores options independently this is the real unit of
    /// work, and it is the number that makes "more accurate but slower" a
    /// statement with evidence rather than an impression.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hypotheses_scored: Option<usize>,
    /// Milliseconds spent inside the engine.
    #[serde(default)]
    pub engine_ms: u64,
    /// Milliseconds spent inside the façade, engine time included.
    #[serde(default)]
    pub facade_ms: u64,
}

/// How a decline threshold was applied to one choice.
///
/// Where an engine scores each option independently, the best option's score is
/// an *absolute* statement about that option rather than a share of a fixed
/// probability mass. That makes declining expressible as a threshold: if
/// nothing clears `threshold`, the decline option wins. Where options share one
/// budget it is not — a 115-way softmax puts every option below any sensible
/// threshold — so the façade reports `applied: false` rather than silently
/// doing something different.
///
/// ```
/// use system_one_core::Decline;
///
/// let fired = Decline { key: "none".into(), threshold: 0.5, applied: true,
///                       best_score: Some(0.31), fired: true };
/// assert!(fired.fired);
/// ```
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Decline {
    /// The option key that represents declining, e.g. `none`.
    pub key: String,
    /// The threshold in force for this request.
    pub threshold: f64,
    /// Whether the threshold could be applied at all.
    pub applied: bool,
    /// The best option's absolute score, when the engine reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_score: Option<f64>,
    /// Whether the threshold actually decided the answer.
    pub fired: bool,
}

/// A System One response.
///
/// ```
/// use system_one_core::Response;
///
/// let body = r#"{"model":"jev-latest","answers":{"q":{"noul":0.9}},
///                "usage":{"input_tokens":12,"output_tokens":0}}"#;
/// let resp: Response = serde_json::from_str(body).unwrap();
/// assert_eq!(resp.usage.input_tokens, 12);
/// assert!(resp.sso.is_none()); // a cloud endpoint sends no honesty block
/// ```
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Response {
    /// The model that answered.
    #[serde(default)]
    pub model: String,
    /// One answer per question, under the question's name.
    pub answers: IndexMap<String, Answer>,
    /// What the engine consumed.
    #[serde(default)]
    pub usage: Usage,
    /// The façade's honesty block, absent from third-party endpoints.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sso: Option<Sso>,
}

impl Response {
    /// An empty response for `model`.
    #[must_use]
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            model: model.into(),
            answers: IndexMap::new(),
            usage: Usage::default(),
            sso: None,
        }
    }

    /// Add an answer, builder style.
    #[must_use]
    pub fn with_answer(mut self, name: impl Into<String>, answer: Answer) -> Self {
        self.answers.insert(name.into(), answer);
        self
    }
}

/// The body of a 4xx/5xx: `{"error":{"code":"...","message":"..."}}`.
///
/// ```
/// use system_one_core::ErrorEnvelope;
/// let e = ErrorEnvelope::new("options_unfittable", "not even 2 options fit");
/// assert_eq!(serde_json::to_string(&e).unwrap(),
///            r#"{"error":{"code":"options_unfittable","message":"not even 2 options fit"}}"#);
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    /// The error itself.
    pub error: ErrorBody,
}

/// A machine code and a human message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorBody {
    /// A stable, machine-readable code such as `options_unfittable`.
    pub code: String,
    /// A human-readable explanation. Never parsed by a consumer.
    pub message: String,
}

impl ErrorEnvelope {
    /// Build an envelope.
    #[must_use]
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: ErrorBody {
                code: code.into(),
                message: message.into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_deserialises_from_object_and_string() {
        let object: State = serde_json::from_str(r#"{"a":"1","b":"2"}"#).unwrap();
        assert_eq!(object.render(), "a: 1\nb: 2");
        let text: State = serde_json::from_str(r#""plain""#).unwrap();
        assert_eq!(text, State::Text("plain".into()));
    }

    #[test]
    fn state_object_preserves_caller_order() {
        let s: State = serde_json::from_str(r#"{"z":"1","a":"2","m":"3"}"#).unwrap();
        assert_eq!(s.render(), "z: 1\na: 2\nm: 3");
    }

    #[test]
    fn unknown_question_type_is_typed() {
        let raw = RawQuestion {
            question_type: "ranking".into(),
            instructions: Some("x".into()),
            criteria: None,
        };
        assert_eq!(
            Question::from_raw("q1", raw).unwrap_err(),
            ValidationError::UnknownQuestionType {
                name: "q1".into(),
                found: "ranking".into()
            }
        );
    }

    #[test]
    fn score_with_object_criteria_is_typed() {
        let raw: RawQuestion = serde_json::from_str(
            r#"{"type":"score","instructions":"x","criteria":{"low":"a","high":"b"}}"#,
        )
        .unwrap();
        let err = Question::from_raw("urgency", raw).unwrap_err();
        assert!(matches!(
            err,
            ValidationError::WrongFieldType {
                field: "criteria",
                found: "an object of option -> rubric",
                ..
            }
        ));
    }

    #[test]
    fn choice_with_array_criteria_is_typed() {
        let raw: RawQuestion =
            serde_json::from_str(r#"{"type":"choice","instructions":"x","criteria":["a","b"]}"#)
                .unwrap();
        let err = Question::from_raw("pick", raw).unwrap_err();
        assert!(matches!(
            err,
            ValidationError::WrongFieldType {
                found: "an array of band labels",
                ..
            }
        ));
    }

    #[test]
    fn request_round_trips() {
        let json = r#"{"model":"laya-typed-decisions","state":{"user_request":"deploy it"},
            "questions":{"pick":{"type":"choice","instructions":"which","criteria":{"a":"A","b":"B"}},
                         "urgency":{"type":"score","instructions":"how","criteria":["low","high"]},
                         "is_deploy":{"type":"noul","instructions":"deploy?"}}}"#;
        let req = Request::parse(json).unwrap();
        assert_eq!(req.questions.len(), 3);
        assert_eq!(req.questions.keys().next().unwrap(), "pick");

        let reparsed: Request =
            serde_json::from_str(&serde_json::to_string(&req).unwrap()).unwrap();
        assert_eq!(req, reparsed);
    }

    #[test]
    fn answers_discriminate_by_key() {
        let resp: Response = serde_json::from_str(
            r#"{"model":"m","answers":{
                 "a":{"choice":"x","confidence":0.9,"probabilities":{"x":0.9,"y":0.1}},
                 "b":{"score":1.84,"distribution":[0.1,0.9],"confidence":0.8},
                 "c":{"noul":0.87}},
               "usage":{"input_tokens":5,"output_tokens":0}}"#,
        )
        .unwrap();
        assert_eq!(resp.answers["a"].kind(), QuestionKind::Choice);
        assert_eq!(resp.answers["b"].as_score(), Some(1.84));
        assert_eq!(resp.answers["c"].as_noul(), Some(0.87));
    }

    #[test]
    fn sso_block_round_trips() {
        let mut sso = Sso::default();
        sso.shortlisted.insert(
            "pick".into(),
            Shortlisted {
                from: 115,
                to: 8,
                compressed_option_tokens: None,
            },
        );
        sso.windowed.insert(
            "pick".into(),
            Windowed {
                windows: 7,
                selected: 2,
                truncate_left: Some(true),
            },
        );
        sso.engine_ms = 31;
        sso.facade_ms = 48;
        let json = serde_json::to_string(&sso).unwrap();
        assert_eq!(serde_json::from_str::<Sso>(&json).unwrap(), sso);
        assert!(json.contains(r#""from":115"#));
    }
}
