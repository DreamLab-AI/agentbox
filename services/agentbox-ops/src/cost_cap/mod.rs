//! Enforced per-run cost cap for execution-gated, N-candidate skills
//! (ADR-2020 Surface 2 — `skills/tree-search-coder`).
//!
//! The manifest has long *declared* `spend_cap_usd`, `max_candidates` and
//! `per_branch_timeout_s` under `[skills.tree_search_coder]`, but nothing
//! consumed them: the cap was an instruction to the orchestrating agent, not a
//! limiter at the dispatch boundary. This module is that limiter.
//!
//! # Contract
//!
//! Every candidate branch must be **reserved before dispatch** and **settled
//! after it finishes**:
//!
//! ```no_run
//! use agentbox_ops::cost_cap::{CapConfig, Limiter, Outcome};
//!
//! let limiter = Limiter::new(
//!     CapConfig::load(None),
//!     agentbox_ops::cost_cap::default_ledger_path(),
//! );
//! let res = limiter.reserve("run-42", 0.13)?;   // refuses when the cap would break
//! // … dispatch the branch …
//! limiter.settle(&res, 0.11, Outcome::Completed)?;
//! # Ok::<(), agentbox_ops::cost_cap::CapError>(())
//! ```
//!
//! Reserving *before* dispatch is what makes the cap safe under concurrency:
//! an in-flight branch's estimate is held against the cap for as long as it
//! runs, so two branches racing on the last $0.13 of budget cannot both be
//! admitted. The arithmetic runs under an exclusive `flock` on the ledger
//! file, so the check-and-admit is a single atomic step across threads *and*
//! across processes (the tree-search orchestration path is a set of CLI calls,
//! not one long-lived process).
//!
//! A reservation is released on **both** paths: [`Outcome::Completed`] charges
//! the actual cost, [`Outcome::Failed`] charges whatever was actually incurred
//! (`0.0` when the branch died before spending). A branch that never settles
//! at all is expired at its wall-clock deadline by the next `reserve` and
//! charged its full estimate — the conservative direction, so a crashed branch
//! can never hand budget back that it may have spent.
//!
//! # Defaults
//!
//! When the manifest block or an individual field is absent the documented
//! defaults apply — [`DEFAULT_SPEND_CAP_USD`], [`DEFAULT_MAX_CANDIDATES`],
//! [`DEFAULT_PER_BRANCH_TIMEOUT_S`] — and the field name is recorded in
//! [`CapConfig::defaulted`] so the receipt shows the cap was inferred rather
//! than declared. There is no unlimited mode: an absent cap is 0.50 USD, never
//! infinity.

pub mod ledger;

#[cfg(test)]
#[path = "mod_tests.rs"]
mod mod_tests;

use ledger::{Ledger, Reservation as StoredReservation, RunState};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};

/// Documented default per-run spend cap (USD) when the manifest omits one.
pub const DEFAULT_SPEND_CAP_USD: f64 = 0.50;
/// Documented default candidate ceiling when the manifest omits one.
pub const DEFAULT_MAX_CANDIDATES: u32 = 5;
/// Documented default per-branch wall-clock ceiling (seconds).
pub const DEFAULT_PER_BRANCH_TIMEOUT_S: u64 = 60;

/// Float tolerance for the cap comparison — a reservation is refused only when
/// it exceeds the cap by more than this.
const EPS: f64 = 1e-9;

/// The manifest-declared ceilings for one execution-gated skill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapConfig {
    /// `[skills.tree_search_coder] enabled`. A disabled capability refuses
    /// every reservation rather than silently running uncapped.
    pub enabled: bool,
    pub spend_cap_usd: f64,
    pub max_candidates: u32,
    pub per_branch_timeout_s: u64,
    /// Fields that fell back to a documented default (empty = fully declared).
    pub defaulted: Vec<String>,
}

impl Default for CapConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            spend_cap_usd: DEFAULT_SPEND_CAP_USD,
            max_candidates: DEFAULT_MAX_CANDIDATES,
            per_branch_timeout_s: DEFAULT_PER_BRANCH_TIMEOUT_S,
            defaulted: vec![
                "enabled".into(),
                "spend_cap_usd".into(),
                "max_candidates".into(),
                "per_branch_timeout_s".into(),
            ],
        }
    }
}

impl CapConfig {
    /// Parses `[skills.tree_search_coder]` out of an `agentbox.toml` body.
    /// Missing keys take the documented defaults and are named in
    /// [`CapConfig::defaulted`]. An unparseable manifest yields the full
    /// default set rather than an uncapped run.
    pub fn from_manifest_toml(text: &str) -> Self {
        Self::from_manifest_toml_at(text, "tree_search_coder")
    }

