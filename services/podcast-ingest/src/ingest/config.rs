//! `podcasts.yaml` config loading — port of `ingest.py`'s `load_config`,
//! `_expand_paths`, and the `DEFAULT_*` module constants.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::OnceLock;

pub const DEFAULT_LOOM_URL: &str = "http://loom:8080/v1";
pub const DEFAULT_LOOM_MODEL: &str = "qwen3.8-27b";
pub const DEFAULT_MAX_ASSERTIONS: usize = 15;
pub const DEFAULT_MIN_CONFIDENCE: f64 = 0.4;
pub const DEFAULT_MAX_EPISODES: usize = 15;
pub const DEFAULT_BACKLOG_BATCH: usize = 50;

/// One podcast channel and where its pages live.
///
/// The vault splits into a curated corpus and a working corpus (ADR-2107). This
/// pipeline only ever reads the first and writes the second:
///
/// - `pages_dir` is the curated topic-page directory (`$VAULT_PAGES`). It is
///   read-only here, used to resolve extracted topics to existing pages.
/// - `working_dir` is the working pages root (`$VAULT_WORKING_PAGES`). Evidence
///   ledgers land in `<working_dir>/podcast-evidence/` and proposed new pages
///   in `<working_dir>/`; nothing reaches the curated corpus except through
///   `vault propose`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Podcast {
    pub channel: String,
    pub name: String,
    #[serde(default)]
    pub focus: Option<String>,
    pub output_dir: String,
    /// Retired key. It named a directory this pipeline both read and wrote,
    /// which is how curated pages came to be written directly. Loading a
    /// config that still sets it is an error; see [`reject_retired_keys`].
    #[serde(default)]
    pub ontology_dir: Option<String>,
    /// Curated topic pages, read-only.
    #[serde(default)]
    pub pages_dir: Option<String>,
    /// Working pages root; every write goes under it.
    #[serde(default, alias = "working_graph_dir")]
    pub working_dir: Option<String>,
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
/// No fallback unless the config names one. The fallback used to be a rail
/// address baked into this source; an address belongs in the environment, not
/// in a published crate.
fn default_loom_fallback_urls() -> Vec<String> {
    Vec::new()
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
    let expand_opt = |v: Option<String>| v.map(|v| if v.is_empty() { v } else { expandvars(&v) });
    for podcast in config.podcasts.iter_mut() {
        podcast.output_dir = expandvars(&podcast.output_dir);
        podcast.ontology_dir = expand_opt(podcast.ontology_dir.take());
        podcast.pages_dir = expand_opt(podcast.pages_dir.take());
        podcast.working_dir = expand_opt(podcast.working_dir.take());
    }
    config
}

/// True when `value` still contains a `$NAME` / `${NAME}` reference, meaning
/// the variable was not set in the environment.
fn has_unexpanded_var(value: &str) -> bool {
    re_var().is_match(value)
}

/// Refuse the retired `ontology_dir` key rather than honour it silently.
fn reject_retired_keys(config: &Config) -> anyhow::Result<()> {
    for podcast in &config.podcasts {
        if podcast
            .ontology_dir
            .as_deref()
            .is_some_and(|v| !v.is_empty())
        {
            anyhow::bail!(
                "podcast {:?}: `ontology_dir` is retired. Set `pages_dir` (curated topic pages, \
                 read-only) and `working_dir` (working pages root; ledgers go to \
                 <working_dir>/podcast-evidence/). The old key let this pipeline write \
                 curated pages directly.",
                podcast.name
            );
        }
    }
    Ok(())
}

/// Expand environment references in the Loom settings.
///
/// An unset `loom_url` variable is an error, since extraction cannot run
/// without a façade. A fallback that names an unset variable is dropped:
/// no fallback configured is a normal state.
fn resolve_settings(settings: &mut Settings) -> anyhow::Result<()> {
    settings.loom_url = expandvars(&settings.loom_url);
    if has_unexpanded_var(&settings.loom_url) {
        anyhow::bail!(
            "settings.loom_url is {:?}: the environment variable it names is not set",
            settings.loom_url
        );
    }
    settings.loom_fallback_urls = settings
        .loom_fallback_urls
        .iter()
        .map(|u| expandvars(u))
        .filter(|u| !u.trim().is_empty() && !has_unexpanded_var(u))
        .collect();
    Ok(())
}

