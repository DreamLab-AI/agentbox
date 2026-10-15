//! The protected-path policy for a night.
//!
//! One policy is built per night from the **baseline** config bytes the
//! experiment manifest froze, and that same value is used twice: by
//! `dream_core::candidate::run` (the guard that runs before any patch is
//! applied) and by `dream_gate::gate::GateContext` (the re-check inside the
//! gate). There is no code path that builds a gate context without it, and no
//! fallback to an empty policy: a config the manifest does not vouch for is an
//! error the caller turns into a BLOCKED-ENV night.

use std::path::Path;

use dream_gate::guard::{PolicyError, ProtectedPolicy};
use dream_gate::manifest::ExperimentManifest;

use crate::config::DEFAULT_LEDGER_PATH;

/// Where this engine's own source lives inside the agentbox repository.
const OWN_SOURCE_DIR: &str = "services/dream-engine";

/// The Nix derivation that decides which source and lockfile the judging
/// binary is built from.
const OWN_BUILD_RECIPE: &str = "lib/dream-engine.nix";

/// True when `repo` carries this engine's own source: the agentbox checkout
/// (`services/dream-engine`) or a checkout of the standalone gate crates
/// (`crates/dream-gate`). A night on such a repo must not be able to edit the
/// judge that will judge it.
pub fn is_self_referential(repo: &Path) -> bool {
    if repo.join("crates/dream-gate/Cargo.toml").is_file() {
        return true;
    }
    std::fs::read_to_string(repo.join(OWN_SOURCE_DIR).join("Cargo.toml"))
        .map(|t| {
            t.lines()
                .any(|l| l.trim().replace(' ', "") == "name=\"dream-engine\"")
        })
        .unwrap_or(false)
}

/// Build the night's policy from the frozen manifest and the exact config
/// bytes it digested, adding the self-referential protections when the target
/// is this engine's own source.
///
/// `ProtectedPolicy::with_self_referential` protects the gate crates by their
/// path in the standalone repository; in the agentbox checkout the engine
/// lives at `services/dream-engine`, which is protected here as well.
pub fn for_night(
    manifest: &ExperimentManifest,
    config_bytes: &[u8],
    repo: &Path,
) -> Result<ProtectedPolicy, PolicyError> {
    let policy = ProtectedPolicy::for_manifest(manifest, config_bytes, DEFAULT_LEDGER_PATH)?;
    Ok(if is_self_referential(repo) {
        policy
            .with_self_referential(true)
            .with_globs([OWN_SOURCE_DIR, OWN_BUILD_RECIPE])
    } else {
        policy
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use dream_gate::config::DreamConfig;
    use dream_gate::guard::{check, GuardViolation};
    use dream_gate::manifest::{build, digest, ModelIdentity};

    const CONFIG: &[u8] = br#"{"repo":"o/r","slots":[{"deep":"d","scan":[]}],
        "evaluatorEntrypoints":{"tests":"bash scripts/check.sh"}}"#;

    fn manifest() -> ExperimentManifest {
        let cfg = DreamConfig::from_json(CONFIG).unwrap();
        build(
            &cfg,
            CONFIG,
            "r",
            "2026-10-01-r",
            "2026-10-01",
            20261001,
            "d",
            &[],
            &"0".repeat(40),
            &"0".repeat(40),
            ModelIdentity {
                provider: "t".into(),
                model: "m".into(),
                max_tokens: 1,
                fallback: None,
            },
            "0.1.0",
        )
    }

    fn patch_to(path: &str) -> String {
        format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n-a\n+b\n")
    }

    fn protected(policy: &ProtectedPolicy, path: &str) -> bool {
        matches!(
            check(&patch_to(path), policy),
            Err(GuardViolation::Protected { .. })
        )
    }

    #[test]
    fn the_default_ledger_and_the_evaluator_script_are_protected() {
        let repo = tempfile::tempdir().unwrap();
        let p = for_night(&manifest(), CONFIG, repo.path()).unwrap();
        assert!(protected(&p, DEFAULT_LEDGER_PATH));
        assert!(protected(&p, "scripts/check.sh"));
        assert!(protected(&p, ".github/workflows/ci.yml"));
        assert!(!protected(&p, "src/lib.rs"));
        // Not this engine's source, so its own directory is ordinary code.
        assert!(!protected(&p, "services/dream-engine/src/engine.rs"));
    }

    #[test]
    fn config_bytes_the_manifest_did_not_freeze_are_refused() {
        let repo = tempfile::tempdir().unwrap();
        let other = br#"{"repo":"o/r","slots":[{"deep":"d","scan":[]}]}"#;
        assert_ne!(digest(other), manifest().config_digest);
        assert!(for_night(&manifest(), other, repo.path()).is_err());
    }

    /// The agentbox checkout carries the engine at services/dream-engine; a
    /// night dreaming that repo must not be able to rewrite the engine.
    #[test]
    fn the_engines_own_source_is_protected_when_it_is_the_target() {
        let repo = tempfile::tempdir().unwrap();
        let own = repo.path().join("services/dream-engine");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::write(
            own.join("Cargo.toml"),
            "[package]\nname = \"dream-engine\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        assert!(is_self_referential(repo.path()));
        let p = for_night(&manifest(), CONFIG, repo.path()).unwrap();
        assert!(protected(&p, "services/dream-engine/src/engine.rs"));
        assert!(protected(&p, "services/dream-engine/src/policy.rs"));
        assert!(protected(&p, "services/dream-engine/Cargo.lock"));
        assert!(protected(&p, "lib/dream-engine.nix"));
        assert!(!protected(&p, "services/other/src/lib.rs"));
    }

    #[test]
    fn a_checkout_of_the_gate_crates_is_self_referential_too() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(repo.path().join("crates/dream-gate")).unwrap();
        std::fs::write(
            repo.path().join("crates/dream-gate/Cargo.toml"),
            "[package]\n",
        )
        .unwrap();
        assert!(is_self_referential(repo.path()));
        let p = for_night(&manifest(), CONFIG, repo.path()).unwrap();
        assert!(protected(&p, "crates/dream-gate/src/gate.rs"));
    }

    #[test]
    fn an_unrelated_services_dir_is_not_self_referential() {
        let repo = tempfile::tempdir().unwrap();
        let own = repo.path().join("services/dream-engine");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::write(
            own.join("Cargo.toml"),
            "[package]\nname = \"something-else\"\n",
        )
        .unwrap();
        assert!(!is_self_referential(repo.path()));
    }
}
