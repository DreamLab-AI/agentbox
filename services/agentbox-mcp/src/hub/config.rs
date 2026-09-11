//! Hub configuration: the runtime JSON written at boot by
//! `agentbox-manifest mcp-hub-project`.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

pub const DEFAULT_BIND: &str = "127.0.0.1:9720";

/// One child stdio MCP server.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ServerSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct HubConfig {
    #[serde(default = "default_bind")]
    pub bind: String,
    #[serde(default)]
    pub servers: BTreeMap<String, ServerSpec>,
}

fn default_bind() -> String {
    DEFAULT_BIND.to_string()
}

impl HubConfig {
    pub fn parse(text: &str) -> anyhow::Result<Self> {
        let cfg: HubConfig = serde_json::from_str(text)?;
        for name in cfg.servers.keys() {
            if !is_valid_name(name) {
                anyhow::bail!("server name {name:?} is not a URL-safe identifier");
            }
        }
        for (name, spec) in &cfg.servers {
            if spec.command.trim().is_empty() {
                anyhow::bail!("server {name:?} has an empty command");
            }
        }
        Ok(cfg)
    }

    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
        Self::parse(&text).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))
    }
}

/// Names become path segments; keep them to the registry's own alphabet.
pub fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.'
        })
}

/// `host:port` where host is a loopback address or `localhost`.
pub fn is_loopback_bind(bind: &str) -> bool {
    let host = match bind.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty() => h,
        _ => return false,
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host == "localhost" {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_with_defaults() {
        let cfg = HubConfig::parse(r#"{"servers": {"perplexity": {"command": "node", "args": ["p.js"], "env": {"K": "v"}}}}"#).unwrap();
        assert_eq!(cfg.bind, DEFAULT_BIND);
        let s = &cfg.servers["perplexity"];
        assert_eq!(s.command, "node");
        assert_eq!(s.args, vec!["p.js"]);
        assert_eq!(s.env["K"], "v");
        assert_eq!(s.cwd, None);
        assert!(HubConfig::parse("{}").unwrap().servers.is_empty());
    }

    #[test]
    fn rejects_bad_names_and_empty_commands() {
        assert!(HubConfig::parse(r#"{"servers": {"Bad Name": {"command": "x"}}}"#).is_err());
        assert!(HubConfig::parse(r#"{"servers": {"a/b": {"command": "x"}}}"#).is_err());
        assert!(HubConfig::parse(r#"{"servers": {"ok": {"command": " "}}}"#).is_err());
        assert!(is_valid_name("consultant-codex"));
        assert!(is_valid_name("web_researcher.v2"));
        assert!(!is_valid_name(""));
        assert!(!is_valid_name("../x"));
    }

    #[test]
    fn loopback_binds_only() {
        for ok in [
            "127.0.0.1:9720",
            "localhost:1",
            "[::1]:9720",
            "127.5.5.5:80",
        ] {
            assert!(is_loopback_bind(ok), "{ok}");
        }
        for bad in [
            "0.0.0.0:9720",
            "the model host:9720",
            "[::]:9720",
            "127.0.0.1",
            "127.0.0.1:x",
            "",
        ] {
            assert!(!is_loopback_bind(bad), "{bad}");
        }
    }
}