/// Default config for AI Daily Brief — matches `load_config`'s fallback
/// dict literal when `config_path` does not exist.
fn default_config(config_path: &Path) -> Config {
    let output_dir = config_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let pages_dir = std::env::var("VAULT_PAGES").unwrap_or_default();
    let working_dir = std::env::var("VAULT_WORKING_PAGES").unwrap_or_default();
    Config {
        podcasts: vec![Podcast {
            channel: "@AIDailyBrief".to_string(),
            name: "AI Daily Brief".to_string(),
            focus: Some("AI industry news, policy, models, companies".to_string()),
            output_dir,
            ontology_dir: None,
            pages_dir: Some(pages_dir),
            working_dir: Some(working_dir),
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
        let mut config = expand_paths(config);
        reject_retired_keys(&config)?;
        resolve_settings(&mut config.settings)?;
        Ok(config)
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
  - channel: "@AIDailyBrief"
    name: "AI Daily Brief"
    focus: "AI industry news"
    output_dir: "${VAULT_TRANSCRIPTS}"
    pages_dir: "${VAULT_PAGES}"
    working_dir: "${VAULT_WORKING_PAGES}"

settings:
  loom_url: "http://loom:8080/v1"
  loom_fallback_urls: []
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

    fn write_config(dir: &std::path::Path, body: &str) -> std::path::PathBuf {
        let path = dir.join("podcasts.yaml");
        std::fs::write(&path, body).unwrap();
        path
    }

    const MINIMAL: &str = r#"
podcasts:
  - channel: "@AIDailyBrief"
    name: "AI Daily Brief"
    output_dir: "${PCI_CFG_OUT}"
    pages_dir: "${PCI_CFG_PAGES}"
    working_dir: "${PCI_CFG_WORK}"
settings:
  loom_url: "${PCI_CFG_LOOM}"
  loom_fallback_urls: ["${PCI_CFG_FALLBACK}"]
"#;

    #[test]
    fn load_config_expands_paths_and_loom_settings() {
        std::env::set_var("PCI_CFG_OUT", "/v/transcripts");
        std::env::set_var("PCI_CFG_PAGES", "/v/knowledge");
        std::env::set_var("PCI_CFG_WORK", "/v/working");
        std::env::set_var("PCI_CFG_LOOM", "http://loom.test/v1");
        std::env::set_var("PCI_CFG_FALLBACK", "http://fallback.test/v1");
        let dir = tempfile::tempdir().unwrap();
        let config = load_config(&write_config(dir.path(), MINIMAL)).unwrap();
        let p = &config.podcasts[0];
        assert_eq!(p.output_dir, "/v/transcripts");
        assert_eq!(p.pages_dir.as_deref(), Some("/v/knowledge"));
        assert_eq!(p.working_dir.as_deref(), Some("/v/working"));
        assert_eq!(config.settings.loom_url, "http://loom.test/v1");
        assert_eq!(
            config.settings.loom_fallback_urls,
            vec!["http://fallback.test/v1".to_string()]
        );
    }

    #[test]
    fn unset_fallback_variable_means_no_fallback() {
        std::env::set_var("PCI_CFG2_OUT", "/v/t");
        std::env::set_var("PCI_CFG2_LOOM", "http://loom.test/v1");
        std::env::remove_var("PCI_CFG2_FALLBACK");
        let body = MINIMAL
            .replace("PCI_CFG_OUT", "PCI_CFG2_OUT")
            .replace("PCI_CFG_LOOM", "PCI_CFG2_LOOM")
            .replace("PCI_CFG_FALLBACK", "PCI_CFG2_FALLBACK");
        let dir = tempfile::tempdir().unwrap();
        let config = load_config(&write_config(dir.path(), &body)).unwrap();
        assert!(config.settings.loom_fallback_urls.is_empty());
    }

    #[test]
    fn unset_loom_url_variable_is_an_error_naming_the_problem() {
        std::env::set_var("PCI_CFG3_OUT", "/v/t");
        std::env::remove_var("PCI_CFG3_LOOM");
        let body = MINIMAL
            .replace("PCI_CFG_OUT", "PCI_CFG3_OUT")
            .replace("PCI_CFG_LOOM", "PCI_CFG3_LOOM");
        let dir = tempfile::tempdir().unwrap();
        let err = load_config(&write_config(dir.path(), &body)).unwrap_err();
        assert!(err.to_string().contains("loom_url"), "{err}");
    }

    #[test]
    fn retired_ontology_dir_key_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let body = r#"
podcasts:
  - channel: "@AIDailyBrief"
    name: "AI Daily Brief"
    output_dir: "/v/t"
    ontology_dir: "/v/knowledge"
"#;
        let err = load_config(&write_config(dir.path(), body)).unwrap_err();
        let text = err.to_string();
        assert!(text.contains("ontology_dir"), "{text}");
        assert!(text.contains("working_dir"), "{text}");
    }

    #[test]
    fn default_fallback_list_is_empty_and_carries_no_address() {
        assert!(Settings::default().loom_fallback_urls.is_empty());
    }

    #[test]
    fn working_graph_dir_is_still_read_as_working_dir() {
        let yaml =
            "podcasts:\n  - channel: x\n    name: n\n    output_dir: o\n    working_graph_dir: w\n";
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.podcasts[0].working_dir.as_deref(), Some("w"));
    }
}
