use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;
use tracing::{info, warn};

use crate::compile;
use crate::config::{self, DreamConfig, RuntimeConfig};
use crate::dispatch;
use crate::inbox;
use crate::ledger::{self, LedgerRow};
use crate::llm::{self, LlmConfig, Provider};
use crate::ruvector::{self, DreamFinding, RuVectorConfig};
use crate::verdict::{self, Verdict};
use crate::witness;

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

        if eligible.len() > self.runtime.max_repos_per_night {
            for (name, _) in &eligible[self.runtime.max_repos_per_night..] {
                warn!(repo = %name, cap = self.runtime.max_repos_per_night, "over roster cap — skipped tonight");
            }
            eligible.truncate(self.runtime.max_repos_per_night);
        }

        info!(
            eligible = eligible.len(),
            nominated = repos.len(),
            "night start — dreaming each eligible repo serially"
        );

        let mut outcomes = Vec::new();
        for (name, path) in eligible {
            match self.cycle_repo(&name, &path, day_int, date, false).await {
                Ok(res) => outcomes.push((name, res.verdict.as_str().to_string())),
                Err(e) => {
                    warn!(repo = %name, error = %e, "cycle failed — continuing with next repo");
                    outcomes.push((name, format!("FAILED: {}", e)));
                }
            }
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
        let cfg = DreamConfig::load(&repo_path.join("dream.config.json"))?;
        let slot = config::tonight_slot(&cfg, day_int).clone();
        let bonuses = config::bonus_dives(&cfg, day_int);
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

        // 4. Dispatch to the HP annexe: clone, build, run evaluators.
        //    Hygiene first: sweep night dirs older than 3 days so the annexe
        //    never accumulates stale clones/build trees (fail-open).
        let night_id = format!("{}-{}", date, repo_name);
        // Per-run unique remote dir (pid suffix): two engine processes can
        // never share a workspace, so a duplicate loop degrades to wasted
        // compute instead of racing rm -rf against a live evaluation
        // (observed 2026-08-20/21).
        let remote_dir = format!(
            "{}/{}-p{}",
            self.runtime.hp_annexe_dir,
            night_id,
            std::process::id()
        );
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
        dispatch::clone_to_hp(&repo_path, &self.runtime.hp_host, &remote_dir, &repo_name)?;

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
                dispatch::clone_to_hp(&repo_path, &self.runtime.hp_host, &remote_dir, &repo_name)?;
                matches!(probe(&work_dir), Ok(out) if out.contains("PREFLIGHT-OK"))
            }
        };
        if !preflight_ok {
            warn!(repo = %repo_name, "pre-flight failed twice — recording BLOCKED-ENV night (no LLM call)");
            return self
                .persist_blocked_env(
                    &cfg,
                    &repo_name,
                    &repo_path,
                    &slot.deep,
                    &night_id,
                    date,
                    &remote_dir,
                )
                .await;
        }

        let evaluators: Vec<(&str, &str)> = cfg
            .evaluator_entrypoints
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let (build_out, eval_outs) = dispatch::run_on_hp(
            &self.runtime.hp_host,
            &remote_dir,
            &repo_name,
            cfg.build_step.as_ref().map(|b| b.cmd.as_str()),
            &evaluators,
        )?;
        info!("build + evaluators complete");

        // 5. Append evidence receipts to the prompt so the LLM reasons over
        //    real evaluator output, not imagination. The LLM has no shell:
        //    everything it may cite — receipts, prior ledger rows, the session
        //    commit — must be in this pack. HP paths are redacted before they
        //    reach an external provider.
        let commit = git_head(&repo_path).unwrap_or_default();
        prompt.push_str("\n\n---\n\n# TONIGHT'S EVIDENCE (receipts from the HP annexe)\n\n");
        prompt.push_str(&format!(
            "## Session commit\n`{}`\n\n",
            if commit.is_empty() {
                "unavailable"
            } else {
                &commit
            }
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

        // 7. Verdict + finding.
        let v = verdict::parse_verdict(&report);
        let finding = verdict::sanitise_finding(&report, v);
        info!(verdict = v.as_str(), finding = %finding, "verdict parsed");

        // 8. Witness: bind report to the repo's current commit.
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

        // 9. Persist the report locally.
        let night_dir = self.artefact_dir.join(&night_id);
        std::fs::create_dir_all(&night_dir)?;
        let report_path = night_dir.join("report.md");
        std::fs::write(&report_path, &report)?;

        // 9b. Queue any "Human action recommended" items for the operator —
        //     the inbox hook surfaces them in the next Claude session,
        //     whatever its context. Fail-open.
        for q in inbox::extract_questions(&report) {
            match inbox::add("question", &repo_name, &night_id, date, &q) {
                Ok(id) => info!(id = %id, "operator question queued to dream inbox"),
                Err(e) => warn!(error = %e, "dream inbox write failed (fail-open)"),
            }
        }

        // 10. Ledger row.
        let ledger_path = repo_path.join(&cfg.ledger_path);
        let row = LedgerRow {
            date: date.into(),
            deep: slot.deep.clone(),
            finding: finding.clone(),
            issue: "NONE".into(),
            pr: "NONE".into(),
            evaluated: "yes".into(),
            verdict: v.as_str().into(),
            effect: String::new(),
            witness: wit_short.clone(),
            prior_fates: String::new(),
        };
        ledger::append_row(&ledger_path, &row)?;
        info!(path = %ledger_path.display(), "ledger row appended");

        // 11. RuVector store — fail-open: a memory failure never fails the night.
        let df = DreamFinding {
            night_id: night_id.clone(),
            repo: repo_name.clone(),
            date: date.into(),
            deep: slot.deep.clone(),
            finding: finding.clone(),
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

        // 12. Clean this night's remote dir — everything worth keeping (report,
        //     verdict, ledger row, witness, memory) is already control-plane
        //     side. Kept on failure paths for debugging; removed on success.
        match dispatch::ssh(
            &self.runtime.hp_host,
            &format!("rm -rf {}", dispatch::shell_quote(&remote_dir)),
        ) {
            Ok(_) => info!(remote = %remote_dir, "HP annexe night dir cleaned"),
            Err(e) => warn!(error = %e, "HP annexe cleanup failed (fail-open)"),
        }

        info!(
            repo = %repo_name,
            verdict = v.as_str(),
            witness = %wit_short,
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
    ) -> Result<CycleResult, EngineError> {
        let finding = format!(
            "Pre-flight failed twice: annexe checkout {}/{} missing or empty — environment fault, hypothesis untested",
            remote_dir, repo_name
        );
        let report = format!(
            "# BLOCKED-ENV night — {}\n\nThe HP annexe checkout failed pre-flight twice (missing/empty \
             working directory). No evaluators were run and no LLM was called; \
             tonight is an environment fault, not evidence about the repo.\n\n\
             VERDICT: BLOCKED-ENV\n",
            night_id
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
                finding: finding.clone(),
                issue: "NONE".into(),
                pr: "NONE".into(),
                evaluated: "no".into(),
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
                "Dream night for {} was BLOCKED-ENV: the HP annexe checkout could not be provisioned \
                 (probe failed twice). Check the HP mount / dispatch path before the next window.",
                repo_name
            ),
        ) {
            warn!(error = %e, "dream inbox write failed (fail-open)");
        }

        let _ = dispatch::ssh(
            &self.runtime.hp_host,
            &format!("rm -rf {}", dispatch::shell_quote(remote_dir)),
        );

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
            max_tokens: rt.zai_max_tokens,
            api_key: std::env::var("ZAI_ANTHROPIC_API_KEY")
                .ok()
                .or_else(|| std::env::var("ZAI_API_KEY").ok()),
        },
        Provider::Loom => LlmConfig {
            provider,
            url: std::env::var("LOOM_URL").unwrap_or_else(|_| rt.loom_url.clone()),
            model: std::env::var("LOOM_MODEL").unwrap_or_else(|_| rt.loom_model.clone()),
            max_tokens: rt.loom_max_tokens,
            api_key: None,
        },
    }
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
            max_tokens: rt.loom_max_tokens,
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
                max_tokens: rt.zai_max_tokens,
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

fn git_head(repo: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", repo.to_str()?, "rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
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
