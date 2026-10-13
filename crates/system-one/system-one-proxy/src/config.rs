//! The projection file: the proxy's only configuration.
//!
//! `/run/agentbox/system-one.json` is written by `agentbox-manifest
//! system-one-project` at boot and rewritten in place (atomic rename) by
//! `./agentbox.sh systemone backend <name>`. The proxy reads it at start and
//! again whenever its mtime changes, keeping the last good copy when a reread
//! fails to parse — a half-written file must never take the judge down.
//!
//! `projected_local` is what the consumers were told at boot and is the anchor
//! of the ADR-2094 §5 rule enforced in [`crate::server`]: it is recorded in
//! the file, not in this process, so a proxy restart cannot re-baseline it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::error::ProxyError;

/// One declared backend.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Backend {
    /// Its `POST /v1/systemone`.
    pub url: String,
    /// Model id written into every forwarded request.
    pub model: String,
    /// NAME of the env var holding the key; empty = keyless.
    #[serde(default)]
    pub key_env: String,
    /// Declared locality (ADR-2094 §5).
    #[serde(default)]
    pub local: bool,
    /// Upstream deadline in milliseconds.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    /// Input price per million tokens.
    #[serde(default)]
    pub usd_per_mtok_in: f64,
}

fn default_timeout_ms() -> u64 {
    30_000
}

/// The projection file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Projection {
    /// Schema version (1).
    #[serde(default = "one")]
    pub version: u32,
    /// Mirrors the manifest gate; false means the proxy should not be running.
    #[serde(default)]
    pub enabled: bool,
    /// Listen address (loopback only).
    pub bind: String,
    /// JSONL request log; empty disables.
    #[serde(default)]
    pub log: String,
    /// Name of the active backend.
    pub active: String,
    /// What the consumers were told at boot; `None` = not projected.
    #[serde(default)]
    pub projected_local: Option<bool>,
    /// When the consumers were projected.
    #[serde(default)]
    pub projected_at: Option<String>,
    /// Every declared backend.
    pub backends: BTreeMap<String, Backend>,
}

fn one() -> u32 {
    1
}

impl Projection {
    /// Parse and validate one file's text.
    pub fn parse(text: &str) -> Result<Projection, ProxyError> {
        let p: Projection = serde_json::from_str(text)
            .map_err(|e| ProxyError::Config(format!("projection is not valid JSON: {e}")))?;
        p.validate()?;
        Ok(p)
    }

    /// The invariants the proxy refuses to run without.
    pub fn validate(&self) -> Result<(), ProxyError> {
        if self.version != 1 {
            return Err(ProxyError::Config(format!(
                "projection version {} is not 1",
                self.version
            )));
        }
        if !self.enabled {
            return Err(ProxyError::Config("projection says enabled=false".into()));
        }
        if !is_loopback_bind(&self.bind) {
            return Err(ProxyError::Config(format!(
                "bind {} is not loopback",
                self.bind
            )));
        }
        if !self.backends.contains_key(&self.active) {
            return Err(ProxyError::Config(format!(
                "active backend {:?} is not declared (have: {})",
                self.active,
                self.backends.keys().cloned().collect::<Vec<_>>().join(", ")
            )));
        }
        for (name, b) in &self.backends {
            if b.url.is_empty() || b.model.is_empty() {
                return Err(ProxyError::Config(format!(
                    "backend {name} needs url and model"
                )));
            }
        }
        Ok(())
    }

    /// The active backend.
    #[must_use]
    pub fn selected(&self) -> &Backend {
        &self.backends[&self.active]
    }
}

