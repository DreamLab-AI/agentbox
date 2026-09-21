//! What can go wrong between a request and an answer, kept apart on purpose.
//!
//! A caller's fail-open policy is not the same for every failure. A timeout
//! means "try the built-in path this turn"; a 400 means "the request is wrong
//! and will be wrong next time too"; a malformed body means "this endpoint is
//! not a System One endpoint". Collapsing those into one opaque error is how a
//! misconfigured base URL ends up looking like a flaky network for a week, so
//! they are separate variants here and the body of an error response is
//! captured rather than discarded.

use thiserror::Error;

/// A failure while talking to a System One endpoint.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ClientError {
    /// The configured base URL could not be parsed into an endpoint.
    #[error("invalid base URL `{url}`: {reason}")]
    InvalidBaseUrl {
        /// The URL as configured.
        url: String,
        /// Why it could not be used.
        reason: String,
    },

    /// The request never completed within the configured timeout.
    ///
    /// Distinct from [`ClientError::Transport`] because it is the caller's own
    /// deadline that fired, not the network that broke: the endpoint may well
    /// have answered a moment later.
    #[error("request timed out after {timeout_ms} ms")]
    Timeout {
        /// The deadline that fired, in milliseconds.
        timeout_ms: u64,
    },

    /// The request could not be sent, or the connection failed.
    #[error("transport error: {source}")]
    Transport {
        /// The underlying `reqwest` failure.
        #[from]
        source: reqwest::Error,
    },

    /// The endpoint answered with a non-success status.
    ///
    /// `code` and `message` come from the protocol's error envelope
    /// (`{"error":{"code":…,"message":…}}`) when the body carries one; when it
    /// does not, `message` holds a truncated copy of the raw body, because an
    /// HTML error page from a reverse proxy is the single most informative
    /// thing a misrouted request produces.
    #[error("HTTP {status} after {attempts} attempt(s){}: {message}",
            .code.as_ref().map(|c| format!(" ({c})")).unwrap_or_default())]
    Status {
        /// The HTTP status code.
        status: u16,
        /// The protocol error code, if the body carried an envelope.
        code: Option<String>,
        /// The envelope's message, or a truncated raw body.
        message: String,
        /// How many attempts were made, retries included.
        attempts: u32,
    },

    /// The endpoint answered 2xx with something that is not a System One
    /// response.
    #[error("malformed response body from `{url}`: {reason}; body began: {snippet}")]
    MalformedBody {
        /// The endpoint that produced it.
        url: String,
        /// The deserialisation failure.
        reason: String,
        /// The first bytes of the body, for a log line that is actually useful.
        snippet: String,
    },

    /// The request was rejected locally, before anything was sent.
    ///
    /// The client validates a request against the protocol first: sending a
    /// choice with one option to a remote endpoint spends a round trip to be
    /// told what is knowable here.
    #[error("invalid request: {source}")]
    InvalidRequest {
        /// The validation failure.
        #[from]
        source: system_one_core::Error,
    },
}

impl ClientError {
    /// Whether retrying this failure unchanged could plausibly succeed.
    ///
    /// True for timeouts, transport failures and the retryable statuses; false
    /// for a 4xx that is not 429, for a malformed body, and for a request this
    /// client already refused. A caller with its own outer retry loop should
    /// consult this rather than re-deriving the rule.
    ///
    /// ```
    /// use system_one_client::ClientError;
    ///
    /// let rate_limited = ClientError::Status {
    ///     status: 429, code: None, message: "slow down".into(), attempts: 3,
    /// };
    /// assert!(rate_limited.is_retryable());
    ///
    /// let bad_request = ClientError::Status {
    ///     status: 400, code: Some("invalid_request".into()), message: "nope".into(), attempts: 1,
    /// };
    /// assert!(!bad_request.is_retryable());
    /// ```
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Timeout { .. } | Self::Transport { .. } => true,
            Self::Status { status, .. } => crate::is_retryable_status(*status),
            Self::InvalidBaseUrl { .. }
            | Self::MalformedBody { .. }
            | Self::InvalidRequest { .. } => false,
        }
    }

    /// The protocol error code the endpoint reported, if any.
    ///
    /// ```
    /// use system_one_client::ClientError;
    /// let err = ClientError::Status {
    ///     status: 422,
    ///     code: Some("options_unfittable".into()),
    ///     message: "not even 2 options fit".into(),
    ///     attempts: 1,
    /// };
    /// assert_eq!(err.code(), Some("options_unfittable"));
    /// ```
    #[must_use]
    pub fn code(&self) -> Option<&str> {
        match self {
            Self::Status { code, .. } => code.as_deref(),
            _ => None,
        }
    }
}
