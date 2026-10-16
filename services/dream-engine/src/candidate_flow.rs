//! The engine's candidate step: build the model's patch in isolation, re-run
//! the required evaluators on it, with one apply-repair pass (ADR-2114).
//!
//! Every attempt goes through `dream_core::candidate::run`, which enforces the
//! order *refuse, guard, worktree, build, evaluate*. This module never calls
//! `prepare`, `build_branch_worktree` or `git apply` itself, so there is no
//! path from a model-written diff to a git command that skips the
//! protected-path guard — including the corrected diff the apply-repair pass
//! produces, which is attempted through `run` again and so guarded again.

use std::cell::RefCell;
use std::path::Path;

use dream_core::candidate::{self, Attempt, AttemptError, AttemptInput, PreparedCandidate};
use dream_core::runner::EvaluatorRunner;
use dream_core::seams::Llm;
use dream_core::source::{self, RepairOutcome, RepairRecord};
use dream_gate::gate::CandidateState;
use dream_gate::guard::ProtectedPolicy;
use dream_gate::manifest::{
    digest, write_atomic, CandidateRecord, EvaluatorIdentity, MANIFEST_SCHEMA,
};
use serde_json::json;
use tracing::{info, warn};

use crate::dispatch;
use crate::journal::Journal;
use crate::present::receipt_outcomes;

/// Text `dream-core` puts in front of git's refusal in
/// `CandidateState::DidNotApply`. Used only to *format* the combined detail
/// of a failed repair pass; whether git refused the diff is decided by the
/// typed [`AttemptError`], never by this text.
const APPLY_FAILED: &str = "patch did not apply: ";

/// Where the candidate tree is evaluated: the connected node annexe.
pub struct Annexe<'a> {
    /// `user@host` of the annexe.
    pub host: &'a str,
    /// The night's remote directory (the candidate goes under it).
    pub remote_dir: &'a str,
    /// The repo's depth under the workspace (see `dispatch::annexe_subpath`).
    pub repo_subpath: &'a str,
    /// Sibling workspace repos the build needs.
    pub siblings: &'a [String],
    /// The real workspace root, which siblings resolve against.
    pub workspace: &'a Path,
}

impl Annexe<'_> {
    /// Ship the candidate worktree and return the directory to evaluate in.
    fn provision(&self, worktree: &Path) -> Result<String, String> {
        let cand_remote = format!("{}/candidate", self.remote_dir);
        dispatch::clone_repo_and_siblings(
            self.host,
            worktree,
            &cand_remote,
            self.repo_subpath,
            self.siblings,
            self.workspace,
        )
        .map_err(|e| e.to_string())?;
        Ok(format!("{}/{}", cand_remote, self.repo_subpath))
    }
}

/// Everything the candidate step needs besides the patch.
pub struct Flow<'a> {
    /// The checkout the candidate branch is cut from.
    pub repo: &'a Path,
    /// The candidate branch.
    pub branch: &'a str,
    /// Commit message for the candidate commit.
    pub commit_msg: &'a str,
    /// The commit the model was shown.
    pub base: &'a str,
    /// The night's policy ([`crate::policy::for_night`]); the same value the
    /// gate context is built from.
    pub policy: &'a ProtectedPolicy,
    /// Build command and timeout to run in the candidate tree.
    pub build: Option<(&'a str, u64)>,
    /// The required evaluators to re-run.
    pub required: &'a [&'a EvaluatorIdentity],
    /// How evaluator commands run.
    pub runner: &'a dyn EvaluatorRunner,
    /// Where the candidate is evaluated; `None` evaluates in the local
    /// worktree (tests).
    pub annexe: Option<Annexe<'a>>,
    /// The night's artefact directory (the apply-repair record lives here).
    pub night_dir: &'a Path,
    /// The model's report (apply-repair shows it the failed patch in context).
    pub report: &'a str,
    /// The language model for the apply-repair pass.
    pub llm: &'a dyn Llm,
    /// Fallback model for that pass.
    pub fallback: Option<&'a dyn Llm>,
}

