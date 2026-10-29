//! The launch contract (`config/session-plane/launch.json`).
//!
//! How each seed's tool is started, verified against the pinned CLIs by
//! `tests/cli/session-launch-contract.test.mjs`. That test and this module
//! implement the same resolution; `agentbox-sessions resolve --json` exposes
//! this side so the test can assert the two never drift.

use crate::manifest::Seed;
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct ToolSpec {
    pub argv: Vec<String>,
    #[serde(default)]
    pub model_argv: Option<Vec<String>>,
    #[serde(default)]
    pub model_env: BTreeMap<String, String>,
    #[serde(default)]
    pub trust: Vec<String>,
    #[serde(default)]
    pub blockers: Vec<String>,
    #[serde(default)]
    pub ready: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Contract {
    pub worktree_root: String,
    pub worktree_prefix: String,
    pub settle_seconds: u64,
    pub common_blockers: Vec<String>,
    pub tools: BTreeMap<String, ToolSpec>,
}

/// A seed resolved to something launchable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Launch {
    pub kind: String,
    pub argv: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub blockers: Vec<String>,
    pub ready: Option<String>,
    pub trust: Vec<String>,
}

fn fill(s: &str, seed: &Seed, wrapper: &Path) -> String {
    s.replace("{slug}", &seed.slug)
        .replace("{model}", seed.model.as_deref().unwrap_or(""))
        .replace("{wrapper}", &wrapper.display().to_string())
}

impl Contract {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))
    }

    pub fn wrapper_path(wrapper_dir: &Path, slug: &str) -> PathBuf {
        wrapper_dir.join(format!("{slug}.sh"))
    }

    /// A seed whose slug has a harness wrapper, and whose tool is `claude` or
    /// `custom:<slug>`, launches through the wrapper; otherwise the tool name
    /// selects the template.
    pub fn kind(&self, seed: &Seed, wrapper_dir: &Path) -> Result<String> {
        let has_wrapper = Self::wrapper_path(wrapper_dir, &seed.slug).exists();
        if has_wrapper && (seed.tool == "claude" || seed.tool == format!("custom:{}", seed.slug)) {
            return Ok("wrapper".into());
        }
        if self.tools.contains_key(&seed.tool) {
            return Ok(seed.tool.clone());
        }
        Err(anyhow!("seed {:?}: tool {:?} has no launch template", seed.slug, seed.tool))
    }

    pub fn resolve(&self, seed: &Seed, wrapper_dir: &Path) -> Result<Launch> {
        let kind = self.kind(seed, wrapper_dir)?;
        let t = self.tools.get(&kind).ok_or_else(|| anyhow!("contract has no {kind:?} template"))?;
        let wrapper = Self::wrapper_path(wrapper_dir, &seed.slug);
        let mut argv: Vec<String> = t.argv.iter().map(|a| fill(a, seed, &wrapper)).collect();
        let mut env = BTreeMap::new();
        if seed.model.as_deref().is_some_and(|m| !m.is_empty()) && kind != "wrapper" {
            if t.model_argv.is_none() && t.model_env.is_empty() {
                bail!("seed {:?}: {kind} has no way to receive a model", seed.slug);
            }
            if let Some(extra) = &t.model_argv {
                argv.extend(extra.iter().map(|a| fill(a, seed, &wrapper)));
            }
            for (k, v) in &t.model_env {
                env.insert(k.clone(), fill(v, seed, &wrapper));
            }
        }
        let mut blockers = self.common_blockers.clone();
        blockers.extend(t.blockers.iter().cloned());
        Ok(Launch { kind, argv, env, blockers, ready: t.ready.clone(), trust: t.trust.clone() })
    }

    /// Where the session runs: the shared project checkout, or its own
    /// worktree under the one worktree root.
    pub fn session_dir(&self, seed: &Seed, home: &Path, project: &Path) -> PathBuf {
        if !seed.worktree {
            return project.to_path_buf();
        }
        let root = match self.worktree_root.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => PathBuf::from(&self.worktree_root),
        };
        root.join(format!("{}{}", self.worktree_prefix, seed.slug))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(slug: &str, tool: &str, model: Option<&str>, worktree: bool) -> Seed {
        Seed { slug: slug.into(), tool: tool.into(), model: model.map(Into::into), worktree, env_allowlist: vec![], eager_mandate: false }
    }

    fn contract() -> Contract {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/session-plane/launch.json");
        Contract::load(&p).unwrap()
    }

    #[test]
    fn opencode_model_rides_env_never_argv() {
        let l = contract().resolve(&seed("deepseek", "opencode", Some("deepseek-agent/deepseek-flash"), true), Path::new("/nowhere")).unwrap();
        assert_eq!(l.argv, vec!["opencode", "--standalone"]);
        assert_eq!(l.env["OPENCODE_CONFIG_CONTENT"], r#"{"model":"deepseek-agent/deepseek-flash"}"#);
        assert_eq!(l.ready.as_deref(), Some("Ask anything"));
    }

    #[test]
    fn native_tools_take_the_model_flag() {
        let l = contract().resolve(&seed("antigravity", "antigravity", Some("gemini-3.8-flash"), true), Path::new("/nowhere")).unwrap();
        assert_eq!(l.argv, vec!["env", "AGENTBOX_PROFILE=antigravity", "agy", "--model", "gemini-3.8-flash"]);
        assert!(l.blockers.iter().any(|b| b == "You are currently not signed in"));
        assert!(l.blockers.iter().any(|b| b == "Unrecognized flag"), "common blockers are included");
    }

    #[test]
    fn a_wrapper_file_selects_the_wrapper_template() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("zai.sh"), "#!/bin/sh\n").unwrap();
        let l = contract().resolve(&seed("zai", "claude", None, false), dir.path()).unwrap();
        assert_eq!(l.kind, "wrapper");
        assert_eq!(l.argv, vec![dir.path().join("zai.sh").display().to_string()]);
        // Without the file the same seed is a plain claude session.
        assert_eq!(contract().resolve(&seed("zai", "claude", None, false), Path::new("/nowhere")).unwrap().kind, "claude");
    }

    #[test]
    fn a_wrapper_never_receives_a_model() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("router.sh"), "#!/bin/sh\n").unwrap();
        let l = contract().resolve(&seed("router", "custom:router", Some("x"), false), dir.path()).unwrap();
        assert_eq!(l.kind, "wrapper");
        assert_eq!(l.argv.len(), 1);
        assert!(l.env.is_empty());
    }

    #[test]
    fn unknown_tools_fail_loudly() {
        assert!(contract().resolve(&seed("x", "nope", None, false), Path::new("/nowhere")).is_err());
    }

    #[test]
    fn session_dirs_sit_under_the_one_worktree_root() {
        let c = contract();
        let home = Path::new("/home/devuser");
        let project = Path::new("/home/devuser/workspace/project");
        assert_eq!(c.session_dir(&seed("codex", "codex", None, true), home, project), Path::new("/home/devuser/workspace/wt/aoe-codex"));
        assert_eq!(c.session_dir(&seed("zai", "claude", None, false), home, project), project);
    }
}
