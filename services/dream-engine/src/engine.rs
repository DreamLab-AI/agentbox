//! The composition root: one night, wired from `dream-core` and `dream-gate`
//! parts and the estate's adapters.
//!
//! The mechanism (evaluator receipts, candidate worktrees, the ledger, source
//! reading, the context governor, the streak, the pure gate) lives in the
//! extracted crates; this module decides *when* each runs and plugs the
//! estate seams in: [`LlmAdapter`] (Z.AI / Loom), [`SshRunner`] (the annexe),
//! [`RuVectorSink`] (memory) and the inbox and journal notifiers. The
//! protected-path policy is built once per night ([`policy::for_night`]) and
//! handed both to the candidate guard and to the gate's context.

use dream_core::candidate;
use dream_core::context;
use dream_core::ledger::{self, LedgerRow};
use dream_core::replay;
use dream_core::roster;
use dream_core::runstate;
use dream_core::seams::{DraftPr, Forge, Llm, LlmRequest, MemorySink, Notice, Notifier};
use dream_core::source;
use dream_core::{persist, readiness, streak};
use dream_gate::config::DreamConfig;
use dream_gate::gate::{self, CandidateState};
use dream_gate::manifest::{self, ModelIdentity};
use dream_gate::receipts::{self, Phase};
use dream_gate::verdict::{self, Verdict};
use dream_gate::witness;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tracing::{info, warn};