/// One pass through `candidate::run`, journalled.
async fn run_once(flow: &Flow<'_>, patch: &str, op: &str, j: &Journal) -> Attempt {
    let c = j
        .called("git.worktree", json!({ "op": op, "branch": flow.branch }))
        .await;
    let shipped: RefCell<Vec<Result<(), String>>> = RefCell::new(Vec::new());
    let attempt = {
        let relocate = |p: &PreparedCandidate| {
            let a = flow
                .annexe
                .as_ref()
                .expect("relocate is only offered with an annexe");
            let r = a.provision(&p.worktree);
            shipped
                .borrow_mut()
                .push(r.as_ref().map(|_| ()).map_err(|e| e.clone()));
            r
        };
        let input = AttemptInput {
            repo: flow.repo,
            branch: flow.branch,
            patch,
            commit_msg: flow.commit_msg,
            base: flow.base,
            policy: flow.policy,
            build: flow.build,
            required: flow.required,
        };
        let reloc: Option<candidate::Relocate<'_>> = flow.annexe.as_ref().map(|_| &relocate as _);
        candidate::run(&input, flow.runner, reloc)
    };
    let tree = attempt.prepared.as_ref().map(|c| c.tree_hash.clone());
    let err = match &attempt.state {
        CandidateState::Applied { .. } => None,
        other => Some(format!("{other:?}")),
    };
    j.completed(c, err.is_none(), json!({ "error": err, "tree": tree }))
        .await;
    for r in shipped.into_inner() {
        let jc = j.called("annexe.clone", json!({ "op": "candidate" })).await;
        j.completed(jc, r.is_ok(), json!({ "error": r.err() }))
            .await;
    }
    if !attempt.receipts.is_empty() {
        let jc = j
            .called(
                "annexe.exec",
                json!({ "op": "evaluate", "phase": "candidate" }),
            )
            .await;
        j.completed(
            jc,
            true,
            json!({ "outcomes": receipt_outcomes(&attempt.receipts) }),
        )
        .await;
        for r in &attempt.receipts {
            info!(receipt = %r.summary(), "candidate evaluator");
        }
    }
    attempt
}

/// Build `patch` in isolation, re-run the required evaluators on it and, when
/// git refuses the diff, give the model exactly one chance to correct it.
///
/// The repair carries git's error and the real file text where it failed —
/// never evaluator receipts — and the corrected diff goes through
/// `candidate::run` like any other. The reply is receipted in
/// `apply-repair.json`, which a restarted night reuses instead of asking
/// again (only for the exact patch it repaired).
pub async fn attempt(flow: &Flow<'_>, patch: &str, j: &Journal) -> Attempt {
    attempt_judged(flow, patch, j).await.0
}

