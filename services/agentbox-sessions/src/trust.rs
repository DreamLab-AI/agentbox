//! Folder-trust seeding (ADR-2153 §5).
//!
//! A new session must not stop on a trust prompt nobody is watching. Which
//! config store a tool reads depends on the tool, so the launch contract names
//! them (`trust`) and this module writes each one:
//!
//! * `claude-root`: `~/.claude.json`.
//! * `claude-profile`: every wrapper profile's own
//!   `profiles/<slug>/.claude/.claude.json`, which is that profile's
//!   `CLAUDE_CONFIG_DIR` and the only store it reads. (`trust-seed.cjs` only
//!   ever wrote the root store, which left `zai` blocked.)
//! * `codex`: `$CODEX_HOME/config.toml` or `~/.codex/config.toml`.
//!
//! Idempotent, and it never removes or overwrites unrelated state.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub struct Roots {
    pub home: PathBuf,
    pub workspace: PathBuf,
    pub codex_home: Option<PathBuf>,
}

impl Roots {
    pub fn from_env() -> Self {
        let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into()));
        let workspace = std::env::var("WORKSPACE").map(PathBuf::from).unwrap_or_else(|_| home.join("workspace"));
        Self { home, workspace, codex_home: std::env::var("CODEX_HOME").ok().filter(|s| !s.is_empty()).map(PathBuf::from) }
    }
}

fn profile_stores(workspace: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(workspace.join("profiles")) else { return vec![] };
    let mut v: Vec<PathBuf> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path().join(".claude").join(".claude.json"))
        .filter(|p| p.exists())
        .collect();
    v.sort();
    v
}

