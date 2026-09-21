//! The System One typed-decision protocol, in pure Rust.
//!
//! A *System One* endpoint answers three primitives about a piece of state,
//! without generating text:
//!
//! | primitive | question | answer |
//! |---|---|---|
//! | `choice` | which of these named options applies? | one option key plus a probability distribution over all of them |
//! | `score` | where on this ordered scale does the state sit? | a position, plus the band distribution |
//! | `noul` | is this proposition true of the state? | a probability |
//!
//! This crate is the protocol and the arithmetic around it: the wire types
//! ([`Request`], [`Response`]), their validation ([`validate`]), a documented
//! token estimate ([`tokens`]), and the two adaptations that let a small
//! encoder answer a large question — fitting a long option list into the
//! encoder's head budget ([`budget`], [`compress`]) and splitting a long state
//! into windows that are answered separately and recombined ([`window`],
//! [`aggregate`], [`expand`]).
//!
//! It performs **no I/O**, spawns nothing, and does not depend on an async
//! runtime, so it compiles to `wasm32-unknown-unknown` and can be embedded in a
//! server, a client, a CLI or a test harness alike. For the HTTP side, see the
//! companion crate `system-one-client`.
//!
//! # The invariant this crate exists to protect
//!
//! A capacity-adapting façade shows the encoder a *reduced* question: eight
//! options instead of 115, two windows instead of thirty. The caller must never
//! be able to tell, except by reading the honesty block ([`Sso`]). Concretely:
//! the chosen option is always one the caller offered, and `probabilities`
//! covers every option the caller offered, with the dropped ones at exactly
//! `0.0`. [`expand::expand_choice`] implements that rule and
//! [`validate::validate_response`] enforces it.
//!
//! # A whole adaptation, end to end
//!
//! ```
//! use system_one_core::{
//!     aggregate::{aggregate_choice, WindowResult},
//!     budget::{fit_options, OptionBudget},
//!     expand::expand_choice,
//!     validate::validate_response,
//!     window::{window_state, WindowOptions},
//!     Question, QuestionKind, Request, Response,
//! };
//!
//! // A question far too large for a 512-token encoder: 60 options over a long state.
//! let criteria: Vec<(String, String)> = (0..60)
//!     .map(|i| (format!("skill-{i}"), format!("handles workflow {i} end to end")))
//!     .collect();
//! let request = Request::new("laya-typed-decisions", "turn text. ".repeat(400))
//!     .with_question("route", Question::choice("which skill?", criteria.clone()));
//!
//! let question = &request.questions["route"];
//! let Question::Choice { instructions, criteria } = question else { unreachable!() };
//!
//! // 1. Fit the options. Ranking would come from embeddings; caller order will do here.
//! let plan = fit_options(
//!     QuestionKind::Choice,
//!     instructions,
//!     criteria,
//!     &[],
//!     &OptionBudget::default(),
//! )
//! .unwrap();
//! assert!(!plan.would_squeeze());
//!
//! // 2. Window the state around the head cost.
//! let windows = window_state(
//!     &request.state.render(),
//!     512 - plan.head_tokens,
//!     &WindowOptions::default(),
//! );
//!
//! // 3. The engine answers each window (stubbed here), and the windows are merged.
//! let per_window: Vec<WindowResult<_>> = windows
//!     .iter()
//!     .map(|w| {
//!         let distribution = plan
//!             .selected
//!             .iter()
//!             .enumerate()
//!             .map(|(i, o)| (o.key.clone(), if i == 0 { 0.9 } else { 0.1 / 7.0 }))
//!             .collect();
//!         WindowResult::new(0.5, distribution)
//!     })
//!     .collect();
//! let merged = aggregate_choice(&per_window).unwrap();
//!
//! // 4. Re-expand over every original option, and prove the result is honest.
//! let keys: Vec<&str> = criteria.keys().map(String::as_str).collect();
//! let answer = expand_choice(&keys, &merged).unwrap();
//! let response = Response::new("laya-typed-decisions").with_answer("route", answer);
//!
//! validate_response(&request, &response).unwrap();
//! assert_eq!(response.answers["route"].as_choice().unwrap().1.len(), 60);
//! ```
//!
//! # Adapting to more than one engine
//!
//! The two adaptations are not universal truths; they are responses to what a
//! particular engine *is*. An encoder with one shared `[MASK]` head needs its
//! options shortlisted and its rubrics compressed, or it silently squeezes
//! them to four tokens each. A cross-encoder that scores each option in its own
//! sequence needs neither, and applying them anyway would throw away the
//! clause that distinguishes one option from another for no benefit.
//!
//! So the engine declares itself and the caller reads the declaration:
//! [`capability::EngineCapabilities`] carries it, [`budget::OptionCostModel`]
//! is the structural difference it names, and [`budget::offer_options`] is the
//! unbounded counterpart to [`budget::fit_options`]. An engine that declares
//! nothing gets the conservative shape, never the unconstrained one. Where
//! options are scored independently, declining becomes expressible as a
//! threshold rather than as a 116-way competition for one probability mass —
//! [`expand::expand_choice_with_decline`].
//!
//! # Provenance of the magic numbers
//!
//! Every constant that encodes an encoder's behaviour cites its source in its
//! own documentation, in the form `laya 0.3.4, <file>:<symbol>`, read from the
//! published sdist on 2026-09-20. They are re-exported here so they can be found
//! in one place: [`budget::OPTION_TOKEN_CAP`],
//! [`budget::SQUEEZE_RESERVE_TOKENS`], [`budget::SQUEEZE_FLOOR_TOKENS`],
//! [`budget::SEQUENCE_OVERHEAD_TOKENS`], [`budget::MASK_TOKENS_PER_OPTION`],
//! [`budget::DEFAULT_HEAD_MAX_LEN`] and [`budget::DEFAULT_MAX_LEN`]. The token
//! estimate in [`tokens`] is a heuristic and documents where it is wrong and in
//! which direction.

#![forbid(unsafe_code)]
#![warn(missing_docs, missing_debug_implementations, rust_2018_idioms)]
#![doc(html_root_url = "https://docs.rs/system-one-core")]

pub mod aggregate;
pub mod budget;
pub mod capability;
pub mod compress;
pub mod error;
pub mod expand;
pub mod tokens;
pub mod validate;
pub mod window;
pub mod wire;

pub use capability::{CapabilityError, DeclaredCapabilities, EngineCapabilities};
pub use error::{AggregateError, BudgetError, Error, ExpandError, ResponseError, ValidationError};
pub use wire::{
    Answer, ChoiceAction, CompressedOptionTokens, Decline, ErrorBody, ErrorEnvelope, Question,
    QuestionKind, RawCriteria, RawQuestion, RawRequest, Request, RequestOptions, Response,
    Shortlisted, Sso, State, Usage, Windowed,
};

/// The `model` name the sovereign façade answers under.
///
/// Consumers send whatever their configuration says; the façade answers with
/// this, so a recorded transcript shows which backend actually replied.
pub const SOVEREIGN_MODEL: &str = "laya-typed-decisions";

/// The path a System One endpoint is served at, relative to its base URL.
///
/// Frozen by the wire contract and shared by the cloud endpoint and the façade,
/// which is what makes the two swappable behind one configuration key.
pub const SYSTEM_ONE_PATH: &str = "/v1/systemone";