/// [`attempt`], also returning the patch text the final state came from: the
/// extracted patch, or the corrected one when the repair pass ran. Replay
/// records that text, so its guard cross-check sees the diff that was judged.
pub async fn attempt_judged(flow: &Flow<'_>, patch: &str, j: &Journal) -> (Attempt, String) {
    let first = run_once(flow, patch, "apply-candidate", j).await;
    let detail = match &first.error {
        Some(AttemptError::PatchDidNotApply { stderr }) if first.prepared.is_none() => {
            stderr.clone()
        }
        _ => return (first, patch.to_string()),
    };

    let rec_path = flow.night_dir.join("apply-repair.json");
    let recorded = std::fs::read(&rec_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<RepairRecord>(&b).ok())
        .filter(|r| r.repairs(patch));
    let record = match recorded {
        Some(r) => r,
        None => {
            info!("candidate patch did not apply — running the one-shot apply-repair pass");
            let excerpt = source::failing_hunk(&detail).and_then(|(path, line)| {
                source::failing_excerpt(flow.repo, flow.base, &path, line, 40)
            });
            let prompt =
                source::apply_repair_prompt(flow.report, patch, &detail, excerpt.as_deref());
            let c = j
                .called(
                    "llm.call",
                    json!({ "purpose": "apply-repair", "model": flow.llm.identity().model }),
                )
                .await;
            let r = source::apply_repair(flow.llm, flow.fallback, patch, prompt).await;
            j.completed(c, matches!(r.outcome, RepairOutcome::Patch(_)), json!({}))
                .await;
            let _ = write_atomic(
                &rec_path,
                &serde_json::to_vec_pretty(&r).unwrap_or_default(),
            );
            r
        }
    };

    let mut judged = patch.to_string();
    let result = match &record.outcome {
        RepairOutcome::Patch(fixed) if !dream_gate::patch::deletes_binary(fixed) => {
            let mut second = run_once(flow, fixed, "apply-repaired-candidate", j).await;
            judged = fixed.clone();
            info!(
                applied = matches!(second.state, CandidateState::Applied { .. }),
                "apply-repair candidate"
            );
            match &second.state {
                CandidateState::Applied { .. } => {
                    // Say plainly that a second model call rewrote the diff
                    // that is being tested.
                    if let Some(p) = second.prepared.as_mut() {
                        p.applied_via = format!(
                            "apply-repair({}): {}",
                            &record.prompt_digest[..record.prompt_digest.len().min(12)],
                            p.applied_via
                        );
                    }
                }
                CandidateState::DidNotApply { detail: again } if second.prepared.is_none() => {
                    let again = match &second.error {
                        Some(AttemptError::PatchDidNotApply { stderr }) => stderr.clone(),
                        _ => again.clone(),
                    };
                    second.state = CandidateState::DidNotApply {
                        detail: format!(
                            "{APPLY_FAILED}{detail}; the one repair pass also failed: {again}"
                        ),
                    };
                }
                // Protected, Refused, or a provisioning failure: the second
                // attempt's own state is the truth, and a corrected diff that
                // touches a protected path is a REJECT like any other.
                _ => {}
            }
            second
        }
        other => {
            let why = match other {
                RepairOutcome::NoPatch(r) => format!("model declined: {r}"),
                RepairOutcome::LlmError(e) => format!("repair call failed: {e}"),
                RepairOutcome::Patch(_) => "repaired patch deletes a binary file".into(),
                RepairOutcome::Absent => "repair reply carried no diff".into(),
            };
            info!(%why, "apply-repair produced no usable diff");
            Attempt {
                state: CandidateState::DidNotApply {
                    detail: format!("{APPLY_FAILED}{detail}; repair pass: {why}"),
                },
                prepared: None,
                receipts: Vec::new(),
                build: None,
                error: Some(AttemptError::PatchDidNotApply { stderr: detail }),
            }
        }
    };
    (result, judged)
}

