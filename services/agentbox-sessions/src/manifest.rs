//! The manifest's session declarations.
//!
//! `[[interaction_plane.session_seeds]]` in `agentbox.toml` is the only
//! declaration of which sessions should exist (ADR-2153 §3). This module reads
//! it and nothing else, so a seed shape the daemon cannot represent fails at
//! load time instead of at the first reconcile.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One desired session.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Seed {
    pub slug: String,
    pub tool: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub worktree: bool,
    /// Provider variables this session may keep. Every other
    /// `ANTHROPIC_*` redirect variable is scrubbed from its environment, so
    /// only the wrapper seeds are ever pointed at a non-Anthropic endpoint
    /// (the N-01 guard the old seeder enforced through its env forwarding).
    #[serde(default)]
    pub env_allowlist: Vec<String>,
    #[serde(default)]
    pub eager_mandate: bool,
}

/// The coordinator (`tab0`): an external entry. It is listed and sendable, but
/// never launched, recreated or reconciled (ADR-2153 §6).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Coordinator {
    #[serde(default = "default_coordinator_slug")]
    pub slug: String,
    /// tmux target of the coordinator pane.
    #[serde(default = "default_coordinator_target")]
    pub target: String,
}

fn default_coordinator_slug() -> String {
    "tab0".into()
}
fn default_coordinator_target() -> String {
    "agentbox:0".into()
}

impl Default for Coordinator {
    fn default() -> Self {
        Self { slug: default_coordinator_slug(), target: default_coordinator_target() }
    }
}

/// Everything the daemon reads from `[interaction_plane]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plane {
    pub enabled: bool,
    pub seeds: Vec<Seed>,
    pub coordinator: Coordinator,
}

#[derive(Deserialize)]
struct Root {
    interaction_plane: Option<RawPlane>,
}

#[derive(Deserialize)]
struct RawPlane {
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default)]
    session_seeds: Vec<Seed>,
    #[serde(default)]
    coordinator: Option<Coordinator>,
}

fn yes() -> bool {
    true
}

/// A slug becomes a tmux session name, a directory name and a branch name, so
/// it is held to the one alphabet that is safe in all three.
pub fn valid_slug(slug: &str) -> bool {
    let b = slug.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && b[0].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

impl Plane {
    pub fn parse(text: &str) -> Result<Self> {
        let root: Root = toml::from_str(text).context("agentbox.toml is not valid TOML")?;
        let raw = root.interaction_plane.unwrap_or(RawPlane { enabled: false, session_seeds: vec![], coordinator: None });
        let mut seen = std::collections::HashSet::new();
        for s in &raw.session_seeds {
            if !valid_slug(&s.slug) {
                bail!("session seed slug {:?} must match [a-z0-9][a-z0-9-]{{0,31}}", s.slug);
            }
            if !seen.insert(s.slug.clone()) {
                bail!("duplicate session seed slug {:?}", s.slug);
            }
        }
        let coordinator = raw.coordinator.unwrap_or_default();
        if seen.contains(&coordinator.slug) {
            bail!("seed slug {:?} collides with the coordinator", coordinator.slug);
        }
        Ok(Self { enabled: raw.enabled, seeds: raw.session_seeds, coordinator })
    }

    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        Self::parse(&text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_seeds_and_defaults() {
        let p = Plane::parse(
            r#"
[interaction_plane]
enabled = true
[[interaction_plane.session_seeds]]
slug = "codex"
tool = "codex"
worktree = true
[[interaction_plane.session_seeds]]
slug = "zai"
tool = "claude"
env_allowlist = ["ANTHROPIC_BASE_URL"]
"#,
        )
        .unwrap();
        assert_eq!(p.seeds.len(), 2);
        assert!(p.seeds[0].worktree && !p.seeds[1].worktree);
        assert_eq!(p.seeds[1].env_allowlist, vec!["ANTHROPIC_BASE_URL"]);
        assert_eq!(p.coordinator.slug, "tab0");
    }

    #[test]
    fn absent_table_means_disabled() {
        assert!(!Plane::parse("[other]\nx = 1\n").unwrap().enabled);
    }

    #[test]
    fn rejects_unsafe_and_duplicate_slugs() {
        for bad in ["Up", "a b", "a/b", "-x", "", "x.y", &"a".repeat(33)] {
            let t = format!("[interaction_plane]\n[[interaction_plane.session_seeds]]\nslug = {bad:?}\ntool = \"claude\"\n");
            assert!(Plane::parse(&t).is_err(), "{bad:?} must be rejected");
        }
        let dup = "[interaction_plane]\n[[interaction_plane.session_seeds]]\nslug=\"a\"\ntool=\"claude\"\n[[interaction_plane.session_seeds]]\nslug=\"a\"\ntool=\"claude\"\n";
        assert!(Plane::parse(dup).is_err());
        let coll = "[interaction_plane]\n[[interaction_plane.session_seeds]]\nslug=\"tab0\"\ntool=\"claude\"\n";
        assert!(Plane::parse(coll).is_err());
    }

    #[test]
    fn the_real_manifest_parses() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../agentbox.toml");
        let plane = Plane::load(&p).expect("agentbox.toml");
        assert!(plane.enabled);
        assert!(plane.seeds.iter().any(|s| s.slug == "loom-raw"));
        assert!(!plane.seeds.iter().any(|s| s.slug == "loom"), "scaffolded loom seed is dropped (ADR-2153 §10)");
    }
}
