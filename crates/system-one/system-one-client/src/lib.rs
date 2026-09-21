//! An async HTTP client for any System One typed-decision endpoint.
//!
//! A System One endpoint answers `choice` / `score` / `noul` questions about a
//! piece of state without generating text. The wire format is shared, so one
//! client speaks to a hosted typed-decision API and to a self-hosted,
//! capacity-adapting façade alike; swapping backend is a change of URL and
//! nothing else. The protocol types themselves live in
//! [`system_one_core`], which this crate re-exports.
//!
//! ```no_run
//! # async fn run() -> Result<(), Box<dyn std::error::Error>> {
//! use std::time::Duration;
//! use system_one_client::SystemOneClient;
//! use system_one_client::core::{Question, Request};
//!
//! let client = SystemOneClient::builder("http://systemone:8097")
//!     .bearer_token(std::env::var("SSO_API_KEY").ok())
//!     .timeout(Duration::from_secs(5))
//!     .max_retries(2)
//!     .build()?;
//!
//! let request = Request::new("laya-typed-decisions", "please rebuild the container")
//!     .with_question(
//!         "route",
//!         Question::choice(
//!             "which skill should handle this?",
//!             [("rebuild", "rebuilds the container image"), ("none", "no skill applies")],
//!         ),
//!     );
//!
//! let response = client.predict(&request).await?;
//! let (choice, probabilities) = response.answers["route"].as_choice().unwrap();
//! println!("{choice} at {:.2}", probabilities[choice]);
//! # Ok(())
//! # }
//! ```
//!
//! # What this client does that a bare POST does not
//!
//! * **Resolves the endpoint either way.** A base URL may be the origin or the
//!   full `/v1/systemone` path; both appear in real configuration and both work.
//! * **Validates locally first.** A choice with one option is refused here
//!   rather than after a round trip.
//! * **Retries only what is worth retrying** — `429` and `529`, bounded, with
//!   exponential backoff and a capped `Retry-After`. A `500` from a typed
//!   decision is a bug, and retrying it makes one bad request into three.
//! * **Keeps failures apart.** A fired deadline, a broken connection, an HTTP
//!   status with the protocol's error envelope, and a 2xx body that is not a
//!   System One response are four different variants of [`ClientError`],
//!   because a caller's fail-open policy is different for each.
//!
//! # Fail-open belongs to the caller
//!
//! This client never fabricates an answer. When the endpoint cannot be reached,
//! it returns an error and the caller decides what to do — which for this
//! estate's consumers means falling back to their own built-in path. A
//! plausible invented distribution would be indistinguishable from a real one,
//! which is precisely why there is none.

#![forbid(unsafe_code)]
#![warn(missing_docs, missing_debug_implementations, rust_2018_idioms)]
#![doc(html_root_url = "https://docs.rs/system-one-client")]

mod client;
mod error;

pub use client::{
    is_retryable_status, ModelInfo, ModelsResponse, SystemOneClient, SystemOneClientBuilder,
    DEFAULT_BACKOFF, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT, MAX_BACKOFF,
};
pub use error::ClientError;

/// The protocol crate, re-exported so a dependant needs only this one.
///
/// ```
/// use system_one_client::core::{Question, Request};
/// let request = Request::new("m", "state").with_question("q", Question::noul("true?"));
/// assert_eq!(request.questions.len(), 1);
/// ```
pub use system_one_core as core;
