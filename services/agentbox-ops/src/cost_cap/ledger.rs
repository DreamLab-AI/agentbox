//! Durable, lock-guarded state for the [`crate::cost_cap`] limiter.
//!
//! The tree-search orchestration path is a sequence of short-lived CLI calls,
//! so the cap's accounting cannot live in process memory. Every mutation is a
//! read-modify-write of one JSON file performed while holding an exclusive
//! `flock` on it, which serialises threads *and* processes: the cap check and
//! the admission it authorises are one indivisible step, never a read followed
//! by a racing write.

use super::CapError;
use rustix::fs::{flock, FlockOperation};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

/// One in-flight claim on a run's budget.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reservation {
    pub id: String,
    pub candidate_index: u32,
    pub estimate_usd: f64,
    pub started_at_ms: i64,
    pub deadline_ms: i64,
}

/// Per-run accounting.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RunState {
    /// Cap in force for this run, snapshotted at first reservation.
    pub cap_usd: f64,
    /// Spend settled so far (including expired holds charged at estimate).
    pub committed_usd: f64,
    /// Branches admitted, ever — the candidate-count ceiling counts admissions,
    /// not concurrent holds, so a run cannot retry its way past `max_candidates`.
    pub admitted: u32,
    /// Branches settled (success or failure).
    pub settled: u32,
    /// Branches expired by wall clock without settling.
    pub expired: u32,
    /// Holds still outstanding.
    pub reservations: Vec<Reservation>,
}

impl RunState {
    /// Sum of every in-flight hold.
    pub fn outstanding_usd(&self) -> f64 {
        self.reservations.iter().map(|r| r.estimate_usd).sum()
    }

    /// Charges and drops holds whose wall-clock deadline has passed.
    ///
    /// An expired branch is charged its **full estimate**: its real spend is
    /// unknown, and under-charging would hand budget back to a branch that may
    /// have burned it. This is what stops an abandoned in-flight reservation
    /// from wedging a run's budget forever.
    pub fn expire_stale(&mut self, now_ms: i64) {
        let mut charged = 0.0;
        let mut expired = 0;
        self.reservations.retain(|r| {
            if now_ms > r.deadline_ms {
                charged += r.estimate_usd;
                expired += 1;
                false
            } else {
                true
            }
        });
        self.committed_usd += charged;
        self.expired += expired;
    }
}

/// The whole ledger file.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct State {
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub runs: BTreeMap<String, RunState>,
}

fn one() -> u32 {
    1
}

impl State {
    /// Existing run, or a fresh one carrying the current cap.
    pub fn run_mut(&mut self, run_id: &str, cap_usd: f64) -> &mut RunState {
        self.runs
            .entry(run_id.to_string())
            .or_insert_with(|| RunState {
                cap_usd,
                ..Default::default()
            })
    }
}

/// A JSON ledger guarded by an advisory exclusive lock.
pub struct Ledger {
    path: PathBuf,
}

impl Ledger {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Runs `f` against the ledger while holding an exclusive `flock`.
    ///
    /// The state is written back only when `f` returns `Ok`; a refusal leaves
    /// the ledger byte-identical. The lock is released when the file handle
    /// drops, which happens on every path including a panic unwinding.
    pub fn with_state<T, F>(&self, f: F) -> Result<T, CapError>
    where
        F: FnOnce(&mut State) -> Result<T, CapError>,
    {
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(io_err)?;
            }
        }
        let mut file: File = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&self.path)
            .map_err(io_err)?;

        flock(&file, FlockOperation::LockExclusive).map_err(|e| CapError::Ledger {
            message: format!("flock: {e}"),
        })?;
        // The guard holds its own handle to the same open file, so the lock is
        // released even if the closure below panics, without borrowing `file`.
        let _guard = LockGuard {
            file: file.try_clone().map_err(io_err)?,
        };

        let mut raw = String::new();
        file.read_to_string(&mut raw).map_err(io_err)?;
        let mut state: State = if raw.trim().is_empty() {
            State {
                version: 1,
                ..Default::default()
            }
        } else {
            serde_json::from_str(&raw).map_err(|e| CapError::Ledger {
                message: format!("corrupt ledger {}: {e}", self.path.display()),
            })?
        };

        let out = f(&mut state)?;

        let encoded = serde_json::to_string_pretty(&state).map_err(|e| CapError::Ledger {
            message: e.to_string(),
        })?;
        file.seek(SeekFrom::Start(0)).map_err(io_err)?;
        file.set_len(0).map_err(io_err)?;
        file.write_all(encoded.as_bytes()).map_err(io_err)?;
        file.write_all(b"\n").map_err(io_err)?;
        file.flush().map_err(io_err)?;
        file.sync_data().map_err(io_err)?;
        Ok(out)
    }
}

/// Releases the advisory lock even if the closure panics.
struct LockGuard {
    file: File,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        let _ = flock(&self.file, FlockOperation::Unlock);
    }
}

fn io_err(e: std::io::Error) -> CapError {
    CapError::Ledger {
        message: e.to_string(),
    }
}
