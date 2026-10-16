//! Estate configuration for the dream engine.
//!
//! The repository document (`dream.config.json`) is parsed and validated by
//! `dream_gate::config`; this module adds what only this estate decides: the
//! defaults the gate deliberately leaves empty ([`load_dream_config`]), the
//! `[dream_machine]` runtime settings with their `${NAME}` placeholder
//! expansion, nominated-repo discovery and the nightly slot rotation.

use serde::Deserialize;
use std::path::{Path, PathBuf};

use dream_gate::config::AdrConvention;
pub use dream_gate::config::{ConfigError, DreamConfig, Slot};

/// Ledger path used when a repo's config names none. `dream-gate` has no
/// default of its own and protects only a non-empty path, so the same value is
/// passed to `ProtectedPolicy::for_manifest` as the fallback.
pub const DEFAULT_LEDGER_PATH: &str = "docs/dream-cycle/LEDGER.md";

/// Branch namespace used when a repo's config names none.
pub const DEFAULT_BRANCH_PREFIX: &str = "dream/";

/// Apply this estate's defaults to a parsed config: ledger path, branch
/// prefix and a four-digit ADR convention. Nothing else is touched, so the
/// config digest (taken over the raw bytes) is unaffected.
pub fn apply_estate_defaults(cfg: &mut DreamConfig) {
    if cfg.ledger_path.trim().is_empty() {
        cfg.ledger_path = DEFAULT_LEDGER_PATH.into();
    }
    if cfg.branch_prefix.trim().is_empty() {
        cfg.branch_prefix = DEFAULT_BRANCH_PREFIX.into();
    }
    if cfg.adr_convention.is_unset() {
        cfg.adr_convention = AdrConvention::FourDigit;
    }
}

/// Read, validate and default a repo's `dream.config.json`, returning the
/// parsed document **and the exact bytes it was parsed from**. The bytes are
/// what the experiment manifest digests and what the protected-path policy is
/// built from, so one read feeds all three.
pub fn load_dream_config(path: &Path) -> Result<(DreamConfig, Vec<u8>), ConfigError> {
    let bytes = std::fs::read(path)?;
    let mut cfg = DreamConfig::from_json(&bytes)?;
    apply_estate_defaults(&mut cfg);
    Ok((cfg, bytes))
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_hp_host")]
    pub hp_host: String,
    #[serde(default = "default_hp_annexe_dir")]
    pub hp_annexe_dir: String,
    #[serde(default = "default_loom_url")]
    pub loom_url: String,
    #[serde(default = "default_loom_model")]
    pub loom_model: String,
    #[serde(default = "default_max_tokens")]
    pub loom_max_tokens: u32,
    #[serde(default = "default_zai_url")]
    pub zai_url: String,
    #[serde(default = "default_zai_model")]
    pub zai_model: String,
    #[serde(default = "default_max_tokens")]
    pub zai_max_tokens: u32,
    #[serde(default = "default_provider")]
    pub llm_provider: String,
    #[serde(default = "default_memory_namespace")]
    pub memory_namespace: String,
    #[serde(default = "default_window_start")]
    pub window_start: u8,
    #[serde(default = "default_window_end")]
    pub window_end: u8,
    /// Hard cap on repos dreamed per night (serial cycles).
    #[serde(default = "default_max_repos")]
    pub max_repos_per_night: usize,
    /// A repo whose last N ledger rows are ALL INCONCLUSIVE goes to standby
    /// (skipped in nightly all-repos mode). Decisive verdicts reset the streak.
    #[serde(default = "default_prune_streak")]
    pub prune_dry_streak: usize,
    /// On an ACCEPT night, push the candidate as a `dream/*` branch + DRAFT PR
    /// (ADR-061) so the win becomes a reviewable artifact instead of an
    /// evaporating report. Draft only — the merge stays human.
    #[serde(default = "default_true")]
    pub persist_accepts: bool,
}