use crate::baseline;
use crate::candidate_flow::{self, Annexe, Flow};
use crate::config::{self, RuntimeConfig, DEFAULT_LEDGER_PATH};
use crate::digest;
use crate::dispatch;
use crate::estate;
use crate::governance;
use crate::inbox;
use crate::journal::{self, Journal, JournalStats};
use crate::judge;
use crate::llm::{LlmAdapter, LlmConfig};
use crate::notify::{self, InboxNotifier, JournalNotifier, Notifiers};
use crate::policy;
use crate::present::{
    gate_result_line, pr_title, receipt_outcomes, render_receipt, tail, vetoed_finding,
};
use crate::prompt;
use crate::records;
use crate::runner::EvaluatorRunner;
use crate::ruvector::{self, DreamFinding, RuVectorConfig, RuVectorSink};
use crate::wanted;

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
    #[error("prompt template: {0}")]
    Template(#[from] dream_core::compile::TemplateError),
    /// Another engine holds this night's lock. Not a fault: the night is being
    /// run elsewhere, so this process skips it.
    #[error("night {0} is already being run by another engine")]
    NightLocked(String),
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
    /// [`crate::runner::SshRunner`] at the connected node annexe; tests substitute a local
    /// or scripted runner so the acceptance path is exercisable offline.
    pub runner: Arc<dyn EvaluatorRunner>,
    /// Durable fair-scheduling state (least-recently-dreamed first).
    pub roster_path: PathBuf,
    /// Where a verified candidate is published. Production wires
    /// [`GhForge`]; tests substitute a recording forge so no PR is opened.
    pub forge: Arc<dyn Forge>,
    /// Replaces the configured HTTP model for the verdict, source-gather,
    /// context-govern and repair calls. `None` (production) builds a
    /// [`LlmAdapter`] from [`Engine::llm`] exactly as before.
    pub llm_override: Option<Arc<dyn Llm>>,
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
    /// `max_repos_per_night`. A repo whose dry streak reaches `prune_dry_streak`
    /// is on standby and skipped: REJECT and INCONCLUSIVE nights advance the
    /// streak, an ACCEPT resets it, BLOCKED-ENV and HANDOFF neither
    /// (`dream_core::streak`). A dry streak means a saturated repo, and the
    /// slot is wasted until an ACCEPT (via a forced `--target` run) resets it.
    /// Returns `None` when dreaming is paused (the night is NOT consumed —
    /// the loop retries the same date after `/dream on`).
    pub async fn run_night(&self, day_int: u32, date: &str) -> Option<Vec<(String, String)>> {
        // Global kill-switch: `/dream off` touches this file; no restart needed.
        let pause_flag = estate::pause_flag_path();
        let pause_flag = pause_flag.as_path();
        if pause_flag.exists() {
            info!(flag = %pause_flag.display(), "dreaming paused — night skipped (/dream on to resume)");
            return None;
        }

        // ADR-2071: the night-level work (forum governance, branch sweep,
        // digest, forum suggestions) is its own journal session; each repo's
        // cycle opens another. Fail-open throughout.
        let nj = Journal::from_env(&journal::session_for(
            &format!("night-{date}"),
            chrono::Utc::now().timestamp(),
        ));
        nj.turn_started(json!({ "date": date, "day": day_int }))
            .await;

        // Decisions the operator made on the forum governance panel since the
        // last night resolve their inbox items first, so tonight's carry-over
        // sees them. Fail-open.
        if governance::enabled() {
            let c = nj
                .called("forum.governance", json!({ "op": "ingest" }))
                .await;
            let r = governance::ingest(&inbox::inbox_path(), false).await;
            nj.completed(c, true, json!({ "resolved": r.resolved, "withdrawn": r.withdrawn, "rejected": r.rejected, "skipped": r.skipped }))
                .await;
        }

        let repos = match self.discover() {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "night aborted — no nominated repos");
                nj.turn_completed(json!({ "aborted": "no nominated repos" }))
                    .await;
                return Some(vec![]);
            }
        };

        // The seven-day rule for dream/* branches, before tonight adds any.
        // Opt out with DREAM_SWEEP=0.
        let swept = if std::env::var("DREAM_SWEEP").as_deref() == Ok("0") {
            Vec::new()
        } else {
            self.sweep_branches(&repos, &nj).await
        };

        let mut eligible = Vec::new();
        let mut standby: Vec<digest::Standby> = Vec::new();
        for (name, path) in &repos {
            if path.join(".dream-standby").exists() {
                info!(repo = %name, "standby — manual .dream-standby marker; skipped (/dream revive removes it)");
                standby.push(digest::Standby {
                    repo: name.clone(),
                    reason: "marker".into(),
                    streak: 0,
                });
                continue;
            }
            match self.repo_dry_streak(path) {
                s if s >= self.runtime.prune_dry_streak => {
                    info!(
                        repo = %name,
                        streak = s,
                        limit = self.runtime.prune_dry_streak,
                        "standby — dry streak (REJECT/INCONCLUSIVE nights); skipped (revive via --target)"
                    );
                    standby.push(digest::Standby {
                        repo: name.clone(),
                        reason: "dry-streak".into(),
                        streak: s,
                    });
                }
                _ => eligible.push((name.clone(), path.clone())),
            }
        }

        // Two eligible directories for one remote repository collide (see
        // config::shared_remotes): say so every night until one is parked.
        for (slug, dirs) in crate::config::shared_remotes(&eligible) {
            let text = format!(
                "{} are separate checkouts of the same repository ({slug}) and are both being \
                 dreamed. They use two of the nightly slots on the same code and push \
                 same-named branches, so one night's pull request can be lost. Put all but one \
                 on standby (`touch workspace/<dir>/.dream-standby`).",
                dirs.join(" and ")
            );
            warn!(%slug, dirs = %dirs.join(","), "nominated checkouts share a remote");
            if let Err(e) = inbox::add("alert", "roster", &format!("{}-night", date), date, &text) {
                warn!(error = %e, "dream inbox write failed (fail-open)");
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
        let deferred: Vec<String> = eligible_names
            .iter()
            .filter(|n| !selected.contains(n))
            .cloned()
            .collect();
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
        let mut journal_stats: Vec<JournalStats> = Vec::new();
        let mut skipped_locked = 0usize;
        for (name, path) in eligible {
            let (result, stats) = self
                .cycle_repo_recorded(&name, &path, day_int, date, false)
                .await;
            journal_stats.push(stats);
            let verdict_label = match result {
                Ok(res) => res.verdict.as_str().to_string(),
                Err(EngineError::NightLocked(night)) => {
                    // Another engine owns this night; it records the outcome.
                    info!(repo = %name, %night, "skipped — night held by another engine");
                    skipped_locked += 1;
                    continue;
                }
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

        // Every selected repo was held by another engine: that engine owns the
        // night's outcomes, health summary and digest. Raising "zero eligible
        // repos" or overwriting its summary from here would be a false alarm.
        if outcomes.is_empty() && skipped_locked > 0 {
            info!(
                skipped = skipped_locked,
                "every selected night is held by another engine — nothing to report"
            );
            nj.turn_completed(json!({ "skipped": "all nights held by another engine" }))
                .await;
            return Some(outcomes);
        }

        // Night-health self-check: persist a machine-readable summary and
        // raise an operator alert on anomalies (hard failures, or a night
        // with nothing eligible — a silently shrunken roster is itself a
        // fault). This is the invariant "one honest row per eligible repo".
        let health = digest::NightHealth {
            date: date.to_string(),
            outcomes: outcomes
                .iter()
                .map(|(n, v)| digest::Outcome {
                    repo: n.clone(),
                    verdict: v.clone(),
                })
                .collect(),
            nominated: repos.iter().map(|(n, _)| n.clone()).collect(),
            standby,
            deferred,
            digest: None,
            journal: journal_stats,
            sweep: swept,
        };
        let health_path = digest::health_path();
        if let Some(dir) = health_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(e) = std::fs::write(
            &health_path,
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
            let c = nj
                .called("inbox.write", json!({ "kind": "alert", "repo": "roster" }))
                .await;
            let r = inbox::add("alert", "roster", &format!("{}-night", date), date, &text);
            nj.completed(c, r.is_ok(), json!({})).await;
            if let Err(e) = r {
                warn!(error = %e, "dream inbox write failed (fail-open)");
            }
        }

        // Surface every open decision on the forum governance panel
        // (ADR-2115), then post the nightly digest (JunkieJarvis → dreamlab
        // zone, "chat with agents") — visibility only, pointing at the panel.
        // Separate switches (DREAM_GOVERNANCE / DREAM_DIGEST): pausing panel
        // publishing must never silence the night report. Both fail-open:
        // forum trouble never taints the night.
        if governance::enabled() {
            let c = nj
                .called("forum.governance", json!({ "op": "publish" }))
                .await;
            let paths = governance::CasePaths {
                workspace: self.workspace.clone(),
                artefact_dir: self.artefact_dir.clone(),
            };
            let r = governance::publish(&inbox::inbox_path(), &paths, false).await;
            nj.completed(c, r.rejected == 0, json!({ "published": r.published, "withdrawn": r.withdrawn, "rejected": r.rejected }))
                .await;
        }
        if std::env::var("DREAM_DIGEST").as_deref() != Ok("0") {
            let c = nj.called("forum.post", json!({ "op": "digest" })).await;
            let status = digest::run(&self.workspace, date, false).await;
            nj.completed(c, !status.contains("failed"), json!({ "status": status }))
                .await;
            info!(result = %status, "night digest");
            records::record_digest_status(date, &status);
        }

        // Forum-suggestions tenant: mine the community feature-suggestions
        // thread, triage each new post with the LLM against the action-vs-risk
        // policy, queue handoffs, and reply inline as JunkieJarvis. Same
        // workspace-script pattern as the digest (the script is the live code;
        // this binary only schedules it). Fail-open; opt out with
        // DREAM_FORUM_SUGGESTIONS=0.
        if std::env::var("DREAM_FORUM_SUGGESTIONS").as_deref() != Ok("0") {
            let forum_script = std::env::var("DREAM_FORUM_SCRIPT").unwrap_or_else(|_| {
                "/home/devuser/workspace/project/agentbox/scripts/dream-forum-suggestions.mjs"
                    .into()
            });
            if Path::new(&forum_script).exists() {
                let c = nj
                    .called("forum.suggestions", json!({ "script": forum_script }))
                    .await;
                match Command::new("node").arg(&forum_script).output() {
                    Ok(out) => {
                        let tail = String::from_utf8_lossy(&out.stdout);
                        let last = tail.lines().last().unwrap_or("").to_string();
                        nj.completed(
                            c,
                            out.status.success(),
                            json!({ "exit": out.status.code(), "tail": last }),
                        )
                        .await;
                        info!(result = %last, "forum suggestions");
                    }
                    Err(e) => {
                        nj.completed(c, false, json!({ "error": e.to_string() }))
                            .await;
                        warn!(error = %e, "forum suggestions failed (fail-open)")
                    }
                }
            }
        }

        nj.turn_completed(json!({ "outcomes": outcomes.len() }))
            .await;
        records::record_night_journal(&nj.stats());
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

    /// The repo's dry streak from its own ledger (0 when the ledger is
    /// missing/unreadable — never punish a repo for having no history yet, or
    /// for a ledger path we cannot resolve). REJECT and INCONCLUSIVE advance
    /// it, ACCEPT resets it, BLOCKED-ENV and HANDOFF neither (the old engine
    /// counted only INCONCLUSIVE and reset on REJECT; changed by design in
    /// the `dream-core` extraction, see the extraction ledger).
    fn repo_dry_streak(&self, repo_path: &Path) -> usize {
        let Ok((cfg, _)) = config::load_dream_config(&repo_path.join("dream.config.json")) else {
            return 0;
        };
        match std::fs::read_to_string(repo_path.join(&cfg.ledger_path)) {
            Ok(text) => streak::dry_streak_text(&text),
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
        self.cycle_repo_recorded(repo_name, repo_path, day_int, date, dry_run)
            .await
            .0
    }

    /// One repo's cycle as one journal session (ADR-2071): `turn.started`,
    /// a `tool.called`/`tool.completed` pair per side effect, `turn.completed`
    /// carrying the verdict or the error. Every early return is covered
    /// because the session is closed here, outside the cycle body. A dry run
    /// has no side effects and is not journalled.
    async fn cycle_repo_recorded(
        &self,
        repo_name: &str,
        repo_path: &Path,
        day_int: u32,
        date: &str,
        dry_run: bool,
    ) -> (Result<CycleResult, EngineError>, JournalStats) {
        let night_id = format!("{}-{}", date, repo_name);
        let j = if dry_run {
            Journal::disabled(&night_id)
        } else {
            Journal::from_env(&journal::session_for(
                &night_id,
                chrono::Utc::now().timestamp(),
            ))
        };
        j.turn_started(json!({ "repo": repo_name, "date": date, "night_id": night_id }))
            .await;
        let result = self
            .cycle_repo_body(repo_name, repo_path, day_int, date, dry_run, &j)
            .await;
        let outcome = match &result {
            Ok(r) => json!({ "verdict": r.verdict.as_str(), "finding": r.finding }),
            Err(e) => json!({ "error": e.to_string() }),
        };
        j.turn_completed(outcome).await;
        let stats = j.stats();
        (result, stats)
    }

    async fn cycle_repo_body(
        &self,
        repo_name: &str,
        repo_path: &Path,
        day_int: u32,
        date: &str,
        dry_run: bool,
        j: &Journal,
    ) -> Result<CycleResult, EngineError> {
        info!(repo = %repo_name, "cycle start");
        let repo_name = repo_name.to_string();
        let repo_path = repo_path.to_path_buf();

        // Load config, pick slot, compile the prompt.
        // One read: the parsed document, the manifest's digest and the
        // protected-path policy are all built from these same bytes.
        let config_path = repo_path.join("dream.config.json");
        let (cfg, config_bytes) = config::load_dream_config(&config_path)?;
        let slot = config::tonight_slot(&cfg, day_int).clone();
        let bonuses = config::bonus_dives(&cfg, day_int);

        let night_id = format!("{}-{}", date, repo_name);
        let night_dir = self.artefact_dir.join(&night_id);

        // Exclusive per-night lock, taken before the first journal read and
        // held (RAII) until this function returns, so two engines can never
        // both pass the "is it finished?" check and both publish. A dry run
        // writes nothing, so it takes no lock.
        let _night_lock = if dry_run {
            None
        } else {
            match runstate::NightLock::acquire_within(&night_dir, Duration::from_millis(250)) {
                Ok(l) => Some(l),
                Err(runstate::LockError::Held { path }) => {
                    info!(night = %night_id, lock = %path.display(), "night held by another engine — skipped");
                    return Err(EngineError::NightLocked(night_id));
                }
                Err(runstate::LockError::Io { source, .. }) => return Err(source.into()),
            }
        };

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
                .persist_handoff(
                    &cfg, &repo_name, &repo_path, &slot.deep, &night_id, date, &admission, j,
                )
                .await;
        }
        info!(
            repo = %repo_name,
            deep = %slot.deep,
            required = %admission.required.join(", "),
            advisory = %admission.advisory.join(", "),
            "admission passed — evaluators are usable for tonight's deep"
        );

        let mut prompt = prompt::compile(&cfg, &slot, day_int, &bonuses)?;
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

        // 0b. A night is identified by its directory (repo, date, deep slot),
        //     not by the run id: the engine's own ledger commit moves HEAD and
        //     so the run id. A night already persisted or complete is over —
        //     no model call, no new manifest, no commit, no forge request.
        //     Only an operator `--reset-night` reopens it.
        let finished = match runstate::finished_night(&night_dir, &repo_name, date, &night_id) {
            Ok(f) => f,
            Err(e) => {
                return Ok(journal_blocked(
                    &repo_name, &repo_path, &cfg, &night_id, date, &e,
                ))
            }
        };
        if let Some(prior) = finished {
            info!(
                run_id = %prior.run_id,
                verdict = ?prior.verdict,
                "night already complete — skipping"
            );
            return Ok(finished_result(
                repo_name,
                &prior,
                night_dir.join("report.md"),
                repo_path.join(&cfg.ledger_path),
            ));
        }

        // 1. Freeze the experiment manifest BEFORE anything else can move.
        //    Baseline revision + tree hash, evaluator identities and command
        //    digests, the model we intend to call, and the restart-safe run id.
        let default_llm;
        let llm: &dyn Llm = match &self.llm_override {
            Some(l) => l.as_ref(),
            None => {
                default_llm = LlmAdapter::new(self.llm.clone());
                &default_llm
            }
        };
        let fallback_llm = self.llm_fallback.clone().map(LlmAdapter::new);
        let fallback: Option<&dyn Llm> = fallback_llm.as_ref().map(|f| f as &dyn Llm);
        let notifier = Notifiers(vec![
            Box::new(InboxNotifier::new(&repo_name, &night_id, date)),
            Box::new(JournalNotifier::new(j)),
        ]);

        let (baseline_rev, baseline_tree) = match baseline::of(&repo_path) {
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
                        j,
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
            ModelIdentity {
                fallback: self
                    .llm_fallback
                    .as_ref()
                    .map(|f| format!("{:?}:{}", f.provider, f.model).to_lowercase()),
                ..llm.identity()
            },
            env!("CARGO_PKG_VERSION"),
        );
        // The night's single protected-path policy, from the bytes the
        // manifest just froze. A config the manifest does not vouch for is a
        // fault, never a reason to run with a weaker policy.
        // Computed once: the same value builds the policy and is recorded for replay.
        let extras = match policy::resolved_extras(&frozen, &repo_path) {
            Ok(x) => x,
            Err(e) => {
                warn!(repo = %repo_name, error = %e, "evaluator commands cannot be analysed — BLOCKED-ENV");
                return self
                    .persist_blocked_env(
                        &cfg,
                        &repo_name,
                        &repo_path,
                        &slot.deep,
                        &night_id,
                        date,
                        "",
                        &format!("protected-path policy could not be built: {e}"),
                        j,
                    )
                    .await;
            }
        };
        let policy = match policy::for_night(&frozen, &config_bytes, &extras) {
            Ok(p) => p,
            Err(e) => {
                warn!(repo = %repo_name, error = %e, "protected-path policy unavailable — BLOCKED-ENV");
                return self
                    .persist_blocked_env(
                        &cfg,
                        &repo_name,
                        &repo_path,
                        &slot.deep,
                        &night_id,
                        date,
                        "",
                        &format!("protected-path policy could not be built: {e}"),
                        j,
                    )
                    .await;
            }
        };
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
                        &cfg,
                        &repo_name,
                        &repo_path,
                        &slot.deep,
                        &night_id,
                        date,
                        "",
                        &format!("experiment manifest could not be frozen: {e}"),
                        j,
                    )
                    .await;
            }
        }

        // 1b. Node health, before the journal counts an attempt. Hygiene first:
        //     sweep night dirs older than 3 days so the annexe never accumulates
        //     stale clones/build trees (fail-open). Then prove the annexe takes
        //     a write and has room: a full or unreachable node is BLOCKED-ENV
        //     for tonight but leaves the experiment's retry budget intact
        //     (2026-09-26: a full HP disk abandoned loom's run on two
        //     attempts that never reached the model).
        let c = j
            .called(
                "annexe.ssh",
                json!({ "op": "retention-sweep", "run_id": frozen.run_id }),
            )
            .await;
        let swept = dispatch::ssh(
            &self.runtime.hp_host,
            &format!(
                "find {} -maxdepth 1 -type d -name '20*' -mtime +3 -exec rm -rf {{}} + 2>/dev/null; true",
                dispatch::shell_quote(&self.runtime.hp_annexe_dir)
            ),
        );
        j.completed(
            c,
            swept.is_ok(),
            json!({ "error": swept.as_ref().err().map(|e| e.to_string()) }),
        )
        .await;
        if let Err(e) = swept {
            warn!(error = %e, "annexe retention sweep failed (fail-open)");
        }
        let c = j.called("annexe.ssh", json!({ "op": "health" })).await;
        let health = dispatch::annexe_health(
            &self.runtime.hp_host,
            &self.runtime.hp_annexe_dir,
            min_free_gib_from(std::env::var("DREAM_ANNEXE_MIN_FREE_GIB").ok().as_deref()),
        );
        j.completed(
            c,
            health.is_ok(),
            json!({ "free_gib": health.as_ref().ok(), "error": health.as_ref().err() }),
        )
        .await;
        match health {
            Ok(gib) => info!(free_gib = gib, "connected node annexe healthy"),
            Err(reason) => {
                warn!(%reason, "connected node annexe unhealthy — BLOCKED-ENV, no attempt counted");
                let _ = inbox::add(
                    "alert",
                    &repo_name,
                    &night_id,
                    date,
                    &format!(
                        "Dream run {} for {} did not start: the connected node annexe is unhealthy ({}). \
                         No attempt was counted; it runs once the node is fixed.",
                        frozen.run_id, repo_name, reason
                    ),
                );
                return self
                    .persist_blocked_env(
                        &cfg,
                        &repo_name,
                        &repo_path,
                        &slot.deep,
                        &night_id,
                        date,
                        "",
                        &format!("connected node annexe unhealthy: {reason}"),
                        j,
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
                    "night already complete — skipping"
                );
                return Ok(finished_result(
                    repo_name,
                    &prior,
                    night_dir.join("report.md"),
                    repo_path.join(&cfg.ledger_path),
                ));
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
                        prior.run_id,
                        repo_name,
                        prior.attempts,
                        prior.phase.as_str()
                    ),
                );
                return self
                    .persist_blocked_env(
                        &cfg,
                        &repo_name,
                        &repo_path,
                        &slot.deep,
                        &night_id,
                        date,
                        "",
                        &format!("run abandoned after {} attempts", prior.attempts),
                        j,
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
                return Ok(journal_blocked(
                    &repo_name, &repo_path, &cfg, &night_id, date, &e,
                ));
            }
        };
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::ManifestFrozen);

        // 3. Dispatch to the connected node annexe: clone, build, run evaluators.
        //    The remote dir carries the RUN ID, not the pid: two attempts at the
        //    same experiment reuse one workspace, two different experiments
        //    never collide, and the name survives a restart.
        let remote_dir = format!(
            "{}/{}-r{}",
            self.runtime.hp_annexe_dir, night_id, frozen.run_id
        );
        info!(remote = %remote_dir, "dispatching to the connected node");
        // Mirror the repo's real depth under the workspace so sibling
        // path-deps resolve on the annexe (see `clone_repo_and_siblings`).
        let repo_subpath = dispatch::annexe_subpath(&repo_path, &self.workspace);
        let c = j
            .called(
                "annexe.clone",
                json!({ "remote": remote_dir, "include": cfg.sibling_repos }),
            )
            .await;
        let cloned = dispatch::clone_repo_and_siblings(
            &self.runtime.hp_host,
            &repo_path,
            &remote_dir,
            &repo_subpath,
            &cfg.sibling_repos,
            &self.workspace,
        );
        j.completed(
            c,
            cloned.is_ok(),
            json!({ "error": cloned.as_ref().err().map(|e| e.to_string()) }),
        )
        .await;
        cloned?;

        // Pre-flight probe: the checkout must exist and be non-empty on the connected node
        // before any evaluator runs. A broken environment (vanished cwd,
        // empty extraction) must become BLOCKED-ENV — a verdict the LLM never
        // sees and the dry streak never counts — not an INCONCLUSIVE night
        // full of false-positive evaluator "findings". One re-provision retry.
        let work_dir = format!("{}/{}", remote_dir, repo_subpath);
        let probe = |wd: &str| {
            dispatch::ssh(
                &self.runtime.hp_host,
                &format!(
                    "test -d {0} && [ -n \"$(ls -A {0})\" ] && echo PREFLIGHT-OK",
                    dispatch::shell_quote(wd)
                ),
            )
        };
        let c = j.called("annexe.ssh", json!({ "op": "preflight" })).await;
        let first = probe(&work_dir);
        let first_ok = matches!(&first, Ok(out) if out.contains("PREFLIGHT-OK"));
        j.completed(c, first_ok, json!({})).await;
        let preflight_ok = if first_ok {
            true
        } else {
            warn!(result = ?first.err().map(|e| e.to_string()), "pre-flight failed — re-provisioning annexe checkout once");
            let c = j
                .called(
                    "annexe.clone",
                    json!({ "remote": remote_dir, "op": "reprovision" }),
                )
                .await;
            let _ = dispatch::ssh(
                &self.runtime.hp_host,
                &format!("rm -rf {}", dispatch::shell_quote(&remote_dir)),
            );
            let recloned = dispatch::clone_repo_and_siblings(
                &self.runtime.hp_host,
                &repo_path,
                &remote_dir,
                &repo_subpath,
                &cfg.sibling_repos,
                &self.workspace,
            );
            j.completed(
                c,
                recloned.is_ok(),
                json!({ "error": recloned.as_ref().err().map(|e| e.to_string()) }),
            )
            .await;
            recloned?;
            let c = j
                .called("annexe.ssh", json!({ "op": "preflight", "retry": true }))
                .await;
            let ok = matches!(probe(&work_dir), Ok(out) if out.contains("PREFLIGHT-OK"));
            j.completed(c, ok, json!({})).await;
            ok
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
                        remote_dir, repo_subpath
                    ),
                    j,
                )
                .await;
        }

        // 4. Build step, then the BASELINE evaluator pass — each run producing a
        //    typed receipt (exit code, both streams, duration, outcome) rather
        //    than an untyped blob of stdout.
        let build_out = match cfg.build_step.as_ref() {
            Some(bs) => {
                let c = j
                    .called("annexe.exec", json!({ "op": "build", "cmd": bs.cmd }))
                    .await;
                let exec = self
                    .runner
                    .run(&work_dir, &bs.cmd, DEFAULT_BUILD_TIMEOUT_SECS);
                j.completed(
                    c,
                    exec.exit_code == Some(0),
                    json!({ "exit": exec.exit_code }),
                )
                .await;
                match exec.exit_code {
                    Some(0) => exec.stdout,
                    other => {
                        warn!(exit = ?other, "build step did not succeed — evaluators decide the night");
                        format!(
                            "BUILD FAILED (exit {:?})\n{}\n{}",
                            other, exec.stdout, exec.stderr
                        )
                    }
                }
            }
            None => "(no build step)".into(),
        };
        let applicable = frozen.applicable();
        let c = j
            .called(
                "annexe.exec",
                json!({ "op": "evaluate", "phase": "baseline",
                "evaluators": applicable.iter().map(|e| e.name.clone()).collect::<Vec<_>>() }),
            )
            .await;
        let baseline_receipts = self.run_evaluators(&work_dir, &applicable, Phase::Baseline);
        j.completed(
            c,
            true,
            json!({ "outcomes": receipt_outcomes(&baseline_receipts) }),
        )
        .await;
        for r in &baseline_receipts {
            info!(receipt = %r.summary(), "baseline evaluator");
        }
        if let Err(e) = receipts::persist(&night_dir, Phase::Baseline, &baseline_receipts) {
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
            // The same harness failures recurring unchanged night after night
            // is a stalled harness, not a repo problem: say so (HarnessStuck).
            self.record_streak(
                &repo_name,
                &night_id,
                Verdict::BlockedEnv.as_str(),
                &env_vetoes,
                &notifier,
            )
            .await;
            let res = self
                .persist_blocked_env(
                    &cfg,
                    &repo_name,
                    &repo_path,
                    &slot.deep,
                    &night_id,
                    date,
                    &remote_dir,
                    &detail,
                    j,
                )
                .await?;
            let _ = runstate::complete(&night_dir, &mut run, res.verdict.as_str());
            return Ok(res);
        }

        // 5. Append evidence receipts to the prompt so the LLM reasons over
        //    real evaluator output, not imagination. The LLM has no shell:
        //    everything it may cite — receipts, prior ledger rows, the session
        //    commit — must be in this pack. the connected node paths are redacted before they
        //    reach an external provider.
        let commit = baseline_rev.clone();
        let evidence_start = prompt.len();
        prompt.push_str(
            "\n\n---\n\n# TONIGHT'S EVIDENCE (receipts from the connected node annexe)\n\n",
        );
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
        match std::fs::create_dir_all(&night_dir)
            .and_then(|_| context::persist_receipts(&night_dir, &night_id, &build_out, &eval_outs))
        {
            Ok(mut objects) => {
                if estate::self_gc_enabled() {
                    objects.extend(context::load_prior_objects(
                        &self.artefact_dir,
                        &repo_name,
                        date,
                    ));
                    let c = j
                        .called(
                            "llm.call",
                            json!({ "purpose": "context-govern", "model": self.llm.model }),
                        )
                        .await;
                    governed_pack = context::govern(
                        llm,
                        fallback,
                        &objects,
                        &slot.deep,
                        &slot.scan.join(", "),
                        estate::self_gc_budget(),
                        estate::redact,
                    )
                    .await;
                    j.completed(c, governed_pack.is_some(), json!({})).await;
                }
            }
            Err(e) => warn!(error = %e, "receipt sidecar persist failed (fail-open)"),
        }
        match governed_pack {
            Some(pack) => prompt.push_str(&pack),
            None => {
                prompt.push_str(&format!(
                    "## Build output (tail)\n```\n{}\n```\n\n",
                    estate::redact(tail(&build_out, 3000))
                ));
                for (name, out) in &eval_outs {
                    prompt.push_str(&format!(
                        "## Evaluator `{}` output (tail)\n```\n{}\n```\n\n",
                        name,
                        estate::redact(tail(out, 6000))
                    ));
                }
            }
        }

        // 5c. Tree-read (ADR-2114): the model has no shell, so the source its
        //     diff must apply to is read here — from the dispatched commit, the
        //     same bytes the annexe built — and inlined. Fail-open: no section,
        //     same night as before.
        let required_cmds: Vec<String> = frozen
            .required()
            .iter()
            .map(|id| id.command.clone())
            .chain(cfg.build_step.as_ref().map(|b| b.cmd.clone()))
            .collect();
        let c = j
            .called(
                "llm.call",
                json!({ "purpose": "source-gather", "model": self.llm.model }),
            )
            .await;
        let scans = slot.scan.join(", ");
        let source_cfg = estate::source_config_from_env();
        let deny = estate::source_denylist();
        // Sources the previous night (or the operator) asked for are read
        // first (ADR-DE-008); `wanted` keeps them until met or lapsed.
        let mut requested = wanted::take_for(&repo_name, &slot.deep);
        if !requested.is_empty() {
            info!(
                count = requested.len(),
                "honouring the previous night's source requests"
            );
        }
        // A slot whose `scan` entries are paths (files or directories) has
        // already said what its nights read; offer them after the explicit
        // requests, so the planner is never the only thing standing between
        // a deep and its own scope. Topic-word scans are left to the prompt.
        for scan in &slot.scan {
            let Some(key) = wanted::path_tokens(scan).into_iter().next() else {
                continue;
            };
            if let Some(r) = source::SourceRequest::parse(&key) {
                if !requested.iter().any(|q| q.path == r.path) {
                    requested.push(r);
                }
            }
        }
        let gathered = source::gather(
            llm,
            fallback,
            &source::GatherInput::new(
                &repo_path,
                &baseline_rev,
                &slot.deep,
                &scans,
                &required_cmds,
                &prompt[evidence_start..],
                &source_cfg,
                &deny,
            )
            .with_requested(&requested),
            &estate::redact,
        )
        .await;
        j.completed(c, gathered.is_some(), json!({})).await;
        let source_section = match gathered {
            Some((section, record)) => {
                let _ = manifest::write_atomic(
                    &night_dir.join("source.json"),
                    &serde_json::to_vec_pretty(&record).unwrap_or_default(),
                );
                wanted::settle(&repo_name, &slot.deep, &night_id, &record);
                prompt.push_str(&section);
                Some(section)
            }
            None => None,
        };

        // 6. LLM call: primary (with its internal retry), then the fallback
        //    provider, and only then a degraded night.
        info!(provider = ?self.llm.provider, model = %self.llm.model, "calling LLM");
        let mut model_used = self.llm.model.clone();
        let c = j
            .called(
                "llm.call",
                json!({ "purpose": "verdict", "provider": format!("{:?}", self.llm.provider),
                "model": self.llm.model, "prompt_chars": prompt.len() }),
            )
            .await;
        let primary = llm
            .complete(&LlmRequest::new(prompt.as_str(), llm.identity().max_tokens))
            .await;
        j.completed(
            c,
            primary.is_ok(),
            json!({ "error": primary.as_ref().err().map(|e| e.to_string()) }),
        )
        .await;
        let report = match primary {
            Ok(r) => r,
            Err(primary_err) => match (&self.llm_fallback, fallback) {
                (Some(fb), Some(fb_llm)) => {
                    warn!(
                        error = %primary_err,
                        fallback_provider = ?fb.provider,
                        fallback_model = %fb.model,
                        "primary LLM failed — trying fallback provider"
                    );
                    let c = j
                        .called(
                            "llm.call",
                            json!({ "purpose": "verdict-fallback",
                            "provider": format!("{:?}", fb.provider), "model": fb.model }),
                        )
                        .await;
                    let second = fb_llm
                        .complete(&LlmRequest::new(
                            prompt.as_str(),
                            fb_llm.identity().max_tokens,
                        ))
                        .await;
                    j.completed(
                        c,
                        second.is_ok(),
                        json!({ "error": second.as_ref().err().map(|e| e.to_string()) }),
                    )
                    .await;
                    match second {
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
                _ => {
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
        //    report's own claim about its patch. `candidate_flow::attempt` goes
        //    through `dream_core::candidate::run`, which runs the protected-path
        //    guard before any git command, build or evaluator.
        let required = frozen.required();
        let branch = persist::branch_name(&slot.deep, date);
        let mut attempt = dream_core::candidate::Attempt {
            state: CandidateState::NotAttempted,
            prepared: None,
            receipts: Vec::new(),
            build: None,
            error: None,
        };
        // The patch text the candidate state came from (the corrected diff
        // after an apply-repair), recorded with the night for replay.
        let mut judged_patch: Option<String> = None;

        // 8a. Repair pass (ADR-2114): an ACCEPT with no diff gets exactly one
        //     follow-up call asking for the diff alone. The report itself is
        //     not rewritten — its witness and VERDICT line stay as emitted;
        //     the outcome is receipted in repair.json.
        let claimed_accept = matches!(strict, Ok(Verdict::Accept));
        let mut patch = dream_gate::patch::extract_patch(&report);
        if source::needs_repair(claimed_accept, patch.is_some()) {
            info!("ACCEPT without a dream-patch block — running the one-shot repair pass");
            let c = j
                .called(
                    "llm.call",
                    json!({ "purpose": "repair", "model": self.llm.model }),
                )
                .await;
            let record = source::repair(llm, fallback, &report, source_section.as_deref()).await;
            j.completed(
                c,
                matches!(record.outcome, source::RepairOutcome::Patch(_)),
                json!({}),
            )
            .await;
            info!(outcome = ?record.outcome, "repair pass finished");
            let _ = manifest::write_atomic(
                &night_dir.join("repair.json"),
                &serde_json::to_vec_pretty(&record).unwrap_or_default(),
            );
            if let source::RepairOutcome::Patch(p) = record.outcome {
                patch = Some(p);
            }
        }

        if claimed_accept {
            match patch {
                None => {
                    info!(
                        "report claims ACCEPT but carries no candidate patch — nothing to verify"
                    );
                    attempt.state = CandidateState::NoPatch;
                }
                Some(patch) => {
                    let commit_msg = format!("dream({}): candidate for {}", slot.deep, night_id);
                    let flow = Flow {
                        repo: &repo_path,
                        branch: &branch,
                        commit_msg: &commit_msg,
                        base: &baseline_rev,
                        policy: &policy,
                        build: cfg
                            .build_step
                            .as_ref()
                            .map(|b| (b.cmd.as_str(), DEFAULT_BUILD_TIMEOUT_SECS)),
                        required: &required,
                        runner: self.runner.as_ref(),
                        annexe: Some(Annexe {
                            host: &self.runtime.hp_host,
                            remote_dir: &remote_dir,
                            repo_subpath: &repo_subpath,
                            siblings: &cfg.sibling_repos,
                            workspace: &self.workspace,
                        }),
                        night_dir: &night_dir,
                        report: &report,
                        llm,
                        fallback,
                    };
                    let (a, judged) = candidate_flow::attempt_judged(&flow, &patch, j).await;
                    attempt = a;
                    judged_patch = Some(judged);
                    match &attempt.state {
                        CandidateState::Applied { tree_hash, .. } => {
                            info!(tree = %tree_hash, branch = %branch, "candidate tree built in isolation")
                        }
                        other => {
                            warn!(state = ?other, "candidate not applied — acceptance cannot be verified")
                        }
                    }
                }
            }
        }
        if let Some(rec) = candidate_flow::candidate_record(&frozen.run_id, &attempt) {
            let _ = manifest::write_candidate(&night_dir, &rec);
        }
        let candidate_receipts = std::mem::take(&mut attempt.receipts);
        if !candidate_receipts.is_empty() {
            if let Err(e) = receipts::persist(&night_dir, Phase::Candidate, &candidate_receipts) {
                warn!(error = %e, "candidate receipt persist failed (fail-open)");
            }
        }
        let _ = runstate::advance(&night_dir, &mut run, runstate::Phase::CandidateEvaluated);

        // 9. The deterministic gate. From here the verdict is a function of the
        //    receipts, not of the report's prose. The context always carries
        //    this night's policy (the one the candidate guard used) and the
        //    digest of the config the candidate tree was evaluated with: a
        //    config that drifted under the night is BLOCKED-ENV.
        let candidate_config_digest = attempt
            .prepared
            .as_ref()
            .and_then(candidate_flow::tree_config_digest);
        let cand_work = format!("{}/candidate/{}", remote_dir, repo_subpath);
        let tests: std::collections::BTreeMap<_, _> = test_evidence(
            &required,
            &baseline_receipts,
            &candidate_receipts,
            &work_dir,
            &cand_work,
        )
        .into_iter()
        .collect();
        // Every night that reaches the gate is judged AND recorded by
        // `replay::capture` (through `judge::judge`), with the policy
        // additions it was judged under, so `replay verify` reproduces the
        // verdict from the artefact directory.
        let inputs = replay::NightInputs {
            manifest: frozen.clone(),
            report: report.clone(),
            candidate: attempt.state.clone(),
            extracted_patch: judged_patch,
            baseline_receipts: baseline_receipts.clone(),
            candidate_receipts: candidate_receipts.clone(),
            config_bytes: config_bytes.clone(),
            fallback_ledger_path: DEFAULT_LEDGER_PATH.into(),
            candidate_config_digest,
            tests,
            options: Default::default(),
            policy: extras.clone(),
        };
        let decision = match judge::judge(&night_dir, &inputs) {
            Ok(judged) => {
                if let Err(why) = &judged.recorded {
                    // Visible, not just a log line: this night will not replay.
                    let c = j
                        .called("replay.capture", json!({ "night": night_id }))
                        .await;
                    j.completed(c, false, json!({ "error": why })).await;
                }
                judged.decision
            }
            Err(e) => {
                // Unreachable in practice: the same bytes built `policy` above.
                warn!(repo = %repo_name, error = %e, "gate inputs could not be judged — BLOCKED-ENV");
                let _ = runstate::fail(&night_dir, &mut run, &e.to_string());
                return self
                    .persist_blocked_env(
                        &cfg,
                        &repo_name,
                        &repo_path,
                        &slot.deep,
                        &night_id,
                        date,
                        "",
                        &format!("the gate could not judge the night: {e}"),
                        j,
                    )
                    .await;
            }
        };
        let prepared = attempt.prepared.take();
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
        self.record_streak(
            &repo_name,
            &night_id,
            v.as_str(),
            &decision.vetoes,
            &notifier,
        )
        .await;

        // The finding shown in the ledger must not read as a win when the gate
        // refused one.
        let finding = if decision.accepted || decision.vetoes.is_empty() {
            verdict::sanitise_finding(&report, lenient, date)
        } else {
            vetoed_finding(
                &verdict::sanitise_finding(&report, lenient, date),
                &decision,
            )
        };
        let finding_head = verdict::sanitise_finding_full(&report, lenient);
        let finding_full = format!("{}\n\nGate: {}", finding_head, decision.summary);

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
        //      Source supply is not a decision (ADR-DE-008): a "please
        //      inline X" line becomes a request the next tree-read honours,
        //      and the report's own "Sources wanted next night" list is
        //      recorded the same way. Only a path asked for again after it
        //      was read reaches the operator, as one alert.
        let mut wanted_keys = wanted::extract_wanted(&report);
        for q in inbox::extract_questions(&report) {
            if wanted::is_source_supply(&q) {
                for k in wanted::path_tokens(&q) {
                    if !wanted_keys.contains(&k) {
                        wanted_keys.push(k);
                    }
                }
                info!(question = %q, "source-supply ask routed to the tree-read, not the operator");
                continue;
            }
            let q = inbox::plain_decision(&q);
            let c = j.called("inbox.write", json!({ "kind": "question" })).await;
            let added = inbox::add("question", &repo_name, &night_id, date, &q);
            j.completed(c, added.is_ok(), json!({})).await;
            match added {
                Ok(id) => info!(id = %id, "operator question queued to dream inbox"),
                Err(e) => warn!(error = %e, "dream inbox write failed (fail-open)"),
            }
        }
        match wanted::record(&repo_name, &slot.deep, &wanted_keys, &night_id, "report") {
            Ok(looped) if !looped.is_empty() => {
                let c = j
                    .called(
                        "inbox.write",
                        json!({ "kind": "alert", "why": "source-loop" }),
                    )
                    .await;
                let added = inbox::add(
                    "alert",
                    &repo_name,
                    &night_id,
                    date,
                    &wanted::loop_alert(&repo_name, &slot.deep, &looped),
                );
                j.completed(c, added.is_ok(), json!({})).await;
            }
            Ok(_) => {}
            Err(e) => warn!(error = %e, "source-request store write failed (fail-open)"),
        }
        // A vetoed ACCEPT is exactly the kind of thing a human should see.
        if !decision.vetoes.is_empty() {
            let c = j
                .called("inbox.write", json!({ "kind": "alert", "why": "veto" }))
                .await;
            let added = inbox::add(
                "alert",
                &repo_name,
                &night_id,
                date,
                &format!(
                    "Dream night {} claimed {} but the required-check gate vetoed it → {}. {}",
                    night_id, decision.model_verdict, decision.verdict, decision.summary
                ),
            );
            j.completed(c, added.is_ok(), json!({})).await;
        }

        // 11b'. Persistence begins HERE, before any externally visible effect
        //      (forge request, ledger commit). A crash from now on can lose a
        //      publish but can never repeat one: the next start sees a
        //      Persisted night and skips it, whatever the moved HEAD says.
        if let Err(e) = runstate::persist(&night_dir, &mut run, v.as_str()) {
            warn!(error = %e, "run journal unwritable before persistence — refusing to publish unrecoverably");
            return self
                .persist_blocked_env(
                    &cfg,
                    &repo_name,
                    &repo_path,
                    &slot.deep,
                    &night_id,
                    date,
                    "",
                    &format!("run journal unwritable: {e}"),
                    j,
                )
                .await;
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
                let title = pr_title(&slot.deep, &finding, &finding_head);
                let body = format!(
                    "Draft PR opened by the dream engine on a GATED ACCEPT night ({night_id}, \
                     run `{run_id}`).\n\nCandidate tree `{tree}` was applied in isolation and the \
                     required evaluators re-run against it: {outcomes}. Witness `{wit_short}`.\n\n\
                     A human decides the merge — evaluation is not promotion.\n\n**Finding:** {finding_full}{landing}",
                    landing = {
                        let mut note = if c.applied_via.starts_with("apply-repair") {
                            format!("\n\n**Note:** the report's own diff did not apply; this diff is the model's corrected version from one apply-repair call (`{}`). Review it against the finding.", c.applied_via)
                        } else if c.applied_via.starts_with("normalised") {
                            format!("\n\n**Note:** the engine adjusted this diff's headers or context lines before applying it (`{}`); its added and removed lines are the model's own.", c.applied_via)
                        } else {
                            String::new()
                        };
                        // Independent of the apply note: a formatted candidate
                        // is reviewed as the model's logic in the fixer's layout
                        // (ADR-DE-009), whatever way its diff landed.
                        if let Some(f) = &c.formatting {
                            if let dream_core::candidate::FormattingOutcome::Applied { .. } = f.outcome {
                                note.push_str(&format!(
                                    "\n\n**Note:** the engine ran `{}` on the candidate's own files ({}) as a second commit; the logic is the model's, the layout the formatter's.",
                                    f.fixer.name(),
                                    f.files.join(", ")
                                ));
                            }
                        }
                        note
                    },
                    run_id = frozen.run_id,
                    tree = c.tree_hash,
                    outcomes = decision
                        .required_outcomes
                        .iter()
                        .map(|(n, o)| format!("{n}={o}"))
                        .collect::<Vec<_>>()
                        .join(", "),
                );
                let jc = j.called("git.push", json!({ "branch": c.branch, "repo": cfg.repo, "then": "gh pr create --draft" })).await;
                let out = self.forge.publish_draft(&DraftPr {
                    repo_dir: repo_path.clone(),
                    repo_slug: cfg.repo.clone(),
                    branch: c.branch.clone(),
                    title,
                    body,
                });
                j.completed(
                    jc,
                    out.pushed && out.pr_url.is_some(),
                    json!({ "pushed": out.pushed, "pr": out.pr_url }),
                )
                .await;
                info!(branch = %out.branch, pushed = out.pushed, pr = ?out.pr_url, "verified candidate persisted as draft PR");
                if out.pr_url.is_none() {
                    warn!(branch = %out.branch, pushed = out.pushed, "verified candidate has no draft PR — raising an alert");
                    notifier
                        .notify(&notify::lost_pr(
                            &repo_name,
                            &cfg.repo,
                            &out.branch,
                            out.pushed,
                        ))
                        .await;
                } else {
                    notifier
                        .notify(&Notice::Accepted {
                            repo: repo_name.clone(),
                            night_id: night_id.clone(),
                            branch: out.branch.clone(),
                            pr_url: out.pr_url.clone(),
                        })
                        .await;
                }
                pr_ref = out.pr_url.clone().unwrap_or_else(|| {
                    if out.pushed {
                        format!("branch:{}", out.branch)
                    } else {
                        "PERSIST-LOCAL".into()
                    }
                });
            }
            (Some(c), true) => {
                candidate::cleanup(&repo_path, c);
                info!("persist_accepts disabled — verified candidate left on local branch only");
                pr_ref = format!("branch:{}", c.branch);
            }
            (Some(c), false) => {
                warn!(branch = %c.branch, "candidate vetoed — discarding branch and worktree");
                let jc = j
                    .called(
                        "git.branch-delete",
                        json!({ "branch": c.branch, "why": "vetoed" }),
                    )
                    .await;
                candidate::discard(&repo_path, c);
                j.completed(jc, true, json!({})).await;
                pr_ref = "VETOED".into();
            }
            (None, _) => {}
        }

        // 12. Ledger row.
        let ledger_path = repo_path.join(&cfg.ledger_path);
        let row = LedgerRow {
            date: date.into(),
            deep: slot.deep.clone(),
            finding,
            issue: "NONE".into(),
            pr: pr_ref.clone(),
            evaluated: "yes".into(),
            verdict: v.as_str().into(),
            effect: String::new(),
            witness: wit_short.clone(),
            prior_fates: String::new(),
            // FR6.6 — the human columns are EMPTY tonight. A PR opened by this
            // night has not been reviewed yet; they are filled on a later night
            // from the merge event (ledger::review_from_merge), alongside the
            // prior-night fate token for the same PR.
            reviewer: String::new(),
            review_minutes: String::new(),
        };
        let row = self
            .append_and_commit_ledger(
                &repo_path,
                &ledger_path,
                row,
                &gate_result_line(&decision),
                &night_id,
                j,
            )
            .await?;
        info!(path = %ledger_path.display(), "ledger row appended");

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
        let c = j
            .called(
                "ruvector.store",
                json!({ "namespace": self.ruvector.namespace, "key": df.night_id }),
            )
            .await;
        // Operational verdicts (BLOCKED-ENV/HANDOFF) clear no storage bar and
        // are skipped inside the sink, exactly as before.
        let store = RuVectorSink::new(self.ruvector.clone())
            .record(&ruvector::record_for(&df))
            .await;
        let stored = store.is_ok() && ruvector::stores(&df.verdict);
        j.completed(
            c,
            stored,
            json!({ "error": store.as_ref().err().map(|e| e.to_string()) }),
        )
        .await;
        if let Err(e) = &store {
            warn!(error = %e, "RuVector store failed (fail-open)");
        }
        notifier
            .notify(&Notice::NightSummary {
                repo: repo_name.clone(),
                night_id: night_id.clone(),
                verdict: v.as_str().to_string(),
                finding: row.finding.clone(),
            })
            .await;

        // 14. Clean this night's remote dir — everything worth keeping (report,
        //     verdict, receipts, ledger row, witness, memory) is already
        //     control-plane side. Kept on failure paths for debugging.
        let c = j
            .called(
                "annexe.ssh",
                json!({ "op": "cleanup", "remote": remote_dir }),
            )
            .await;
        let cleaned = dispatch::ssh(
            &self.runtime.hp_host,
            &format!("rm -rf {}", dispatch::shell_quote(&remote_dir)),
        );
        j.completed(c, cleaned.is_ok(), json!({})).await;
        match cleaned {
            Ok(_) => info!(remote = %remote_dir, "the connected node annexe night dir cleaned"),
            Err(e) => warn!(error = %e, "the connected node annexe cleanup failed (fail-open)"),
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
            finding: row.finding,
            witness_short: wit_short,
            report_path,
            ledger_path,
            stored_to_ruvector: stored,
        })
    }

    /// Record the night in the repo's failure manifest and raise
    /// [`Notice::HarnessStuck`] when the same harness failures recurred
    /// unchanged on consecutive BLOCKED-ENV nights. Fail-open.
    ///
    /// Called where the night's harness vetoes are known: the baseline
    /// environment gate and the final gate. The pre-dispatch BLOCKED-ENV exits
    /// (annexe unhealthy, run abandoned, journal unwritable) carry no
    /// evaluator evidence and are deliberately **not** recorded: recording
    /// them with no failures would mark yesterday's persisting failures
    /// "fixed" on a night that never got far enough to observe them.
    async fn record_streak(
        &self,
        repo: &str,
        night_id: &str,
        verdict: &str,
        vetoes: &[gate::Veto],
        notifier: &dyn Notifier,
    ) {
        match streak::record_night(&self.artefact_dir, repo, verdict, vetoes) {
            Ok(update) => {
                if let Some(n) = streak::harness_stuck_notice(repo, night_id, &update) {
                    warn!(
                        repo,
                        "the evaluation harness is stuck — same failures unchanged"
                    );
                    notifier.notify(&n).await;
                }
            }
            Err(e) => warn!(error = %e, "failure manifest write failed (fail-open)"),
        }
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
}

/// Per-test evidence for the gate: for every required evaluator whose config
/// declares a `testFormat`, read both trees' receipts into per-test outcomes
/// (`dream_core::testfmt`). An evaluator without a format, or whose output
/// cannot be read in that format, contributes nothing and is judged by its
/// receipt alone, exactly as before per-test evidence existed.
fn test_evidence(
    required: &[&manifest::EvaluatorIdentity],
    baseline: &[receipts::EvaluatorReceipt],
    candidate: &[receipts::EvaluatorReceipt],
    baseline_root: &str,
    candidate_root: &str,
) -> Vec<(String, dream_gate::pertest::TestOutcomes)> {
    required
        .iter()
        .filter_map(|id| {
            let format = id.test_format?;
            let b = baseline.iter().find(|r| r.name == id.name)?;
            let c = candidate.iter().find(|r| r.name == id.name)?;
            dream_core::testfmt::outcomes_from_receipts(
                format,
                b,
                c,
                Some(baseline_root),
                Some(candidate_root),
            )
            .map(|t| (id.name.clone(), t))
        })
        .collect()
}

/// The result reported for a night that had already finished.
/// BLOCKED-ENV for a night whose run journal cannot be trusted (damaged,
/// unreadable, unknown schema, or another night's).
///
/// Deliberately writes **no** report and **no** ledger row: the night may well
/// have finished, and `persist_blocked_env` would overwrite its real
/// `report.md`. The damaged file is left exactly as found, as evidence. The
/// operator is told to look and to run `reset-night` if the night should be
/// rerun; until then every start reports the same, and nothing is published.
fn journal_blocked(
    repo_name: &str,
    repo_path: &Path,
    cfg: &DreamConfig,
    night_id: &str,
    date: &str,
    err: &runstate::JournalError,
) -> CycleResult {
    warn!(error = %err, night = %night_id, "run journal untrustworthy — night BLOCKED-ENV, nothing run");
    let finding = format!(
        "run journal untrustworthy ({err}); inspect it, then `dream-engine reset-night {repo_name} {date}` to rerun the night"
    );
    let _ = inbox::add(
        "alert",
        repo_name,
        night_id,
        date,
        &format!("Dream night {night_id} is BLOCKED-ENV: {finding}. Nothing was run or published."),
    );
    CycleResult {
        repo: repo_name.to_string(),
        verdict: Verdict::BlockedEnv,
        finding,
        witness_short: String::new(),
        report_path: PathBuf::new(),
        ledger_path: repo_path.join(&cfg.ledger_path),
        stored_to_ruvector: false,
    }
}

fn finished_result(
    repo: String,
    prior: &runstate::RunState,
    report_path: PathBuf,
    ledger_path: PathBuf,
) -> CycleResult {
    CycleResult {
        repo,
        verdict: prior
            .verdict
            .as_deref()
            .map(verdict::from_label)
            .unwrap_or(Verdict::Inconclusive),
        finding: "(already complete — restart-safe skip)".into(),
        witness_short: String::new(),
        report_path,
        ledger_path,
        stored_to_ruvector: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::Provider;
    use dream_core::runner::ScriptedRunner;
    use dream_core::seams::GhForge;
    use dream_gate::config::{EvaluatorSpec, TestFormat};
    use dream_gate::gate::VetoClass;
    use dream_gate::outcome::ExecOutcome;
    use std::sync::Mutex;

    /// Collects every notice.
    struct Recording(Mutex<Vec<Notice>>);
    impl Notifier for Recording {
        fn notify<'a>(&'a self, notice: &'a Notice) -> dream_core::seams::BoxFut<'a, ()> {
            self.0.lock().unwrap().push(notice.clone());
            Box::pin(async {})
        }
    }

    fn engine(dir: &Path) -> Engine {
        Engine {
            runtime: toml::Table::new().try_into().unwrap(),
            workspace: dir.to_path_buf(),
            artefact_dir: dir.join("artefacts"),
            llm: LlmConfig {
                provider: Provider::Loom,
                url: "http://127.0.0.1:9".into(),
                model: "m".into(),
                max_tokens: 1024,
                api_key: None,
            },
            llm_fallback: None,
            ruvector: RuVectorConfig {
                pg_url: String::new(),
                xinference_url: String::new(),
                namespace: "dream-cycle".into(),
            },
            runner: Arc::new(ScriptedRunner::new()),
            roster_path: dir.join("roster.json"),
            forge: Arc::new(GhForge),
            llm_override: None,
        }
    }

    fn harness_veto(subject: &str, reason: &str) -> gate::Veto {
        gate::Veto {
            class: VetoClass::Harness,
            subject: subject.into(),
            reason: reason.into(),
        }
    }

    fn row(verdict: &str) -> LedgerRow {
        LedgerRow {
            date: "2026-10-01".into(),
            deep: "d".into(),
            finding: "a concrete result".into(),
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

    /// (c) The dry streak the roster reads: REJECT and INCONCLUSIVE advance
    /// it, ACCEPT resets it, BLOCKED-ENV and HANDOFF neither.
    #[test]
    fn the_roster_reads_the_new_dry_streak_rule_from_the_repos_ledger() {
        let d = tempfile::tempdir().unwrap();
        let repo = d.path().join("r");
        std::fs::create_dir_all(repo.join("docs/dream-cycle")).unwrap();
        std::fs::write(
            repo.join("dream.config.json"),
            br#"{"repo":"o/r","slots":[{"deep":"d","scan":[]}]}"#,
        )
        .unwrap();
        let ledger = repo.join("docs/dream-cycle/LEDGER.md");
        let e = engine(d.path());
        assert_eq!(e.repo_dry_streak(&repo), 0, "no ledger, no punishment");
        for (verdict, expect) in [
            ("INCONCLUSIVE", 1),
            ("REJECT", 2),
            ("BLOCKED-ENV", 2),
            ("HANDOFF", 2),
            ("REJECT", 3),
            ("ACCEPT", 0),
            ("REJECT", 1),
        ] {
            ledger::append_row(&ledger, &row(verdict)).unwrap();
            assert_eq!(e.repo_dry_streak(&repo), expect, "after {verdict}");
        }
    }

    /// (d) The same harness failures on two BLOCKED-ENV nights raise one
    /// HarnessStuck notice; a different failure, or a decisive night, does not.
    #[tokio::test]
    async fn the_same_harness_failures_twice_raise_harness_stuck() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        std::fs::create_dir_all(&e.artefact_dir).unwrap();
        let n = Recording(Mutex::new(vec![]));
        let v = vec![harness_veto(
            "tests",
            "required evaluator timed out after 1800s",
        )];
        e.record_streak("r", "2026-10-01-r", "BLOCKED-ENV", &v, &n)
            .await;
        assert!(n.0.lock().unwrap().is_empty(), "one night is not a stall");
        e.record_streak("r", "2026-10-02-r", "BLOCKED-ENV", &v, &n)
            .await;
        {
            let got = n.0.lock().unwrap();
            assert_eq!(got.len(), 1);
            assert!(
                matches!(&got[0], Notice::HarnessStuck { repo, night_id, .. }
                    if repo == "r" && night_id == "2026-10-02-r"),
                "{:?}",
                got[0]
            );
        }
        // Another repo sharing the artefact directory is unaffected.
        e.record_streak("other", "2026-10-02-other", "BLOCKED-ENV", &v, &n)
            .await;
        assert_eq!(n.0.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_decisive_night_after_a_stall_is_not_a_stall() {
        let d = tempfile::tempdir().unwrap();
        let e = engine(d.path());
        std::fs::create_dir_all(&e.artefact_dir).unwrap();
        let n = Recording(Mutex::new(vec![]));
        let v = vec![harness_veto("tests", "blocked: ssh down")];
        e.record_streak("r", "n1", "BLOCKED-ENV", &v, &n).await;
        e.record_streak("r", "n2", "REJECT", &[], &n).await;
        e.record_streak("r", "n3", "BLOCKED-ENV", &v, &n).await;
        assert!(n.0.lock().unwrap().is_empty());
    }

    fn receipt(name: &str, phase: Phase, stdout: &str) -> receipts::EvaluatorReceipt {
        receipts::EvaluatorReceipt::from_exec(
            name,
            "cargo test",
            phase,
            true,
            60,
            ExecOutcome {
                exit_code: Some(0),
                stdout: stdout.into(),
                stderr: String::new(),
                duration_ms: 1,
                transport_error: None,
                timed_out: false,
                started_at: "2026-10-01T01:00:00Z".into(),
            },
        )
    }

    /// Per-test evidence is built only for evaluators that declare a format.
    #[test]
    fn per_test_evidence_needs_a_declared_format() {
        let mut with =
            manifest::EvaluatorIdentity::from_spec("unit", &EvaluatorSpec::command("cargo test"));
        with.test_format = Some(TestFormat::Libtest);
        let without =
            manifest::EvaluatorIdentity::from_spec("lint", &EvaluatorSpec::command("cargo clippy"));
        let out = "running 2 tests\ntest t::a ... ok\ntest t::b ... ok\n\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n";
        let base = vec![
            receipt("unit", Phase::Baseline, out),
            receipt("lint", Phase::Baseline, out),
        ];
        let cand = vec![
            receipt("unit", Phase::Candidate, out),
            receipt("lint", Phase::Candidate, out),
        ];
        let got = test_evidence(&[&with, &without], &base, &cand, "/b", "/c");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, "unit");
        assert!(test_evidence(&[&without], &base, &cand, "/b", "/c").is_empty());
        assert!(test_evidence(&[&with], &base, &[], "/b", "/c").is_empty());
    }
}

/// Minimum free space the annexe must report, in GiB. `DREAM_ANNEXE_MIN_FREE_GIB`
/// overrides the default so hermetic test runs, which have no real annexe disk
/// to protect, do not depend on the size of the build sandbox's filesystem. An
/// unset, empty or unparseable value keeps the production default.
fn min_free_gib_from(raw: Option<&str>) -> u64 {
    raw.and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(dispatch::ANNEXE_MIN_FREE_GIB)
}

#[cfg(test)]
mod min_free_tests {
    use super::*;

    #[test]
    fn unset_empty_and_garbage_keep_the_production_default() {
        for raw in [
            None,
            Some(""),
            Some("  "),
            Some("ten"),
            Some("-1"),
            Some("1.5"),
        ] {
            assert_eq!(
                min_free_gib_from(raw),
                dispatch::ANNEXE_MIN_FREE_GIB,
                "{raw:?}"
            );
        }
    }

    #[test]
    fn a_valid_override_wins_including_zero() {
        assert_eq!(min_free_gib_from(Some("0")), 0);
        assert_eq!(min_free_gib_from(Some(" 3 ")), 3);
    }
}