/// The `candidate.json` record for an attempt that built a tree. `None` when
/// nothing was built (a refused, protected or non-applying patch).
pub fn candidate_record(run_id: &str, attempt: &Attempt) -> Option<CandidateRecord> {
    let c = attempt.prepared.as_ref()?;
    Some(CandidateRecord {
        schema: MANIFEST_SCHEMA,
        run_id: run_id.to_string(),
        patch_digest: c.patch_digest.clone(),
        patch_bytes: c.patch_bytes,
        candidate_tree_hash: c.tree_hash.clone(),
        branch: c.branch.clone(),
        applied: matches!(attempt.state, CandidateState::Applied { .. }),
        apply_error: match &attempt.state {
            CandidateState::DidNotApply { detail } | CandidateState::Refused { detail } => {
                Some(detail.clone())
            }
            CandidateState::Protected { paths } => Some(format!("protected: {}", paths.join(", "))),
            _ => None,
        },
        applied_via: c.applied_via.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Digest of the `dream.config.json` the candidate tree was evaluated with,
/// for `GateContext::with_config_digest`. `None` when the tree carries no
/// config (an untracked file is not in `git archive` either), which skips the
/// drift check rather than inventing one.
pub fn tree_config_digest(prepared: &PreparedCandidate) -> Option<String> {
    match std::fs::read(prepared.worktree.join("dream.config.json")) {
        Ok(bytes) => Some(digest(&bytes)),
        Err(e) => {
            warn!(error = %e, "candidate tree has no dream.config.json — config drift check skipped");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dream_core::runner::LocalRunner;
    use dream_core::seams::{BoxFut, LlmError, LlmRequest};
    use dream_gate::config::EvaluatorSpec;
    use dream_gate::manifest::ModelIdentity;
    use dream_gate::outcome::ExecOutcome;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    /// Counts every command it is asked to run, then delegates.
    struct Counting(AtomicUsize);
    impl EvaluatorRunner for Counting {
        fn run(&self, work_dir: &str, command: &str, timeout_secs: u64) -> ExecOutcome {
            self.0.fetch_add(1, Ordering::SeqCst);
            LocalRunner.run(work_dir, command, timeout_secs)
        }
        fn describe(&self) -> String {
            "counting".into()
        }
    }

    /// Replies with a fixed string and counts calls.
    struct Scripted {
        reply: Mutex<String>,
        calls: AtomicUsize,
    }
    impl Scripted {
        fn new(reply: &str) -> Self {
            Self {
                reply: Mutex::new(reply.into()),
                calls: AtomicUsize::new(0),
            }
        }
    }
    impl Llm for Scripted {
        fn complete<'a>(&'a self, _req: &'a LlmRequest) -> BoxFut<'a, Result<String, LlmError>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let r = self.reply.lock().unwrap().clone();
            Box::pin(async move { Ok(r) })
        }
        fn identity(&self) -> ModelIdentity {
            ModelIdentity {
                provider: "test".into(),
                model: "scripted".into(),
                max_tokens: 1024,
                fallback: None,
            }
        }
    }

    fn scratch_repo() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let repo = d.path().join("repo");
        std::fs::create_dir_all(repo.join("scripts")).unwrap();
        std::fs::create_dir_all(repo.join(".github/workflows")).unwrap();
        let git = |a: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(a)
                .output()
                .unwrap()
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "dream@test"]);
        git(&["config", "user.name", "dream"]);
        std::fs::write(repo.join("value.txt"), "42\n").unwrap();
        std::fs::write(repo.join(".github/workflows/ci.yml"), "name: ci\n").unwrap();
        std::fs::write(
            repo.join("scripts/check.sh"),
            "#!/bin/bash\nv=$(cat value.txt)\nif [ \"$v\" = \"42\" ]; then echo \"check ok: $v\"; exit 0; fi\necho \"FAIL: got $v\"\nexit 1\n",
        )
        .unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);
        (d, repo)
    }

    fn state(repo: &Path) -> String {
        let g = |a: &[&str]| {
            String::from_utf8_lossy(
                &Command::new("git")
                    .arg("-C")
                    .arg(repo)
                    .args(a)
                    .output()
                    .unwrap()
                    .stdout,
            )
            .to_string()
        };
        format!(
            "{}|{}",
            g(&["branch", "--list", "dream/*"]).trim(),
            g(&["worktree", "list", "--porcelain"])
                .lines()
                .filter(|l| l.starts_with("worktree "))
                .count()
        )
    }

    fn patch_to(path: &str, from: &str, to: &str) -> String {
        format!(
            "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n-{from}\n+{to}\n"
        )
    }

    struct Rig {
        _d: tempfile::TempDir,
        repo: PathBuf,
        night: tempfile::TempDir,
        policy: ProtectedPolicy,
        required: Vec<EvaluatorIdentity>,
        runner: Counting,
        llm: Scripted,
        j: Journal,
    }

    impl Rig {
        fn new(llm_reply: &str) -> Self {
            let (d, repo) = scratch_repo();
            Self {
                _d: d,
                repo,
                night: tempfile::tempdir().unwrap(),
                policy: ProtectedPolicy::default()
                    .with_evaluator_commands(["bash scripts/check.sh"]),
                required: vec![EvaluatorIdentity::from_spec(
                    "check",
                    &EvaluatorSpec::command("bash scripts/check.sh"),
                )],
                runner: Counting(AtomicUsize::new(0)),
                llm: Scripted::new(llm_reply),
                j: Journal::disabled("test"),
            }
        }

        async fn attempt(&self, patch: &str) -> Attempt {
            let required: Vec<&EvaluatorIdentity> = self.required.iter().collect();
            let flow = Flow {
                repo: &self.repo,
                branch: "dream/test-2026-10-01",
                commit_msg: "dream: test",
                base: "HEAD",
                policy: &self.policy,
                build: None,
                required: &required,
                runner: &self.runner,
                annexe: None,
                night_dir: self.night.path(),
                report: "# report",
                llm: &self.llm,
                fallback: None,
            };
            attempt(&flow, patch, &self.j).await
        }
    }

    /// The apply-repair gate matches the typed error, never a string prefix:
    /// the same text under a different error kind is not repaired.
    #[tokio::test]
    async fn the_repair_pass_keys_on_the_typed_error() {
        let rig = Rig::new("NO-PATCH: cannot");
        let a = rig.attempt(&patch_to("value.txt", "nope", "x")).await;
        assert!(matches!(
            a.error,
            Some(AttemptError::PatchDidNotApply { .. })
        ));
        assert_eq!(rig.llm.calls.load(Ordering::SeqCst), 1, "one repair call");
        let source = include_str!("candidate_flow.rs");
        let (prod, _) = source.split_once("#[cfg(test)]").unwrap();
        assert!(
            !prod.contains("strip_prefix(APPLY_FAILED)"),
            "no string-prefix matching of the apply failure"
        );
    }

    /// The patch recorded for replay is the one whose guard result produced
    /// the state: after a repair, the corrected diff, not the original.
    #[tokio::test]
    async fn the_judged_patch_is_the_one_the_final_state_came_from() {
        let fixed = patch_to(".github/workflows/ci.yml", "name: ci", "name: pwned");
        let rig = Rig::new(&format!("```dream-patch\n{fixed}```\n"));
        let required: Vec<&EvaluatorIdentity> = rig.required.iter().collect();
        let flow = Flow {
            repo: &rig.repo,
            branch: "dream/test-2026-10-01",
            commit_msg: "dream: test",
            base: "HEAD",
            policy: &rig.policy,
            build: None,
            required: &required,
            runner: &rig.runner,
            annexe: None,
            night_dir: rig.night.path(),
            report: "# report",
            llm: &rig.llm,
            fallback: None,
        };
        let orig = patch_to("value.txt", "nope", "x");
        let (a, judged) = attempt_judged(&flow, &orig, &rig.j).await;
        let _ = &a;
        assert_ne!(judged, orig);
        assert!(judged.contains(".github/workflows/ci.yml"), "{judged}");
    }

    /// The call-order invariant at the adapter: a protected patch reaches
    /// neither git, nor the build, nor an evaluator, nor the repair model.
    #[tokio::test]
    async fn a_protected_patch_never_reaches_git_an_evaluator_or_the_model() {
        let rig = Rig::new("NO-PATCH: unused");
        let before = state(&rig.repo);
        for target in [".github/workflows/ci.yml", "scripts/check.sh"] {
            let a = rig
                .attempt(&patch_to(target, "name: ci", "name: pwned"))
                .await;
            assert!(
                matches!(a.state, CandidateState::Protected { .. }),
                "{target}: {:?}",
                a.state
            );
            assert!(a.prepared.is_none() && a.receipts.is_empty());
        }
        assert_eq!(rig.runner.0.load(Ordering::SeqCst), 0, "no evaluator ran");
        assert_eq!(rig.llm.calls.load(Ordering::SeqCst), 0, "no repair call");
        assert_eq!(state(&rig.repo), before, "no branch or worktree appeared");
    }

    #[tokio::test]
    async fn a_good_patch_is_applied_and_the_required_evaluators_rerun_on_it() {
        let rig = Rig::new("unused");
        let patch = "diff --git a/NOTES.md b/NOTES.md\nnew file mode 100644\n--- /dev/null\n+++ b/NOTES.md\n@@ -0,0 +1 @@\n+notes\n";
        let a = rig.attempt(patch).await;
        assert!(
            matches!(a.state, CandidateState::Applied { .. }),
            "{:?}",
            a.state
        );
        assert_eq!(a.receipts.len(), 1);
        assert!(a.receipts[0].outcome.is_pass());
        let prepared = a.prepared.as_ref().unwrap();
        assert!(prepared.worktree.join("NOTES.md").exists());
        assert!(
            !rig.repo.join("NOTES.md").exists(),
            "the checkout is untouched"
        );
        let rec = candidate_record("run1", &a).unwrap();
        assert!(rec.applied && rec.apply_error.is_none());
        candidate::discard(&rig.repo, prepared);
    }

    /// A diff git refuses gets one repair; the corrected diff is applied and
    /// receipted, and a restart reuses the receipt instead of asking again.
    #[tokio::test]
    async fn an_unappliable_patch_gets_exactly_one_recorded_repair() {
        let fixed = patch_to("value.txt", "42", "42 ");
        let rig = Rig::new(&format!("```dream-patch\n{fixed}```"));
        let broken = patch_to("value.txt", "nope", "x");
        let a = rig.attempt(&broken).await;
        assert!(
            matches!(a.state, CandidateState::Applied { .. }),
            "{:?}",
            a.state
        );
        assert!(
            a.prepared
                .as_ref()
                .unwrap()
                .applied_via
                .starts_with("apply-repair("),
            "{:?}",
            a.prepared.as_ref().map(|p| &p.applied_via)
        );
        assert_eq!(rig.llm.calls.load(Ordering::SeqCst), 1);
        assert!(rig.night.path().join("apply-repair.json").exists());
        candidate::discard(&rig.repo, a.prepared.as_ref().unwrap());

        // Restart: same failed patch, recorded repair reused, no second call.
        let again = rig.attempt(&broken).await;
        assert!(matches!(again.state, CandidateState::Applied { .. }));
        assert_eq!(rig.llm.calls.load(Ordering::SeqCst), 1, "repair reused");
        candidate::discard(&rig.repo, again.prepared.as_ref().unwrap());
    }

    /// The repair path cannot launder a protected edit: the corrected diff is
    /// guarded by `run` like the original.
    #[tokio::test]
    async fn a_repaired_patch_that_touches_a_protected_path_is_protected() {
        let evil = patch_to(".github/workflows/ci.yml", "name: ci", "name: pwned");
        let rig = Rig::new(&format!("```dream-patch\n{evil}```"));
        let before = state(&rig.repo);
        let a = rig.attempt(&patch_to("value.txt", "nope", "x")).await;
        assert!(
            matches!(a.state, CandidateState::Protected { .. }),
            "{:?}",
            a.state
        );
        assert_eq!(rig.runner.0.load(Ordering::SeqCst), 0);
        assert_eq!(state(&rig.repo), before);
    }

    #[tokio::test]
    async fn a_declined_repair_leaves_a_did_not_apply_state_with_the_reason() {
        let rig = Rig::new("NO-PATCH: cannot see the file");
        let a = rig.attempt(&patch_to("value.txt", "nope", "x")).await;
        let CandidateState::DidNotApply { detail } = &a.state else {
            panic!("{:?}", a.state)
        };
        assert!(detail.starts_with(APPLY_FAILED), "{detail}");
        assert!(detail.contains("repair pass: model declined: cannot see the file"));
        assert!(a.prepared.is_none() && candidate_record("r", &a).is_none());
        assert_eq!(rig.runner.0.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_binary_deletion_is_refused_before_any_git_command() {
        let rig = Rig::new("unused");
        let before = state(&rig.repo);
        let p = "diff --git a/logo.png b/logo.png\ndeleted file mode 100644\nGIT binary patch\ndelta 1\nHc${\n";
        let a = rig.attempt(p).await;
        assert!(
            matches!(a.state, CandidateState::Refused { .. }),
            "{:?}",
            a.state
        );
        assert_eq!(rig.llm.calls.load(Ordering::SeqCst), 0);
        assert_eq!(state(&rig.repo), before);
    }

    #[test]
    fn the_candidate_trees_config_digest_is_what_the_gate_compares() {
        let d = tempfile::tempdir().unwrap();
        let p = PreparedCandidate {
            worktree: d.path().to_path_buf(),
            branch: "b".into(),
            tree_hash: "t".into(),
            patch_digest: "p".into(),
            patch_bytes: 0,
            applied_via: String::new(),
            applied_patch: String::new(),
        };
        assert!(tree_config_digest(&p).is_none(), "no config, no check");
        std::fs::write(d.path().join("dream.config.json"), b"{}").unwrap();
        assert_eq!(tree_config_digest(&p), Some(digest(b"{}")));
    }
}
