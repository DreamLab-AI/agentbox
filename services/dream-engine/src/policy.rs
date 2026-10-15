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

use dream_core::replay::{night_policy, PolicyExtras};
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

/// What this engine adds to the frozen config's protected set for `repo`: the
/// self-referential flag and, when the target carries this engine's own
/// source, that source and its build recipe.
///
/// `ProtectedPolicy::with_self_referential` protects the gate crates by their
/// path in the standalone repository; in the agentbox checkout the engine
/// lives at `services/dream-engine`, which is protected here as well. The same
/// value is stored with the night so a replay judges under the same set.
pub fn extras_for(repo: &Path) -> PolicyExtras {
    if is_self_referential(repo) {
        PolicyExtras {
            self_referential: true,
            extra_globs: vec![OWN_SOURCE_DIR.into(), OWN_BUILD_RECIPE.into()],
            protected_paths: Vec::new(),
        }
    } else {
        PolicyExtras::default()
    }
}

/// The baseline tree's file list (`git ls-tree -r --name-only <rev>`), empty
/// when git cannot answer. Lets a bare word in a frozen evaluator command
/// (`make`'s `Makefile`, a script run as `check`) protect the file it names.
fn baseline_files(repo: &Path, rev: &str) -> Vec<String> {
    std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["ls-tree", "-r", "--name-only", "-z", rev])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .split('\0')
                .filter(|f| !f.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// [`extras_for`] plus what the frozen evaluator commands name in this
/// repository: absolute paths under `repo` made repo-relative and bare words
/// that name files in the baseline tree (`manifest.baseline_revision`). An
/// evaluator command that cannot be read with certainty (unterminated quote,
/// command substitution) is an error, so the night is `BLOCKED-ENV`. The
/// result is recorded with the night, so replay protects the same set.
pub fn resolved_extras(
    manifest: &ExperimentManifest,
    repo: &Path,
) -> Result<PolicyExtras, PolicyError> {
    let files = baseline_files(repo, &manifest.baseline_revision);
    let root = repo
        .canonicalize()
        .unwrap_or_else(|_| repo.to_path_buf())
        .display()
        .to_string();
    extras_for(repo).resolving(manifest, &root, &files)
}

/// Build the night's policy from the frozen manifest and the exact config
/// bytes it digested, plus `extras` ([`extras_for`] the target repository,
/// computed once per night and also stored in `NightInputs::policy`, so the
/// live policy and the recorded one are the same value). This goes through
/// `dream_core::replay::night_policy`, the one builder replay also uses.
pub fn for_night(
    manifest: &ExperimentManifest,
    config_bytes: &[u8],
    extras: &PolicyExtras,
) -> Result<ProtectedPolicy, PolicyError> {
    night_policy(manifest, config_bytes, DEFAULT_LEDGER_PATH, extras)
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

    #[test]
    fn an_unanalysable_evaluator_command_blocks_the_night() {
        let mut m = manifest();
        m.evaluators[0].command = "bash 'scripts/check.sh".into();
        let repo = tempfile::tempdir().unwrap();
        let e = resolved_extras(&m, repo.path()).unwrap_err();
        assert!(matches!(e, PolicyError::UnsupportedCommand { .. }), "{e:?}");
    }

    #[test]
    fn evaluator_paths_are_resolved_against_the_repository_and_baseline_tree() {
        let repo = tempfile::tempdir().unwrap();
        let git = |a: &[&str]| {
            let o = std::process::Command::new("git")
                .arg("-C")
                .arg(repo.path())
                .args(a)
                .output()
                .unwrap();
            assert!(o.status.success(), "{a:?}");
            String::from_utf8(o.stdout).unwrap().trim().to_string()
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::create_dir_all(repo.path().join("scripts")).unwrap();
        std::fs::write(repo.path().join("scripts/check suite.sh"), "x").unwrap();
        std::fs::write(repo.path().join("verify"), "x").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "i"]);
        let mut m = manifest();
        m.baseline_revision = git(&["rev-parse", "HEAD"]);
        let root = repo.path().canonicalize().unwrap();
        m.evaluators[0].command = format!(
            "bash \"{}/scripts/check suite.sh\" && ./verify",
            root.display()
        );
        let ex = resolved_extras(&m, repo.path()).unwrap();
        assert!(
            ex.protected_paths
                .contains(&"scripts/check suite.sh".to_string()),
            "{ex:?}"
        );
        assert!(ex.protected_paths.contains(&"verify".to_string()), "{ex:?}");
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
        let p = for_night(&manifest(), CONFIG, &extras_for(repo.path())).unwrap();
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
        assert!(for_night(&manifest(), other, &extras_for(repo.path())).is_err());
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
        let p = for_night(&manifest(), CONFIG, &extras_for(repo.path())).unwrap();
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
        let p = for_night(&manifest(), CONFIG, &extras_for(repo.path())).unwrap();
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
