//! Whole-night, end-to-end tests of the dream engine.
//!
//! Each test builds a throwaway git repository with a `dream.config.json` and
//! a shell-evaluated project, then drives the REAL `Engine::run_night` through
//! roster selection, manifest freeze, annexe provisioning, the baseline
//! evaluator pass, the model call, the protected-path guard, patch apply in a
//! worktree, the candidate evaluator rerun, the gate, replay capture, the
//! ledger row and the persisted run state.
//!
//! What is substituted (all at existing or constructor seams, none inside the
//! engine):
//! * the model: a scripted [`Llm`] (`Engine::llm_override`);
//! * the forge: a recording [`Forge`] (`Engine::forge`) — no PR is ever opened;
//! * evaluators: [`LocalRunner`] wrapped in a recording runner;
//! * the annexe transport: fake `ssh`/`scp` executables first on `PATH` that
//!   run the command locally (host must end in `.invalid`, anything else is
//!   refused) and log every call per host.
//!
//! Everything lives in a tempdir; the process-wide environment is set exactly
//! once, before any test body runs.

use std::collections::VecDeque;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Once};

use dream_core::ledger::{self, LedgerRow};
use dream_core::replay;
use dream_core::runner::LocalRunner;
use dream_core::runstate;
use dream_core::seams::{BoxFut, DraftPr, Forge, Llm, LlmError, LlmRequest, PrOutcome};
use dream_core::streak;
use dream_engine::engine::Engine;
use dream_engine::llm::{LlmConfig, Provider};
use dream_engine::runner::EvaluatorRunner;
use dream_engine::ruvector::RuVectorConfig;
use dream_gate::manifest::ModelIdentity;
use dream_gate::outcome::ExecOutcome;
use dream_gate::receipts::{self, Phase};
use futures_util::FutureExt;

const DATE: &str = "2026-10-14";
const DEEP: &str = "core";

// ---------------------------------------------------------------------------
// Process-wide hermetic environment (once)
// ---------------------------------------------------------------------------

static ENV: Once = Once::new();

const SSH_SHIM: &str = r#"#!/bin/bash
while [ "$1" = "-o" ]; do shift 2; done
host="$1"; shift
case "$host" in
  *.invalid) ;;
  *) echo "shim: refusing host $host" >&2; exit 255 ;;
esac
echo "ssh $*" >> "$SHIM_LOG_DIR/$host.log"
cmd="$*"
cmd="${cmd/#bash -lc /bash -c }"
exec bash -c "$cmd"
"#;

const SCP_SHIM: &str = r#"#!/bin/bash
while [ "$1" = "-o" ]; do shift 2; done
src="$1"; dst="$2"
host="${dst%%:*}"; path="${dst#*:}"
case "$host" in
  *.invalid) ;;
  *) echo "shim: refusing host $host" >&2; exit 255 ;;
esac
echo "scp $src -> $path" >> "$SHIM_LOG_DIR/$host.log"
cp "$src" "$path"
"#;