    /// As [`CapConfig::from_manifest_toml`], for an arbitrary `[skills.<key>]`
    /// block, so a second execution-gated skill can reuse the limiter.
    pub fn from_manifest_toml_at(text: &str, skill_key: &str) -> Self {
        let mut cfg = Self::default();
        let Ok(root) = text.parse::<toml::Value>() else {
            return cfg;
        };
        let Some(block) = root
            .get("skills")
            .and_then(|s| s.get(skill_key))
            .and_then(toml::Value::as_table)
        else {
            return cfg;
        };
        cfg.defaulted.clear();

        match block.get("enabled").and_then(toml::Value::as_bool) {
            Some(v) => cfg.enabled = v,
            None => cfg.defaulted.push("enabled".into()),
        }
        match block.get("spend_cap_usd").and_then(number_as_f64) {
            Some(v) if v.is_finite() && v > 0.0 => cfg.spend_cap_usd = v,
            _ => cfg.defaulted.push("spend_cap_usd".into()),
        }
        match block
            .get("max_candidates")
            .and_then(toml::Value::as_integer)
        {
            Some(v) if v > 0 => cfg.max_candidates = v as u32,
            _ => cfg.defaulted.push("max_candidates".into()),
        }
        match block
            .get("per_branch_timeout_s")
            .and_then(toml::Value::as_integer)
        {
            Some(v) if v > 0 => cfg.per_branch_timeout_s = v as u64,
            _ => cfg.defaulted.push("per_branch_timeout_s".into()),
        }
        cfg
    }

    /// Reads the manifest from `path`, or from [`default_manifest_path`] when
    /// `None`. An unreadable manifest yields the documented defaults.
    pub fn load(path: Option<&Path>) -> Self {
        let path = match path {
            Some(p) => p.to_path_buf(),
            None => match default_manifest_path() {
                Some(p) => p,
                None => return Self::default(),
            },
        };
        match std::fs::read_to_string(&path) {
            Ok(text) => Self::from_manifest_toml(&text),
            Err(_) => Self::default(),
        }
    }
}

fn number_as_f64(v: &toml::Value) -> Option<f64> {
    v.as_float().or_else(|| v.as_integer().map(|i| i as f64))
}

/// First readable manifest among `$AGENTBOX_MANIFEST`, the baked
/// `/opt/agentbox/agentbox.toml`, and `./agentbox.toml`.
pub fn default_manifest_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("AGENTBOX_MANIFEST") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    for candidate in ["/opt/agentbox/agentbox.toml", "agentbox.toml"] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Ledger location: `$AGENTBOX_TREE_SEARCH_LEDGER`, else
/// `$XDG_STATE_HOME/agentbox/tree-search-cap.json`, else
/// `$HOME/.local/state/agentbox/tree-search-cap.json`.
pub fn default_ledger_path() -> PathBuf {
    if let Ok(p) = std::env::var("AGENTBOX_TREE_SEARCH_LEDGER") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    let base = std::env::var("XDG_STATE_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            PathBuf::from(home).join(".local/state")
        });
    base.join("agentbox").join("tree-search-cap.json")
}

/// Every way a reservation can be refused, or a settlement rejected.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum CapError {
    /// The manifest gate is off; the capability must not execute at all.
    CapabilityDisabled { skill: String },
    /// Admitting this branch would push committed + in-flight spend past the cap.
    SpendCapExceeded {
        cap_usd: f64,
        committed_usd: f64,
        outstanding_usd: f64,
        requested_usd: f64,
    },
    /// The run has already admitted `max_candidates` branches.
    CandidateLimitExceeded { max_candidates: u32, admitted: u32 },
    /// The branch outran `per_branch_timeout_s`.
    BranchTimeout {
        reservation_id: String,
        per_branch_timeout_s: u64,
        elapsed_s: u64,
    },
    /// Settling something that was never reserved, or was already settled.
    UnknownReservation { reservation_id: String },
    /// A negative or non-finite cost figure.
    InvalidAmount { amount_usd: f64 },
    /// The ledger could not be read or written.
    Ledger { message: String },
}