fn default_true() -> bool {
    true
}
fn default_hp_host() -> String {
    std::env::var("CONNECTED_NODE_SSH").unwrap_or_default()
}
fn default_hp_annexe_dir() -> String {
    "/srv/dream-annexe".into()
}
/// Resolve a manifest value that may be an unexpanded `${NAME}` environment
/// placeholder.
///
/// `agentbox.toml` carries placeholders instead of estate addresses, because
/// the repository is public, and nothing expands them before they reach here.
/// Left alone the literal gets used where a URL or a hostname belongs, and the
/// perfectly good default sitting beside it never fires — which is how
/// `LOOM_URL=${LOOM_BASE_URL}` reached a running dream engine.
///
///   not a placeholder     the value, trimmed
///   `${NAME}`, NAME set   whatever the environment says
///   `${NAME}`, NAME unset `None` — absent, so the caller's default applies
pub fn resolve_env_placeholder(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let Some(name) = trimmed.strip_prefix("${").and_then(|r| r.strip_suffix('}')) else {
        return (!trimmed.is_empty()).then(|| trimmed.to_owned());
    };
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

impl RuntimeConfig {
    /// Expand the `${NAME}` placeholders the manifest carried, falling back to
    /// this struct's own defaults wherever the variable is unset. Call once,
    /// straight after deserialising, so no consumer has to remember.
    pub fn resolve_placeholders(&mut self) {
        self.hp_host = resolve_env_placeholder(&self.hp_host).unwrap_or_else(default_hp_host);
        self.loom_url = resolve_env_placeholder(&self.loom_url).unwrap_or_else(default_loom_url);
        self.zai_url = resolve_env_placeholder(&self.zai_url).unwrap_or_else(default_zai_url);
        // hp_annexe_dir is a COMPOSITE value ("${CONNECTED_NODE_HOME}/dream-annexe"),
        // so it takes the infix expander; unresolved it reached a live ssh
        // command verbatim (2026-09-17: the literal `${CONNECTED_NODE_HOME}`
        // was the remote mkdir target of the failed campaignbuilder night).
        self.hp_annexe_dir = resolve_env_placeholders_infix(&self.hp_annexe_dir)
            .unwrap_or_else(default_hp_annexe_dir);
    }
}

/// Expand every embedded `${NAME}` in a composite value ("${HOME}/dream-annexe").
///
/// `resolve_env_placeholder` handles values that ARE a placeholder; this
/// handles values that CONTAIN one. Any referenced variable unset or empty
/// poisons the whole value to `None` — a half-expanded path is worse than the
/// caller's default.
pub fn resolve_env_placeholders_infix(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(trimmed.len());
    let mut rest = trimmed;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after.find('}')?; // unterminated placeholder → poison
        let name = &after[..end];
        match std::env::var(name).ok().map(|v| v.trim().to_owned()) {
            Some(v) if !v.is_empty() => out.push_str(&v),
            _ => return None,
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

fn default_loom_url() -> String {
    "http://loom:8080/v1".into()
}
fn default_loom_model() -> String {
    "qwen3.8-27B".into()
}
fn default_max_tokens() -> u32 {
    16384
}
fn default_zai_url() -> String {
    "https://api.z.ai/api/anthropic".into()
}
fn default_zai_model() -> String {
    "glm-5.3".into()
}
fn default_provider() -> String {
    "zai".into()
}
fn default_memory_namespace() -> String {
    "dream-cycle".into()
}
fn default_window_start() -> u8 {
    1
}
fn default_window_end() -> u8 {
    5
}
fn default_max_repos() -> usize {
    5
}
fn default_prune_streak() -> usize {
    5
}

/// Nominated repos that point at the same remote repository (`repo` in their
/// dream.config.json): `(slug, [dir names])` for every slug named by two or
/// more. Two checkouts of one repository each take a nightly slot, dream the
/// same code, and push same-named branches, so the second PR is lost
/// (project2 and dreamlab-ai-website, 2026-10-11).
pub fn shared_remotes(repos: &[(String, PathBuf)]) -> Vec<(String, Vec<String>)> {
    let mut by_slug: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for (name, path) in repos {
        if let Ok(cfg) = DreamConfig::load(&path.join("dream.config.json")) {
            if !cfg.repo.is_empty() {
                by_slug
                    .entry(cfg.repo.clone())
                    .or_default()
                    .push(name.clone());
            }
        }
    }
    by_slug.into_iter().filter(|(_, v)| v.len() > 1).collect()
}

/// Discover nominated repos — directories under workspace containing dream.config.json.
pub fn discover_repos(workspace: &Path) -> Vec<(String, PathBuf)> {
    let mut repos = Vec::new();
    let Ok(entries) = std::fs::read_dir(workspace) else {
        return repos;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("dream.config.json").exists() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                repos.push((name.to_string(), path));
            }
        }
    }
    repos.sort_by(|a, b| a.0.cmp(&b.0));
    repos
}

/// Select tonight's slot by day-of-year modulo slot count.
pub fn tonight_slot(cfg: &DreamConfig, day_int: u32) -> &Slot {
    let idx = (day_int as usize) % cfg.slots.len();
    &cfg.slots[idx]
}

/// Check bonus dives for tonight.
pub fn bonus_dives(cfg: &DreamConfig, day_int: u32) -> Vec<String> {
    cfg.bonus_moduli
        .iter()
        .filter_map(|(modulus_str, dive)| {
            let modulus: u32 = modulus_str.parse().ok()?;
            if modulus > 0 && day_int.is_multiple_of(modulus) {
                Some(dive.clone())
            } else {
                None
            }
        })
        .collect()
}
#[cfg(test)]
mod tests {

    #[test]
    fn shared_remotes_flags_two_checkouts_of_one_repo() {
        let d = tempfile::tempdir().unwrap();
        let mk = |name: &str, slug: &str| {
            let p = d.path().join(name);
            std::fs::create_dir_all(&p).unwrap();
            std::fs::write(
                p.join("dream.config.json"),
                format!(r#"{{"repo":"{slug}","slots":[{{"deep":"d","scan":[]}}]}}"#),
            )
            .unwrap();
            (name.to_string(), p)
        };
        let repos = vec![
            mk("site", "o/site"),
            mk("project2", "o/site"),
            mk("other", "o/other"),
        ];
        let shared = shared_remotes(&repos);
        assert_eq!(
            shared,
            vec![(
                "o/site".to_string(),
                vec!["site".to_string(), "project2".to_string()]
            )]
        );
        assert!(shared_remotes(&repos[1..]).is_empty());
    }

    mod placeholders {
        use super::super::*;
        use std::sync::Mutex;

        /// `resolve_env_placeholder` reads process-global env, so these must
        /// not run alongside each other.
        static ENV_LOCK: Mutex<()> = Mutex::new(());

        fn with_var<T>(key: &str, value: Option<&str>, f: impl FnOnce() -> T) -> T {
            let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            unsafe {
                match value {
                    Some(v) => std::env::set_var(key, v),
                    None => std::env::remove_var(key),
                }
            }
            let out = f();
            unsafe { std::env::remove_var(key) };
            out
        }

        #[test]
        fn a_plain_value_passes_through() {
            assert_eq!(
                resolve_env_placeholder("http://loom:8080/v1"),
                Some("http://loom:8080/v1".to_owned())
            );
        }

        #[test]
        fn a_placeholder_resolves_from_the_environment() {
            let got = with_var("DREAM_TEST_BASE", Some("http://facade:8084/v1"), || {
                resolve_env_placeholder("${DREAM_TEST_BASE}")
            });
            assert_eq!(got, Some("http://facade:8084/v1".to_owned()));
        }

        #[test]
        fn an_unset_placeholder_is_absent_not_a_literal() {
            // The whole point: absent means the caller's default applies. A
            // literal "${DREAM_TEST_MISSING}" would be used as a URL.
            let got = with_var("DREAM_TEST_MISSING", None, || {
                resolve_env_placeholder("${DREAM_TEST_MISSING}")
            });
            assert_eq!(got, None);
        }

        #[test]
        fn an_empty_variable_counts_as_unset() {
            let got = with_var("DREAM_TEST_EMPTY", Some("   "), || {
                resolve_env_placeholder("${DREAM_TEST_EMPTY}")
            });
            assert_eq!(got, None);
        }

        #[test]
        fn a_placeholder_in_the_middle_is_left_alone() {
            // Only a value that is ENTIRELY a placeholder is one; a path that
            // happens to contain braces is a path.
            assert_eq!(
                resolve_env_placeholder("http://h/${x}/p"),
                Some("http://h/${x}/p".to_owned())
            );
        }

        #[test]
        fn an_infix_placeholder_expands_inside_a_composite_value() {
            let got = with_var("DREAM_TEST_NODE_HOME", Some("/home/john"), || {
                resolve_env_placeholders_infix("${DREAM_TEST_NODE_HOME}/dream-annexe")
            });
            assert_eq!(got, Some("/home/john/dream-annexe".to_owned()));
        }

        #[test]
        fn an_unset_infix_placeholder_poisons_the_whole_value() {
            // Half a path is worse than no path: the caller's default must
            // apply, not "/dream-annexe" or a literal "${…}/dream-annexe".
            let got = with_var("DREAM_TEST_NODE_HOME", None, || {
                resolve_env_placeholders_infix("${DREAM_TEST_NODE_HOME}/dream-annexe")
            });
            assert_eq!(got, None);
        }

        #[test]
        fn the_annexe_dir_literal_no_longer_reaches_a_live_ssh_command() {
            // The 2026-09-17 regression: hp_annexe_dir was never resolved and
            // the literal `${CONNECTED_NODE_HOME}/dream-annexe` became the
            // remote night-dir of a dispatched cycle.
            let mut rt: RuntimeConfig = toml::Table::new().try_into().unwrap();
            rt.hp_annexe_dir = "${DREAM_TEST_NODE_HOME}/dream-annexe".to_owned();
            let resolved = with_var("DREAM_TEST_NODE_HOME", Some("/home/john"), || {
                let mut rt = rt.clone();
                rt.resolve_placeholders();
                rt.hp_annexe_dir
            });
            assert_eq!(resolved, "/home/john/dream-annexe");

            let fallback = with_var("DREAM_TEST_NODE_HOME", None, || {
                let mut rt = rt.clone();
                rt.resolve_placeholders();
                rt.hp_annexe_dir
            });
            assert_eq!(fallback, default_hp_annexe_dir());
        }

        #[test]
        fn the_manifest_placeholder_no_longer_reaches_the_loom_client() {
            // The exact regression: agentbox.toml ships loom_url as a
            // placeholder, and the running engine was given it verbatim.
            let mut rt: RuntimeConfig = toml::Table::new().try_into().unwrap();
            rt.loom_url = "${DREAM_TEST_LOOM}".to_owned();
            let resolved = with_var("DREAM_TEST_LOOM", Some("http://facade:8084/v1"), || {
                let mut rt = rt.clone();
                rt.resolve_placeholders();
                rt.loom_url
            });
            assert_eq!(resolved, "http://facade:8084/v1");
        }

        #[test]
        fn an_unresolvable_manifest_placeholder_falls_back_to_the_default() {
            let mut rt: RuntimeConfig = toml::Table::new().try_into().unwrap();
            rt.loom_url = "${DREAM_TEST_ABSENT}".to_owned();
            with_var("DREAM_TEST_ABSENT", None, || rt.resolve_placeholders());
            assert_eq!(rt.loom_url, default_loom_url());
            assert!(
                !rt.loom_url.contains("${"),
                "a placeholder survived into the config"
            );
        }
    }

    use super::*;

    fn cfg_of(slots: &str, extra: &str) -> DreamConfig {
        DreamConfig::from_json(
            format!(r#"{{"repo":"test/repo","slots":{slots}{extra}}}"#).as_bytes(),
        )
        .unwrap()
    }

    #[test]
    fn slot_rotation() {
        let cfg = cfg_of(
            r#"[{"deep":"a","scan":[]},{"deep":"b","scan":[]},{"deep":"c","scan":[]}]"#,
            "",
        );
        assert_eq!(tonight_slot(&cfg, 20260815).deep, "a"); // 20260815 % 3 = 0
        assert_eq!(tonight_slot(&cfg, 20260816).deep, "b"); // 20260816 % 3 = 1
        assert_eq!(tonight_slot(&cfg, 20260817).deep, "c"); // 20260817 % 3 = 2
    }

    #[test]
    fn bonus_moduli() {
        let cfg = cfg_of(
            r#"[{"deep":"a","scan":[]}]"#,
            r#","bonusModuli":{"25":"ui-review","75":"self-hosting"}"#,
        );
        let day = 20260825; // % 25 = 0, % 75 = 25
        let bonuses = bonus_dives(&cfg, day);
        assert!(bonuses.contains(&"ui-review".to_string()));
        assert!(!bonuses.contains(&"self-hosting".to_string()));
    }

    /// `dream-gate` leaves ledger path, branch prefix and ADR convention empty;
    /// the estate fills them, and the ledger default is what the policy
    /// fallback protects.
    #[test]
    fn estate_defaults_fill_what_the_gate_leaves_empty() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("dream.config.json");
        std::fs::write(&p, br#"{"repo":"o/r","slots":[{"deep":"d","scan":[]}]}"#).unwrap();
        let (cfg, bytes) = load_dream_config(&p).unwrap();
        assert_eq!(cfg.ledger_path, "docs/dream-cycle/LEDGER.md");
        assert_eq!(cfg.branch_prefix, "dream/");
        assert_eq!(cfg.adr_convention.pad(), 4);
        assert_eq!(
            bytes,
            std::fs::read(&p).unwrap(),
            "the bytes are the file's"
        );

        std::fs::write(
            &p,
            br#"{"repo":"o/r","slots":[{"deep":"d","scan":[]}],
                "ledgerPath":"notes/L.md","branchPrefix":"night/","adrConvention":"3-digit"}"#,
        )
        .unwrap();
        let (cfg, _) = load_dream_config(&p).unwrap();
        assert_eq!(cfg.ledger_path, "notes/L.md");
        assert_eq!(cfg.branch_prefix, "night/");
        assert_eq!(cfg.adr_convention.pad(), 3);
    }

    /// A config the gate's stricter validation refuses is an error, not a
    /// silently loosened night.
    #[test]
    fn a_config_the_gate_rejects_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("dream.config.json");
        std::fs::write(
            &p,
            br#"{"repo":"not-a-slug","slots":[{"deep":"d","scan":[]}]}"#,
        )
        .unwrap();
        assert!(load_dream_config(&p).is_err());
        std::fs::write(&p, br#"{"repo":"o/r","slots":[]}"#).unwrap();
        assert!(load_dream_config(&p).is_err());
    }
}
