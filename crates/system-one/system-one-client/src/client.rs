//! The client itself: one HTTP call, made carefully.

use std::time::Duration;

use reqwest::{header, StatusCode, Url};
use serde::{Deserialize, Serialize};
use system_one_core::{ErrorEnvelope, Request, Response, SYSTEM_ONE_PATH};

use crate::error::ClientError;

/// Default request deadline.
///
/// A System One call is a single forward pass through a small encoder — tens of
/// milliseconds locally, a second or so across the public internet. Thirty
/// seconds is therefore not "how long it takes", it is "long enough that
/// something is wrong", which is what a timeout should mean.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Default number of retries after the first attempt.
pub const DEFAULT_MAX_RETRIES: u32 = 2;

/// Default first backoff delay; each further retry doubles it.
pub const DEFAULT_BACKOFF: Duration = Duration::from_millis(250);

/// Ceiling on a single backoff delay, including one taken from `Retry-After`.
///
/// A `Retry-After: 3600` from an over-zealous gateway must not turn a routing
/// decision into an hour-long stall, so the header is honoured only up to this.
pub const MAX_BACKOFF: Duration = Duration::from_secs(10);

/// Bytes of a failing body kept for the error message.
const SNIPPET_BYTES: usize = 512;

/// Statuses worth retrying: `429 Too Many Requests` and the `529` some
/// providers return when a model is overloaded.
///
/// Deliberately narrow. A 500 from a typed-decision endpoint is a bug, not
/// congestion, and hammering it turns one bad request into three.
///
/// ```
/// use system_one_client::is_retryable_status;
/// assert!(is_retryable_status(429));
/// assert!(is_retryable_status(529));
/// assert!(!is_retryable_status(500));
/// ```
#[must_use]
pub fn is_retryable_status(status: u16) -> bool {
    status == 429 || status == 529
}

/// What a System One engine says about its own limits, from `GET /v1/models`.
///
/// Both limits are optional because a third-party endpoint does not publish
/// them; a façade should treat their absence as "assume the documented
/// defaults" rather than as an error.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelInfo {
    /// The model or deployment name.
    #[serde(default)]
    pub id: String,
    /// The engine's whole-sequence ceiling in tokens, if published.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_len: Option<usize>,
    /// The engine's head ceiling in tokens, if published.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_max_len: Option<usize>,
}

/// The `GET /v1/models` body.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelsResponse {
    /// The models this endpoint serves.
    #[serde(default)]
    pub data: Vec<ModelInfo>,
}

/// Builder for a [`SystemOneClient`].
///
/// ```
/// use std::time::Duration;
/// use system_one_client::SystemOneClient;
///
/// let client = SystemOneClient::builder("http://systemone:8097")
///     .bearer_token(Some("secret".to_string()))
///     .timeout(Duration::from_secs(5))
///     .max_retries(3)
///     .build()
///     .unwrap();
///
/// assert_eq!(client.endpoint().as_str(), "http://systemone:8097/v1/systemone");
/// ```
#[derive(Clone, Debug)]
pub struct SystemOneClientBuilder {
    base_url: String,
    bearer_token: Option<String>,
    timeout: Duration,
    max_retries: u32,
    backoff: Duration,
    user_agent: String,
    validate_requests: bool,
}

impl SystemOneClientBuilder {
    /// The bearer token sent as `Authorization: Bearer …`.
    ///
    /// `None` sends no header at all, which is the loopback and LAN posture:
    /// the sovereign façade accepts the header but does not require it when no
    /// key is configured.
    #[must_use]
    pub fn bearer_token(mut self, token: Option<String>) -> Self {
        self.bearer_token = token;
        self
    }

    /// The per-request deadline. Defaults to [`DEFAULT_TIMEOUT`].
    #[must_use]
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// How many times to retry a retryable status. Defaults to
    /// [`DEFAULT_MAX_RETRIES`]; zero means one attempt and no retries.
    #[must_use]
    pub fn max_retries(mut self, retries: u32) -> Self {
        self.max_retries = retries;
        self
    }

    /// The first backoff delay; each further retry doubles it, capped at
    /// [`MAX_BACKOFF`]. Defaults to [`DEFAULT_BACKOFF`].
    #[must_use]
    pub fn backoff(mut self, backoff: Duration) -> Self {
        self.backoff = backoff;
        self
    }