/// Loopback host check for `bind`.
#[must_use]
pub fn is_loopback_bind(bind: &str) -> bool {
    let host = if let Some(end) = bind.find(']') {
        bind.get(1..end).unwrap_or("")
    } else {
        bind.rsplit_once(':').map_or(bind, |(h, _)| h)
    };
    let host = host.to_ascii_lowercase();
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

/// The host of an `http(s)://` URL under a STRICT grammar, or `None`.
///
/// Only `scheme://host[:port][/…]` is accepted, where `host` is a DNS name
/// (`[A-Za-z0-9.-]`), a dotted-decimal IPv4 literal with four plain decimal
/// octets, or a bracketed IPv6 literal. Userinfo (`@`), backslashes, octal or
/// hex octets, short IPv4 forms and dotless decimal IPs are REFUSED rather
/// than interpreted, because WHATWG parsers (reqwest's `url`, browsers) read
/// those differently from a naive split: `https://evil.com\@api.subq.ai/`
/// connects to evil.com. Refusing the grammar keeps "the host we checked" and
/// "the host that is dialled" the same string. IPv6 hosts are returned WITH
/// their brackets so a hostname such as `fcbook.com` can never be mistaken
/// for a ULA prefix.
pub fn strict_host(url: &str) -> Option<(&str, String)> {
    let (scheme, rest) = url.split_once("://")?;
    if !matches!(scheme, "http" | "https") {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') || authority.contains('\\') {
        return None;
    }
    let host = if let Some(inner) = authority.strip_prefix('[') {
        let end = inner.find(']')?;
        let (h, after) = (&inner[..end], &inner[end + 1..]);
        if h.is_empty()
            || !h.chars().all(|c| c.is_ascii_hexdigit() || c == ':')
            || !valid_port(after)
        {
            return None;
        }
        format!("[{h}]")
    } else {
        let (h, after) = match authority.find(':') {
            Some(i) => (&authority[..i], &authority[i..]),
            None => (authority, ""),
        };
        if h.is_empty()
            || !valid_port(after)
            || !h
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        {
            return None;
        }
        let labels: Vec<&str> = h.split('.').collect();
        if labels.iter().any(|l| l.is_empty()) {
            return None;
        }
        // Anything a WHATWG parser would read as a NUMBER is only accepted in
        // the one unambiguous spelling: four decimal octets without leading zeros.
        let numeric = labels.last().is_some_and(|l| {
            l.chars().all(|c| c.is_ascii_digit()) || l.starts_with("0x") || l.starts_with("0X")
        });
        if numeric
            && !(labels.len() == 4
                && labels
                    .iter()
                    .all(|l| l.parse::<u8>().is_ok() && (l == &"0" || !l.starts_with('0'))))
        {
            return None;
        }
        h.to_string()
    };
    Some((scheme, host.to_ascii_lowercase()))
}

/// `""` or `:<decimal port>`.
fn valid_port(after_host: &str) -> bool {
    match after_host.strip_prefix(':') {
        None => after_host.is_empty(),
        Some(p) => {
            !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) && p.parse::<u16>().is_ok()
        }
    }
}

/// Loopback, RFC1918/CGNAT/link-local, `.local`/`.internal`, or a dotless
/// name (a Docker service such as `systemone`). Everything else, and every
/// URL [`strict_host`] refuses, is off-LAN.
pub fn is_local_endpoint(endpoint: &str) -> bool {
    let Some((_, host)) = strict_host(endpoint) else {
        return false;
    };
    if host == "localhost" || host == "[::1]" || host.starts_with("127.") {
        return true;
    }
    if let Some(v6) = host.strip_prefix('[') {
        let v6 = v6.trim_end_matches(']');
        let first = v6.split(':').next().unwrap_or("");
        // ULA fc00::/7 and link-local fe80::/10, by the first hextet only.
        return first.len() == 4
            && (first.starts_with("fc")
                || first.starts_with("fd")
                || first.starts_with("fe8")
                || first.starts_with("fe9")
                || first.starts_with("fea")
                || first.starts_with("feb"));
    }
    if host.ends_with(".local") || host.ends_with(".internal") {
        return true;
    }
    let octets: Vec<&str> = host.split('.').collect();
    if octets.len() == 4 && octets.iter().all(|o| o.parse::<u8>().is_ok()) {
        let a: u8 = octets[0].parse().expect("checked");
        let b: u8 = octets[1].parse().expect("checked");
        return match a {
            10 => true,
            192 => b == 168,
            172 => (16..=31).contains(&b),
            100 => (64..=127).contains(&b), // CGNAT
            169 => b == 254,                // link-local
            _ => false,
        };
    }
    // A dotless NAME; strict_host already refused dotless numbers.
    !host.contains('.')
}

/// The projection as the proxy sees it: reloaded on mtime change, last good
/// copy kept when a reread fails.
pub struct Watched {
    path: PathBuf,
    inner: Mutex<(Projection, Option<SystemTime>, bool)>,
}

