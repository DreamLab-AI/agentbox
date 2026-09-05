//! Apply the emitted candidate in isolation and re-run the required evaluators.
//!
//! ADR-2024's closeout: "evaluation runs before patch emission … the emitted
//! candidate is not re-evaluated". Everything the model saw was evidence about
//! the *baseline*; the diff it then wrote was never tested. This module closes
//! that loop.
//!
//! The candidate is materialised the same way [`crate::persist`] materialises a
//! draft PR — a git worktree at HEAD on a fresh branch, so the operator's
//! working tree is never touched — and the worktree's tree hash is recorded, so
//! the rerun's receipts bind to exact bytes rather than to a branch name. The
//! required evaluators then run *against that tree*, through the same
//! [`EvaluatorRunner`] seam as the baseline, producing receipts the gate reads.

use std::path::{Path, PathBuf};

use tracing::{info, warn};

use crate::manifest::{digest, EvaluatorIdentity};
use crate::persist::{self, PersistError};
use crate::receipts::{EvaluatorReceipt, Phase};
use crate::runner::EvaluatorRunner;

/// A candidate that exists on disk as a real tree, ready to be evaluated.
#[derive(Debug, Clone)]
pub struct PreparedCandidate {
    pub worktree: PathBuf,
    pub branch: String,
    /// `git rev-parse HEAD^{tree}` inside the worktree — the exact content the
    /// rerun evaluates.
    pub tree_hash: String,
    pub patch_digest: String,
    pub patch_bytes: usize,
}

/// Build the candidate tree: a worktree at HEAD, on `branch`, with `patch`
/// applied and committed.
///
/// Returns [`PersistError::PatchDidNotApply`] when the diff will not land — a
/// harness-class veto, not evidence about the code.
pub fn prepare(
    repo: &Path,
    branch: &str,
    patch: &str,
    commit_msg: &str,
) -> Result<PreparedCandidate, PersistError> {
    let worktree = persist::build_branch_worktree(repo, branch, patch, commit_msg)?;
    let tree_hash = crate::manifest::git(&worktree, &["rev-parse", "HEAD^{tree}"])
        .map_err(|e| PersistError::Git("rev-parse HEAD^{tree}".into(), e.to_string()))?;
    Ok(PreparedCandidate {
        worktree,
        branch: branch.to_string(),
        tree_hash,
        patch_digest: digest(patch.as_bytes()),
        patch_bytes: patch.len(),
    })
}

/// Remove the candidate worktree, keeping the branch (the draft-PR path may
/// still want to push it).
pub fn cleanup(repo: &Path, prepared: &PreparedCandidate) {
    persist::remove_worktree(repo, &prepared.worktree);
}

/// Remove the candidate worktree *and* its branch — used when the gate rejects
/// the candidate, so a vetoed diff leaves no promotable artefact behind.
pub fn discard(repo: &Path, prepared: &PreparedCandidate) {
    persist::remove_worktree(repo, &prepared.worktree);
    persist::delete_branch(repo, &prepared.branch);
}

