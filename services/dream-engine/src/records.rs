//! The night's records: what is written down, and where, when a repo's cycle
//! ends (or cannot start).
//!
//! The ledger row and its git commit, the BLOCKED-ENV and HANDOFF nights,
//! the carry-over from the previous night, the branch sweep, and the
//! night-health file. These are estate presentation and bookkeeping around
//! the `dream-core` ledger/sweep mechanism; the orchestration that decides
//! when they run is [`crate::engine`].

use dream_core::ledger::{self, LedgerRow};
use dream_core::{readiness, sweep};
use dream_gate::manifest;
use dream_gate::verdict::Verdict;
use serde_json::json;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

use crate::config::DreamConfig;
use crate::digest;
use crate::dispatch;
use crate::engine::{CycleResult, Engine, EngineError};
use crate::inbox;
use crate::journal::{Journal, JournalStats};

impl Engine {
    /// Check the night's ledger row against the row contract, append it, then
    /// commit it on the default branch so the night is visible in git
    /// (ADR-2071 Phase 1). Both are journalled. The append is fatal as before;
    /// the commit is fail-open.
    ///
    /// A row that breaks the contract is repaired, never appended as is and
    /// never fatal: a failing finding is replaced by `fallback`, a line stating
    /// what happened tonight ([`ledger::enforce_contract`]), with a warning.
    /// Later nights read these rows as memory, so a false row misleads them.
    /// Returns the row as written.
    pub(crate) async fn append_and_commit_ledger(
        &self,
        repo_path: &Path,
        ledger_path: &Path,
        mut row: LedgerRow,
        fallback: &str,
        night_id: &str,
        j: &Journal,
    ) -> Result<LedgerRow, EngineError> {
        let broken = ledger::enforce_contract(&mut row, fallback);
        if !broken.is_empty() {
            warn!(rules = ?broken, finding = %row.finding, "ledger row broke the row contract; repaired before append");
        }
        let c = j
            .called(
                "ledger.append",
                json!({ "verdict": row.verdict, "deep": row.deep, "repaired": broken }),
            )
            .await;
        let appended = ledger::append_row(ledger_path, &row);
        j.completed(c, appended.is_ok(), json!({})).await;
        appended?;

        if std::env::var("DREAM_LEDGER_COMMIT").as_deref() == Ok("0") {
            return Ok(row);
        }
        let c = j
            .called(
                "git.commit",
                json!({ "path": ledger_path.display().to_string() }),
            )
            .await;
        let outcome = ledger::commit_ledger(
            repo_path,
            ledger_path,
            &format!("dream-cycle: {} ledger row ({})", night_id, row.verdict),
        );
        let ok = matches!(
            outcome,
            ledger::LedgerCommit::Committed(_) | ledger::LedgerCommit::NothingToCommit
        );
        j.completed(c, ok, serde_json::to_value(&outcome).unwrap_or_default())
            .await;
        match &outcome {
            ledger::LedgerCommit::Committed(id) => info!(commit = %id, "ledger row committed"),
            ledger::LedgerCommit::Failed(e) => {
                warn!(error = %e, "ledger commit failed (fail-open — row stays in the working tree)")
            }
            other => info!(outcome = ?other, "ledger row not committed"),
        }
        Ok(row)
    }

    /// Apply the seven-day rule to every nominated repo's `dream/*` branches,
    /// journalling each deletion or PR closure. Fail-open per branch.
    pub(crate) async fn sweep_branches(
        &self,
        repos: &[(String, PathBuf)],
        nj: &Journal,
    ) -> Vec<sweep::SweepRecord> {
        let now = chrono::Utc::now().timestamp();
        let mut records = Vec::new();
        for (name, path) in repos {
            let slug = DreamConfig::load(&path.join("dream.config.json"))
                .map(|c| c.repo.clone())
                .unwrap_or_default();
            for p in sweep::plan(name, path, &slug, now) {
                if p.action == sweep::SweepAction::Keep {
                    continue;
                }
                let c = nj
                    .called(
                        "git.branch-sweep",
                        serde_json::to_value(&p).unwrap_or_default(),
                    )
                    .await;
                let ok = sweep::apply(path, &slug, &p);
                nj.completed(c, ok, json!({})).await;
                info!(repo = %name, branch = %p.branch, action = ?p.action, ok, "branch sweep");
                records.push(p.record(ok));
            }
        }
        records
    }