fn setup_env() {
    ENV.call_once(|| {
        let base = tempfile::Builder::new()
            .prefix("dream-e2e-")
            .tempdir()
            .expect("scratch dir")
            .keep();
        let bin = base.join("bin");
        let logs = base.join("shim-logs");
        let tmp = base.join("tmp");
        for d in [&bin, &logs, &tmp] {
            std::fs::create_dir_all(d).unwrap();
        }
        for (name, body) in [("ssh", SSH_SHIM), ("scp", SCP_SHIM)] {
            let p = bin.join(name);
            std::fs::write(&p, body).unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let old_path = std::env::var("PATH").unwrap_or_default();
        // SAFETY of intent: set once, before any engine code runs, under `Once`.
        std::env::set_var("PATH", format!("{}:{}", bin.display(), old_path));
        std::env::set_var("SHIM_LOG_DIR", &logs);
        std::env::set_var("TMPDIR", &tmp);
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        std::env::set_var("DREAM_INBOX_PATH", base.join("inbox.json"));
        std::env::set_var("DREAM_HEALTH_PATH", base.join("last-night.json"));
        std::env::set_var("DREAM_PAUSE_FLAG", base.join("no-such-pause-flag"));
        for off in [
            "DREAM_JOURNAL",
            "DREAM_SWEEP",
            "DREAM_DIGEST",
            "DREAM_GOVERNANCE",
            "DREAM_FORUM_SUGGESTIONS",
            "DREAM_SELF_GC",
            "DREAM_SOURCE_READ",
        ] {
            std::env::set_var(off, "0");
        }
        std::env::remove_var("DREAM_LEDGER_COMMIT");
    });
}

fn shim_log(host: &str) -> String {
    let p = PathBuf::from(std::env::var("SHIM_LOG_DIR").unwrap()).join(format!("{host}.log"));
    std::fs::read_to_string(p).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/// A model that returns queued replies and counts its calls.
struct ScriptedLlm {
    replies: Mutex<VecDeque<String>>,
    calls: AtomicUsize,
}

impl ScriptedLlm {
    fn new(replies: Vec<String>) -> Arc<Self> {
        Arc::new(Self {
            replies: Mutex::new(replies.into()),
            calls: AtomicUsize::new(0),
        })
    }
    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl Llm for ScriptedLlm {
    fn complete<'a>(&'a self, _req: &'a LlmRequest) -> BoxFut<'a, Result<String, LlmError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let next = self.replies.lock().unwrap().pop_front();
        Box::pin(async move {
            next.ok_or_else(|| LlmError::Transport("scripted model has no more replies".into()))
        })
    }
    fn identity(&self) -> ModelIdentity {
        ModelIdentity {
            provider: "scripted".into(),
            model: "scripted-1".into(),
            max_tokens: 4096,
            fallback: None,
        }
    }
}

/// A forge that records what it was asked to publish and opens nothing.
#[derive(Default)]
struct RecordingForge {
    asked: Mutex<Vec<DraftPr>>,
}

impl Forge for RecordingForge {
    fn publish_draft(&self, pr: &DraftPr) -> PrOutcome {
        self.asked.lock().unwrap().push(pr.clone());
        PrOutcome {
            branch: pr.branch.clone(),
            pr_url: Some("https://forge.invalid/o/r/pull/1".into()),
            pushed: true,
        }
    }
}

type Intercept = Box<dyn Fn(&str, &str) -> Option<ExecOutcome> + Send + Sync>;

/// [`LocalRunner`] with a call log and an optional per-call interception.
struct Recording {
    inner: LocalRunner,
    calls: Mutex<Vec<(String, String)>>,
    intercept: Intercept,
}

impl Recording {
    fn new(intercept: Intercept) -> Arc<Self> {
        Arc::new(Self {
            inner: LocalRunner,
            calls: Mutex::new(Vec::new()),
            intercept,
        })
    }
    fn passthrough() -> Arc<Self> {
        Self::new(Box::new(|_, _| None))
    }
    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().unwrap().clone()
    }
    fn candidate_calls(&self) -> usize {
        self.calls()
            .iter()
            .filter(|(wd, _)| wd.contains("/candidate/"))
            .count()
    }
}

impl EvaluatorRunner for Recording {
    fn run(&self, work_dir: &str, command: &str, timeout_secs: u64) -> ExecOutcome {
        self.calls
            .lock()
            .unwrap()
            .push((work_dir.to_string(), command.to_string()));
        match (self.intercept)(work_dir, command) {
            Some(o) => o,
            None => self.inner.run(work_dir, command, timeout_secs),
        }
    }
    fn describe(&self) -> String {
        "recording-local".into()
    }
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

struct Rig {
    _tmp: tempfile::TempDir,
    name: String,
    host: String,
    workspace: PathBuf,
    repo: PathBuf,
    artefacts: PathBuf,
    roster: PathBuf,
    annexe: PathBuf,
    llm: Arc<ScriptedLlm>,
    forge: Arc<RecordingForge>,
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn ledger_row(verdict: &str) -> LedgerRow {
    LedgerRow {
        date: "2026-10-01".into(),
        deep: DEEP.into(),
        finding: "a concrete earlier result".into(),
        issue: "NONE".into(),
        pr: "NONE".into(),
        evaluated: "yes".into(),
        verdict: verdict.into(),
        effect: String::new(),
        witness: "abcd1234".into(),
        prior_fates: String::new(),
        reviewer: String::new(),
        review_minutes: String::new(),
    }
}

impl Rig {
    /// `seed_dry` REJECT rows are committed into the ledger first.
    fn new(name: &str, replies: Vec<String>, seed_dry: usize) -> Self {
        setup_env();
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("ws");
        let repo = workspace.join(name);
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::create_dir_all(repo.join("scripts")).unwrap();
        std::fs::write(
            repo.join("dream.config.json"),
            format!(
                r#"{{"repo":"o/{name}","slots":[{{"deep":"{DEEP}","scan":["src"]}}],
                "evaluatorEntrypoints":{{"check":{{"cmd":"bash scripts/check.sh","required":true,"timeoutSecs":60}}}}}}"#
            ),
        )
        .unwrap();
        std::fs::write(
            repo.join("src/greeting.txt"),
            "greeting=hello\naudience=world\n",
        )
        .unwrap();
        std::fs::write(
            repo.join("scripts/check.sh"),
            "#!/bin/bash\nset -e\ngrep -q '^greeting=hello$' src/greeting.txt\necho \"check: greeting intact\"\n",
        )
        .unwrap();
        if seed_dry > 0 {
            let ledger_path = repo.join("docs/dream-cycle/LEDGER.md");
            for _ in 0..seed_dry {
                ledger::append_row(&ledger_path, &ledger_row("REJECT")).unwrap();
            }
        }
        git(&repo, &["init", "-q", "-b", "main"]);
        git(&repo, &["config", "user.name", "e2e"]);
        git(&repo, &["config", "user.email", "e2e@example.invalid"]);
        git(&repo, &["config", "commit.gpgsign", "false"]);
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-q", "-m", "seed"]);
        let annexe = tmp.path().join("annexe");
        Self {
            host: format!("fake-annexe-{name}.invalid"),
            name: name.into(),
            artefacts: tmp.path().join("artefacts"),
            roster: tmp.path().join("roster.json"),
            annexe,
            repo,
            workspace,
            llm: ScriptedLlm::new(replies),
            forge: Arc::new(RecordingForge::default()),
            _tmp: tmp,
        }
    }

    fn engine(&self, runner: Arc<dyn EvaluatorRunner>) -> Engine {
        let runtime = format!(
            "hp_host = \"{}\"\nhp_annexe_dir = \"{}\"\npersist_accepts = true\n",
            self.host,
            self.annexe.display()
        );
        Engine {
            runtime: toml::from_str(&runtime).expect("runtime config"),
            workspace: self.workspace.clone(),
            artefact_dir: self.artefacts.clone(),
            llm: LlmConfig {
                provider: Provider::Loom,
                url: "http://127.0.0.1:9".into(),
                model: "unused-override-is-set".into(),
                max_tokens: 1024,
                api_key: None,
            },
            llm_fallback: None,
            ruvector: RuVectorConfig {
                pg_url: String::new(),
                xinference_url: String::new(),
                namespace: "dream-e2e".into(),
            },
            runner,
            roster_path: self.roster.clone(),
            forge: self.forge.clone(),
            llm_override: Some(self.llm.clone()),
        }
    }

    fn night_dir(&self) -> PathBuf {
        self.artefacts.join(format!("{DATE}-{}", self.name))
    }

    fn ledger_text(&self) -> String {
        std::fs::read_to_string(self.repo.join("docs/dream-cycle/LEDGER.md")).unwrap_or_default()
    }

    fn dream_branches(&self) -> Vec<String> {
        git(&self.repo, &["branch", "--list", "dream/*"])
            .lines()
            .map(|l| l.trim().trim_start_matches("* ").to_string())
            .filter(|l| !l.is_empty())
            .collect()
    }

    fn gate_json(&self) -> serde_json::Value {
        let raw = std::fs::read(self.night_dir().join("gate.json")).expect("gate.json written");
        serde_json::from_slice(&raw).unwrap()
    }

    fn run_state(&self) -> runstate::RunState {
        runstate::load(&self.night_dir()).expect("run state persisted")
    }

    /// `replay::verify` on the captured night reproduces the recorded verdict.
    fn assert_replay_reproduces(&self, expected_verdict: &str) {
        let v = replay::verify(&self.night_dir()).expect("night was captured for replay");
        assert!(v.matches, "replay disagreed: {:?}", v.diffs);
        assert!(v.diffs.is_empty(), "replay diffs: {:?}", v.diffs);
        assert_eq!(v.recorded.verdict, expected_verdict);
        assert_eq!(v.recomputed.verdict, expected_verdict);
    }

    fn only_outcome(outcomes: Option<Vec<(String, String)>>) -> String {
        let outcomes = outcomes.expect("dreaming is not paused");
        assert_eq!(outcomes.len(), 1, "one nominated repo: {outcomes:?}");
        outcomes[0].1.clone()
    }
}

// ---------------------------------------------------------------------------
// Scripted model replies
// ---------------------------------------------------------------------------

const GOOD_PATCH: &str = "diff --git a/src/greeting.txt b/src/greeting.txt\n\
--- a/src/greeting.txt\n\
+++ b/src/greeting.txt\n\
@@ -1,2 +1,3 @@\n \
greeting=hello\n \
audience=world\n\
+punctuation=!\n";

const BREAKING_PATCH: &str = "diff --git a/src/greeting.txt b/src/greeting.txt\n\
--- a/src/greeting.txt\n\
+++ b/src/greeting.txt\n\
@@ -1,2 +1,2 @@\n\
-greeting=hello\n\
+greeting=howdy\n \
audience=world\n";

const WORKFLOW_PATCH: &str = "diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n\
new file mode 100644\n\
--- /dev/null\n\
+++ b/.github/workflows/x.yml\n\
@@ -0,0 +1,2 @@\n\
+name: x\n\
+on: push\n";

const CONFIG_PATCH: &str = "diff --git a/dream.config.json b/dream.config.json\n\
--- a/dream.config.json\n\
+++ b/dream.config.json\n\
@@ -1 +1 @@\n\
-{\"repo\":\"o/PLACEHOLDER\",\"slots\":[{\"deep\":\"core\",\"scan\":[\"src\"]}],\n\
+{\"repo\":\"o/PLACEHOLDER\",\"slots\":[{\"deep\":\"core\",\"scan\":[\"src\"]}],\"x\":1,\n";

fn accept_report(patch: &str) -> String {
    format!(
        "# Dream night\n\nFinding: the greeting file is missing punctuation, a safe cosmetic change.\n\n\
         ```dream-patch\n{patch}```\n\nNext steps: none.\n\nVERDICT: ACCEPT\n"
    )
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/// (1) A harmless source patch: ACCEPT, a verified branch, a forge request,
/// a ledger row, a completed run state, and a replayable artefact directory.
#[tokio::test]
async fn an_accepted_night_leaves_a_branch_a_forge_request_a_ledger_row_and_a_replay() {
    let rig = Rig::new("e2e-accept", vec![accept_report(GOOD_PATCH)], 0);
    let runner = Recording::passthrough();
    let engine = rig.engine(runner.clone());

    let verdict = Rig::only_outcome(engine.run_night(0, DATE).await);

    assert_eq!(verdict, "ACCEPT");
    assert_eq!(rig.llm.calls(), 1, "exactly one model call");

    // Baseline on the annexe checkout, rerun on the candidate tree.
    let calls = runner.calls();
    assert!(calls.iter().any(|(wd, _)| !wd.contains("/candidate/")));
    assert_eq!(
        runner.candidate_calls(),
        1,
        "required evaluator re-run once"
    );

    // The candidate tree really was shipped to the (fake) annexe — this is what
    // makes the "nothing shipped" assertion in the protected-path tests mean something.
    assert!(
        shim_log(&rig.host).contains("candidate"),
        "candidate never reached the annexe:\n{}",
        shim_log(&rig.host)
    );

    // On-disk artefacts.
    let nd = rig.night_dir();
    for f in ["manifest.json", "gate.json", "report.md", "replay.json"] {
        assert!(nd.join(f).is_file(), "{f} missing from {}", nd.display());
    }
    let gate = rig.gate_json();
    assert_eq!(gate["accepted"], true);
    assert_eq!(gate["verdict"], "ACCEPT");
    assert_eq!(receipts::load(&nd, Phase::Baseline).len(), 1);
    assert_eq!(receipts::load(&nd, Phase::Candidate).len(), 1);
    let rs = rig.run_state();
    assert_eq!(rs.phase, runstate::Phase::Complete);
    assert_eq!(rs.verdict.as_deref(), Some("ACCEPT"));

    // The verified candidate lives on its own branch; main is untouched.
    let branch = dream_core::persist::branch_name(DEEP, DATE);
    assert_eq!(rig.dream_branches(), vec![branch.clone()]);
    let on_branch = git(&rig.repo, &["show", &format!("{branch}:src/greeting.txt")]);
    assert!(on_branch.contains("punctuation=!"), "{on_branch}");
    let on_main = git(&rig.repo, &["show", "main:src/greeting.txt"]);
    assert!(!on_main.contains("punctuation"), "main must not change");

    // The forge was asked, once, for a draft of that branch; nothing opened.
    let asked = rig.forge.asked.lock().unwrap().clone();
    assert_eq!(asked.len(), 1, "one publish request");
    assert_eq!(asked[0].branch, branch);
    assert_eq!(asked[0].repo_slug, "o/e2e-accept");
    assert_eq!(asked[0].repo_dir, rig.repo);
    assert!(asked[0].body.contains("check=") || asked[0].body.contains("GATED ACCEPT"));

    // Ledger row, committed on main, carrying the forge's PR reference.
    let ledger = rig.ledger_text();
    let last = ledger.lines().last().unwrap();
    assert!(last.contains("ACCEPT"), "{last}");
    assert!(last.contains("forge.invalid/o/r/pull/1"), "{last}");
    assert!(
        git(&rig.repo, &["log", "--format=%s", "-3"]).contains("ledger")
            || git(&rig.repo, &["status", "--porcelain"]).trim().is_empty()
    );

    // The roster remembers the night.
    assert!(std::fs::read_to_string(&rig.roster)
        .unwrap()
        .contains("e2e-accept"));

    rig.assert_replay_reproduces("ACCEPT");
}

/// (2) The candidate breaks a required evaluator: the model said ACCEPT, the
/// gate says REJECT, and no branch or forge request survives.
#[tokio::test]
async fn a_candidate_that_breaks_a_required_evaluator_is_rejected() {
    let rig = Rig::new("e2e-breaks", vec![accept_report(BREAKING_PATCH)], 0);
    let runner = Recording::passthrough();
    let engine = rig.engine(runner.clone());

    let verdict = Rig::only_outcome(engine.run_night(0, DATE).await);

    assert_eq!(verdict, "REJECT");
    assert_eq!(rig.llm.calls(), 1);
    assert_eq!(runner.candidate_calls(), 1, "the rerun happened and failed");

    let gate = rig.gate_json();
    assert_eq!(gate["accepted"], false);
    assert_eq!(gate["modelVerdict"], "ACCEPT");
    assert_eq!(gate["verdict"], "REJECT");
    assert_eq!(gate["vetoes"][0]["subject"], "check");

    let nd = rig.night_dir();
    let cand = receipts::load(&nd, Phase::Candidate);
    assert_eq!(cand.len(), 1);
    assert_eq!(
        cand[0].exit_code,
        Some(1),
        "the evaluator failed on the candidate"
    );

    assert!(
        rig.dream_branches().is_empty(),
        "vetoed branch is discarded"
    );
    assert!(
        rig.forge.asked.lock().unwrap().is_empty(),
        "no publish request"
    );
    let ledger = rig.ledger_text();
    assert!(ledger.lines().last().unwrap().contains("REJECT"));
    assert!(ledger.lines().last().unwrap().contains("VETOED"));
    assert_eq!(rig.run_state().verdict.as_deref(), Some("REJECT"));

    rig.assert_replay_reproduces("REJECT");
}

async fn protected_night(name: &str, patch: String, touched: &str) {
    let rig = Rig::new(name, vec![accept_report(&patch)], 0);
    let runner = Recording::passthrough();
    let engine = rig.engine(runner.clone());

    let verdict = Rig::only_outcome(engine.run_night(0, DATE).await);

    assert_eq!(verdict, "REJECT", "a protected-path patch is rejected");
    assert_eq!(rig.llm.calls(), 1);

    // The decisive assertion: the patched tree was never touched. Nothing
    // ran in a candidate directory, and the only evaluator call was the
    // baseline one.
    assert_eq!(
        runner.candidate_calls(),
        0,
        "no candidate-phase evaluator call"
    );
    assert_eq!(
        runner.calls().len(),
        1,
        "baseline only: {:?}",
        runner.calls()
    );
    assert!(
        !shim_log(&rig.host).is_empty(),
        "the baseline did use the shim"
    );
    assert!(
        !shim_log(&rig.host).contains("candidate"),
        "no candidate was shipped to the annexe:\n{}",
        shim_log(&rig.host)
    );
    assert!(
        rig.dream_branches().is_empty(),
        "no dream/* branch was created"
    );
    let worktrees = git(&rig.repo, &["worktree", "list", "--porcelain"]);
    assert_eq!(worktrees.matches("worktree ").count(), 1, "{worktrees}");
    assert!(receipts::load(&rig.night_dir(), Phase::Candidate).is_empty());

    let gate = rig.gate_json();
    assert_eq!(gate["verdict"], "REJECT");
    assert_eq!(gate["vetoes"][0]["subject"], "protected-path");
    assert!(
        gate["vetoes"][0]["reason"]
            .as_str()
            .unwrap()
            .contains(touched),
        "veto names the protected file: {}",
        gate["vetoes"][0]
    );
    assert!(rig.forge.asked.lock().unwrap().is_empty());
    assert!(rig.ledger_text().lines().last().unwrap().contains("REJECT"));

    rig.assert_replay_reproduces("REJECT");
}

/// (3a) A patch that adds a workflow file never reaches git or an evaluator.
#[tokio::test]
async fn a_patch_touching_a_workflow_is_refused_before_anything_runs() {
    protected_night(
        "e2e-protected-wf",
        WORKFLOW_PATCH.to_string(),
        ".github/workflows/x.yml",
    )
    .await;
}

/// (3b) A patch that edits `dream.config.json` (the experiment's own rules).
#[tokio::test]
async fn a_patch_editing_the_dream_config_is_refused_before_anything_runs() {
    protected_night(
        "e2e-protected-cfg",
        CONFIG_PATCH.replace("PLACEHOLDER", "e2e-protected-cfg"),
        "dream.config.json",
    )
    .await;
}

/// (4a) The annexe cannot run the baseline: BLOCKED-ENV, the model is never
/// asked, and the repo's dry streak is exactly what it was.
#[tokio::test]
async fn a_transport_fault_at_baseline_is_blocked_env_and_the_dry_streak_is_unchanged() {
    let rig = Rig::new("e2e-blocked-base", vec![accept_report(GOOD_PATCH)], 2);
    assert_eq!(streak::dry_streak_text(&rig.ledger_text()), 2);
    let runner = Recording::new(Box::new(|_, _| {
        Some(ExecOutcome::blocked("ssh: connection lost"))
    }));
    let engine = rig.engine(runner.clone());

    let verdict = Rig::only_outcome(engine.run_night(0, DATE).await);

    assert_eq!(verdict, "BLOCKED-ENV");
    assert_eq!(
        rig.llm.calls(),
        0,
        "no model call without baseline evidence"
    );
    assert_eq!(runner.candidate_calls(), 0);
    assert_eq!(
        streak::dry_streak_text(&rig.ledger_text()),
        2,
        "streak unchanged"
    );
    assert!(rig
        .ledger_text()
        .lines()
        .last()
        .unwrap()
        .contains("BLOCKED-ENV"));
    assert!(rig.dream_branches().is_empty());
    assert!(rig.forge.asked.lock().unwrap().is_empty());
    // This night never reached the gate, so there is nothing to replay.
    assert!(!rig.night_dir().join("replay.json").exists());
    assert_eq!(rig.run_state().verdict.as_deref(), Some("BLOCKED-ENV"));
}

/// (4b) The baseline is fine but the candidate rerun hits a transport fault:
/// the gate calls it BLOCKED-ENV (a harness veto), never REJECT, never a
/// pass, and the dry streak is unchanged.
#[tokio::test]
async fn a_transport_fault_on_the_candidate_rerun_is_blocked_env_and_the_dry_streak_is_unchanged() {
    let rig = Rig::new("e2e-blocked-rerun", vec![accept_report(GOOD_PATCH)], 2);
    let runner = Recording::new(Box::new(|wd, _| {
        wd.contains("/candidate/")
            .then(|| ExecOutcome::blocked("ssh: connection lost"))
    }));
    let engine = rig.engine(runner.clone());

    let verdict = Rig::only_outcome(engine.run_night(0, DATE).await);

    assert_eq!(verdict, "BLOCKED-ENV");
    assert_eq!(rig.llm.calls(), 1);
    assert_eq!(runner.candidate_calls(), 1);
    assert_eq!(
        streak::dry_streak_text(&rig.ledger_text()),
        2,
        "streak unchanged"
    );
    assert!(
        rig.forge.asked.lock().unwrap().is_empty(),
        "never published"
    );
    assert!(rig.dream_branches().is_empty());
    rig.assert_replay_reproduces("BLOCKED-ENV");
}

/// (5) A crash between ManifestFrozen and ModelCalled: the restart resumes the
/// SAME run, counts the attempt, and asks the model exactly once overall.
#[tokio::test]
async fn a_night_restarted_after_a_crash_resumes_the_same_run_and_calls_the_model_once() {
    let rig = Rig::new("e2e-resume", vec![accept_report(GOOD_PATCH)], 0);

    // First process: the evaluator harness dies on its first baseline call.
    let armed = Arc::new(AtomicBool::new(true));
    let crash = {
        let armed = armed.clone();
        Recording::new(Box::new(move |_, _| {
            if armed.swap(false, Ordering::SeqCst) {
                panic!("simulated process death during the baseline pass");
            }
            None
        }))
    };
    let first = rig.engine(crash.clone());
    let died = AssertUnwindSafe(first.run_night(0, DATE))
        .catch_unwind()
        .await;
    assert!(died.is_err(), "the first process must have died");

    let before = rig.run_state();
    assert_eq!(
        before.phase,
        runstate::Phase::ManifestFrozen,
        "died after the freeze"
    );
    assert_eq!(before.attempts, 1);
    assert_eq!(rig.llm.calls(), 0, "died before the model was asked");
    let manifest_before = std::fs::read(rig.night_dir().join("manifest.json")).unwrap();

    // Second process: same artefact dir, same repo, same date.
    let runner = Recording::passthrough();
    let second = rig.engine(runner.clone());
    let verdict = Rig::only_outcome(second.run_night(0, DATE).await);

    assert_eq!(verdict, "ACCEPT");
    let after = rig.run_state();
    assert_eq!(after.run_id, before.run_id, "the same experiment resumed");
    assert_eq!(after.attempts, 2, "the restart counted an attempt");
    assert_eq!(after.resumed_from, Some(runstate::Phase::ManifestFrozen));
    assert_eq!(after.phase, runstate::Phase::Complete);
    assert_eq!(
        rig.llm.calls(),
        1,
        "the model was called once across both processes"
    );
    assert_eq!(
        std::fs::read(rig.night_dir().join("manifest.json")).unwrap(),
        manifest_before,
        "the frozen manifest was not rewritten"
    );
    assert_eq!(rig.dream_branches().len(), 1);
    assert_eq!(rig.forge.asked.lock().unwrap().len(), 1);

    rig.assert_replay_reproduces("ACCEPT");
}

/// KNOWN GAP (reported, not fixed here): a night that completed is not
/// repeated. Today it IS: the engine's own ledger commit moves the baseline
/// HEAD, `run_id` includes that HEAD, so the next start of the same night
/// computes a different run id, takes the "diverged" path and dreams again
/// (second model call, second ledger row, second publish request). The same
/// hole opens for a crash between the ledger commit and `runstate::complete`.
/// Un-ignore when the run id (or the completion check) stops depending on the
/// engine's own commit.
#[tokio::test]
#[ignore = "known gap: the engine's ledger commit changes the run id, so a finished night is re-run"]
async fn a_finished_night_is_not_repeated_after_its_own_ledger_commit() {
    let rig = Rig::new(
        "e2e-once",
        vec![accept_report(GOOD_PATCH), accept_report(GOOD_PATCH)],
        0,
    );
    let first = rig.engine(Recording::passthrough());
    assert_eq!(Rig::only_outcome(first.run_night(0, DATE).await), "ACCEPT");
    let rows = rig.ledger_text().lines().count();

    let again = rig.engine(Recording::passthrough());
    let _ = again.run_night(0, DATE).await;

    assert_eq!(
        rig.llm.calls(),
        1,
        "a finished night never re-asks the model"
    );
    assert_eq!(
        rig.ledger_text().lines().count(),
        rows,
        "no second ledger row"
    );
    assert_eq!(
        rig.forge.asked.lock().unwrap().len(),
        1,
        "no second publish"
    );
}