    /// The `User-Agent` header.
    #[must_use]
    pub fn user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.user_agent = user_agent.into();
        self
    }

    /// Whether to validate a request against the protocol before sending it.
    ///
    /// On by default. Turn it off only to probe an endpoint's own handling of a
    /// malformed request — which is exactly what the evaluator does.
    #[must_use]
    pub fn validate_requests(mut self, validate: bool) -> Self {
        self.validate_requests = validate;
        self
    }

    /// Build the client.
    ///
    /// # Errors
    ///
    /// [`ClientError::InvalidBaseUrl`] if the base URL cannot be parsed or
    /// carries no host, or [`ClientError::Transport`] if the HTTP stack cannot
    /// be constructed.
    pub fn build(self) -> Result<SystemOneClient, ClientError> {
        let invalid = |reason: String| ClientError::InvalidBaseUrl {
            url: self.base_url.clone(),
            reason,
        };

        let trimmed = self.base_url.trim().trim_end_matches('/');
        let parsed = Url::parse(trimmed).map_err(|e| invalid(e.to_string()))?;
        if parsed.host_str().is_none() {
            return Err(invalid("no host".to_owned()));
        }

        // A caller may configure either the bare origin or the full endpoint.
        // Both are in live use in this estate's config files, so both work.
        let endpoint = if parsed
            .path()
            .trim_end_matches('/')
            .ends_with(SYSTEM_ONE_PATH)
        {
            parsed.clone()
        } else {
            let joined = format!("{trimmed}{SYSTEM_ONE_PATH}");
            Url::parse(&joined).map_err(|e| invalid(e.to_string()))?
        };

        let mut models_url = endpoint.clone();
        models_url.set_path("/v1/models");
        models_url.set_query(None);

        let http = reqwest::Client::builder()
            .timeout(self.timeout)
            .user_agent(self.user_agent)
            .build()?;

        Ok(SystemOneClient {
            http,
            endpoint,
            models_url,
            bearer_token: self.bearer_token,
            timeout: self.timeout,
            max_retries: self.max_retries,
            backoff: self.backoff,
            validate_requests: self.validate_requests,
        })
    }
}

/// An async client for a System One endpoint.
///
/// The same client speaks to a third-party typed-decision API and to the
/// sovereign façade, because the wire format is the same — which is the whole
/// point of having one: a deployment swaps backend by changing a URL, and
/// nothing in the calling code moves.
///
/// Cloning is cheap: the underlying connection pool is shared.
#[derive(Clone, Debug)]
pub struct SystemOneClient {
    http: reqwest::Client,
    endpoint: Url,
    models_url: Url,
    bearer_token: Option<String>,
    timeout: Duration,
    max_retries: u32,
    backoff: Duration,
    validate_requests: bool,
}

impl SystemOneClient {
    /// Start building a client for `base_url`, which may be either the origin
    /// (`http://systemone:8097`) or the full endpoint
    /// (`http://systemone:8097/v1/systemone`).
    #[must_use]
    pub fn builder(base_url: impl Into<String>) -> SystemOneClientBuilder {
        SystemOneClientBuilder {
            base_url: base_url.into(),
            bearer_token: None,
            timeout: DEFAULT_TIMEOUT,
            max_retries: DEFAULT_MAX_RETRIES,
            backoff: DEFAULT_BACKOFF,
            user_agent: concat!("system-one-client/", env!("CARGO_PKG_VERSION")).to_owned(),
            validate_requests: true,
        }
    }

    /// A client with every default.
    ///
    /// # Errors
    ///
    /// As [`SystemOneClientBuilder::build`].
    ///
    /// ```
    /// use system_one_client::SystemOneClient;
    /// let client = SystemOneClient::new("https://api.example.test").unwrap();
    /// assert_eq!(client.endpoint().path(), "/v1/systemone");
    /// ```
    pub fn new(base_url: impl Into<String>) -> Result<Self, ClientError> {
        Self::builder(base_url).build()
    }

    /// The resolved endpoint this client posts to.
    #[must_use]
    pub fn endpoint(&self) -> &Url {
        &self.endpoint
    }

    /// The resolved `GET /v1/models` URL.
    #[must_use]
    pub fn models_url(&self) -> &Url {
        &self.models_url
    }

