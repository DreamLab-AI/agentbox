use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("reading config: {0}")]
    Io(#[from] std::io::Error),
    #[error("parsing config: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("validation: {0}")]
    Validation(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Slot {
    pub deep: String,
    pub scan: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStep {
    pub cmd: String,
    #[serde(default)]
    pub degrade_on_wasm_failure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamConfig {
    pub repo: String,
    #[serde(default = "default_cron")]
    pub cron: String,
    pub slots: Vec<Slot>,
    #[serde(default)]
    pub bonus_moduli: HashMap<String, String>,
    #[serde(default)]
    pub control_plane_probes: Vec<String>,
    #[serde(default)]
    pub build_step: Option<BuildStep>,
    #[serde(default)]
    pub evaluator_entrypoints: HashMap<String, String>,
    #[serde(default)]
    pub competitors: Vec<String>,
    #[serde(default = "default_adr_convention")]
    pub adr_convention: String,
    #[serde(default)]
    pub extra_disciplines: Vec<String>,
    #[serde(default = "default_ledger_path")]
    pub ledger_path: String,
    #[serde(default = "default_branch_prefix")]
    pub branch_prefix: String,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub auto_merge: bool,
}

fn default_cron() -> String { "0 3 * * *".into() }
fn default_adr_convention() -> String { "4-digit".into() }
fn default_ledger_path() -> String { "docs/dream-cycle/LEDGER.md".into() }
fn default_branch_prefix() -> String { "dream/".into() }

impl DreamConfig {
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let text = std::fs::read_to_string(path)?;
        let cfg: Self = serde_json::from_str(&text)?;
        cfg.validate()?;
        Ok(cfg)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.repo.is_empty() {
            return Err(ConfigError::Validation("repo must not be empty".into()));
        }
        if self.slots.is_empty() {
            return Err(ConfigError::Validation("slots must not be empty".into()));
        }
        for (i, slot) in self.slots.iter().enumerate() {
            if slot.deep.is_empty() {
                return Err(ConfigError::Validation(
                    format!("slot[{}].deep must not be empty", i),
                ));
            }
        }
        Ok(())
    }
}

/// Runtime settings loaded from agentbox.toml [dream_machine].
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
}

fn default_true() -> bool { true }
fn default_hp_host() -> String { "john@10.10.10.1".into() }
fn default_hp_annexe_dir() -> String { "/home/john/dream-annexe".into() }
fn default_loom_url() -> String { "http://192.168.2.132:8084/v1".into() }
fn default_loom_model() -> String { "qwen3.8-27B".into() }
fn default_max_tokens() -> u32 { 16384 }
fn default_zai_url() -> String { "https://api.z.ai/api/anthropic".into() }
fn default_zai_model() -> String { "glm-5.3".into() }
fn default_provider() -> String { "zai".into() }
fn default_memory_namespace() -> String { "dream-cycle".into() }
fn default_window_start() -> u8 { 1 }
fn default_window_end() -> u8 { 5 }
fn default_max_repos() -> usize { 5 }
fn default_prune_streak() -> usize { 5 }

/// Discover nominated repos — directories under workspace containing dream.config.json.
pub fn discover_repos(workspace: &Path) -> Vec<(String, PathBuf)> {
    let mut repos = Vec::new();
    let Ok(entries) = std::fs::read_dir(workspace) else { return repos };
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
            if modulus > 0 && day_int % modulus == 0 {
                Some(dive.clone())
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_rotation() {
        let cfg = DreamConfig {
            repo: "test/repo".into(),
            cron: default_cron(),
            slots: vec![
                Slot { deep: "a".into(), scan: vec![] },
                Slot { deep: "b".into(), scan: vec![] },
                Slot { deep: "c".into(), scan: vec![] },
            ],
            bonus_moduli: HashMap::new(),
            control_plane_probes: vec![],
            build_step: None,
            evaluator_entrypoints: HashMap::new(),
            competitors: vec![],
            adr_convention: default_adr_convention(),
            extra_disciplines: vec![],
            ledger_path: default_ledger_path(),
            branch_prefix: default_branch_prefix(),
            labels: vec![],
            auto_merge: false,
        };
        assert_eq!(tonight_slot(&cfg, 20260815).deep, "a"); // 20260815 % 3 = 0
        assert_eq!(tonight_slot(&cfg, 20260816).deep, "b"); // 20260816 % 3 = 1
        assert_eq!(tonight_slot(&cfg, 20260817).deep, "c"); // 20260817 % 3 = 2
    }

    #[test]
    fn bonus_moduli() {
        let mut mods = HashMap::new();
        mods.insert("25".into(), "ui-review".into());
        mods.insert("75".into(), "self-hosting".into());
        let cfg = DreamConfig {
            repo: "test/repo".into(),
            cron: default_cron(),
            slots: vec![Slot { deep: "a".into(), scan: vec![] }],
            bonus_moduli: mods,
            control_plane_probes: vec![],
            build_step: None,
            evaluator_entrypoints: HashMap::new(),
            competitors: vec![],
            adr_convention: default_adr_convention(),
            extra_disciplines: vec![],
            ledger_path: default_ledger_path(),
            branch_prefix: default_branch_prefix(),
            labels: vec![],
            auto_merge: false,
        };
        let day = 20260825; // % 25 = 0, % 75 = 25
        let bonuses = bonus_dives(&cfg, day);
        assert!(bonuses.contains(&"ui-review".to_string()));
        assert!(!bonuses.contains(&"self-hosting".to_string()));
    }

    #[test]
    fn rejects_empty_slots() {
        let cfg = DreamConfig {
            repo: "test/repo".into(),
            cron: default_cron(),
            slots: vec![],
            bonus_moduli: HashMap::new(),
            control_plane_probes: vec![],
            build_step: None,
            evaluator_entrypoints: HashMap::new(),
            competitors: vec![],
            adr_convention: default_adr_convention(),
            extra_disciplines: vec![],
            ledger_path: default_ledger_path(),
            branch_prefix: default_branch_prefix(),
            labels: vec![],
            auto_merge: false,
        };
        assert!(cfg.validate().is_err());
    }
}
