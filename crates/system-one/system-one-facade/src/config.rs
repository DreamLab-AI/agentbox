//! Configuration from the environment, with documented defaults.
//!
//! | variable | default | meaning |
//! |---|---|---|
//! | `SSO_BIND` | `0.0.0.0:8097` | façade listen address (the sole ingress) |
//! | `SSO_ENGINE_URL` | `http://127.0.0.1:8098` | Laya engine base URL (loopback) |
//! | `SSO_API_KEY` | unset | when set, `Authorization: Bearer` is enforced |
//! | `SSO_MODEL` | `laya-typed-decisions` | model name reported in responses |
//! | `SSO_SHORTLIST_K` | `8` | options kept by shortlisting |
//! | `SSO_SHORTLIST_ALWAYS` | `none,other` | option keys never shortlisted away |
//! | `SSO_WINDOW_K` | `2` | state windows evaluated per question |
//! | `SSO_WINDOW_OVERLAP` | `0.25` | window overlap fraction |
//! | `SSO_EMBEDDINGS_URL` | `http://192.168.2.132:9997/v1/embeddings` | bge-small endpoint |
//! | `SSO_EMBEDDINGS_MODEL` | `bge-small-en-v1.5` | embeddings model |
//! | `SSO_EMBEDDINGS_DIM` | `384` | expected dimensionality; a mismatch fails loud |
//! | `SSO_EMBEDDINGS_BATCH` | `32` | inputs per embeddings request |
//! | `SSO_CACHE_PATH` | `$HOME/.cache/agentbox/system-one/embeddings.jsonl` | embedding cache (`off` disables) |
//! | `SSO_ENGINE_TIMEOUT_MS` | `30000` | per engine call |
//! | `SSO_EMBEDDINGS_TIMEOUT_MS` | `15000` | per embeddings call |
//! | `SSO_BUDGET_TTL_S` | `300` | how long the engine's reported budget is cached |
//! | `SSO_OPTION_MAX_TOKENS` | `48` | per-option ceiling assumed when the engine reports none |
//! | `SSO_OPTION_TOKEN_SAFETY` | `4` | margin held back from that ceiling when compressing |
//! | `SSO_COST_SHORTLIST_K` | unset | options offered to an engine with NO head budget; unset offers them all |
//! | `SSO_NONE_THRESHOLD` | `0.5` | decline threshold on an engine that scores options independently |
//! | `SSO_NONE_KEY` | `none` | the option key that means "nothing applies" |
//!
//! Both outbound URLs pass [`assert_lan`] at startup. There is no cloud
//! fallback in this binary and no configuration that can create one.

use std::env;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::Duration;

/// A configuration that could not be used as-is.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// A variable held something that is not a value of its type.
    #[error("{var}: {message}")]
    Invalid {
        /// Environment variable at fault.
        var: String,
        /// What was wrong with it.
        message: String,
    },
    /// An outbound URL points off the LAN.
    #[error("{var} points at a non-LAN host `{host}`; the facade never forwards off the LAN")]
    NonLan {
        /// Environment variable at fault.
        var: String,
        /// The offending host.
        host: String,
    },
}

/// Resolved façade configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Listen address.
    pub bind: String,
    /// Laya engine base URL, without a trailing slash.
    pub engine_url: String,
    /// Bearer token required of callers, when set.
    pub api_key: Option<String>,
    /// Model name reported back to callers.
    pub model: String,
    /// Options kept by shortlisting.
    pub shortlist_k: usize,
    /// Option keys always retained, so the judge can still decline.
    pub shortlist_always: Vec<String>,
    /// Windows evaluated per question.
    pub window_k: usize,
    /// Window overlap fraction.
    pub window_overlap: f32,
    /// Embeddings endpoint (full `/v1/embeddings` URL).
    pub embeddings_url: String,
    /// Embeddings model name.
    pub embeddings_model: String,
    /// Expected embedding dimensionality.
    pub embeddings_dim: usize,
    /// Inputs per embeddings request.
    pub embeddings_batch: usize,
    /// Persistent embedding cache file, if enabled.
    pub cache_path: Option<PathBuf>,
    /// Per engine call.
    pub engine_timeout: Duration,
    /// Per embeddings call.
    pub embeddings_timeout: Duration,
    /// Engine budget cache lifetime.
    pub budget_ttl: Duration,
    /// Hard per-option token ceiling the engine applies (laya: 48, §10.1).
    ///
    /// Used only when the engine does not report `option_max_len` itself.
    pub option_max_tokens: usize,
    /// Options offered to an engine that declares **no head budget**.
    ///
    /// `None` — the default — offers every option the caller sent. On such an
    /// engine a shortlist is a latency choice and nothing else, so importing
    /// the head-bounded engine's `k = 8` would answer a narrower question than
    /// the caller asked for no reason at all (contract §11.4).
    pub cost_shortlist_k: Option<usize>,
    /// The decline threshold: an option must score at least this much, in
    /// absolute terms, or the answer is [`Config::none_key`].
    ///
    /// Only applied where the engine scores options independently, because
    /// only there is an option's score independent of how many rivals it had.
    /// Overridable per request so it can be swept rather than guessed.
    pub none_threshold: f64,
    /// The option key that means "nothing applies".
    pub none_key: String,
    /// Tokens held back from [`Config::option_max_tokens`] when compressing.
    ///
    /// The façade cannot run laya's WordPiece vocabulary, so it estimates.
    /// The margin is what keeps an estimate that is a little low from becoming
    /// the tail-first amputation the whole exercise exists to prevent.
    pub option_token_safety: usize,
}