    /// Ask the endpoint for its typed answers.
    ///
    /// # Errors
    ///
    /// [`ClientError::InvalidRequest`] if the request is not a well-formed
    /// typed decision (unless validation was turned off),
    /// [`ClientError::Timeout`], [`ClientError::Transport`],
    /// [`ClientError::Status`] for a non-2xx after retries, or
    /// [`ClientError::MalformedBody`] if a 2xx body is not a System One
    /// response.
    ///
    /// ```no_run
    /// # async fn run() -> Result<(), Box<dyn std::error::Error>> {
    /// use system_one_client::SystemOneClient;
    /// use system_one_core::{Question, Request};
    ///
    /// let client = SystemOneClient::new("http://systemone:8097")?;
    /// let request = Request::new("laya-typed-decisions", "deploy the container")
    ///     .with_question("is_deploy", Question::noul("is the user asking to deploy?"));
    ///
    /// let response = client.predict(&request).await?;
    /// println!("{:?}", response.answers["is_deploy"].as_noul());
    /// # Ok(())
    /// # }
    /// ```
    pub async fn predict(&self, request: &Request) -> Result<Response, ClientError> {
        let body = self.send(request).await?;
        serde_json::from_str::<Response>(&body).map_err(|e| ClientError::MalformedBody {
            url: self.endpoint.to_string(),
            reason: e.to_string(),
            snippet: snippet(&body),
        })
    }

    /// As [`SystemOneClient::predict`], but returning the raw JSON body.
    ///
    /// The typed [`Response`] models the frozen wire contract and drops fields
    /// outside it — a backend's own answer metadata, for instance. A façade or
    /// an evaluator that needs those reaches for this; a consumer does not.
    ///
    /// # Errors
    ///
    /// As [`SystemOneClient::predict`], except that any 2xx body which is valid
    /// JSON is returned rather than rejected.
    pub async fn predict_raw(&self, request: &Request) -> Result<serde_json::Value, ClientError> {
        let body = self.send(request).await?;
        serde_json::from_str(&body).map_err(|e| ClientError::MalformedBody {
            url: self.endpoint.to_string(),
            reason: e.to_string(),
            snippet: snippet(&body),
        })
    }

    /// Ask the endpoint what models it serves and what its context limits are.
    ///
    /// # Errors
    ///
    /// As [`SystemOneClient::predict`], minus [`ClientError::InvalidRequest`].
    pub async fn models(&self) -> Result<ModelsResponse, ClientError> {
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let request = self.authorise(self.http.get(self.models_url.clone()));
            match self.execute(request, attempt).await? {
                Outcome::Body(body) => {
                    return serde_json::from_str(&body).map_err(|e| ClientError::MalformedBody {
                        url: self.models_url.to_string(),
                        reason: e.to_string(),
                        snippet: snippet(&body),
                    })
                }
                Outcome::RetryAfter(delay) => tokio::time::sleep(delay).await,
            }
        }
    }

    /// Attach the bearer token, when one is configured.
    fn authorise(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.bearer_token {
            Some(token) => builder.header(header::AUTHORIZATION, format!("Bearer {token}")),
            None => builder,
        }
    }

    /// POST the request, retrying retryable statuses, and return the raw body.
    async fn send(&self, request: &Request) -> Result<String, ClientError> {
        if self.validate_requests {
            system_one_core::validate::validate(request).map_err(system_one_core::Error::from)?;
        }

        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let http_request = self
                .authorise(self.http.post(self.endpoint.clone()))
                .json(request);
            match self.execute(http_request, attempt).await? {
                Outcome::Body(body) => return Ok(body),
                Outcome::RetryAfter(delay) => tokio::time::sleep(delay).await,
            }
        }
    }

    /// One attempt. Returns the body, or the delay to wait before retrying.
    async fn execute(
        &self,
        request: reqwest::RequestBuilder,
        attempt: u32,
    ) -> Result<Outcome, ClientError> {
        let response = request.send().await.map_err(|e| self.transport(e))?;
        let status = response.status();
        let retry_after = retry_after(&response);
        let body = response.text().await.map_err(|e| self.transport(e))?;

        if status.is_success() {
            return Ok(Outcome::Body(body));
        }

        if is_retryable_status(status.as_u16()) && attempt <= self.max_retries {
            return Ok(Outcome::RetryAfter(
                retry_after.unwrap_or_else(|| self.backoff_for(attempt)),
            ));
        }

        Err(self.status_error(status, &body, attempt))
    }

    /// Exponential backoff for the `attempt`-th try, capped.
    fn backoff_for(&self, attempt: u32) -> Duration {
        let factor = 1u32 << (attempt.saturating_sub(1)).min(16);
        self.backoff.saturating_mul(factor).min(MAX_BACKOFF)
    }

    /// Separate a fired deadline from a broken connection.
    fn transport(&self, error: reqwest::Error) -> ClientError {
        if error.is_timeout() {
            ClientError::Timeout {
                timeout_ms: u64::try_from(self.timeout.as_millis()).unwrap_or(u64::MAX),
            }
        } else {
            ClientError::Transport { source: error }
        }
    }

    /// Build a status error, preferring the protocol's error envelope.
    fn status_error(&self, status: StatusCode, body: &str, attempts: u32) -> ClientError {
        match serde_json::from_str::<ErrorEnvelope>(body) {
            Ok(envelope) => ClientError::Status {
                status: status.as_u16(),
                code: Some(envelope.error.code),
                message: envelope.error.message,
                attempts,
            },
            Err(_) => ClientError::Status {
                status: status.as_u16(),
                code: None,
                message: snippet(body),
                attempts,
            },
        }
    }
}

