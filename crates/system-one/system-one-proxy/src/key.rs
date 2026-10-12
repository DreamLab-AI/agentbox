//! Where a vendor key may go.
//!
//! The projection file is operator-editable (and agents edit `agentbox.toml`),
//! so `url` and `key_env` cannot be trusted to agree. The pairing between a
//! key variable and the hosts it may be sent to is therefore hard-coded here,
//! the same way the jev-checkpoints plugin only ever sends `TYPESAFE_API_KEY`
//! to `*.typesafe.ai`. A new vendor is a one-line change in this file and a
//! review, never a manifest edit.

use crate::config::{is_local_endpoint, Backend};
use crate::error::ProxyError;

/// Hosts a key variable may be sent to: exact host or any subdomain of it.
const PAIRINGS: &[(&str, &[&str])] = &[
    ("TYPESAFE_API_KEY", &["typesafe.ai"]),
    ("SUBQ_API_KEY", &["subq.ai"]),
];

/// The host of an `https://` URL under the strict grammar of
/// [`crate::config::strict_host`]; `None` for http, userinfo, backslashes or
/// any numeric spelling a WHATWG parser would read differently.
fn https_host(url: &str) -> Option<String> {
    match crate::config::strict_host(url)? {
        ("https", host) => Some(host),
        _ => None,
    }
}

/// True when `key_env` is paired with the host of `url`.
#[must_use]
pub fn host_allowed(key_env: &str, url: &str) -> bool {
    let Some(host) = https_host(url) else {
        return false;
    };
    PAIRINGS.iter().any(|(env, hosts)| {
        *env == key_env
            && hosts
                .iter()
                .any(|h| host == *h || host.ends_with(&format!(".{h}")))
    })
}

/// Read a key: `<NAME>_FILE` (path, trimmed contents) first, then `<NAME>`.
pub fn read_key(key_env: &str) -> Result<String, ProxyError> {
    if let Ok(path) = std::env::var(format!("{key_env}_FILE")) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            let v = text.trim().to_string();
            if !v.is_empty() {
                return Ok(v);
            }
        }
    }
    match std::env::var(key_env) {
        Ok(v) if !v.trim().is_empty() => Ok(v.trim().to_string()),
        _ => Err(ProxyError::NoKey(key_env.to_string())),
    }
}

/// Decide the bearer token for one backend, or that none is sent.
///
/// * local backend: never a key, and its host must be LAN/loopback;
/// * cloud backend: a key is required, and only goes to its paired host.
pub fn credential(name: &str, b: &Backend) -> Result<Option<String>, ProxyError> {
    if b.local {
        if !is_local_endpoint(&b.url) {
            return Err(ProxyError::BackendNotLocal(name.to_string()));
        }
        return Ok(None);
    }
    if b.key_env.is_empty() {
        return Err(ProxyError::NoKey(format!("key_env for backend {name}")));
    }
    if !host_allowed(&b.key_env, &b.url) {
        return Err(ProxyError::KeyHostNotAllowed(
            b.key_env.clone(),
            https_host(&b.url).unwrap_or_else(|| b.url.clone()),
        ));
    }
    read_key(&b.key_env).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crafted_urls_never_pair_with_a_key() {
        assert!(!host_allowed(
            "SUBQ_API_KEY",
            r"https://evil.com\@api.subq.ai/v1/systemone"
        ));
        assert!(!host_allowed(
            "SUBQ_API_KEY",
            "https://api.subq.ai@evil.com/v1/systemone"
        ));
        assert!(!host_allowed(
            "SUBQ_API_KEY",
            "https://api.subq.ai.evil.com/v1/systemone"
        ));
        assert!(!host_allowed(
            "TYPESAFE_API_KEY",
            "https://api.subq.ai/v1/systemone"
        ));
        assert!(host_allowed(
            "SUBQ_API_KEY",
            "https://api.subq.ai/v1/systemone"
        ));
    }

    fn backend(url: &str, key_env: &str, local: bool) -> Backend {
        Backend {
            url: url.into(),
            model: "m".into(),
            key_env: key_env.into(),
            local,
            timeout_ms: 1000,
            usd_per_mtok_in: 0.0,
        }
    }

    #[test]
    fn pairings() {
        assert!(host_allowed(
            "SUBQ_API_KEY",
            "https://api.subq.ai/v1/systemone"
        ));
        assert!(host_allowed(
            "TYPESAFE_API_KEY",
            "https://api.typesafe.ai/v1/systemone"
        ));
        assert!(!host_allowed(
            "SUBQ_API_KEY",
            "https://api.typesafe.ai/v1/systemone"
        ));
        assert!(
            !host_allowed("SUBQ_API_KEY", "http://api.subq.ai/v1/systemone"),
            "https only"
        );
        assert!(
            !host_allowed("SUBQ_API_KEY", "https://evilsubq.ai/v1"),
            "suffix must be a label boundary"
        );
        assert!(!host_allowed("OTHER_KEY", "https://api.subq.ai/v1"));
    }

    #[test]
    fn local_backends_are_keyless_and_must_be_local() {
        assert_eq!(
            credential("laya", &backend("http://systemone:8097/v1", "", true)).unwrap(),
            None
        );
        assert!(matches!(
            credential("x", &backend("https://api.subq.ai/v1", "", true)),
            Err(ProxyError::BackendNotLocal(_))
        ));
    }

    #[test]
    fn cloud_backend_key_rules() {
        std::env::set_var("SOP_TEST_KEY_FILE", "/nonexistent/file");
        std::env::remove_var("SUBQ_API_KEY");
        assert!(matches!(
            credential(
                "subq",
                &backend("https://api.subq.ai/v1", "SUBQ_API_KEY", false)
            ),
            Err(ProxyError::NoKey(_))
        ));
        assert!(matches!(
            credential(
                "subq",
                &backend("https://api.evil.ai/v1", "SUBQ_API_KEY", false)
            ),
            Err(ProxyError::KeyHostNotAllowed(..))
        ));
        let dir = std::env::temp_dir().join(format!("sop-key-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("k");
        std::fs::write(&f, "from-file\n").unwrap();
        std::env::set_var("SUBQ_API_KEY_FILE", &f);
        std::env::set_var("SUBQ_API_KEY", "from-env");
        assert_eq!(read_key("SUBQ_API_KEY").unwrap(), "from-file", "_FILE wins");
        std::env::remove_var("SUBQ_API_KEY_FILE");
        assert_eq!(read_key("SUBQ_API_KEY").unwrap(), "from-env");
        std::env::remove_var("SUBQ_API_KEY");
        std::fs::remove_dir_all(&dir).ok();
    }
}
