//! Judging a night, and recording what it was judged on.
//!
//! Every night that reaches the gate is judged by
//! [`dream_core::replay::capture`], which runs the one pure gate and persists
//! the inputs next to the decision under the night's artefact directory
//! (`replay.json`, `decision.json` and the files [`dream_core::replay`]
//! documents). `dream-core`'s `replay verify` can then recompute the verdict
//! from the stored files under the **same** protected set the live night used,
//! because the policy additions ([`PolicyExtras`]) are stored with it.
//!
//! There is no second way to judge in this crate: nothing here or in the
//! engine calls `gate::decide` directly (a test enforces it).

use std::path::Path;

use dream_core::replay::{self, NightInputs, ReplayError};
use dream_gate::gate::GateDecision;
use tracing::warn;

/// Judge `inputs` and record them under `night_dir`.
///
/// Recording is fail-open: if the artefacts cannot be written the night is
/// still judged by the very same function ([`replay::decide`]) and the failure
/// is logged. A policy error is returned, because a night that cannot build
/// its protected set must not be judged at all.
pub fn judge(night_dir: &Path, inputs: &NightInputs) -> Result<GateDecision, ReplayError> {
    match replay::capture(night_dir, inputs) {
        Ok(d) => Ok(d),
        Err(e @ ReplayError::Policy(_)) => Err(e),
        Err(e) => {
            warn!(error = %e, "replay capture failed (fail-open) — judging without recording");
            replay::decide(inputs)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy;
    use dream_core::candidate::{self, AttemptInput};
    use dream_core::runner::ScriptedRunner;
    use dream_gate::config::DreamConfig;
    use dream_gate::manifest::{build, ExperimentManifest, ModelIdentity};
    use dream_gate::outcome::ExecOutcome;
    use std::path::PathBuf;
    use std::process::Command;

    const CONFIG: &[u8] = br#"{"repo":"o/r","slots":[{"deep":"d","scan":[]}],
        "evaluatorEntrypoints":{"check":"bash scripts/check.sh"}}"#;
    const CHECK: &str = "bash scripts/check.sh";
    const BENIGN: &str = "diff --git a/README.md b/README.md\nnew file mode 100644\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+notes\n";
    const OWN: &str = "diff --git a/services/dream-engine/src/x.rs b/services/dream-engine/src/x.rs\n--- a/services/dream-engine/src/x.rs\n+++ b/services/dream-engine/src/x.rs\n@@ -1 +1 @@\n-a\n+b\n";

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
            &"1".repeat(40),
            ModelIdentity {
                provider: "t".into(),
                model: "m".into(),
                max_tokens: 1,
                fallback: None,
            },
            "0.1.0",
        )
    }

    fn exec(code: Option<i32>, transport: Option<&str>) -> ExecOutcome {
        ExecOutcome {
            exit_code: code,
            stdout: "check output\n".into(),
            stderr: String::new(),
            duration_ms: 5,
            transport_error: transport.map(str::to_string),
            timed_out: false,
            started_at: "2026-10-01T01:00:00Z".into(),
        }
    }

    /// A git checkout that carries this engine's own source, so a night on it
    /// is self-referential.
    fn own_checkout() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let repo = d.path().join("repo");
        std::fs::create_dir_all(repo.join("services/dream-engine")).unwrap();
        std::fs::write(
            repo.join("services/dream-engine/Cargo.toml"),
            "[package]\nname = \"dream-engine\"\n",
        )
        .unwrap();
        std::fs::write(repo.join("README.md.keep"), "x\n").unwrap();
        let git = |a: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(a)
                .output()
                .unwrap()
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);
        (d, repo)
    }

    /// Run the real candidate flow against `patch` with `runner`, then judge
    /// the night as the engine does. Returns the night dir and the decision.
    fn night(
        patch: &str,
        runner: &ScriptedRunner,
        report: &str,
    ) -> (tempfile::TempDir, GateDecision) {
        let (_keep, repo) = own_checkout();
        let m = manifest();
        let pol = policy::for_night(&m, CONFIG, &repo).unwrap();
        let required = m.required();
        let attempt = candidate::run(
            &AttemptInput {
                repo: &repo,
                branch: "dream/d-2026-10-01",
                patch,
                commit_msg: "dream: t",
                base: "HEAD",
                policy: &pol,
                build: None,
                required: &required,
            },
            runner,
            None,
        );
        let inputs = NightInputs {
            manifest: m,
            report: report.into(),
            candidate: attempt.state.clone(),
            extracted_patch: Some(patch.into()),
            baseline_receipts: vec![],
            candidate_receipts: attempt.receipts.clone(),
            config_bytes: CONFIG.to_vec(),
            fallback_ledger_path: crate::config::DEFAULT_LEDGER_PATH.into(),
            candidate_config_digest: None,
            tests: Default::default(),
            options: Default::default(),
            policy: policy::extras_for(&repo),
        };
        let dir = tempfile::tempdir().unwrap();
        let d = judge(dir.path(), &inputs).unwrap();
        if let Some(p) = &attempt.prepared {
            candidate::discard(&repo, p);
        }
        (dir, d)
    }

    fn replayed(dir: &Path, want: &str, decision: &GateDecision) {
        assert_eq!(decision.verdict, want, "{decision:?}");
        let v = replay::verify(dir).unwrap();
        assert!(v.matches, "{:?}", v.diffs);
        assert_eq!(v.recomputed.verdict, want);
        assert_eq!(&v.recorded, decision);
    }

    const ACCEPT: &str = "analysis\nVERDICT: ACCEPT\n";

    #[test]
    fn an_accepted_night_replays_to_accept() {
        let r = ScriptedRunner::new().with(CHECK, exec(Some(0), None));
        let (dir, d) = night(BENIGN, &r, ACCEPT);
        replayed(dir.path(), "ACCEPT", &d);
    }

    #[test]
    fn a_rejected_night_replays_to_reject() {
        let r = ScriptedRunner::new().with(CHECK, exec(Some(1), None));
        let (dir, d) = night(BENIGN, &r, ACCEPT);
        replayed(dir.path(), "REJECT", &d);
    }

    #[test]
    fn a_blocked_env_night_from_the_gate_replays_to_blocked_env() {
        // The rerun's transport failed: a harness fault the gate classifies,
        // not an early policy failure (which never reaches the gate).
        let r = ScriptedRunner::new().with(CHECK, exec(None, Some("runner unreachable")));
        let (dir, d) = night(BENIGN, &r, ACCEPT);
        replayed(dir.path(), "BLOCKED-ENV", &d);
    }

    #[test]
    fn a_protected_patch_to_the_engines_own_source_replays_to_reject() {
        let r = ScriptedRunner::new().with(CHECK, exec(Some(0), None));
        let (dir, d) = night(OWN, &r, ACCEPT);
        replayed(dir.path(), "REJECT", &d);
        let v = replay::verify(dir.path()).unwrap();
        assert_eq!(v.guard_agrees, Some(true));
        // The stored policy is what makes this reproducible.
        let stored = std::fs::read_to_string(dir.path().join("replay.json")).unwrap();
        assert!(stored.contains("\"selfReferential\": true"), "{stored}");
        assert!(stored.contains("services/dream-engine"), "{stored}");
    }

    #[test]
    fn an_inconclusive_night_is_captured_too() {
        let r = ScriptedRunner::new();
        let (dir, d) = night(BENIGN, &r, "no verdict line at all\n");
        assert_eq!(d.verdict, "INCONCLUSIVE");
        assert!(replay::verify(dir.path()).unwrap().matches);
    }

    #[test]
    fn capture_failure_falls_back_to_the_same_judgement() {
        let r = ScriptedRunner::new().with(CHECK, exec(Some(0), None));
        let (_keep, repo) = own_checkout();
        let m = manifest();
        let pol = policy::for_night(&m, CONFIG, &repo).unwrap();
        let required = m.required();
        let attempt = candidate::run(
            &AttemptInput {
                repo: &repo,
                branch: "dream/d-2026-10-01",
                patch: BENIGN,
                commit_msg: "dream: t",
                base: "HEAD",
                policy: &pol,
                build: None,
                required: &required,
            },
            &r,
            None,
        );
        let inputs = NightInputs {
            manifest: m,
            report: ACCEPT.into(),
            candidate: attempt.state.clone(),
            extracted_patch: None,
            baseline_receipts: vec![],
            candidate_receipts: attempt.receipts.clone(),
            config_bytes: CONFIG.to_vec(),
            fallback_ledger_path: crate::config::DEFAULT_LEDGER_PATH.into(),
            candidate_config_digest: None,
            tests: Default::default(),
            options: Default::default(),
            policy: Default::default(),
        };
        // A regular file where the directory should be: every write fails.
        let blocker = tempfile::NamedTempFile::new().unwrap();
        let d = judge(blocker.path(), &inputs).unwrap();
        assert_eq!(d.verdict, "ACCEPT");
        if let Some(p) = &attempt.prepared {
            candidate::discard(&repo, p);
        }
    }

    /// The call-order invariant, enforced on the source: this crate judges
    /// only through `judge::judge`, builds the policy only through
    /// `policy::for_night`, and never applies a patch itself, so
    /// `guard::check` (inside `candidate::run`) has always run before the gate
    /// sees a candidate state.
    #[test]
    fn the_adapter_has_one_way_to_judge_and_no_way_around_the_guard() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let forbidden = [
            "gate::decide(",
            "GateContext::new(",
            "GateContext {",
            "ProtectedPolicy::for_manifest(",
            "ProtectedPolicy::default(",
            "candidate::prepare(",
            "build_branch_worktree(",
            "git apply",
        ];
        for entry in std::fs::read_dir(&src).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|e| e != "rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            // Production code only: everything before the test module.
            let prod: String = text
                .split("#[cfg(test)]")
                .next()
                .unwrap()
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            for pat in forbidden {
                // This file names the patterns in this very list.
                if path.file_name().unwrap() == "judge.rs" {
                    continue;
                }
                assert!(
                    !prod.contains(pat),
                    "{} calls {pat}: judge through judge::judge and build policy through policy::for_night",
                    path.display()
                );
            }
        }
    }
}