/// Re-run the required evaluators against the candidate tree at `work_dir`.
///
/// Only required evaluators run: they are the ones the gate reads, and annexe
/// time inside the nightly window is finite. Advisory evaluators keep their
/// baseline receipts.
pub fn evaluate(
    runner: &dyn EvaluatorRunner,
    work_dir: &str,
    required: &[&EvaluatorIdentity],
) -> Vec<EvaluatorReceipt> {
    let mut out = Vec::new();
    for id in required {
        info!(evaluator = %id.name, runner = %runner.describe(), "candidate rerun");
        let exec = runner.run(work_dir, &id.command, id.timeout_secs);
        let receipt = EvaluatorReceipt::from_exec(
            &id.name,
            &id.command,
            Phase::Candidate,
            true,
            id.timeout_secs,
            exec,
        );
        if !receipt.outcome.is_pass() {
            warn!(
                evaluator = %id.name,
                outcome = receipt.outcome.label(),
                "candidate rerun did not pass — acceptance will be vetoed"
            );
        }
        out.push(receipt);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::{self, CandidateState};
    use crate::manifest::{ExperimentManifest, ModelIdentity};
    use crate::runner::LocalRunner;
    use crate::verdict::Verdict;
    use std::process::Command;

    /// A scratch repo whose "evaluator" is a shell check over its own source.
    fn scratch_repo() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let repo = d.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let run = |a: &[&str]| {
            Command::new("git").arg("-C").arg(&repo).args(a).output().unwrap()
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "dream@test"]);
        run(&["config", "user.name", "dream"]);
        // The "surface": a value the evaluator checks.
        std::fs::write(repo.join("value.txt"), "42\n").unwrap();
        std::fs::create_dir_all(repo.join("scripts")).unwrap();
        std::fs::write(
            repo.join("scripts/check.sh"),
            "#!/bin/bash\nv=$(cat value.txt)\nif [ \"$v\" = \"42\" ]; then echo \"check ok: $v\"; exit 0; fi\necho \"FAIL: expected 42, got $v\"\nexit 1\n",
        )
        .unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-qm", "init"]);
        (d, repo)
    }

    fn manifest(deep: &str) -> ExperimentManifest {
        ExperimentManifest {
            schema: 1,
            run_id: "abcdef0123456789".into(),
            night_id: "2026-09-05-scratch".into(),
            repo: "scratch".into(),
            repo_slug: "o/scratch".into(),
            date: "2026-09-05".into(),
            day_int: 20260905,
            deep: deep.into(),
            scan: vec![],
            baseline_revision: "0".repeat(40),
            baseline_tree_hash: "0".repeat(40),
            config_digest: digest(b"cfg"),
            evaluators: vec![EvaluatorIdentity {
                name: "check".into(),
                command: "bash scripts/check.sh".into(),
                command_digest: digest(b"bash scripts/check.sh"),
                required: true,
                deeps: vec![],
                timeout_secs: 60,
            }],
            model: ModelIdentity {
                provider: "loom".into(),
                model: "qwen3.8-27B".into(),
                max_tokens: 1024,
                fallback: None,
            },
            engine_version: "0.1.0".into(),
            created_at: "2026-09-05T01:00:00Z".into(),
        }
    }

    #[test]
    fn a_good_candidate_is_applied_isolated_and_passes_the_rerun() {
        let (_d, repo) = scratch_repo();
        // A patch that changes something the evaluator does not object to.
        let patch = "diff --git a/README.md b/README.md\nnew file mode 100644\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+notes\n";
        let c = prepare(&repo, "dream/good-2026-09-05", patch, "dream: add notes").unwrap();
        assert_eq!(c.tree_hash.len(), 40);
        assert_eq!(c.patch_digest, digest(patch.as_bytes()));

        let m = manifest("value");
        let receipts = evaluate(&LocalRunner, c.worktree.to_str().unwrap(), &m.required());
        assert_eq!(receipts.len(), 1);
        assert!(receipts[0].outcome.is_pass(), "{:?}", receipts[0]);

        let d = gate::decide(
            &m,
            &Ok(Verdict::Accept),
            &CandidateState::Applied { tree_hash: c.tree_hash.clone() },
            &receipts,
        );
        assert!(d.accepted, "{}", d.summary);
        discard(&repo, &c);
    }

    /// The acceptance test the ADR names: a deliberately broken candidate
    /// cannot receive ACCEPT even when the report insists on it.
    #[test]
    fn a_deliberately_broken_candidate_cannot_receive_accept() {
        let (_d, repo) = scratch_repo();
        // Break the surface the required evaluator checks.
        let patch = "diff --git a/value.txt b/value.txt\n--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-42\n+7\n";
        let c = prepare(&repo, "dream/broken-2026-09-05", patch, "dream: break it").unwrap();

        let m = manifest("value");
        let receipts = evaluate(&LocalRunner, c.worktree.to_str().unwrap(), &m.required());
        assert_eq!(receipts.len(), 1);
        assert!(!receipts[0].outcome.is_pass(), "{:?}", receipts[0].outcome);
        assert!(receipts[0].stdout.contains("FAIL: expected 42"));

        // The model is as confident as we like; the gate does not care.
        let report_says = Ok(Verdict::Accept);
        let d = gate::decide(
            &m,
            &report_says,
            &CandidateState::Applied { tree_hash: c.tree_hash.clone() },
            &receipts,
        );
        assert!(!d.accepted, "a broken candidate must never be accepted");
        assert_eq!(d.verdict, "REJECT");
        assert_eq!(d.model_verdict, "ACCEPT");
        assert!(d.summary.contains("ACCEPT vetoed"), "{}", d.summary);

        discard(&repo, &c);
        // The vetoed branch left no promotable artefact.
        let branches = Command::new("git").arg("-C").arg(&repo).args(["branch", "--list"]).output().unwrap();
        assert!(
            !String::from_utf8_lossy(&branches.stdout).contains("dream/broken"),
            "a vetoed candidate must not leave a branch behind"
        );
    }

    #[test]
    fn the_baseline_is_evaluated_green_so_the_veto_is_the_patch_not_the_repo() {
        // Guards the test above from passing for the wrong reason.
        let (_d, repo) = scratch_repo();
        let m = manifest("value");
        let receipts = evaluate(&LocalRunner, repo.to_str().unwrap(), &m.required());
        assert!(receipts[0].outcome.is_pass(), "{:?}", receipts[0].outcome);
    }

    #[test]
    fn a_patch_that_does_not_apply_is_reported_not_swallowed() {
        let (_d, repo) = scratch_repo();
        let patch = "diff --git a/value.txt b/value.txt\n--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-this line is not in the file\n+7\n";
        let err = prepare(&repo, "dream/bad-patch-2026-09-05", patch, "dream: nope").unwrap_err();
        assert!(matches!(err, PersistError::PatchDidNotApply), "got {err:?}");
    }

    #[test]
    fn preparing_the_candidate_never_touches_the_operator_working_tree() {
        let (_d, repo) = scratch_repo();
        std::fs::write(repo.join("wip.txt"), "operator wip\n").unwrap();
        let patch = "diff --git a/value.txt b/value.txt\n--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-42\n+43\n";
        let c = prepare(&repo, "dream/iso-2026-09-05", patch, "dream: bump").unwrap();
        assert_eq!(std::fs::read_to_string(repo.join("wip.txt")).unwrap(), "operator wip\n");
        assert_eq!(std::fs::read_to_string(repo.join("value.txt")).unwrap(), "42\n");
        assert_eq!(std::fs::read_to_string(c.worktree.join("value.txt")).unwrap(), "43\n");
        discard(&repo, &c);
    }
}
