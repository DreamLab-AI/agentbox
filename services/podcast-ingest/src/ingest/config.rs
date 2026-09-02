//! `podcasts.yaml` config loading — port of `ingest.py`'s `load_config`,
//! `_expand_paths`, and the `DEFAULT_*` module constants.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::OnceLock;

pub const DEFAULT_LOOM_URL: &str = "http://192.168.2.132:8084/v1";
pub const DEFAULT_LOOM_MODEL: &str = "qwen3.8-27b";
pub const DEFAULT_MAX_ASSERTIONS: usize = 15;
pub const DEFAULT_MIN_CONFIDENCE: f64 = 0.4;
pub const DEFAULT_MAX_EPISODES: usize = 15;
pub const DEFAULT_BACKLOG_BATCH: usize = 50;
const DEFAULT_LOOM_FALLBACK_URL: &str = "http://10.10.10.1:8084/v1";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Podcast {
    pub channel: String,
    pub name: String,
    #[serde(default)]
    pub focus: Option<String>,
    pub output_dir: String,
    #[serde(default)]
    pub ontology_dir: Option<String>,
    #[serde(default)]
    pub working_graph_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Settings {
    #[serde(default = "default_loom_url")]
    pub loom_url: String,
    #[serde(default = "default_loom_fallback_urls")]
    pub loom_fallback_urls: Vec<String>,
    #[serde(default = "default_loom_model")]
    pub loom_model: String,
    #[serde(default = "default_max_assertions")]
    pub max_assertions_per_episode: usize,
    #[serde(default = "default_min_confidence")]
    pub min_confidence: f64,
    #[serde(default)]
    pub quality_threshold: Option<f64>,
    #[serde(default = "default_max_episodes")]
    pub max_episodes_per_run: usize,
    #[serde(default = "default_backlog_batch")]
    pub backlog_batch_size: usize,
}

fn default_loom_url() -> String {
    DEFAULT_LOOM_URL.to_string()
}
fn default_loom_fallback_urls() -> Vec<String> {
    vec![DEFAULT_LOOM_FALLBACK_URL.to_string()]
}
fn default_loom_model() -> String {
    DEFAULT_LOOM_MODEL.to_string()
}
fn default_max_assertions() -> usize {
    DEFAULT_MAX_ASSERTIONS
}
fn default_min_confidence() -> f64 {
    DEFAULT_MIN_CONFIDENCE
}
fn default_max_episodes() -> usize {
    DEFAULT_MAX_EPISODES
}
fn default_backlog_batch() -> usize {
    DEFAULT_BACKLOG_BATCH
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            loom_url: default_loom_url(),
            loom_fallback_urls: default_loom_fallback_urls(),
            loom_model: default_loom_model(),
            max_assertions_per_episode: default_max_assertions(),
            min_confidence: default_min_confidence(),
            quality_threshold: None,
            max_episodes_per_run: default_max_episodes(),
            backlog_batch_size: default_backlog_batch(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Config {
    #[serde(default)]
    pub podcasts: Vec<Podcast>,
    #[serde(default)]
    pub settings: Settings,
}

fn re_var() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Python: re.compile(r'\$(\w+|\{[^}]*\})', re.ASCII)
    RE.get_or_init(|| Regex::new(r"\$([0-9A-Za-z_]+|\{[^}]*\})").unwrap())
}

/// Port of `posixpath.expandvars`: `$NAME` / `${NAME}` are substituted from
/// the process environment; a name with no environment entry is left
/// **unchanged** (literal `$NAME`/`${NAME}` text), matching Python's actual
/// runtime behaviour (not the `ingest.py` docstring's claim that an unset
/// variable "expands to nothing" — verified against CPython: `KeyError`
/// during substitution leaves the original text untouched and scanning
/// resumes after it).
pub fn expandvars(path: &str) -> String {
    if !path.contains('$') {
        return path.to_string();
    }
    let mut result = String::new();
    let mut last_end = 0;
    for caps in re_var().captures_iter(path) {
        let m = caps.get(0).unwrap();
        let name_raw = caps.get(1).unwrap().as_str();
        let name = if let Some(stripped) = name_raw.strip_prefix('{') {
            stripped.strip_suffix('}').unwrap_or(stripped)
        } else {
            name_raw
        };
        if let Ok(value) = std::env::var(name) {
            result.push_str(&path[last_end..m.start()]);
            result.push_str(&value);
            last_end = m.end();
        }
        // else: leave the literal `$NAME`/`${NAME}` text in place — do not
        // advance last_end, it is picked up by the final push below (or the
        // next matched substitution's leading slice).
    }
    result.push_str(&path[last_end..]);
    result
}

/// Python:
/// ```python
/// def _expand_paths(config: dict) -> dict:
///     for podcast in config.get("podcasts", []) or []:
///         for key in ("output_dir", "ontology_dir", "working_graph_dir"):
///             if podcast.get(key):
///                 podcast[key] = os.path.expandvars(str(podcast[key]))
///     return config
/// ```
fn expand_paths(mut config: Config) -> Config {
    for podcast in config.podcasts.iter_mut() {
        podcast.output_dir = expandvars(&podcast.output_dir);
        if let Some(v) = podcast.ontology_dir.take() {
            if !v.is_empty() {
                podcast.ontology_dir = Some(expandvars(&v));
            } else {
                podcast.ontology_dir = Some(v);
            }
        }
        if let Some(v) = podcast.working_graph_dir.take() {
            if !v.is_empty() {
                podcast.working_graph_dir = Some(expandvars(&v));
            } else {
                podcast.working_graph_dir = Some(v);
            }
        }
    }
    config
}

/// Default config for AI Daily Brief — matches `load_config`'s fallback
/// dict literal when `config_path` does not exist.
fn default_config(config_path: &Path) -> Config {
    let output_dir = config_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let ontology_dir = std::env::var("VAULT_PAGES").unwrap_or_default();
    Config {
        podcasts: vec![Podcast {
            channel: "@TheAIDailyBrief".to_string(),
            name: "AI Daily Brief".to_string(),
            focus: Some("AI industry news, policy, models, companies".to_string()),
            output_dir,
            ontology_dir: Some(ontology_dir),
            working_graph_dir: None,
        }],
        settings: Settings::default(),
    }
}

/// Python:
/// ```python
/// def load_config(config_path: Path) -> dict:
///     if config_path.exists():
///         return _expand_paths(yaml.safe_load(config_path.read_text()))
///     return { ... default AI Daily Brief config ... }
/// ```
pub fn load_config(config_path: &Path) -> anyhow::Result<Config> {
    if config_path.exists() {
        let text = std::fs::read_to_string(config_path)?;
        let config: Config = serde_yaml::from_str(&text)?;
        Ok(expand_paths(config))
    } else {
        Ok(default_config(config_path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expandvars_substitutes_known_var() {
        std::env::set_var("PCI_TEST_VAR_A", "vault-root");
        assert_eq!(expandvars("${PCI_TEST_VAR_A}/pages"), "vault-root/pages");
        std::env::remove_var("PCI_TEST_VAR_A");
    }

    #[test]
    fn expandvars_leaves_unset_var_literal() {
        std::env::remove_var("PCI_TEST_DEFINITELY_UNSET");
        assert_eq!(
            expandvars("${PCI_TEST_DEFINITELY_UNSET}/pages"),
            "${PCI_TEST_DEFINITELY_UNSET}/pages"
        );
    }

    #[test]
    fn expandvars_no_dollar_is_noop() {
        assert_eq!(expandvars("plain/path"), "plain/path");
    }

    #[test]
    fn parses_podcasts_yaml_shape() {
        let yaml = r#"
podcasts:
  - channel: "@TheAIDailyBrief"
    name: "AI Daily Brief"
    focus: "AI industry news"
    output_dir: "${VAULT_TRANSCRIPTS}"
    ontology_dir: "${VAULT_PAGES}"

settings:
  loom_url: "http://192.168.2.132:8084/v1"
  loom_fallback_urls: ["http://10.10.10.1:8084/v1"]
  loom_model: "qwen3.8-27b"
  max_assertions_per_episode: 15
  min_confidence: 0.4
  quality_threshold: 0.85
  max_episodes_per_run: 15
  backlog_batch_size: 50
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.podcasts.len(), 1);
        assert_eq!(config.settings.min_confidence, 0.4);
        assert_eq!(config.settings.backlog_batch_size, 50);
    }

    #[test]
    fn settings_defaults_apply_when_absent() {
        let yaml = "podcasts: []\n";
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.settings.loom_url, DEFAULT_LOOM_URL);
        assert_eq!(config.settings.max_episodes_per_run, DEFAULT_MAX_EPISODES);
    }
}