impl fmt::Display for CapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CapabilityDisabled { skill } => {
                write!(f, "capability `{skill}` is disabled in the manifest")
            }
            Self::SpendCapExceeded {
                cap_usd,
                committed_usd,
                outstanding_usd,
                requested_usd,
            } => write!(
                f,
                "spend cap exceeded: cap ${cap_usd:.4}, committed ${committed_usd:.4}, \
                 in-flight ${outstanding_usd:.4}, requested ${requested_usd:.4}"
            ),
            Self::CandidateLimitExceeded {
                max_candidates,
                admitted,
            } => write!(
                f,
                "candidate limit exceeded: max_candidates {max_candidates}, already admitted {admitted}"
            ),
            Self::BranchTimeout {
                reservation_id,
                per_branch_timeout_s,
                elapsed_s,
            } => write!(
                f,
                "branch {reservation_id} exceeded per_branch_timeout_s {per_branch_timeout_s} (elapsed {elapsed_s}s)"
            ),
            Self::UnknownReservation { reservation_id } => {
                write!(f, "unknown or already-settled reservation {reservation_id}")
            }
            Self::InvalidAmount { amount_usd } => {
                write!(f, "invalid cost amount {amount_usd}")
            }
            Self::Ledger { message } => write!(f, "cost ledger unavailable: {message}"),
        }
    }
}

impl std::error::Error for CapError {}

/// How a reserved branch ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The branch produced a result.
    Completed,
    /// The branch errored, was cancelled, or timed out. The hold is still
    /// released; the actual spend incurred is still charged.
    Failed,
}

/// A granted, in-flight claim on the run's budget.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reservation {
    pub id: String,
    pub run_id: String,
    /// 0-based index of this branch within the run.
    pub candidate_index: u32,
    pub estimate_usd: f64,
    pub started_at_ms: i64,
    /// `started_at_ms + per_branch_timeout_s * 1000`.
    pub deadline_ms: i64,
    pub cap_usd: f64,
    /// Cap minus committed spend and every in-flight hold, after this grant.
    pub remaining_usd: f64,
}

/// The result of releasing a reservation.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Settlement {
    pub reservation_id: String,
    pub run_id: String,
    pub outcome: Outcome,
    pub charged_usd: f64,
    pub committed_usd: f64,
    pub remaining_usd: f64,
    /// True when the branch overran `per_branch_timeout_s`. The settlement
    /// still succeeds — the hold must always be released — but the caller is
    /// told the branch's result is out of contract.
    pub timed_out: bool,
    /// True when `actual_usd` overran the reservation's estimate. Later
    /// reservations see the real figure, so an overrun tightens the cap.
    pub overran_estimate: bool,
}

/// Enforces one skill's declared ceilings against a durable, lock-guarded ledger.
pub struct Limiter {
    config: CapConfig,
    ledger: Ledger,
    skill: String,
}

impl Limiter {
    /// Builds a limiter for `[skills.tree_search_coder]`.
    pub fn new(config: CapConfig, ledger_path: PathBuf) -> Self {
        Self::for_skill(config, ledger_path, "tree_search_coder")
    }

    /// Builds a limiter for a named `[skills.<skill>]` block.
    pub fn for_skill(config: CapConfig, ledger_path: PathBuf, skill: &str) -> Self {
        Self {
            config,
            ledger: Ledger::new(ledger_path),
            skill: skill.to_string(),
        }
    }

    pub fn config(&self) -> &CapConfig {
        &self.config
    }

    /// Reserves budget for one branch **before** it is dispatched.
    ///
    /// Refuses with a typed [`CapError`] when the capability is off, the
    /// candidate ceiling is reached, or committed plus in-flight plus this
    /// estimate would break the cap. The whole check-and-admit runs under an
    /// exclusive lock, so concurrent callers can never jointly overshoot.
    pub fn reserve(&self, run_id: &str, estimate_usd: f64) -> Result<Reservation, CapError> {
        self.reserve_at(run_id, estimate_usd, now_ms())
    }