impl Watched {
    /// Load the file once; a missing or invalid file refuses to start.
    pub fn load(path: &Path) -> Result<Watched, ProxyError> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| ProxyError::Config(format!("cannot read {}: {e}", path.display())))?;
        let p = Projection::parse(&text)?;
        let mtime = std::fs::metadata(path).ok().and_then(|m| m.modified().ok());
        Ok(Watched {
            path: path.to_path_buf(),
            inner: Mutex::new((p, mtime, false)),
        })
    }

    /// The path being watched.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The current projection, rereading the file if its mtime moved.
    pub fn current(&self) -> Projection {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mtime = std::fs::metadata(&self.path)
            .ok()
            .and_then(|m| m.modified().ok());
        if mtime != guard.1 {
            match std::fs::read_to_string(&self.path)
                .map_err(|e| e.to_string())
                .and_then(|t| Projection::parse(&t).map_err(|e| e.to_string()))
            {
                Ok(p) => {
                    tracing::info!(active = %p.active, projected_local = ?p.projected_local, "projection reloaded");
                    *guard = (p, mtime, false);
                }
                Err(e) => {
                    if !guard.2 {
                        tracing::warn!(error = %e, "projection reread failed; keeping the last good copy");
                        guard.2 = true;
                    }
                    // Do not retry on every request while the file stays broken.
                    guard.1 = mtime;
                }
            }
        }
        guard.0.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_host_refuses_whatwg_ambiguities() {
        // userinfo / backslash tricks: a naive split sees api.subq.ai, reqwest dials evil.com
        assert_eq!(strict_host(r"https://evil.com\@api.subq.ai/v1"), None);
        assert_eq!(strict_host("https://api.subq.ai@evil.com/v1"), None);
        assert_eq!(strict_host(r"http://api.subq.ai\@10.0.0.1/"), None);
        // numeric spellings WHATWG reads as IPv4
        assert_eq!(strict_host("http://134744072/"), None);
        assert_eq!(strict_host("http://0x08080808/"), None);
        assert_eq!(strict_host("http://8.8.8/"), None);
        assert_eq!(strict_host("http://010.0.0.1/"), None);
        assert_eq!(strict_host("http://0x8.8.8.8/"), None);
        // ordinary forms
        assert_eq!(
            strict_host("https://api.subq.ai/v1/systemone"),
            Some(("https", "api.subq.ai".into()))
        );
        assert_eq!(
            strict_host("http://systemone:8097/v1"),
            Some(("http", "systemone".into()))
        );
        assert_eq!(
            strict_host("http://[::1]:8094/v1"),
            Some(("http", "[::1]".into()))
        );
        assert_eq!(
            strict_host("http://10.0.0.1:8080/"),
            Some(("http", "10.0.0.1".into()))
        );
        assert_eq!(strict_host("http://host:99999/"), None);
        assert_eq!(strict_host("ftp://x/"), None);
    }

    #[test]
    fn locality_is_not_fooled_by_names_or_numbers() {
        assert!(!is_local_endpoint("https://fcbook.com/"));
        assert!(!is_local_endpoint("https://fdic.gov/"));
        assert!(is_local_endpoint("http://[fd00::1]:8097/"));
        assert!(is_local_endpoint("http://[fe80::1]:8097/"));
        assert!(!is_local_endpoint("http://[2001:db8::1]:8097/"));
        assert!(!is_local_endpoint("http://134744072/"));
        assert!(!is_local_endpoint(r"http://api.subq.ai\@10.0.0.1/"));
        assert!(is_local_endpoint("http://systemone:8097/v1/systemone"));
        assert!(is_local_endpoint("http://192.168.2.132:9997/v1"));
        assert!(!is_local_endpoint("https://api.subq.ai/v1/systemone"));
    }

    pub(crate) fn sample() -> String {
        r#"{"version":1,"enabled":true,"bind":"127.0.0.1:0","log":"","active":"subq","projected_local":false,
        "backends":{"subq":{"url":"https://api.subq.ai/v1/systemone","model":"subq-snap-preview","key_env":"SUBQ_API_KEY","local":false},
                    "laya":{"url":"http://systemone:8097/v1/systemone","model":"laya","key_env":"","local":true,"timeout_ms":5000}}}"#
            .to_string()
    }

    #[test]
    fn parses_and_defaults() {
        let p = Projection::parse(&sample()).unwrap();
        assert_eq!(p.selected().timeout_ms, 30_000);
        assert_eq!(p.backends["laya"].timeout_ms, 5000);
        assert_eq!(p.projected_local, Some(false));
    }

    #[test]
    fn refuses_bad_files() {
        assert!(Projection::parse("{").is_err());
        assert!(Projection::parse(&sample().replace("\"subq\",", "\"nope\",")).is_err());
        assert!(Projection::parse(&sample().replace("127.0.0.1:0", "0.0.0.0:1")).is_err());
        assert!(
            Projection::parse(&sample().replace("\"enabled\":true", "\"enabled\":false")).is_err()
        );
    }

    #[test]
    fn locality_rules() {
        assert!(is_local_endpoint("http://systemone:8097/v1/systemone"));
        assert!(is_local_endpoint("http://127.0.0.1:8009/v1/systemone"));
        assert!(is_local_endpoint("http://192.168.2.132:9997/v1"));
        assert!(!is_local_endpoint("https://api.subq.ai/v1/systemone"));
        assert!(is_loopback_bind("127.0.0.1:8094"));
        assert!(is_loopback_bind("[::1]:8094"));
        assert!(!is_loopback_bind("0.0.0.0:8094"));
    }

    #[test]
    fn reload_follows_mtime_and_keeps_last_good() {
        let dir = std::env::temp_dir().join(format!("sop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("p.json");
        std::fs::write(&f, sample()).unwrap();
        let w = Watched::load(&f).unwrap();
        assert_eq!(w.current().active, "subq");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(
            &f,
            sample().replace("\"active\":\"subq\"", "\"active\":\"laya\""),
        )
        .unwrap();
        let later = SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options()
            .write(true)
            .open(&f)
            .unwrap()
            .set_modified(later)
            .unwrap();
        assert_eq!(w.current().active, "laya");
        std::fs::write(&f, "{ broken").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&f)
            .unwrap()
            .set_modified(later + std::time::Duration::from_secs(5))
            .unwrap();
        assert_eq!(w.current().active, "laya", "last good copy is kept");
        std::fs::remove_dir_all(&dir).ok();
    }
}
