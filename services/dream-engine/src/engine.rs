use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use thiserror::Error;
use tracing::{info, warn};

use crate::candidate;
use crate::compile;
use crate::config::{self, DreamConfig, RuntimeConfig};
use crate::context;
use crate::dispatch;
use crate::gate;
use crate::inbox;
use crate::ledger::{self, LedgerRow};
use crate::llm::{self, LlmConfig, Provider};
use crate::manifest;
use crate::persist;
use crate::readiness;
use crate::receipts;
use crate::roster;
use crate::runner::EvaluatorRunner;
use crate::runstate;
use crate::ruvector::{self, DreamFinding, RuVectorConfig};
use crate::verdict::{self, Verdict};
use crate::witness;

/// Wall-clock budget for a repo's build step. Generous: a cold release build of
/// a Rust workspace on the annexe is minutes, not seconds, and a build that
/// overruns this is itself a finding.
pub const DEFAULT_BUILD_TIMEOUT_SECS: u64 = 3600;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("no nominated repos found under {0}")]
    NoRepos(PathBuf),
    #[error("target {0} is not a nominated repo")]
    UnknownTarget(String),
    #[error("config: {0}")]
    Config(#[from] config::ConfigError),
    #[error("dispatch: {0}")]
    Dispatch(#[from] dispatch::DispatchError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("ledger: {0}")]
    Ledger(#[from] ledger::LedgerError),
}

#[derive(Debug)]
pub struct CycleResult {
    pub repo: String,
    pub verdict: Verdict,
    pub finding: String,
    pub witness_short: String,
    pub report_path: PathBuf,
    pub ledger_path: PathBuf,
    pub stored_to_ruvector: bool,
}

pub struct Engine {
    pub runtime: RuntimeConfig,
    pub workspace: PathBuf,
    pub artefact_dir: PathBuf,
    pub llm: LlmConfig,
    /// Second provider tried when the primary fails both attempts
    /// (e.g. Z.AI gateway 524s → the self-hosted Loom). None disables.
    pub llm_fallback: Option<LlmConfig>,
    pub ruvector: RuVectorConfig,
    /// How evaluator commands are executed. Production wires
    /// [`crate::runner::SshRunner`] at the HP annexe; tests substitute a local
    /// or scripted runner so the acceptance path is exercisable offline.
    pub runner: Arc<dyn EvaluatorRunner>,
    /// Durable fair-scheduling state (least-recently-dreamed first).
    pub roster_path: PathBuf,
}

impl Engine {
    /// Run one full nightly cycle: discover → compile → dispatch → evaluate →
    /// LLM → verdict → persist (report, ledger, witness, RuVector).
    ///
    /// Single-repo entry point: forced `--target`, or the alphabetically
    /// first nominated repo when no target is given. Nightly all-repos
    /// operation lives in [`Engine::run_night`].
    pub async fn run_cycle(
        &self,
        target: Option<&str>,
        day_int: u32,
        date: &str,
        dry_run: bool,
    ) -> Result<CycleResult, EngineError> {
        let repos = self.discover()?;
        let (repo_name, repo_path) = match target {
            Some(t) => repos
                .iter()
                .find(|(n, _)| n == t)
                .cloned()
                .ok_or_else(|| EngineError::UnknownTarget(t.into()))?,
            None => repos[0].clone(),
        };
        self.cycle_repo(&repo_name, &repo_path, day_int, date, dry_run)
            .await
    }

    /// One full night: every eligible nominated repo, serially, capped at
    /// `max_repos_per_night`. A repo whose trailing ledger rows are all
    /// INCONCLUSIVE (`prune_dry_streak` of them) is on standby and skipped —
    /// a dry streak means a saturated repo or a broken harness, and either
    /// way the slot is wasted until a decisive verdict (via a forced
    /// `--target` run or a harness fix) resets the streak.
    /// Returns `None` when dreaming is paused (the night is NOT consumed —
    /// the loop retries the same date after `/dream on`).
    pub async fn run_night(&self, day_int: u32, date: &str) -> Option<Vec<(String, String)>> {
        // Global kill-switch: `/dream off` touches this file; no restart needed.
        let pause_flag = Path::new("/home/devuser/workspace/.agentbox/dream-paused");
        if pause_flag.exists() {
            info!(flag = %pause_flag.display(), "dreaming paused — night skipped (/dream on to resume)");
            return None;
        }

        let repos = match self.discover() {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "night aborted — no nominated repos");
                return Some(vec![]);
            }
        };

        let mut eligible = Vec::new();
        for (name, path) in &repos {
            if path.join(".dream-standby").exists() {
                info!(repo = %name, "standby — manual .dream-standby marker; skipped (/dream revive removes it)");
                continue;
            }
            match self.repo_dry_streak(path) {
                s if s >= self.runtime.prune_dry_streak => {
                    info!(
                        repo = %name,
                        streak = s,
                        limit = self.runtime.prune_dry_streak,
                        "standby — INCONCLUSIVE dry streak; skipped (revive via --target or a harness fix)"
                    );
                }
                _ => eligible.push((name.clone(), path.clone())),
            }
        }

        // Fair, durable roster selection. Alphabetical order plus a hard cap
        // starves the tail of the roster forever (estate review, 2026-09-04);
        // ordering by least-recently-dreamed rotates the cap through every
        // nominated repo, and the ordering key lives on disk so a restart does
        // not reset the rotation.
        let mut roster = roster::load(&self.roster_path);
        roster.prune(&repos.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>());
        let eligible_names: Vec<String> = eligible.iter().map(|(n, _)| n.clone()).collect();
        let selected = roster.select(&eligible_names, self.runtime.max_repos_per_night);
        for name in &eligible_names {
            if !selected.contains(name) {
                info!(
                    repo = %name,
                    cap = self.runtime.max_repos_per_night,
                    last_run = %roster.repos.get(name).map(|e| e.last_run_date.clone()).unwrap_or_default(),
                    "over tonight's cap — deferred, and it leads the next roster"
                );
            }
        }
        let eligible: Vec<(String, PathBuf)> = selected
            .iter()
            .filter_map(|n| eligible.iter().find(|(name, _)| name == n).cloned())
            .collect();

        info!(
            eligible = eligible.len(),
            nominated = repos.len(),
            order = %eligible.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", "),
            "night start — dreaming each eligible repo serially, fairest first"
        );

        let mut outcomes = Vec::new();
        for (name, path) in eligible {
            let verdict_label = match self.cycle_repo(&name, &path, day_int, date, false).await {
                Ok(res) => res.verdict.as_str().to_string(),
                Err(e) => {
                    warn!(repo = %name, error = %e, "cycle failed — continuing with next repo");
                    format!("FAILED: {}", e)
                }
            };
            // A turn is a turn: a blocked or failed night still counts, or a
            // repo with a broken harness would monopolise the roster forever.
            roster.record(&name, date, &verdict_label);
            if let Err(e) = roster::save(&self.roster_path, &roster) {
                warn!(error = %e, "roster persist failed (fail-open — fairness degrades, the night does not)");
            }
            outcomes.push((name, verdict_label));
        }
        info!(
            summary = %outcomes.iter().map(|(n, v)| format!("{}={}", n, v)).collect::<Vec<_>>().join(", "),
            "night complete"
        );

        // Night-health self-check: persist a machine-readable summary and
        // raise an operator alert on anomalies (hard failures, or a night
        // with nothing eligible — a silently shrunken roster is itself a
        // fault). This is the invariant "one honest row per eligible repo".
        let health = serde_json::json!({
            "date": date,
            "outcomes": outcomes.iter().map(|(n, v)| serde_json::json!({"repo": n, "verdict": v})).collect::<Vec<_>>(),
        });
        let _ = std::fs::create_dir_all("/home/devuser/workspace/.agentbox");
        if let Err(e) = std::fs::write(
            "/home/devuser/workspace/.agentbox/dream-last-night.json",
            serde_json::to_string_pretty(&health).unwrap_or_default(),
        ) {
            warn!(error = %e, "night health summary write failed (fail-open)");
        }
        let failures: Vec<&(String, String)> = outcomes
            .iter()
            .filter(|(_, v)| v.starts_with("FAILED") || v == "BLOCKED-ENV")
            .collect();
        if outcomes.is_empty() || !failures.is_empty() {
            let text = if outcomes.is_empty() {
                "Dream night ran with ZERO eligible repos — the whole roster is on standby or dry-streak parked. Decide which repos to revive (/dream revive, or fix evaluators and /dream run).".to_string()
            } else {
                format!(
                    "Dream night had environment failures: {}. The harness needs attention before verdicts can be trusted.",
                    failures.iter().map(|(n, v)| format!("{}={}", n, v)).collect::<Vec<_>>().join(", ")
                )
            };
            if let Err(e) = inbox::add("alert", "roster", &format!("{}-night", date), date, &text) {
                warn!(error = %e, "dream inbox write failed (fail-open)");
            }
        }

        // Post the nightly digest to the forum (JunkieJarvis → dreamlab zone,
        // "chat with agents"). Visibility only — never an approval object.
        // Fail-open: a digest failure never taints the night.
        let digest_script = std::env::var("DREAM_DIGEST_SCRIPT").unwrap_or_else(|_| {
            "/home/devuser/workspace/project/agentbox/scripts/dream-night-digest.mjs".into()
        });
        if Path::new(&digest_script).exists() {
            match Command::new("node")
                .args([&digest_script, "--date", date])
                .output()
            {
                Ok(out) => {
                    let tail = String::from_utf8_lossy(&out.stdout);
                    info!(result = %tail.lines().last().unwrap_or(""), "night digest");
                }
                Err(e) => warn!(error = %e, "night digest failed (fail-open)"),
            }
        }

        // Forum-suggestions tenant: mine the community feature-suggestions
        // thread, triage each new post with the LLM against the action-vs-risk
        // policy, queue handoffs, and reply inline as JunkieJarvis. Same
        // workspace-script pattern as the digest (the script is the live code;
        // this binary only schedules it). Fail-open; opt out with
        // DREAM_FORUM_SUGGESTIONS=0.
        if std::env::var("DREAM_FORUM_SUGGESTIONS").as_deref() != Ok("0") {
            let forum_script = std::env::var("DREAM_FORUM_SCRIPT").unwrap_or_else(|_| {
                "/home/devuser/workspace/project/agentbox/scripts/dream-forum-suggestions.mjs".into()
            });
            if Path::new(&forum_script).exists() {
                match Command::new("node").arg(&forum_script).output() {
                    Ok(out) => {
                        let tail = String::from_utf8_lossy(&out.stdout);
                        info!(result = %tail.lines().last().unwrap_or(""), "forum suggestions");
                    }
                    Err(e) => warn!(error = %e, "forum suggestions failed (fail-open)"),
                }
            }
        }

        Some(outcomes)
    }

    fn discover(&self) -> Result<Vec<(String, PathBuf)>, EngineError> {
        let repos = config::discover_repos(&self.workspace);
        if repos.is_empty() {
            return Err(EngineError::NoRepos(self.workspace.clone()));
        }
        info!(
            count = repos.len(),
            repos = %repos.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", "),
            "discovered nominated repos"
        );
        Ok(repos)
    }

    /// Trailing INCONCLUSIVE streak from the repo's own ledger (0 when the
    /// ledger is missing/unreadable — never punish a repo for having no
    /// history yet, or for a ledger path we cannot resolve).
    fn repo_dry_streak(&self, repo_path: &Path) -> usize {
        let Ok(cfg) = DreamConfig::load(&repo_path.join("dream.config.json")) else {
            return 0;
        };
        match std::fs::read_to_string(repo_path.join(&cfg.ledger_path)) {
            Ok(text) => dry_streak(&text),
            Err(_) => 0,
        }
    }

    async fn cycle_repo(
        &self,
        repo_name: &str,
        repo_path: &Path,
        day_int: u32,
        date: &str,
        dry_run: bool,
    ) -> Result<CycleResult, EngineError> {
        info!(repo = %repo_name, "cycle start");
        let repo_name = repo_name.to_string();
        let repo_path = repo_path.to_path_buf();

        // Load config, pick slot, compile the prompt.
        let config_path = repo_path.join("dream.config.json");
        let config_bytes = std::fs::read(&config_path).unwrap_or_default();
        let cfg = DreamConfig::load(&config_path)?;
        let slot = config::tonight_slot(&cfg, day_int).clone();
        let bonuses = config::bonus_dives(&cfg, day_int);

        let night_id = format!("{}-{}", date, repo_name);
        let night_dir = self.artefact_dir.join(&night_id);

        // 0. Evaluator-readiness admission (ADR-2024 closeout; ADR-072).
        //    A nomination whose evaluators cannot decide anything is refused
        //    HERE — before an annexe clone, a build or a single model token.
        let admission = readiness::assess(&cfg, &repo_name, &slot.deep, &repo_path);
        if !admission.admitted() {
            warn!(
                repo = %repo_name,
                deep = %slot.deep,
                refusal = %admission.refusal(),
                "nomination refused at admission — HANDOFF (nothing scheduled)"
            );
            if dry_run {
                return Ok(CycleResult {
                    repo: repo_name,
                    verdict: Verdict::Handoff,
                    finding: admission.refusal(),
                    witness_short: String::new(),
                    report_path: PathBuf::new(),
                    ledger_path: PathBuf::new(),
                    stored_to_ruvector: false,
                });
            }
            return self
                .persist_handoff(&cfg, &repo_name, &repo_path, &slot.deep, &night_id, date, &admission)
                .await;
        }
        info!(
            repo = %repo_name,
            deep = %slot.deep,
            required = %admission.required.join(", "),
            advisory = %admission.advisory.join(", "),
            "admission passed — evaluators are usable for tonight's deep"
        );

        let mut prompt = compile::compile(&cfg, &slot, day_int, &bonuses);
        info!(chars = prompt.len(), deep = %slot.deep, "prompt compiled");

        // Carry-over: the previous night's own "Next steps" / "Biggest
        // uncertainty" (and any answered operator questions) are the highest-
        // signal hypothesis candidates — feed them forward so consecutive
        // nights compound instead of restarting.
        let carry = self.carry_over(&repo_name, date);
        if !carry.is_empty() {
            prompt.push_str("\n\n## Carry-over from the previous night (verbatim — prefer these as hypothesis candidates when still applicable)\n");
            prompt.push_str(&carry);
            info!(chars = carry.len(), "carry-over appended to prompt");
        }

        if dry_run {
            info!("[dry-run] would dispatch — stopping");
            return Ok(CycleResult {
                repo: repo_name,
                verdict: Verdict::Inconclusive,
                finding: "(dry run)".into(),
                witness_short: String::new(),
                report_path: PathBuf::new(),
                ledger_path: PathBuf::new(),
                stored_to_ruvector: false,
            });
        }

        // 1. Freeze the experiment manifest BEFORE anything else can move.
        //    Baseline revision + tree hash, evaluator identities and command
        //    digests, the model we intend to call, and the restart-safe run id.
        let (baseline_rev, baseline_tree) = match manifest::baseline_of(&repo_path) {
            Ok(b) => b,
            Err(e) => {
                warn!(repo = %repo_name, error = %e, "cannot resolve baseline revision — BLOCKED-ENV");
                return self
                    .persist_blocked_env(
                        &cfg,
                        &repo_name,
                        &repo_path,
                        &slot.deep,
                        &night_id,
                        date,
                        "",
                        &format!("baseline revision unresolvable: {e}"),
                    )
                    .await;
            }
        };
        let frozen = manifest::build(
            &cfg,
            &config_bytes,
            &repo_name,
            &night_id,
            date,
            day_int,
            &slot.deep,
            &slot.scan,
            &baseline_rev,
            &baseline_tree,
            manifest::ModelIdentity {
                provider: format!("{:?}", self.llm.provider).to_lowercase(),
                model: self.llm.model.clone(),
                max_tokens: self.llm.max_tokens,
                fallback: self
                    .llm_fallback
                    .as_ref()
                    .map(|f| format!("{:?}:{}", f.provider, f.model).to_lowercase()),
            },
        );
        std::fs::create_dir_all(&night_dir)?;
        match manifest::freeze(&night_dir, &frozen) {
            Ok(manifest::Freeze::Written) => {
                info!(run_id = %frozen.run_id, tree = %baseline_tree, "experiment manifest frozen")
            }
            Ok(manifest::Freeze::Resumed) => {
                info!(run_id = %frozen.run_id, "manifest already frozen — restart of the same experiment")
            }
            Ok(manifest::Freeze::Diverged { previous }) => warn!(
                run_id = %frozen.run_id,
                previous = %previous,
                "baseline moved under an interrupted night — prior manifest archived"
            ),
            Err(e) => {
                warn!(error = %e, "manifest freeze failed — refusing to run unwitnessed");
                return self
                    .persist_blocked_env(
                        &cfg, &repo_name, &repo_path, &slot.deep, &night_id, date, "",
                        &format!("experiment manifest could not be frozen: {e}"),
                    )
                    .await;
            }
        }

        // 2. Open the durable run journal. A finished night is never repeated;
        //    an interrupted one resumes with its attempt counted.
        let mut run = match runstate::begin(
            &night_dir,
            &frozen.run_id,
            &night_id,
            &repo_name,
            date,
            runstate::DEFAULT_MAX_ATTEMPTS,
        ) {
            Ok(runstate::Resume::AlreadyComplete(prior)) => {
                info!(
                    run_id = %prior.run_id,
                    verdict = ?prior.verdict,
                    "run already complete — skipping rather than repeating it"
                );
                return Ok(CycleResult {
                    repo: repo_name,
                    verdict: prior
                        .verdict
                        .as_deref()
                        .map(verdict::from_label)
                        .unwrap_or(Verdict::Inconclusive),
                    finding: "(already complete — restart-safe skip)".into(),
                    witness_short: String::new(),
                    report_path: night_dir.join("report.md"),
                    ledger_path: repo_path.join(&cfg.ledger_path),
                    stored_to_ruvector: false,
                });
            }
            Ok(runstate::Resume::Abandoned(prior)) => {
                warn!(run_id = %prior.run_id, attempts = prior.attempts, "run out of attempts — abandoning");
                let _ = inbox::add(
                    "alert",
                    &repo_name,
                    &night_id,
                    date,
                    &format!(
                        "Dream run {} for {} was abandoned after {} attempts (phase {}). \
                         Investigate before the next window; it will not retry itself.",
                        prior.run_id, repo_name, prior.attempts, prior.phase.as_str()
                    ),
                );
                return self
                    .persist_blocked_env(
                        &cfg, &repo_name, &repo_path, &slot.deep, &night_id, date, "",
                        &format!("run abandoned after {} attempts", prior.attempts),
                    )
                    .await;
            }
            Ok(runstate::Resume::Fresh(s)) => s,
            Ok(runstate::Resume::Resumed(s)) => {
                info!(
                    run_id = %s.run_id,
                    attempt = s.attempts,
                    from = ?s.resumed_from,
                    "resuming an interrupted run"
                );
                s
            }
            Err(e) => {
                warn!(error = %e, "run journal unusable — refusing to run unrecoverably");
                return self
                    .persist_blocked_env(
                        &cfg, &repo_name, &repo_path, &slot.deep, &night_id, date, "",
                        &format!("run journal unwritable: {e}"),
                    )
                    .await;
            }
        };
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::ManifestFrozen);

        // 3. Dispatch to the HP annexe: clone, build, run evaluators.
        //    Hygiene first: sweep night dirs older than 3 days so the annexe
        //    never accumulates stale clones/build trees (fail-open).
        //    The remote dir carries the RUN ID, not the pid: two attempts at the
        //    same experiment reuse one workspace, two different experiments
        //    never collide, and the name survives a restart.
        let remote_dir = format!("{}/{}-r{}", self.runtime.hp_annexe_dir, night_id, frozen.run_id);
        if let Err(e) = dispatch::ssh(
            &self.runtime.hp_host,
            &format!(
                "find {} -maxdepth 1 -type d -name '20*' -mtime +3 -exec rm -rf {{}} + 2>/dev/null; true",
                dispatch::shell_quote(&self.runtime.hp_annexe_dir)
            ),
        ) {
            warn!(error = %e, "annexe retention sweep failed (fail-open)");
        }
        info!(remote = %remote_dir, "dispatching to HP");
        clone_repo_and_siblings(
            &self.runtime.hp_host,
            &repo_path,
            &remote_dir,
            &repo_name,
            &cfg.annexe_include,
            repo_path.parent(),
        )?;

        // Pre-flight probe: the checkout must exist and be non-empty on HP
        // before any evaluator runs. A broken environment (vanished cwd,
        // empty extraction) must become BLOCKED-ENV — a verdict the LLM never
        // sees and the dry streak never counts — not an INCONCLUSIVE night
        // full of false-positive evaluator "findings". One re-provision retry.
        let work_dir = format!("{}/{}", remote_dir, repo_name);
        let probe = |wd: &str| {
            dispatch::ssh(
                &self.runtime.hp_host,
                &format!(
                    "test -d {0} && [ -n \"$(ls -A {0})\" ] && echo PREFLIGHT-OK",
                    dispatch::shell_quote(wd)
                ),
            )
        };
        let preflight_ok = match probe(&work_dir) {
            Ok(out) if out.contains("PREFLIGHT-OK") => true,
            first => {
                warn!(result = ?first.err().map(|e| e.to_string()), "pre-flight failed — re-provisioning annexe checkout once");
                let _ = dispatch::ssh(
                    &self.runtime.hp_host,
                    &format!("rm -rf {}", dispatch::shell_quote(&remote_dir)),
                );
                clone_repo_and_siblings(
                    &self.runtime.hp_host,
                    &repo_path,
                    &remote_dir,
                    &repo_name,
                    &cfg.annexe_include,
                    repo_path.parent(),
                )?;
                matches!(probe(&work_dir), Ok(out) if out.contains("PREFLIGHT-OK"))
            }
        };
        if !preflight_ok {
            warn!(repo = %repo_name, "pre-flight failed twice — recording BLOCKED-ENV night (no LLM call)");
            let _ = runstate::fail(&night_dir, &mut run, "pre-flight failed twice");
            return self
                .persist_blocked_env(
                    &cfg,
                    &repo_name,
                    &repo_path,
                    &slot.deep,
                    &night_id,
                    date,
                    &remote_dir,
                    &format!(
                        "annexe checkout {}/{} missing or empty after two provisioning attempts",
                        remote_dir, repo_name
                    ),
                )
                .await;
        }

        // 4. Build step, then the BASELINE evaluator pass — each run producing a
        //    typed receipt (exit code, both streams, duration, outcome) rather
        //    than an untyped blob of stdout.
        let build_out = match cfg.build_step.as_ref() {
            Some(bs) => {
                let exec = self.runner.run(&work_dir, &bs.cmd, DEFAULT_BUILD_TIMEOUT_SECS);
                match exec.exit_code {
                    Some(0) => exec.stdout,
                    other => {
                        warn!(exit = ?other, "build step did not succeed — evaluators decide the night");
                        format!("BUILD FAILED (exit {:?})\n{}\n{}", other, exec.stdout, exec.stderr)
                    }
                }
            }
            None => "(no build step)".into(),
        };
        let applicable = frozen.applicable();
        let baseline_receipts = self.run_evaluators(&work_dir, &applicable, receipts::Phase::Baseline);
        for r in &baseline_receipts {
            info!(receipt = %r.summary(), "baseline evaluator");
        }
        if let Err(e) = receipts::persist(&night_dir, receipts::Phase::Baseline, &baseline_receipts) {
            warn!(error = %e, "baseline receipt persist failed (fail-open)");
        }
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::BaselineEvaluated);

        // 4b. Environment gate. A baseline evaluator is allowed to FAIL — that
        //     is often the finding. It is not allowed to be missing, silent,
        //     blocked or timed out: with no evidence there is nothing to reason
        //     over, and the model must not be asked.
        let env_vetoes = gate::environment_vetoes(&frozen, &baseline_receipts);
        if !env_vetoes.is_empty() {
            let detail = env_vetoes
                .iter()
                .map(|v| format!("{}: {}", v.subject, v.reason))
                .collect::<Vec<_>>()
                .join("; ");
            warn!(detail = %detail, "required evaluators unusable at baseline — BLOCKED-ENV, no LLM call");
            let _ = runstate::fail(&night_dir, &mut run, &detail);
            let res = self
                .persist_blocked_env(
                    &cfg, &repo_name, &repo_path, &slot.deep, &night_id, date, &remote_dir, &detail,
                )
                .await?;
            let _ = runstate::complete(&night_dir, &mut run, res.verdict.as_str());
            return Ok(res);
        }

        // 5. Append evidence receipts to the prompt so the LLM reasons over
        //    real evaluator output, not imagination. The LLM has no shell:
        //    everything it may cite — receipts, prior ledger rows, the session
        //    commit — must be in this pack. HP paths are redacted before they
        //    reach an external provider.
        let commit = baseline_rev.clone();
        prompt.push_str("\n\n---\n\n# TONIGHT'S EVIDENCE (receipts from the HP annexe)\n\n");
        prompt.push_str(&format!(
            "## Session commit\n`{}` (tree `{}`, run `{}`)\n\n",
            commit, baseline_tree, frozen.run_id
        ));
        prompt.push_str(&format!(
            "## Required-check gate\nThese evaluators are REQUIRED for deep `{}` and will be RE-RUN \
             against your candidate patch after you emit it: {}.\nIf any of them fails, is silent, \
             is blocked or times out on that candidate, ACCEPT is vetoed deterministically \
             whatever this report says. Emit a candidate only if you believe it passes them.\n\n",
            slot.deep,
            if admission.required.is_empty() { "(none)".to_string() } else { admission.required.join(", ") }
        ));
        let ledger_file = repo_path.join(&cfg.ledger_path);
        if let Ok(ledger_text) = std::fs::read_to_string(&ledger_file) {
            let rows: Vec<&str> = ledger_text.lines().rev().take(6).collect();
            let recent: Vec<&str> = rows.into_iter().rev().collect();
            prompt.push_str(&format!(
                "## Ledger (most recent rows)\n{}\n\n",
                recent.join("\n")
            ));
        }
        // The governed-context planner and the legacy tail path both consume
        // (name, text) pairs; render each typed receipt into one, keeping the
        // outcome and exit code visible rather than only the stdout blob.
        let eval_outs: Vec<(String, String)> = baseline_receipts
            .iter()
            .map(|r| (r.name.clone(), render_receipt(r)))
            .collect();
        // 5b. Self-GC context governance (ADR-070): persist tonight's receipts
        //     untruncated as sidecars, then let a side-channel planner call
        //     assign fold/mask/prune/restore over tonight's and prior nights'
        //     receipt objects. The governed pack replaces the blind tail()
        //     truncation below. Fail-open at every stage: any error lands on
        //     the legacy path, and the sidecars are still written (recoverable
        //     evidence is worth keeping even when governance is off).
        let mut governed_pack: Option<String> = None;
        match std::fs::create_dir_all(&night_dir).and_then(|_| {
            context::persist_receipts(&night_dir, &night_id, &build_out, &eval_outs)
        }) {
            Ok(mut objects) => {
                if context::enabled() {
                    objects.extend(context::load_prior_objects(
                        &self.artefact_dir,
                        &repo_name,
                        date,
                    ));
                    governed_pack = context::govern(
                        &self.llm,
                        self.llm_fallback.as_ref(),
                        &objects,
                        &slot.deep,
                        &slot.scan.join(", "),
                        redact,
                    )
                    .await;
                }
            }
            Err(e) => warn!(error = %e, "receipt sidecar persist failed (fail-open)"),
        }
        match governed_pack {
            Some(pack) => prompt.push_str(&pack),
            None => {
                prompt.push_str(&format!(
                    "## Build output (tail)\n```\n{}\n```\n\n",
                    redact(tail(&build_out, 3000))
                ));
                for (name, out) in &eval_outs {
                    prompt.push_str(&format!(
                        "## Evaluator `{}` output (tail)\n```\n{}\n```\n\n",
                        name,
                        redact(tail(out, 6000))
                    ));
                }
            }
        }

        // 6. LLM call: primary (with its internal retry), then the fallback
        //    provider, and only then a degraded night.
        info!(provider = ?self.llm.provider, model = %self.llm.model, "calling LLM");
        let mut model_used = self.llm.model.clone();
        let report = match llm::call(&self.llm, &prompt).await {
            Ok(r) => r,
            Err(primary_err) => match &self.llm_fallback {
                Some(fb) => {
                    warn!(
                        error = %primary_err,
                        fallback_provider = ?fb.provider,
                        fallback_model = %fb.model,
                        "primary LLM failed — trying fallback provider"
                    );
                    match llm::call(fb, &prompt).await {
                        Ok(r) => {
                            model_used = fb.model.clone();
                            r
                        }
                        Err(fb_err) => {
                            warn!(error = %fb_err, "fallback LLM also failed — recording degraded night");
                            format!(
                                "# Degraded night\n\nPrimary LLM failed: {}\nFallback LLM failed: {}\n\nVERDICT: INCONCLUSIVE",
                                primary_err, fb_err
                            )
                        }
                    }
                }
                None => {
                    warn!(error = %primary_err, "LLM call failed — recording degraded night");
                    format!(
                        "# Degraded night\n\nLLM call failed: {}\n\nVERDICT: INCONCLUSIVE",
                        primary_err
                    )
                }
            },
        };
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::ModelCalled);

        // 7. Verdict. The STRICT parse is the only reading acceptance consults;
        //    the lenient one still supplies the finding text for the ledger.
        let strict = verdict::parse_verdict_strict(&report);
        let lenient = verdict::parse_verdict(&report);
        info!(strict = ?strict, lenient = lenient.as_str(), "verdict parsed");

        // 8. Candidate: apply the emitted patch in isolation, then RE-RUN the
        //    required evaluators against that tree. Nothing here trusts the
        //    report's own claim about its patch.
        let required = frozen.required();
        let branch = persist::branch_name(&slot.deep, date);
        let mut candidate_state = gate::CandidateState::NotAttempted;
        let mut candidate_receipts: Vec<receipts::EvaluatorReceipt> = Vec::new();
        let mut prepared: Option<candidate::PreparedCandidate> = None;

        if matches!(strict, Ok(Verdict::Accept)) {
            match persist::extract_patch(&report) {
                None => {
                    info!("report claims ACCEPT but carries no candidate patch — nothing to verify");
                    candidate_state = gate::CandidateState::NoPatch;
                }
                Some(patch) => {
                    // A stale branch from an interrupted attempt would block the
                    // worktree; drop it first — the run id, not the branch,
                    // is the identity.
                    persist::delete_branch(&repo_path, &branch);
                    match candidate::prepare(
                        &repo_path,
                        &branch,
                        &patch,
                        &format!("dream({}): candidate for {}", slot.deep, night_id),
                    ) {
                        Err(e) => {
                            warn!(error = %e, "candidate patch did not apply — acceptance cannot be verified");
                            candidate_state = gate::CandidateState::DidNotApply { detail: e.to_string() };
                        }
                        Ok(c) => {
                            info!(tree = %c.tree_hash, branch = %c.branch, "candidate tree built in isolation");
                            let cand_remote = format!("{}/candidate", remote_dir);
                            let cand_work = format!("{}/{}", cand_remote, repo_name);
                            match clone_repo_and_siblings(
                                &self.runtime.hp_host,
                                &c.worktree,
                                &cand_remote,
                                &repo_name,
                                &cfg.annexe_include,
                                repo_path.parent(),
                            ) {
                                Ok(()) => {
                                    if let Some(bs) = cfg.build_step.as_ref() {
                                        let b = self.runner.run(&cand_work, &bs.cmd, DEFAULT_BUILD_TIMEOUT_SECS);
                                        info!(exit = ?b.exit_code, "candidate build");
                                    }
                                    candidate_receipts =
                                        candidate::evaluate(self.runner.as_ref(), &cand_work, &required);
                                    for r in &candidate_receipts {
                                        info!(receipt = %r.summary(), "candidate evaluator");
                                    }
                                    candidate_state = gate::CandidateState::Applied {
                                        tree_hash: c.tree_hash.clone(),
                                    };
                                }
                                Err(e) => {
                                    warn!(error = %e, "candidate could not be shipped to the annexe");
                                    candidate_state = gate::CandidateState::DidNotApply {
                                        detail: format!("annexe provisioning failed: {e}"),
                                    };
                                }
                            }
                            let _ = manifest::write_candidate(
                                &night_dir,
                                &manifest::CandidateRecord {
                                    schema: manifest::MANIFEST_SCHEMA,
                                    run_id: frozen.run_id.clone(),
                                    patch_digest: c.patch_digest.clone(),
                                    patch_bytes: c.patch_bytes,
                                    candidate_tree_hash: c.tree_hash.clone(),
                                    branch: c.branch.clone(),
                                    applied: matches!(candidate_state, gate::CandidateState::Applied { .. }),
                                    apply_error: match &candidate_state {
                                        gate::CandidateState::DidNotApply { detail } => Some(detail.clone()),
                                        _ => None,
                                    },
                                    created_at: chrono::Utc::now().to_rfc3339(),
                                },
                            );
                            prepared = Some(c);
                        }
                    }
                }
            }
        }
        if !candidate_receipts.is_empty() {
            if let Err(e) =
                receipts::persist(&night_dir, receipts::Phase::Candidate, &candidate_receipts)
            {
                warn!(error = %e, "candidate receipt persist failed (fail-open)");
            }
        }
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::CandidateEvaluated);

        // 9. The deterministic gate. From here the verdict is a function of the
        //    receipts, not of the report's prose.
        let decision = gate::decide(&frozen, &strict, &candidate_state, &candidate_receipts);
        let v = decision.verdict_enum();
        if !decision.vetoes.is_empty() {
            warn!(summary = %decision.summary, "required-check gate vetoed the model verdict");
        }
        info!(model_verdict = %decision.model_verdict, verdict = v.as_str(), "gate decided");
        let _ = manifest::write_atomic(
            &night_dir.join("gate.json"),
            &serde_json::to_vec_pretty(&decision).unwrap_or_default(),
        );
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::Gated);

        // The finding shown in the ledger must not read as a win when the gate
        // refused one.
        let finding = if decision.accepted || decision.vetoes.is_empty() {
            verdict::sanitise_finding(&report, lenient)
        } else {
            let base = verdict::sanitise_finding(&report, lenient);
            format!("VETOED: {}", base).chars().take(80).collect()
        };
        let finding_full = format!(
            "{}\n\nGate: {}",
            verdict::sanitise_finding_full(&report, lenient),
            decision.summary
        );

        // 10. Witness: bind report to the repo's current commit.
        let (wit_full, wit_short) = match witness::witness(&report, &commit) {
            Ok(w) => {
                let s = witness::short(&w).to_string();
                (w, s)
            }
            Err(e) => {
                warn!(error = %e, "witness blocked (bad/missing commit)");
                (String::new(), "BLOCKED".into())
            }
        };

        // 11. Persist the report locally.
        let report_path = night_dir.join("report.md");
        std::fs::write(&report_path, &report)?;

        // 11b. Queue any "Human action recommended" items for the operator —
        //      the inbox hook surfaces them in the next Claude session,
        //      whatever its context. Fail-open.
        for q in inbox::extract_questions(&report) {
            match inbox::add("question", &repo_name, &night_id, date, &q) {
                Ok(id) => info!(id = %id, "operator question queued to dream inbox"),
                Err(e) => warn!(error = %e, "dream inbox write failed (fail-open)"),
            }
        }
        // A vetoed ACCEPT is exactly the kind of thing a human should see.
        if !decision.vetoes.is_empty() {
            let _ = inbox::add(
                "alert",
                &repo_name,
                &night_id,
                date,
                &format!(
                    "Dream night {} claimed {} but the required-check gate vetoed it → {}. {}",
                    night_id, decision.model_verdict, decision.verdict, decision.summary
                ),
            );
        }

        // 11c. Persist the candidate as a DRAFT PR (ADR-061) — only when the
        //      GATE accepted, never on the model's say-so. The branch already
        //      exists: it is the verified candidate tree. A vetoed candidate is
        //      discarded so no unverified diff is left looking promotable.
        //      The merge stays human — evaluation is not promotion.
        let mut pr_ref = "NONE".to_string();
        match (&prepared, decision.accepted) {
            (Some(c), true) if self.runtime.persist_accepts => {
                candidate::cleanup(&repo_path, c);
                let title = format!("dream({}): {}", slot.deep, tail(&finding, 60));
                let body = format!(
                    "Draft PR opened by the dream engine on a GATED ACCEPT night ({night_id}, \
                     run `{run_id}`).\n\nCandidate tree `{tree}` was applied in isolation and the \
                     required evaluators re-run against it: {outcomes}. Witness `{wit_short}`.\n\n\
                     A human decides the merge — evaluation is not promotion.\n\n**Finding:** {finding_full}",
                    run_id = frozen.run_id,
                    tree = c.tree_hash,
                    outcomes = decision
                        .required_outcomes
                        .iter()
                        .map(|(n, o)| format!("{n}={o}"))
                        .collect::<Vec<_>>()
                        .join(", "),
                );
                let out = persist::push_and_open_pr(&repo_path, &cfg.repo, &c.branch, &title, &body);
                info!(branch = %out.branch, pushed = out.pushed, pr = ?out.pr_url, "verified candidate persisted as draft PR");
                pr_ref = out.pr_url.clone().unwrap_or_else(|| {
                    if out.pushed { format!("branch:{}", out.branch) } else { "PERSIST-LOCAL".into() }
                });
            }
            (Some(c), true) => {
                candidate::cleanup(&repo_path, c);
                info!("persist_accepts disabled — verified candidate left on local branch only");
                pr_ref = format!("branch:{}", c.branch);
            }
            (Some(c), false) => {
                warn!(branch = %c.branch, "candidate vetoed — discarding branch and worktree");
                candidate::discard(&repo_path, c);
                pr_ref = "VETOED".into();
            }
            (None, _) => {}
        }

        // 12. Ledger row.
        let ledger_path = repo_path.join(&cfg.ledger_path);
        let row = LedgerRow {
            date: date.into(),
            deep: slot.deep.clone(),
            finding: finding.clone(),
            issue: "NONE".into(),
            pr: pr_ref.clone(),
            evaluated: "yes".into(),
            verdict: v.as_str().into(),
            effect: String::new(),
            witness: wit_short.clone(),
            prior_fates: String::new(),
        };
        ledger::append_row(&ledger_path, &row)?;
        info!(path = %ledger_path.display(), "ledger row appended");
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::Persisted);

        // 13. RuVector store — fail-open: a memory failure never fails the night.
        let df = DreamFinding {
            night_id: night_id.clone(),
            repo: repo_name.clone(),
            date: date.into(),
            deep: slot.deep.clone(),
            finding: finding_full,
            verdict: v.as_str().into(),
            witness: if wit_full.is_empty() {
                wit_short.clone()
            } else {
                wit_full
            },
            source: format!("hp-annexe-{}", model_used),
        };
        let stored = match ruvector::store_finding(&self.ruvector, &df).await {
            Ok(s) => s,
            Err(e) => {
                warn!(error = %e, "RuVector store failed (fail-open)");
                false
            }
        };

        // 14. Clean this night's remote dir — everything worth keeping (report,
        //     verdict, receipts, ledger row, witness, memory) is already
        //     control-plane side. Kept on failure paths for debugging.
        match dispatch::ssh(
            &self.runtime.hp_host,
            &format!("rm -rf {}", dispatch::shell_quote(&remote_dir)),
        ) {
            Ok(_) => info!(remote = %remote_dir, "HP annexe night dir cleaned"),
            Err(e) => warn!(error = %e, "HP annexe cleanup failed (fail-open)"),
        }

        let _ = runstate::complete(&night_dir, &mut run, v.as_str());
        info!(
            repo = %repo_name,
            verdict = v.as_str(),
            witness = %wit_short,
            run_id = %frozen.run_id,
            stored,
            "cycle complete"
        );

        Ok(CycleResult {
            repo: repo_name,
            verdict: v,
            finding,
            witness_short: wit_short,
            report_path,
            ledger_path,
            stored_to_ruvector: stored,
        })
    }

    /// Run a set of evaluators in `work_dir` through the configured runner,
    /// producing one typed receipt each.
    fn run_evaluators(
        &self,
        work_dir: &str,
        evaluators: &[&manifest::EvaluatorIdentity],
        phase: receipts::Phase,
    ) -> Vec<receipts::EvaluatorReceipt> {
        let mut out = Vec::new();
        for id in evaluators {
            let exec = self.runner.run(work_dir, &id.command, id.timeout_secs);
            out.push(receipts::EvaluatorReceipt::from_exec(
                &id.name,
                &id.command,
                phase,
                id.required,
                id.timeout_secs,
                exec,
            ));
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// Previous night's carry-over for a repo: the "Next steps" and "Biggest
    /// uncertainty" lines from its most recent report (excluding tonight),
    /// plus any answered inbox questions for the repo. Empty string when
    /// there is nothing to carry.
    fn carry_over(&self, repo_name: &str, tonight: &str) -> String {
        let mut out = String::new();
        let suffix = format!("-{}", repo_name);
        let mut nights: Vec<String> = std::fs::read_dir(&self.artefact_dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter_map(|e| e.file_name().into_string().ok())
                    .filter(|n| n.ends_with(&suffix) && !n.starts_with(tonight))
                    .collect()
            })
            .unwrap_or_default();
        nights.sort();
        if let Some(last) = nights.last() {
            let report = self.artefact_dir.join(last).join("report.md");
            if let Ok(text) = std::fs::read_to_string(&report) {
                for marker in ["Next steps", "Biggest uncertainty", "Main lesson"] {
                    for line in text.lines() {
                        let t = line.trim();
                        if t.to_lowercase().contains(&marker.to_lowercase())
                            && (t.starts_with('-') || t.starts_with('*') || t.starts_with("**"))
                        {
                            out.push_str(t);
                            out.push('\n');
                        }
                    }
                }
                if !out.is_empty() {
                    out.insert_str(0, &format!("From `{}/report.md`:\n", last));
                }
            }
        }
        // Answered operator questions are decisions — always carry them.
        if let Ok(text) = std::fs::read_to_string(inbox::inbox_path()) {
            if let Ok(items) = serde_json::from_str::<Vec<inbox::InboxItem>>(&text) {
                for i in items.iter().filter(|i| {
                    i.repo == repo_name && i.status == "answered" && !i.answer.is_empty()
                }) {
                    out.push_str(&format!(
                        "Operator answered ({}): Q: {} → A: {}\n",
                        i.date, i.text, i.answer
                    ));
                }
            }
        }
        out
    }

    /// Persist a BLOCKED-ENV night: minimal report, ledger row, operator
    /// alert, remote cleanup. No LLM call, no RuVector finding — a broken
    /// harness is operational state, not knowledge.
    #[allow(clippy::too_many_arguments)]
    async fn persist_blocked_env(
        &self,
        cfg: &DreamConfig,
        repo_name: &str,
        repo_path: &Path,
        deep: &str,
        night_id: &str,
        date: &str,
        remote_dir: &str,
        detail: &str,
    ) -> Result<CycleResult, EngineError> {
        let finding: String = format!("Environment fault, hypothesis untested: {}", detail)
            .chars()
            .take(160)
            .collect();
        let report = format!(
            "# BLOCKED-ENV night — {night_id}\n\nThe night could not produce evidence: {detail}.\n\n\
             No verdict was sought from the model; tonight is an environment fault, not evidence \
             about the repo.\n\nVERDICT: BLOCKED-ENV\n"
        );
        let night_dir = self.artefact_dir.join(night_id);
        std::fs::create_dir_all(&night_dir)?;
        let report_path = night_dir.join("report.md");
        std::fs::write(&report_path, &report)?;

        let ledger_path = repo_path.join(&cfg.ledger_path);
        ledger::append_row(
            &ledger_path,
            &LedgerRow {
                date: date.into(),
                deep: deep.into(),
                finding: finding.chars().take(80).collect(),
                issue: "NONE".into(),
                pr: "NONE".into(),
                evaluated: "blocked".into(),
                verdict: Verdict::BlockedEnv.as_str().into(),
                effect: String::new(),
                witness: "BLOCKED".into(),
                prior_fates: String::new(),
            },
        )?;

        if let Err(e) = inbox::add(
            "alert",
            repo_name,
            night_id,
            date,
            &format!(
                "Dream night for {} was BLOCKED-ENV: {}. Check the harness before the next window.",
                repo_name, detail
            ),
        ) {
            warn!(error = %e, "dream inbox write failed (fail-open)");
        }

        if !remote_dir.is_empty() {
            let _ = dispatch::ssh(
                &self.runtime.hp_host,
                &format!("rm -rf {}", dispatch::shell_quote(remote_dir)),
            );
        }

        Ok(CycleResult {
            repo: repo_name.into(),
            verdict: Verdict::BlockedEnv,
            finding,
            witness_short: "BLOCKED".into(),
            report_path,
            ledger_path,
            stored_to_ruvector: false,
        })
    }

    /// Persist a HANDOFF night: the nomination was refused at admission because
    /// no usable evaluator covers tonight's deep.
    ///
    /// Nothing was scheduled — no annexe clone, no build, no model call — so
    /// this is a request for human attention, not a claim about the repository.
    /// It never counts toward the dry streak (the ledger's streak counter
    /// ignores any verdict that is not ACCEPT/REJECT/INCONCLUSIVE), because a
    /// misconfigured evaluator must not park a healthy repo.
    #[allow(clippy::too_many_arguments)]
    async fn persist_handoff(
        &self,
        cfg: &DreamConfig,
        repo_name: &str,
        repo_path: &Path,
        deep: &str,
        night_id: &str,
        date: &str,
        admission: &readiness::ReadinessReport,
    ) -> Result<CycleResult, EngineError> {
        let refusal = admission.refusal();
        let finding: String = format!("HANDOFF — evaluator not ready: {}", refusal)
            .chars()
            .take(160)
            .collect();
        let report = format!(
            "# HANDOFF night — {night_id}\n\nThe nomination was refused before scheduling: tonight's \
             deep `{deep}` has no usable evaluator.\n\n## Problems\n{problems}\n\nNo annexe clone, \
             build, evaluator or model call ran. Fix the `evaluatorEntrypoints` entry (or scope it \
             to a deep it can actually decide) and the next window will schedule normally.\n\n\
             VERDICT: HANDOFF\n",
            problems = admission
                .problems
                .iter()
                .map(|p| format!("- {}", p.describe()))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let night_dir = self.artefact_dir.join(night_id);
        std::fs::create_dir_all(&night_dir)?;
        let report_path = night_dir.join("report.md");
        std::fs::write(&report_path, &report)?;
        let _ = manifest::write_atomic(
            &night_dir.join("admission.json"),
            &serde_json::to_vec_pretty(admission).unwrap_or_default(),
        );

        let ledger_path = repo_path.join(&cfg.ledger_path);
        ledger::append_row(
            &ledger_path,
            &LedgerRow {
                date: date.into(),
                deep: deep.into(),
                finding: finding.chars().take(80).collect(),
                issue: "NONE".into(),
                pr: "NONE".into(),
                evaluated: "no".into(),
                verdict: Verdict::Handoff.as_str().into(),
                effect: String::new(),
                witness: "NONE".into(),
                prior_fates: String::new(),
            },
        )?;

        if let Err(e) = inbox::add(
            "question",
            repo_name,
            night_id,
            date,
            &format!(
                "Dream nomination for {} (deep `{}`) was refused at admission: {}. \
                 Which evaluator should decide this deep?",
                repo_name, deep, refusal
            ),
        ) {
            warn!(error = %e, "dream inbox write failed (fail-open)");
        }

        Ok(CycleResult {
            repo: repo_name.into(),
            verdict: Verdict::Handoff,
            finding,
            witness_short: String::new(),
            report_path,
            ledger_path,
            stored_to_ruvector: false,
        })
    }
}

/// Build the LLM config from runtime settings + environment.
pub fn llm_config(rt: &RuntimeConfig) -> LlmConfig {
    let provider = Provider::parse(
        &std::env::var("DREAM_LLM_PROVIDER").unwrap_or_else(|_| rt.llm_provider.clone()),
    );
    match provider {
        Provider::Zai => LlmConfig {
            provider,
            url: std::env::var("ZAI_URL").unwrap_or_else(|_| rt.zai_url.clone()),
            model: std::env::var("ZAI_MODEL").unwrap_or_else(|_| rt.zai_model.clone()),
            max_tokens: env_u32("ZAI_MAX_TOKENS", rt.zai_max_tokens),
            api_key: std::env::var("ZAI_ANTHROPIC_API_KEY")
                .ok()
                .or_else(|| std::env::var("ZAI_API_KEY").ok()),
        },
        Provider::Loom => LlmConfig {
            provider,
            url: std::env::var("LOOM_URL").unwrap_or_else(|_| rt.loom_url.clone()),
            model: std::env::var("LOOM_MODEL").unwrap_or_else(|_| rt.loom_model.clone()),
            max_tokens: env_u32("LOOM_MAX_TOKENS", rt.loom_max_tokens),
            api_key: None,
        },
    }
}

/// Parse a u32 env override, falling back to the toml value on absence or
/// garbage (a mis-set override must not silently zero the token budget).
fn env_u32(name: &str, default: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

/// Build the fallback LLM config: the *other* provider, when usable.
/// zai primary → Loom (always usable, LAN, no key). loom primary → Z.AI only
/// when a key is present. `DREAM_LLM_FALLBACK=off` disables.
pub fn fallback_llm_config(rt: &RuntimeConfig, primary: &LlmConfig) -> Option<LlmConfig> {
    if std::env::var("DREAM_LLM_FALLBACK").is_ok_and(|v| v == "off") {
        return None;
    }
    match primary.provider {
        Provider::Zai => Some(LlmConfig {
            provider: Provider::Loom,
            url: std::env::var("LOOM_URL").unwrap_or_else(|_| rt.loom_url.clone()),
            model: std::env::var("LOOM_MODEL").unwrap_or_else(|_| rt.loom_model.clone()),
            max_tokens: env_u32("LOOM_MAX_TOKENS", rt.loom_max_tokens),
            api_key: None,
        }),
        Provider::Loom => {
            let key = std::env::var("ZAI_ANTHROPIC_API_KEY")
                .ok()
                .or_else(|| std::env::var("ZAI_API_KEY").ok())
                .filter(|k| !k.is_empty())?;
            Some(LlmConfig {
                provider: Provider::Zai,
                url: std::env::var("ZAI_URL").unwrap_or_else(|_| rt.zai_url.clone()),
                model: std::env::var("ZAI_MODEL").unwrap_or_else(|_| rt.zai_model.clone()),
                max_tokens: env_u32("ZAI_MAX_TOKENS", rt.zai_max_tokens),
                api_key: Some(key),
            })
        }
    }
}

/// Build the RuVector config from environment (conninfo or URL form).
pub fn ruvector_config(rt: &RuntimeConfig) -> RuVectorConfig {
    let pg_url = std::env::var("RUVECTOR_PG_URL").unwrap_or_else(|_| {
        match std::env::var("RUVECTOR_PG_CONNINFO") {
            Ok(ci) => conninfo_to_url(&ci),
            Err(_) => "postgres://ruvector:ruvector@ruvector-postgres:5432/ruvector".into(),
        }
    });
    RuVectorConfig {
        pg_url,
        xinference_url: std::env::var("XINFERENCE_URL")
            .unwrap_or_else(|_| "http://192.168.2.132:9997".into()),
        namespace: rt.memory_namespace.clone(),
    }
}

/// Convert libpq-style "host=h port=p dbname=d user=u password=w" into a URL.
fn conninfo_to_url(conninfo: &str) -> String {
    let mut host = "ruvector-postgres";
    let mut port = "5432";
    let mut db = "ruvector";
    let mut user = "ruvector";
    let mut pass = "ruvector";
    for part in conninfo.split_whitespace() {
        if let Some((k, v)) = part.split_once('=') {
            match k {
                "host" => host = v,
                "port" => port = v,
                "dbname" => db = v,
                "user" => user = v,
                "password" => pass = v,
                _ => {}
            }
        }
    }
    format!("postgres://{}:{}@{}:{}/{}", user, pass, host, port, db)
}

/// ADR-060: clone the target repo to the annexe, plus any `annexe_include`
/// sibling repos its build/evaluators need. Each sibling extracts alongside the
/// target under `remote_dir/<name>`, mirroring the workspace, so a Cargo
/// `path = "../<name>"` resolves the same on the annexe as locally. A missing or
/// unreadable sibling is warned and skipped — the build then fails legibly
/// rather than the night crashing.
fn clone_repo_and_siblings(
    hp_host: &str,
    repo_path: &Path,
    remote_dir: &str,
    repo_name: &str,
    annexe_include: &[String],
    sibling_root: Option<&Path>,
) -> Result<(), dispatch::DispatchError> {
    dispatch::clone_to_hp(repo_path, hp_host, remote_dir, repo_name)?;
    // Siblings resolve against the *workspace*, not against `repo_path`: when
    // the candidate rerun ships a git worktree from a temp directory, its
    // path-deps still come from the real workspace.
    let workspace_root = sibling_root.or_else(|| repo_path.parent());
    for inc in annexe_include {
        // The annexe layout name = the final path component (matches `../<name>`).
        let name = Path::new(inc).file_name().and_then(|s| s.to_str()).unwrap_or(inc);
        let sibling = match workspace_root {
            Some(root) => root.join(inc),
            None => PathBuf::from(inc),
        };
        if !sibling.is_dir() {
            warn!(sibling = %inc, "annexe_include: sibling not found locally — skipping (build may fail on its path-deps)");
            continue;
        }
        info!(sibling = %name, "annexe_include: shipping sibling to annexe");
        dispatch::clone_to_hp(&sibling, hp_host, remote_dir, name)?;
    }
    Ok(())
}

/// Render a typed receipt as the prompt-facing text block: the verdict-relevant
/// facts first (outcome, exit code, duration), then the raw streams.
///
/// The model used to see stdout alone, which is precisely how a non-zero exit
/// became invisible to it.
fn render_receipt(r: &receipts::EvaluatorReceipt) -> String {
    let mut out = format!(
        "outcome={} exit={} duration={}ms required={}\n",
        r.outcome.label(),
        r.exit_code.map(|c| c.to_string()).unwrap_or_else(|| "-".into()),
        r.duration_ms,
        r.required
    );
    if !r.stdout.trim().is_empty() {
        out.push_str("--- stdout ---\n");
        out.push_str(&r.stdout);
        if !r.stdout.ends_with('\n') {
            out.push('\n');
        }
    }
    if !r.stderr.trim().is_empty() {
        out.push_str("--- stderr ---\n");
        out.push_str(&r.stderr);
        if !r.stderr.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

/// Count the trailing run of INCONCLUSIVE verdicts in a ledger. Any decisive
/// row (ACCEPT or REJECT — a falsified hypothesis is still the system
/// learning) resets the streak; header/divider/non-table lines are ignored.
pub fn dry_streak(ledger_text: &str) -> usize {
    let mut streak = 0usize;
    for line in ledger_text.lines() {
        let t = line.trim();
        if !t.starts_with('|') {
            continue;
        }
        let cells: Vec<&str> = t.split('|').map(str::trim).collect();
        // | date | deep | finding | issue | pr | evaluated | verdict | ... |
        // split yields a leading empty cell, so the verdict sits at index 7.
        let Some(verdict) = cells.get(7) else {
            continue;
        };
        match *verdict {
            "INCONCLUSIVE" => streak += 1,
            "ACCEPT" | "REJECT" => streak = 0,
            _ => {} // header, divider, malformed — no effect
        }
    }
    streak
}

/// Redact HP-side filesystem paths before receipts leave the LAN.
fn redact(s: &str) -> String {
    s.replace("/home/john", "~")
}

/// Last `max` bytes of a string, on a char boundary.
fn tail(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conninfo_conversion() {
        let url = conninfo_to_url("host=db port=5433 dbname=mydb user=me password=secret");
        assert_eq!(url, "postgres://me:secret@db:5433/mydb");
    }

    #[test]
    fn conninfo_defaults() {
        let url = conninfo_to_url("");
        assert_eq!(
            url,
            "postgres://ruvector:ruvector@ruvector-postgres:5432/ruvector"
        );
    }

    #[test]
    fn env_u32_falls_back_on_absence_and_garbage() {
        assert_eq!(env_u32("DREAM_TEST_UNSET_VAR", 16384), 16384);
        std::env::set_var("DREAM_TEST_GARBAGE_VAR", "not-a-number");
        assert_eq!(env_u32("DREAM_TEST_GARBAGE_VAR", 16384), 16384);
        std::env::set_var("DREAM_TEST_OK_VAR", " 32768 ");
        assert_eq!(env_u32("DREAM_TEST_OK_VAR", 16384), 32768);
        std::env::remove_var("DREAM_TEST_GARBAGE_VAR");
        std::env::remove_var("DREAM_TEST_OK_VAR");
    }

    #[test]
    fn tail_respects_char_boundaries() {
        let s = "héllo wörld";
        let t = tail(s, 4);
        assert!(t.len() <= 5);
        assert!(s.ends_with(t));
    }

    const LEDGER_HEADER: &str = "| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";

    fn row(verdict: &str) -> String {
        format!(
            "| 2026-08-15 | deep | finding | NONE | NONE | yes | {} |  | abcd1234 |  |\n",
            verdict
        )
    }

    #[test]
    fn dry_streak_counts_trailing_inconclusive() {
        let ledger = format!(
            "{}{}{}{}",
            LEDGER_HEADER,
            row("ACCEPT"),
            row("INCONCLUSIVE"),
            row("INCONCLUSIVE")
        );
        assert_eq!(dry_streak(&ledger), 2);
    }

    #[test]
    fn dry_streak_reset_by_decisive_verdict() {
        let ledger = format!(
            "{}{}{}{}",
            LEDGER_HEADER,
            row("INCONCLUSIVE"),
            row("INCONCLUSIVE"),
            row("REJECT")
        );
        assert_eq!(dry_streak(&ledger), 0);
    }

    #[test]
    fn dry_streak_empty_and_header_only() {
        assert_eq!(dry_streak(""), 0);
        assert_eq!(dry_streak(LEDGER_HEADER), 0);
    }
}