    /// Previous night's carry-over for a repo: the "Next steps" and "Biggest
    /// uncertainty" lines from its most recent report (excluding tonight),
    /// plus any answered inbox questions for the repo. Empty string when
    /// there is nothing to carry.
    pub(crate) fn carry_over(&self, repo_name: &str, tonight: &str) -> String {
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
    pub(crate) async fn persist_blocked_env(
        &self,
        cfg: &DreamConfig,
        repo_name: &str,
        repo_path: &Path,
        deep: &str,
        night_id: &str,
        date: &str,
        remote_dir: &str,
        detail: &str,
        j: &Journal,
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
        let row = LedgerRow {
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
            reviewer: String::new(),
            review_minutes: String::new(),
        };
        self.append_and_commit_ledger(
            repo_path,
            &ledger_path,
            row,
            "Environment fault, hypothesis untested",
            night_id,
            j,
        )
        .await?;

        let c = j
            .called(
                "inbox.write",
                json!({ "kind": "alert", "why": "blocked-env" }),
            )
            .await;
        let added = inbox::add(
            "alert",
            repo_name,
            night_id,
            date,
            &format!(
                "Dream night for {} was BLOCKED-ENV: {}. Check the harness before the next window.",
                repo_name, detail
            ),
        );
        j.completed(c, added.is_ok(), json!({})).await;
        if let Err(e) = added {
            warn!(error = %e, "dream inbox write failed (fail-open)");
        }

        if !remote_dir.is_empty() {
            let c = j
                .called(
                    "annexe.ssh",
                    json!({ "op": "cleanup", "remote": remote_dir }),
                )
                .await;
            let cleaned = dispatch::ssh(
                &self.runtime.hp_host,
                &format!("rm -rf {}", dispatch::shell_quote(remote_dir)),
            );
            j.completed(c, cleaned.is_ok(), json!({})).await;
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
    pub(crate) async fn persist_handoff(
        &self,
        cfg: &DreamConfig,
        repo_name: &str,
        repo_path: &Path,
        deep: &str,
        night_id: &str,
        date: &str,
        admission: &readiness::ReadinessReport,
        j: &Journal,
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
        let row = LedgerRow {
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
            reviewer: String::new(),
            review_minutes: String::new(),
        };
        self.append_and_commit_ledger(
            repo_path,
            &ledger_path,
            row,
            "HANDOFF: no usable evaluator for tonight's deep",
            night_id,
            j,
        )
        .await?;

        let c = j
            .called(
                "inbox.write",
                json!({ "kind": "question", "why": "handoff" }),
            )
            .await;
        let added = inbox::add(
            "question",
            repo_name,
            night_id,
            date,
            &format!(
                "Dream nomination for {} (deep `{}`) was refused at admission: {}. \
                 Which evaluator should decide this deep?",
                repo_name, deep, refusal
            ),
        );
        j.completed(c, added.is_ok(), json!({})).await;
        if let Err(e) = added {
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

/// Add the night-level journal session's counters to the night-health file
/// (written earlier in the night, before the digest and forum work ran).
/// Fail-open.
pub(crate) fn record_night_journal(stats: &JournalStats) {
    let path = digest::health_path();
    if let Some(mut health) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<digest::NightHealth>(&t).ok())
    {
        health.journal.push(stats.clone());
        if let Err(e) = std::fs::write(
            &path,
            serde_json::to_string_pretty(&health).unwrap_or_default(),
        ) {
            warn!(error = %e, "night health journal write failed (fail-open)");
        }
    }
}

/// Record tonight's digest outcome in the night-health file, and raise an
/// operator alert when the digest was withheld for want of a zone key (an
/// encrypted dreamlab zone with no key granted to JunkieJarvis). Fail-open.
pub(crate) fn record_digest_status(date: &str, status: &str) {
    let path = digest::health_path();
    if let Some(mut health) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<digest::NightHealth>(&t).ok())
    {
        health.digest = Some(status.to_string());
        if let Err(e) = std::fs::write(
            &path,
            serde_json::to_string_pretty(&health).unwrap_or_default(),
        ) {
            warn!(error = %e, "night health digest status write failed (fail-open)");
        }
    }
    if status.starts_with(digest::SKIPPED_NO_ZONE_KEY) {
        let text = format!(
            "Tonight's forum digest was not posted: the dreamlab zone is end-to-end encrypted and JunkieJarvis holds no zone key. Grant it the key in the forum admin Encryption tab. ({status})"
        );
        if let Err(e) = inbox::add(
            "alert",
            "dream-machine",
            &format!("{date}-digest-zone-key"),
            date,
            &text,
        ) {
            warn!(error = %e, "dream inbox write failed (fail-open)");
        }
    }
}