/// Mark `dir` trusted in a Claude config store. Returns whether it changed.
fn seed_claude(store: &Path, dir: &Path, backup_dir: &Path) -> Result<bool> {
    let mut cfg: Value = match std::fs::read_to_string(store) {
        Ok(t) => serde_json::from_str(&t).with_context(|| format!("{} is not JSON", store.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(e.into()),
    };
    if !cfg.is_object() {
        cfg = json!({});
    }
    let key = dir.display().to_string();
    let projects = cfg.as_object_mut().unwrap().entry("projects").or_insert_with(|| json!({}));
    if !projects.is_object() {
        *projects = json!({});
    }
    let entry = projects.as_object_mut().unwrap().entry(key).or_insert_with(|| json!({}));
    if !entry.is_object() {
        *entry = json!({});
    }
    let e = entry.as_object_mut().unwrap();
    if e.get("hasTrustDialogAccepted") == Some(&json!(true)) && e.get("hasCompletedProjectOnboarding") == Some(&json!(true)) {
        return Ok(false);
    }
    e.insert("hasTrustDialogAccepted".into(), json!(true));
    e.insert("hasCompletedProjectOnboarding".into(), json!(true));
    if store.exists() {
        // The store can be a bind-mounted file, so it is written in place with a
        // backup of the previous content beside it, as trust-seed.cjs does.
        let _ = std::fs::create_dir_all(backup_dir);
        let tag = store.to_string_lossy().replace('/', "_");
        let _ = std::fs::copy(store, backup_dir.join(format!("{tag}.pre-session-plane")));
    } else if let Some(parent) = store.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(store, serde_json::to_string_pretty(&cfg)? + "\n").with_context(|| format!("write {}", store.display()))?;
    Ok(true)
}

/// Append a trusted project table to Codex's `config.toml` unless one exists.
/// Text append, not a parse and re-serialise, so comments and ordering survive.
fn seed_codex(config: &Path, dir: &Path) -> Result<bool> {
    let text = std::fs::read_to_string(config).unwrap_or_default();
    let quoted = dir.display().to_string().replace('\\', "\\\\").replace('"', "\\\"");
    let header = format!("[projects.\"{quoted}\"]");
    if text.contains(&header) {
        return Ok(false);
    }
    if let Some(parent) = config.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let sep = if text.is_empty() || text.ends_with("\n\n") { "" } else if text.ends_with('\n') { "\n" } else { "\n\n" };
    std::fs::write(config, format!("{text}{sep}{header}\ntrust_level = \"trusted\"\n"))?;
    Ok(true)
}

/// Seed every store named in `kinds` for `dir`. Returns one line per change and
/// one per failure; a store that cannot be written never stops the others.
pub fn seed(kinds: &[String], dir: &Path, roots: &Roots) -> Vec<String> {
    let mut log = Vec::new();
    let backup = roots.workspace.join(".agentbox");
    for kind in kinds {
        let result: Result<Vec<(PathBuf, bool)>> = (|| match kind.as_str() {
            "claude-root" => {
                let s = roots.home.join(".claude.json");
                Ok(vec![(s.clone(), seed_claude(&s, dir, &backup)?)])
            }
            "claude-profile" => profile_stores(&roots.workspace).into_iter().map(|s| Ok((s.clone(), seed_claude(&s, dir, &backup)?))).collect(),
            "codex" => {
                let c = roots.codex_home.clone().unwrap_or_else(|| roots.home.join(".codex")).join("config.toml");
                Ok(vec![(c.clone(), seed_codex(&c, dir)?)])
            }
            other => anyhow::bail!("unknown trust store kind {other:?}"),
        })();
        match result {
            Ok(changes) => log.extend(changes.into_iter().filter(|(_, changed)| *changed).map(|(p, _)| format!("trusted {} in {}", dir.display(), p.display()))),
            Err(e) => log.push(format!("trust {kind} failed: {e:#}")),
        }
    }
    log
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots(d: &Path) -> Roots {
        Roots { home: d.join("home"), workspace: d.join("ws"), codex_home: None }
    }

    #[test]
    fn claude_root_is_seeded_and_other_state_survives() {
        let d = tempfile::tempdir().unwrap();
        let r = roots(d.path());
        std::fs::create_dir_all(&r.home).unwrap();
        std::fs::write(r.home.join(".claude.json"), r#"{"theme":"dark","projects":{"/other":{"keep":1}}}"#).unwrap();
        let dir = Path::new("/home/devuser/workspace/wt/aoe-codex");
        let log = seed(&["claude-root".into()], dir, &r);
        assert_eq!(log.len(), 1, "{log:?}");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(r.home.join(".claude.json")).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["projects"]["/other"]["keep"], 1);
        assert_eq!(v["projects"][dir.to_str().unwrap()]["hasTrustDialogAccepted"], true);
        assert!(seed(&["claude-root".into()], dir, &r).is_empty(), "second run changes nothing");
    }

    /// The zai failure: its profile reads its own store, not the root one.
    #[test]
    fn every_profile_store_is_seeded_and_absent_ones_are_not_invented() {
        let d = tempfile::tempdir().unwrap();
        let r = roots(d.path());
        let zai = r.workspace.join("profiles/zai/.claude");
        std::fs::create_dir_all(&zai).unwrap();
        std::fs::write(zai.join(".claude.json"), "{}").unwrap();
        std::fs::create_dir_all(r.workspace.join("profiles/never-ran/.claude")).unwrap();
        let dir = Path::new("/home/devuser/workspace/project");
        let log = seed(&["claude-profile".into()], dir, &r);
        assert_eq!(log.len(), 1);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(zai.join(".claude.json")).unwrap()).unwrap();
        assert_eq!(v["projects"][dir.to_str().unwrap()]["hasTrustDialogAccepted"], true);
        assert!(!r.workspace.join("profiles/never-ran/.claude/.claude.json").exists());
    }

    #[test]
    fn codex_gets_a_trusted_table_appended_once_comments_intact() {
        let d = tempfile::tempdir().unwrap();
        let r = roots(d.path());
        let cfg = r.home.join(".codex/config.toml");
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(&cfg, "# mine\nmodel = \"x\"\n").unwrap();
        let dir = Path::new("/home/devuser/workspace/wt/aoe-codex");
        assert_eq!(seed(&["codex".into()], dir, &r).len(), 1);
        assert!(seed(&["codex".into()], dir, &r).is_empty());
        let text = std::fs::read_to_string(&cfg).unwrap();
        assert!(text.starts_with("# mine\nmodel = \"x\"\n"));
        let parsed: toml::Value = toml::from_str(&text).expect("still valid TOML");
        assert_eq!(parsed["projects"]["/home/devuser/workspace/wt/aoe-codex"]["trust_level"].as_str(), Some("trusted"));
    }

    #[test]
    fn an_unwritable_store_is_reported_and_does_not_stop_the_rest() {
        let d = tempfile::tempdir().unwrap();
        let r = roots(d.path());
        std::fs::create_dir_all(&r.home).unwrap();
        std::fs::write(r.home.join(".claude.json"), "not json").unwrap();
        let log = seed(&["claude-root".into(), "codex".into()], Path::new("/x"), &r);
        assert!(log.iter().any(|l| l.contains("claude-root failed")));
        assert!(log.iter().any(|l| l.starts_with("trusted /x in")), "codex still seeded: {log:?}");
    }
}