/// The result of one attempt.
enum Outcome {
    /// A 2xx body.
    Body(String),
    /// A retryable status; wait this long and try again.
    RetryAfter(Duration),
}

/// `Retry-After` in seconds, capped at [`MAX_BACKOFF`]. The HTTP-date form is
/// deliberately not supported: no System One endpoint sends it, and a wrong
/// clock would turn it into an unbounded sleep.
fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(|seconds| Duration::from_secs(seconds).min(MAX_BACKOFF))
}

/// The first [`SNIPPET_BYTES`] of a body, cut on a character boundary.
fn snippet(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.len() <= SNIPPET_BYTES {
        return trimmed.to_owned();
    }
    let end = trimmed
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= SNIPPET_BYTES)
        .last()
        .unwrap_or(0);
    format!("{}…", &trimmed[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_origin_and_a_full_endpoint_resolve_the_same() {
        for base in [
            "http://systemone:8097",
            "http://systemone:8097/",
            "http://systemone:8097/v1/systemone",
            "  http://systemone:8097/v1/systemone/  ",
        ] {
            let client = SystemOneClient::new(base).unwrap();
            assert_eq!(client.endpoint().path(), "/v1/systemone", "base={base}");
            assert_eq!(client.models_url().path(), "/v1/models");
        }
    }

    #[test]
    fn a_base_url_with_a_prefix_path_keeps_it() {
        let client = SystemOneClient::new("https://gateway.test/systemone-api").unwrap();
        assert_eq!(
            client.endpoint().as_str(),
            "https://gateway.test/systemone-api/v1/systemone"
        );
    }

    #[test]
    fn a_nonsense_base_url_is_rejected_at_build_time() {
        let err = SystemOneClient::new("not a url").unwrap_err();
        assert!(matches!(err, ClientError::InvalidBaseUrl { .. }));
        assert!(!err.is_retryable());
    }

    #[test]
    fn backoff_doubles_and_is_capped() {
        let client = SystemOneClient::builder("http://x.test")
            .backoff(Duration::from_millis(100))
            .build()
            .unwrap();
        assert_eq!(client.backoff_for(1), Duration::from_millis(100));
        assert_eq!(client.backoff_for(2), Duration::from_millis(200));
        assert_eq!(client.backoff_for(3), Duration::from_millis(400));
        assert_eq!(client.backoff_for(30), MAX_BACKOFF);
    }

    #[test]
    fn a_snippet_never_splits_a_character() {
        let body = "é".repeat(1000);
        let cut = snippet(&body);
        assert!(std::str::from_utf8(cut.as_bytes()).is_ok());
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn an_error_envelope_becomes_a_typed_status() {
        let client = SystemOneClient::new("http://x.test").unwrap();
        let err = client.status_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            r#"{"error":{"code":"options_unfittable","message":"not even 2 options fit"}}"#,
            1,
        );
        assert_eq!(err.code(), Some("options_unfittable"));
        assert!(!err.is_retryable());

        // A proxy's HTML page is kept verbatim rather than thrown away.
        let err = client.status_error(StatusCode::BAD_GATEWAY, "<html>502</html>", 1);
        assert_eq!(err.code(), None);
        assert!(err.to_string().contains("<html>502</html>"));
    }
}