impl Default for Config {
    /// Every documented default, with nothing read from the environment.
    ///
    /// This is the constructor tests use, so that a test never depends on
    /// process-global state that a sibling test is mutating concurrently.
    fn default() -> Self {
        Self {
            bind: "0.0.0.0:8097".into(),
            engine_url: "http://127.0.0.1:8098".into(),
            api_key: None,
            model: "laya-typed-decisions".into(),
            shortlist_k: 8,
            shortlist_always: vec!["none".into(), "other".into()],
            window_k: 2,
            window_overlap: 0.25,
            embeddings_url: "http://192.168.2.132:9997/v1/embeddings".into(),
            embeddings_model: "bge-small-en-v1.5".into(),
            embeddings_dim: 384,
            embeddings_batch: 32,
            cache_path: None,
            engine_timeout: Duration::from_millis(30_000),
            embeddings_timeout: Duration::from_millis(15_000),
            budget_ttl: Duration::from_secs(300),
            option_max_tokens: 48,
            option_token_safety: 4,
            cost_shortlist_k: None,
            none_threshold: 0.5,
            none_key: "none".into(),
        }
    }
}

fn var(name: &str) -> Option<String> {
    match env::var(name) {
        Ok(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
        _ => None,
    }
}

fn parse<T: std::str::FromStr>(name: &str, default: T) -> Result<T, ConfigError> {
    match var(name) {
        None => Ok(default),
        Some(v) => v.parse::<T>().map_err(|_| ConfigError::Invalid {
            var: name.into(),
            message: format!("`{v}` is not a valid value"),
        }),
    }
}

impl Config {
    /// Read the configuration from the process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        let engine_url = var("SSO_ENGINE_URL")
            .unwrap_or_else(|| "http://127.0.0.1:8098".into())
            .trim_end_matches('/')
            .to_string();
        let embeddings_url = var("SSO_EMBEDDINGS_URL")
            .unwrap_or_else(|| "http://192.168.2.132:9997/v1/embeddings".into());
        assert_lan("SSO_ENGINE_URL", &engine_url)?;
        assert_lan("SSO_EMBEDDINGS_URL", &embeddings_url)?;

        let cache_path = match var("SSO_CACHE_PATH") {
            Some(p) if p.eq_ignore_ascii_case("off") => None,
            Some(p) => Some(PathBuf::from(p)),
            None => var("HOME").map(|h| {
                PathBuf::from(h)
                    .join(".cache/agentbox/system-one")
                    .join("embeddings.jsonl")
            }),
        };

        let overlap: f32 = parse("SSO_WINDOW_OVERLAP", 0.25f32)?;
        if !(0.0..0.9).contains(&overlap) {
            return Err(ConfigError::Invalid {
                var: "SSO_WINDOW_OVERLAP".into(),
                message: "must be in [0, 0.9)".into(),
            });
        }

        let defaults = Self::default();
        Ok(Self {
            bind: var("SSO_BIND").unwrap_or_else(|| "0.0.0.0:8097".into()),
            engine_url,
            api_key: var("SSO_API_KEY"),
            model: var("SSO_MODEL").unwrap_or_else(|| "laya-typed-decisions".into()),
            shortlist_k: parse("SSO_SHORTLIST_K", 8usize)?.max(2),
            shortlist_always: var("SSO_SHORTLIST_ALWAYS")
                .unwrap_or_else(|| "none,other".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            window_k: parse("SSO_WINDOW_K", 2usize)?.max(1),
            window_overlap: overlap,
            embeddings_url,
            embeddings_model: var("SSO_EMBEDDINGS_MODEL")
                .unwrap_or_else(|| "bge-small-en-v1.5".into()),
            embeddings_dim: parse("SSO_EMBEDDINGS_DIM", 384usize)?,
            embeddings_batch: parse("SSO_EMBEDDINGS_BATCH", 32usize)?.max(1),
            cache_path,
            engine_timeout: Duration::from_millis(parse("SSO_ENGINE_TIMEOUT_MS", 30_000u64)?),
            embeddings_timeout: Duration::from_millis(parse(
                "SSO_EMBEDDINGS_TIMEOUT_MS",
                15_000u64,
            )?),
            budget_ttl: Duration::from_secs(parse("SSO_BUDGET_TTL_S", 300u64)?),
            option_max_tokens: parse("SSO_OPTION_MAX_TOKENS", defaults.option_max_tokens)?.max(8),
            option_token_safety: parse("SSO_OPTION_TOKEN_SAFETY", defaults.option_token_safety)?,
            cost_shortlist_k: match var("SSO_COST_SHORTLIST_K") {
                None => None,
                Some(v) if v.eq_ignore_ascii_case("all") => None,
                Some(_) => Some(parse("SSO_COST_SHORTLIST_K", 0usize)?.max(2)),
            },
            none_threshold: {
                let threshold = parse("SSO_NONE_THRESHOLD", defaults.none_threshold)?;
                if !threshold.is_finite() || !(0.0..=1.0).contains(&threshold) {
                    return Err(ConfigError::Invalid {
                        var: "SSO_NONE_THRESHOLD".into(),
                        message: "must be a finite number in [0, 1]".into(),
                    });
                }
                threshold
            },
            none_key: var("SSO_NONE_KEY").unwrap_or_else(|| defaults.none_key.clone()),
        })
    }
}

/// Extract the host of a plain `scheme://host[:port]/...` URL.
fn host_of(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority.rsplit('@').next()?;
    if let Some(inner) = authority.strip_prefix('[') {
        let end = inner.find(']')?;
        return Some(inner[..end].to_lowercase());
    }
    let host = authority.split(':').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

/// Reject any URL that is not loopback, RFC1918/ULA, or a bare LAN name.
///
/// This is the §7 guarantee expressed as code: a public DNS name such as
/// `api.typesafe.ai` cannot be configured, so no cloud path exists even by
/// misconfiguration.
///
/// ```
/// use system_one_facade::config::assert_lan;
/// assert!(assert_lan("X", "http://127.0.0.1:8098").is_ok());
/// assert!(assert_lan("X", "http://systemone:8097/v1").is_ok());
/// assert!(assert_lan("X", "https://api.typesafe.ai/v1/systemone").is_err());
/// ```
pub fn assert_lan(var_name: &str, url: &str) -> Result<(), ConfigError> {
    let host = host_of(url).ok_or_else(|| ConfigError::Invalid {
        var: var_name.into(),
        message: format!("`{url}` is not a URL"),
    })?;
    let non_lan = || ConfigError::NonLan {
        var: var_name.into(),
        host: host.clone(),
    };

    if let Ok(ip) = host.parse::<IpAddr>() {
        let ok = match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || (v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]))
            }
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    || (v6.segments()[0] & 0xfe00) == 0xfc00
                    || (v6.segments()[0] & 0xffc0) == 0xfe80
            }
        };
        return if ok { Ok(()) } else { Err(non_lan()) };
    }

    // Names: a bare label (docker service, container hostname) or an explicitly
    // local suffix. Anything publicly resolvable is refused.
    const LOCAL_SUFFIXES: [&str; 5] = [".local", ".lan", ".internal", ".localdomain", ".home.arpa"];
    if host == "localhost"
        || !host.contains('.')
        || LOCAL_SUFFIXES.iter().any(|s| host.ends_with(s))
    {
        Ok(())
    } else {
        Err(non_lan())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_guard_admits_the_estate_and_refuses_the_cloud() {
        for ok in [
            "http://127.0.0.1:8098",
            "http://localhost:8098/predict",
            "http://systemone:8097/v1/systemone",
            "http://192.168.2.132:9997/v1/embeddings",
            "http://10.10.10.1:8085/v1",
            "http://[::1]:8098",
            "http://loom.local:8080",
        ] {
            assert!(assert_lan("X", ok).is_ok(), "expected LAN: {ok}");
        }
        for bad in [
            "https://api.typesafe.ai/v1/systemone",
            "https://api.openai.com/v1/embeddings",
            "http://8.8.8.8:80",
            "http://evil.example.com",
        ] {
            assert!(assert_lan("X", bad).is_err(), "expected refusal: {bad}");
        }
    }

    #[test]
    fn host_parsing_handles_credentials_and_ipv6() {
        assert_eq!(
            host_of("http://u:p@10.0.0.4:9000/x").as_deref(),
            Some("10.0.0.4")
        );
        assert_eq!(
            host_of("http://[fd00::1]:8098/x").as_deref(),
            Some("fd00::1")
        );
        assert_eq!(host_of("nonsense").as_deref(), None);
    }
}