    /// [`Limiter::reserve`] with an injected clock, for tests.
    pub fn reserve_at(
        &self,
        run_id: &str,
        estimate_usd: f64,
        now_ms: i64,
    ) -> Result<Reservation, CapError> {
        if !self.config.enabled {
            return Err(CapError::CapabilityDisabled {
                skill: self.skill.clone(),
            });
        }
        if !estimate_usd.is_finite() || estimate_usd < 0.0 {
            return Err(CapError::InvalidAmount {
                amount_usd: estimate_usd,
            });
        }
        let cap = self.config.spend_cap_usd;
        let max_candidates = self.config.max_candidates;
        let timeout_ms = (self.config.per_branch_timeout_s as i64) * 1000;
        let run_id_owned = run_id.to_string();

        self.ledger.with_state(|state| {
            let run = state.run_mut(&run_id_owned, cap);
            run.expire_stale(now_ms);

            if run.admitted >= max_candidates {
                return Err(CapError::CandidateLimitExceeded {
                    max_candidates,
                    admitted: run.admitted,
                });
            }
            let outstanding = run.outstanding_usd();
            if run.committed_usd + outstanding + estimate_usd > cap + EPS {
                return Err(CapError::SpendCapExceeded {
                    cap_usd: cap,
                    committed_usd: run.committed_usd,
                    outstanding_usd: outstanding,
                    requested_usd: estimate_usd,
                });
            }

            let id = new_reservation_id();
            let candidate_index = run.admitted;
            run.admitted += 1;
            run.reservations.push(StoredReservation {
                id: id.clone(),
                candidate_index,
                estimate_usd,
                started_at_ms: now_ms,
                deadline_ms: now_ms + timeout_ms,
            });
            let remaining = cap - run.committed_usd - run.outstanding_usd();
            Ok(Reservation {
                id,
                run_id: run_id_owned.clone(),
                candidate_index,
                estimate_usd,
                started_at_ms: now_ms,
                deadline_ms: now_ms + timeout_ms,
                cap_usd: cap,
                remaining_usd: remaining,
            })
        })
    }

    /// Releases a reservation and charges the actual cost. Called on both the
    /// success and the failure path — a hold that is never released blocks the
    /// run's budget until its wall-clock deadline expires it.
    pub fn settle(
        &self,
        reservation: &Reservation,
        actual_usd: f64,
        outcome: Outcome,
    ) -> Result<Settlement, CapError> {
        self.settle_at(reservation, actual_usd, outcome, now_ms())
    }

    /// [`Limiter::settle`] with an injected clock, for tests.
    pub fn settle_at(
        &self,
        reservation: &Reservation,
        actual_usd: f64,
        outcome: Outcome,
        now_ms: i64,
    ) -> Result<Settlement, CapError> {
        if !actual_usd.is_finite() || actual_usd < 0.0 {
            return Err(CapError::InvalidAmount {
                amount_usd: actual_usd,
            });
        }
        let cap = self.config.spend_cap_usd;
        let run_id = reservation.run_id.clone();
        let res_id = reservation.id.clone();

        self.ledger.with_state(|state| {
            let run = state.run_mut(&run_id, cap);
            let Some(pos) = run.reservations.iter().position(|r| r.id == res_id) else {
                return Err(CapError::UnknownReservation {
                    reservation_id: res_id.clone(),
                });
            };
            let held = run.reservations.remove(pos);
            run.committed_usd += actual_usd;
            run.settled += 1;
            let remaining = cap - run.committed_usd - run.outstanding_usd();
            Ok(Settlement {
                reservation_id: res_id.clone(),
                run_id: run_id.clone(),
                outcome,
                charged_usd: actual_usd,
                committed_usd: run.committed_usd,
                remaining_usd: remaining,
                timed_out: now_ms > held.deadline_ms,
                overran_estimate: actual_usd > held.estimate_usd + EPS,
            })
        })
    }

    /// Mid-branch wall-clock guard: refuses to let a branch keep running past
    /// `per_branch_timeout_s`. Call before each long step inside a branch.
    pub fn guard_branch(&self, reservation: &Reservation, now_ms: i64) -> Result<(), CapError> {
        if now_ms > reservation.deadline_ms {
            let elapsed_s = ((now_ms - reservation.started_at_ms).max(0) / 1000) as u64;
            return Err(CapError::BranchTimeout {
                reservation_id: reservation.id.clone(),
                per_branch_timeout_s: self.config.per_branch_timeout_s,
                elapsed_s,
            });
        }
        Ok(())
    }

    /// Current accounting for one run, with stale holds expired first.
    pub fn status(&self, run_id: &str) -> Result<RunState, CapError> {
        self.status_at(run_id, now_ms())
    }

    /// [`Limiter::status`] with an injected clock, for tests.
    pub fn status_at(&self, run_id: &str, now_ms: i64) -> Result<RunState, CapError> {
        let cap = self.config.spend_cap_usd;
        let run_id = run_id.to_string();
        self.ledger.with_state(|state| {
            let run = state.run_mut(&run_id, cap);
            run.expire_stale(now_ms);
            Ok(run.clone())
        })
    }

    /// Drops a run's accounting entirely (operator reset).
    pub fn reset(&self, run_id: &str) -> Result<(), CapError> {
        let run_id = run_id.to_string();
        self.ledger.with_state(|state| {
            state.runs.remove(&run_id);
            Ok(())
        })
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn new_reservation_id() -> String {
    format!("res-{}", &uuid::Uuid::new_v4().simple().to_string()[..12])
}
