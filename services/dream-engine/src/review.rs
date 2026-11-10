//! Human review records for dream nights, and the ledger backfill that reads them.
//!
//! The ledger's last two columns, `Reviewer` and `Review-minutes`, record the
//! human side of a night. They are filled **only** from an explicit record of a
//! human review, and stay empty otherwise. A PR merge event is not such a
//! record: agents in this estate open and merge pull requests under the
//! operator's own forge account, so `merged_by` cannot tell a person from an
//! agent, and open-to-merge time is queueing time, not review time.
//!
//! # The record
//!
//! One review per night lives in the night's artefact folder as
//! [`REVIEW_FILE`] (`<artefact_dir>/<date>-<repo>/review.json`), shaped as
//! [`ReviewRecord`] at schema [`SCHEMA`]. It carries the full witness of the
//! night it judges, so a record copied into the wrong folder, or a folder whose
//! report changed after the review, is refused rather than believed.
//!
//! # Getting records in
//!
//! [`import_jsonl`] reads one [`ReviewImport`] per line, validates it against
//! the night folder (the witness is recomputed from `report.md` and the frozen
//! manifest's baseline revision), writes `review.json`, then backfills that
//! night's ledger row. [`backfill_all`] runs at the start of every night and
//! picks up records written by any other tool; it validates each one exactly as
//! the importer does. A record written whose ledger fill then fails (the ledger
//! busy past the lock wait, or unwritable) is reported as
//! [`LineResult::FillPending`], not as refused: the record stands, and the next
//! backfill fills the row.
//!
//! # The ledger edit
//!
//! The backfill touches one row: the row in the reviewed repository's ledger
//! whose `Date` cell is the night date and whose `Witness` cell is the
//! 12-character short witness. Only its two human cells change, and only when
//! both are empty; every other byte of the file is preserved. Rows written at
//! the legacy ten-column width are never widened (no surviving night folder
//! predates the twelve-column writer, so no review can match one). When the
//! filled row sits under a legacy ten-column header, the header and divider
//! gain the two human column names so a markdown renderer shows the cells.
//!
//! The edit is made under the ledger's lock ([`crate::ledger_io::LedgerLock`]),
//! the same lock the night's own row append takes, with the ledger re-read
//! inside the lock and committed before it is released, so a fill can never
//! drop a row the night appended meanwhile.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use dream_core::ledger::{self, LedgerCommit};
use dream_gate::{manifest, witness};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

use crate::archive::GitIdentity;
use crate::config::{self, DEFAULT_LEDGER_PATH};
use crate::ledger_io::{self, LedgerLock, LockError};

/// File name of a night's review record, inside the night's artefact folder.
pub const REVIEW_FILE: &str = "review.json";

/// The review record schema this engine writes and accepts.
pub const SCHEMA: u32 = 1;

/// Shortest witness prefix an import may quote: the ledger's short witness
/// width. A shorter prefix would match the wrong night too often to be proof.
pub const MIN_WITNESS_PREFIX: usize = 12;

/// Longest reviewer name accepted. It lands in a ledger cell.
const MAX_REVIEWER_CHARS: usize = 64;
/// Longest one-line reason accepted.
const MAX_REASON_CHARS: usize = 240;
/// Longest tool identifier accepted.
const MAX_TOOL_CHARS: usize = 64;

/// The ten legacy column headers, which a twelve-column header extends.
const LEGACY_HEADER: [&str; 10] = [
    "Date",
    "Deep",
    "Finding",
    "Issue",
    "PR",
    "Evaluated?",
    "Verdict",
    "Effect",
    "Witness",
    "Prior-night fates",
];

/// Ledger cell indices, in the twelve-column order `dream_core::ledger` writes.
const DATE_CELL: usize = 0;
const WITNESS_CELL: usize = 8;
const REVIEWER_CELL: usize = 10;
const MINUTES_CELL: usize = 11;
/// Row widths: the current writer and the legacy writer.
const WIDTH: usize = 12;
const LEGACY_WIDTH: usize = 10;

/// What the reviewer decided about the night's candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewVerdict {
    /// The change should land as proposed.
    Approve,
    /// The change should not land.
    Reject,
    /// The idea is sound but the change needs work before it could land.
    NeedsChanges,
    /// The reviewer could not reach a judgement (outside their competence, or
    /// the evidence was insufficient). Still a review: someone looked.
    CannotJudge,
}

/// A night's human review, as stored in `review.json` (schema [`SCHEMA`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewRecord {
    /// Always [`SCHEMA`].
    pub schema: u32,
    /// `<date>-<repo>`, the night folder's name.
    pub night_id: String,
    /// Repository directory name under the workspace (not the forge slug).
    pub repo: String,
    /// Night date, `YYYY-MM-DD`.
    pub date: String,
    /// The night's full 64-character witness, recomputed at import.
    pub witness: String,
    /// Who reviewed: a name, login or DID. Written to the ledger's `Reviewer`.
    pub reviewer: String,
    /// The reviewer's decision.
    pub verdict: ReviewVerdict,
    /// One line saying why.
    pub reason: String,
    /// The reviewer's confidence in the decision, 1 (guess) to 5 (certain).
    pub confidence: u8,
    /// Seconds of active review, as measured by the tool. `None` when it was
    /// not measured; the ledger's `Review-minutes` then stays empty.
    pub active_seconds: Option<u64>,
    /// When the decision was made, RFC 3339.
    pub decided_at: String,
    /// Whether the reviewer decided without seeing the gate's verdict.
    pub blind_to_gate: bool,
    /// The tool that produced the review, e.g. `review-desk/0.3`.
    pub tool: String,
}

/// One line of an import file: a review plus the night it belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewImport {
    /// Repository directory name under the workspace.
    pub repo: String,
    /// Night date, `YYYY-MM-DD`.
    pub date: String,
    /// The night's witness, or a prefix of at least [`MIN_WITNESS_PREFIX`]
    /// hex characters (the ledger's short witness is enough).
    pub witness: String,
    /// See [`ReviewRecord::reviewer`].
    pub reviewer: String,
    /// See [`ReviewRecord::verdict`].
    pub verdict: ReviewVerdict,
    /// See [`ReviewRecord::reason`].
    pub reason: String,
    /// See [`ReviewRecord::confidence`].
    pub confidence: u8,
    /// See [`ReviewRecord::active_seconds`]. May be omitted or `null`.
    #[serde(default)]
    pub active_seconds: Option<u64>,
    /// See [`ReviewRecord::decided_at`].
    pub decided_at: String,
    /// See [`ReviewRecord::blind_to_gate`].
    pub blind_to_gate: bool,
    /// See [`ReviewRecord::tool`].
    pub tool: String,
}

/// Why a review was refused, or a record could not be applied.
#[derive(Debug, Error)]
pub enum ReviewError {
    /// A field failed validation.
    #[error("{field}: {why}")]
    Field {
        /// The offending field.
        field: &'static str,
        /// What is wrong with it.
        why: String,
    },
    /// No artefact folder exists for the named night.
    #[error("no night folder {0}")]
    MissingNight(PathBuf),
    /// The night folder has no `report.md`, so its witness cannot be recomputed.
    #[error("night has no report.md, so its witness cannot be recomputed: {0}")]
    MissingReport(PathBuf),
    /// The night folder has no readable frozen manifest.
    #[error("night has no readable manifest.json (baseline revision unknown): {0}")]
    MissingManifest(PathBuf),
    /// The baseline revision did not yield a witness.
    #[error("witness cannot be recomputed: {0}")]
    Witness(String),
    /// The quoted witness does not belong to this night.
    #[error("witness mismatch: review quotes {given}, night {night} has {actual}")]
    WitnessMismatch {
        /// The witness or prefix the review quoted.
        given: String,
        /// The night it named.
        night: String,
        /// The night's recomputed short witness.
        actual: String,
    },
    /// The night already holds a different review.
    #[error("{0} already holds a different review; a night keeps one record, so move it aside to replace it")]
    Conflict(PathBuf),
    /// The ledger stayed locked by another writer, or its lock failed.
    #[error(transparent)]
    Lock(#[from] LockError),
    /// Reading or writing failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A line or record was not valid JSON for its schema.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// Whether to change files or only report what would change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Write records, edit ledgers and commit them.
    Apply,
    /// Validate and report; write nothing.
    DryRun,
}

/// How ledger edits are made: the fallback identity for the ledger commit
/// (used only in a repository with no identity of its own), and how long to
/// wait for another writer's ledger lock.
#[derive(Debug, Clone)]
pub struct Ledgering {
    /// The engine's fallback commit identity, if configured.
    pub identity: Option<GitIdentity>,
    /// Longest wait for the ledger lock before the fill is given up.
    pub lock_wait: Duration,
}

impl Default for Ledgering {
    fn default() -> Self {
        Ledgering {
            identity: None,
            lock_wait: ledger_io::DEFAULT_LOCK_WAIT,
        }
    }
}

/// What writing a record did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    /// `review.json` was written (or would be, in a dry run).
    Written,
    /// An identical record was already there.
    Unchanged,
}

/// What the ledger backfill did for one night.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FillOutcome {
    /// The human cells were filled (or would be, in a dry run).
    Filled {
        /// The ledger edited.
        ledger: PathBuf,
        /// The `Reviewer` cell written.
        reviewer: String,
        /// The `Review-minutes` cell written (may be empty).
        minutes: String,
        /// Whether a legacy ten-column header gained the two human columns.
        widened_header: bool,
        /// The local commit of the ledger, when one was attempted.
        commit: Option<LedgerCommit>,
    },
    /// The matched row already has a reviewer or minutes; left untouched.
    AlreadyFilled,
    /// The matched row is ten cells wide; legacy rows are never widened.
    LegacyRow,
    /// No row carries this night's date and short witness.
    NoRow,
    /// More than one row carries this night's date and short witness.
    Ambiguous(usize),
    /// The repository has no ledger file at the resolved path.
    NoLedger(PathBuf),
}

impl fmt::Display for FillOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FillOutcome::Filled {
                ledger,
                reviewer,
                minutes,
                widened_header,
                commit,
            } => {
                let minutes = if minutes.is_empty() {
                    "(empty)"
                } else {
                    minutes
                };
                write!(
                    f,
                    "ledger filled: reviewer={reviewer} minutes={minutes} in {}",
                    ledger.display()
                )?;
                if *widened_header {
                    write!(f, " (legacy header widened)")?;
                }
                match commit {
                    Some(LedgerCommit::Committed(id)) => write!(f, "; committed {id}"),
                    Some(LedgerCommit::NotDefaultBranch(b)) => {
                        write!(f, "; not committed: HEAD is {b}, not the default branch")
                    }
                    Some(LedgerCommit::NothingToCommit) => write!(f, "; nothing to commit"),
                    Some(LedgerCommit::Failed(e)) => write!(f, "; commit failed: {e}"),
                    None => Ok(()),
                }
            }
            FillOutcome::AlreadyFilled => {
                write!(f, "ledger row already has human cells; unchanged")
            }
            FillOutcome::LegacyRow => write!(f, "ledger row is legacy ten-column; not widened"),
            FillOutcome::NoRow => write!(f, "no ledger row with this date and witness"),
            FillOutcome::Ambiguous(n) => {
                write!(
                    f,
                    "{n} ledger rows share this date and witness; none changed"
                )
            }
            FillOutcome::NoLedger(p) => write!(f, "no ledger at {}", p.display()),
        }
    }
}

/// The `Review-minutes` cell for a measured duration: active seconds rounded
/// to the nearest whole minute (30 s rounds up, so 29 s is `0` and 90 s is
/// `2`). An absent or zero-length duration yields an empty cell, never `0`.
///
/// # Examples
///
/// ```
/// use dream_engine::review::minutes_cell;
/// assert_eq!(minutes_cell(None), "");
/// assert_eq!(minutes_cell(Some(0)), "");
/// assert_eq!(minutes_cell(Some(90)), "2");
/// ```
pub fn minutes_cell(active_seconds: Option<u64>) -> String {
    match active_seconds {
        None | Some(0) => String::new(),
        Some(s) => (s.saturating_add(30) / 60).to_string(),
    }
}

fn field(field: &'static str, why: impl Into<String>) -> ReviewError {
    ReviewError::Field {
        field,
        why: why.into(),
    }
}

/// A single directory name: no separators, no traversal, no hidden names.
fn check_repo(repo: &str) -> Result<(), ReviewError> {
    let bad = repo.is_empty()
        || repo.starts_with('.')
        || repo.contains(['/', '\\'])
        || repo.chars().any(char::is_control);
    if bad {
        return Err(field(
            "repo",
            format!("{repo:?} is not a repository directory name"),
        ));
    }
    Ok(())
}

fn check_date(date: &str) -> Result<NaiveDate, ReviewError> {
    let shaped = date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-';
    match NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(d) if shaped => Ok(d),
        _ => Err(field("date", format!("{date:?} is not YYYY-MM-DD"))),
    }
}

/// One line of text, non-empty after trimming, at most `max` characters.
fn check_line(name: &'static str, value: &str, max: usize) -> Result<(), ReviewError> {
    if value.trim().is_empty() {
        return Err(field(name, "empty"));
    }
    if value.chars().any(char::is_control) {
        return Err(field(name, "must be one line with no control characters"));
    }
    let n = value.chars().count();
    if n > max {
        return Err(field(name, format!("{n} characters; at most {max}")));
    }
    Ok(())
}

/// The review fields shared by an import line and a stored record.
struct Fields<'a> {
    repo: &'a str,
    date: &'a str,
    reviewer: &'a str,
    reason: &'a str,
    confidence: u8,
    decided_at: &'a str,
    tool: &'a str,
}

fn check_fields(f: &Fields<'_>) -> Result<(), ReviewError> {
    check_repo(f.repo)?;
    let night = check_date(f.date)?;
    check_line("reviewer", f.reviewer, MAX_REVIEWER_CHARS)?;
    if f.reviewer.contains('|') {
        // An escaped `\|` still splits the cell for the TypeScript reader.
        return Err(field("reviewer", "may not contain '|'"));
    }
    check_line("reason", f.reason, MAX_REASON_CHARS)?;
    check_line("tool", f.tool, MAX_TOOL_CHARS)?;
    if !(1..=5).contains(&f.confidence) {
        return Err(field(
            "confidence",
            format!("{} is outside 1-5", f.confidence),
        ));
    }
    let decided = DateTime::parse_from_rfc3339(f.decided_at.trim()).map_err(|e| {
        field(
            "decided_at",
            format!("{:?} is not RFC 3339: {e}", f.decided_at),
        )
    })?;
    let night_start = Utc.from_utc_datetime(&night.and_time(chrono::NaiveTime::MIN));
    if decided < night_start {
        return Err(field(
            "decided_at",
            format!("{} is before the night it reviews", f.decided_at),
        ));
    }
    Ok(())
}

/// The night folder for `date` and `repo` under `artefact_dir`.
pub fn night_dir(artefact_dir: &Path, date: &str, repo: &str) -> PathBuf {
    artefact_dir.join(format!("{date}-{repo}"))
}

/// Recompute a night's full witness from its `report.md` and the baseline
/// revision in its frozen `manifest.json`, exactly as the engine bound it.
///
/// # Errors
///
/// [`ReviewError::MissingNight`], [`ReviewError::MissingReport`],
/// [`ReviewError::MissingManifest`] or [`ReviewError::Witness`] when the
/// folder cannot yield a witness.
pub fn night_witness(night_dir: &Path) -> Result<String, ReviewError> {
    if !night_dir.is_dir() {
        return Err(ReviewError::MissingNight(night_dir.to_path_buf()));
    }
    let report_path = night_dir.join("report.md");
    let report = match std::fs::read_to_string(&report_path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(ReviewError::MissingReport(report_path))
        }
        Err(e) => return Err(e.into()),
    };
    let manifest = manifest::load(night_dir)
        .ok_or_else(|| ReviewError::MissingManifest(night_dir.join("manifest.json")))?;
    witness::witness(&report, &manifest.baseline_revision)
        .map_err(|e| ReviewError::Witness(e.to_string()))
}

/// Validate an import line against its night folder and build the record.
///
/// # Errors
///
/// A [`ReviewError::Field`] for a malformed field, the folder errors of
/// [`night_witness`], or [`ReviewError::WitnessMismatch`] when the quoted
/// witness is not a prefix of the night's.
pub fn record_from_import(
    imp: &ReviewImport,
    artefact_dir: &Path,
) -> Result<ReviewRecord, ReviewError> {
    check_fields(&Fields {
        repo: &imp.repo,
        date: &imp.date,
        reviewer: &imp.reviewer,
        reason: &imp.reason,
        confidence: imp.confidence,
        decided_at: &imp.decided_at,
        tool: &imp.tool,
    })?;
    let given = imp.witness.trim().to_ascii_lowercase();
    if given.len() < MIN_WITNESS_PREFIX
        || given.len() > 64
        || !given.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(field(
            "witness",
            format!(
                "{:?} is not {MIN_WITNESS_PREFIX}-64 hex characters",
                imp.witness
            ),
        ));
    }
    let dir = night_dir(artefact_dir, &imp.date, &imp.repo);
    let actual = night_witness(&dir)?;
    if !actual.starts_with(&given) {
        return Err(ReviewError::WitnessMismatch {
            given,
            night: format!("{}-{}", imp.date, imp.repo),
            actual: witness::short(&actual).to_string(),
        });
    }
    Ok(ReviewRecord {
        schema: SCHEMA,
        night_id: format!("{}-{}", imp.date, imp.repo),
        repo: imp.repo.clone(),
        date: imp.date.clone(),
        witness: actual,
        reviewer: imp.reviewer.trim().to_string(),
        verdict: imp.verdict,
        reason: imp.reason.trim().to_string(),
        confidence: imp.confidence,
        active_seconds: imp.active_seconds,
        decided_at: imp.decided_at.trim().to_string(),
        blind_to_gate: imp.blind_to_gate,
        tool: imp.tool.trim().to_string(),
    })
}

/// Check a stored record against the folder it sits in: schema, fields, the
/// folder name, and the witness recomputed from the folder.
///
/// # Errors
///
/// A [`ReviewError::Field`] for a malformed or misplaced record, the folder
/// errors of [`night_witness`], or [`ReviewError::WitnessMismatch`].
pub fn validate_record(rec: &ReviewRecord, night_dir: &Path) -> Result<(), ReviewError> {
    if rec.schema != SCHEMA {
        return Err(field(
            "schema",
            format!("{} is not the supported schema {SCHEMA}", rec.schema),
        ));
    }
    check_fields(&Fields {
        repo: &rec.repo,
        date: &rec.date,
        reviewer: &rec.reviewer,
        reason: &rec.reason,
        confidence: rec.confidence,
        decided_at: &rec.decided_at,
        tool: &rec.tool,
    })?;
    let expected_id = format!("{}-{}", rec.date, rec.repo);
    let folder = night_dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if rec.night_id != expected_id || folder != expected_id {
        return Err(field(
            "night_id",
            format!(
                "{:?} does not match its date and repo ({expected_id}) or its folder ({folder})",
                rec.night_id
            ),
        ));
    }
    let actual = night_witness(night_dir)?;
    if rec.witness.trim().to_ascii_lowercase() != actual {
        return Err(ReviewError::WitnessMismatch {
            given: witness::short(rec.witness.trim()).to_string(),
            night: expected_id,
            actual: witness::short(&actual).to_string(),
        });
    }
    Ok(())
}

/// Read a night's `review.json`, if it has one.
///
/// # Errors
///
/// [`ReviewError::Io`] or [`ReviewError::Json`] when the file exists but is
/// unreadable or not a schema-shaped record.
pub fn load_record(night_dir: &Path) -> Result<Option<ReviewRecord>, ReviewError> {
    match std::fs::read(night_dir.join(REVIEW_FILE)) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Write `rec` as the night's `review.json`, atomically. An identical record
/// already present is left alone; a different one is refused.
///
/// # Errors
///
/// [`ReviewError::Conflict`] when a different record exists, or the read and
/// write errors of [`load_record`].
pub fn write_record(
    night_dir: &Path,
    rec: &ReviewRecord,
    mode: Mode,
) -> Result<WriteOutcome, ReviewError> {
    match load_record(night_dir) {
        Ok(Some(existing)) if existing == *rec => return Ok(WriteOutcome::Unchanged),
        Ok(Some(_)) | Err(ReviewError::Json(_)) => {
            return Err(ReviewError::Conflict(night_dir.join(REVIEW_FILE)))
        }
        Ok(None) => {}
        Err(e) => return Err(e),
    }
    if mode == Mode::Apply {
        let mut bytes = serde_json::to_vec_pretty(rec)?;
        bytes.push(b'\n');
        manifest::write_atomic(&night_dir.join(REVIEW_FILE), &bytes)?;
    }
    Ok(WriteOutcome::Written)
}

/// Where the night's ledger row was written: the repository's `ledgerPath`
/// from the configuration frozen in the night folder, else from the
/// repository's current `dream.config.json`, else the default path.
pub fn ledger_path(workspace: &Path, night_dir: &Path, repo: &str) -> PathBuf {
    let repo_dir = workspace.join(repo);
    let rel = config::load_dream_config(&night_dir.join("config.json"))
        .or_else(|_| config::load_dream_config(&repo_dir.join("dream.config.json")))
        .map(|(cfg, _)| cfg.ledger_path)
        .unwrap_or_else(|_| DEFAULT_LEDGER_PATH.to_string());
    repo_dir.join(rel)
}

/// Byte offsets of the `|` characters in `line` that are column separators,
/// i.e. not written as `\|` (the escape `dream_core::ledger::escape_cell` uses
/// and the ledger reader honours).
fn separators(line: &str) -> Vec<usize> {
    let bytes = line.as_bytes();
    (0..bytes.len())
        .filter(|&i| bytes[i] == b'|' && (i == 0 || bytes[i - 1] != b'\\'))
        .collect()
}

/// A table line split at its separators: the separator offsets, and the cells
/// read as the ledger reader reads them (trimmed, `\|` unescaped). `None` for
/// a line that is not a `| … |` table row.
fn table_cells(line: &str) -> Option<(Vec<usize>, Vec<String>)> {
    let trimmed = line.trim();
    if !trimmed.starts_with('|') {
        return None;
    }
    let bars = separators(line);
    let last = *bars.last()?;
    if bars.len() < 2 || line[last + 1..].trim() != "" {
        return None;
    }
    let cells = bars
        .windows(2)
        .map(|w| line[w[0] + 1..w[1]].trim().replace("\\|", "|"))
        .collect();
    Some((bars, cells))
}

fn is_divider(cells: &[String]) -> bool {
    !cells.is_empty()
        && cells.iter().all(|c| {
            let c = c.trim_matches(':');
            c.len() >= 3 && c.bytes().all(|b| b == b'-')
        })
}

/// A line's content and its terminator (`""`, `"\n"` or `"\r\n"`).
fn split_terminator(line: &str) -> (&str, &str) {
    if let Some(body) = line.strip_suffix("\r\n") {
        (body, "\r\n")
    } else if let Some(body) = line.strip_suffix('\n') {
        (body, "\n")
    } else {
        (line, "")
    }
}

/// The result of [`fill_ledger_text`]: what happened, and the new text when
/// it changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextFill {
    /// What happened. [`FillOutcome::Filled`] carries an empty ledger path
    /// and no commit here; [`fill_ledger`] supplies both.
    pub outcome: FillOutcome,
    /// The edited ledger, present only for [`FillOutcome::Filled`].
    pub text: Option<String>,
}

/// Fill the human cells of the one row dated `date` with witness
/// `witness_short`, in ledger text, changing nothing else.
///
/// Only a twelve-cell row whose `Reviewer` and `Review-minutes` cells are both
/// empty is edited. If that row's governing header is the legacy ten-column
/// header, the header and divider gain the two human columns.
pub fn fill_ledger_text(
    text: &str,
    date: &str,
    witness_short: &str,
    reviewer: &str,
    minutes: &str,
) -> TextFill {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut header: Option<usize> = None;
    let mut matched: Vec<(usize, Option<usize>)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let (body, _) = split_terminator(line);
        let Some((_, cells)) = table_cells(body) else {
            continue;
        };
        if cells.first().map(String::as_str) == Some("Date") {
            header = Some(i);
            continue;
        }
        let width_ok = cells.len() == WIDTH || cells.len() == LEGACY_WIDTH;
        if width_ok
            && !is_divider(&cells)
            && cells[DATE_CELL] == date
            && cells[WITNESS_CELL] == witness_short
        {
            matched.push((i, header));
        }
    }
    let not_filled = |outcome| TextFill {
        outcome,
        text: None,
    };
    let (row, header) = match matched.as_slice() {
        [] => return not_filled(FillOutcome::NoRow),
        [one] => *one,
        many => return not_filled(FillOutcome::Ambiguous(many.len())),
    };
    let (body, end) = split_terminator(lines[row]);
    let Some((bars, cells)) = table_cells(body) else {
        return not_filled(FillOutcome::NoRow);
    };
    if cells.len() == LEGACY_WIDTH {
        return not_filled(FillOutcome::LegacyRow);
    }
    if !cells[REVIEWER_CELL].is_empty() || !cells[MINUTES_CELL].is_empty() {
        return not_filled(FillOutcome::AlreadyFilled);
    }

    let reviewer_cell = ledger::escape_cell(reviewer);
    let minutes_cell = ledger::escape_cell(minutes);
    let filled = format!(
        "{} {reviewer_cell} | {minutes_cell} {}{end}",
        &body[..=bars[REVIEWER_CELL]],
        &body[bars[MINUTES_CELL + 1]..]
    );

    let mut out: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    out[row] = filled;

    let mut widened = false;
    if let Some(h) = header {
        let legacy_header = table_cells(split_terminator(lines[h]).0)
            .is_some_and(|(_, c)| c.iter().map(String::as_str).eq(LEGACY_HEADER));
        let divider = lines
            .get(h + 1)
            .and_then(|l| table_cells(split_terminator(l).0))
            .filter(|(_, c)| c.len() == LEGACY_WIDTH && is_divider(c));
        if legacy_header && divider.is_some() {
            let widen = |line: &str, extra: &str| {
                let (body, end) = split_terminator(line);
                format!("{} {extra} |{end}", body.trim_end())
            };
            out[h] = widen(lines[h], "Reviewer | Review-minutes");
            out[h + 1] = widen(lines[h + 1], "--- | ---");
            widened = true;
        }
    }

    TextFill {
        outcome: FillOutcome::Filled {
            ledger: PathBuf::new(),
            reviewer: reviewer_cell,
            minutes: minutes_cell,
            widened_header: widened,
            commit: None,
        },
        text: Some(out.concat()),
    }
}

/// Backfill one night's ledger row from a validated record, then commit the
/// ledger locally ([`ledger_io::commit`], dream-core's `commit_ledger`: the
/// ledger file only, on the default branch only, never pushed).
///
/// In [`Mode::Apply`] the read, the edit, the crash-safe replace and the
/// commit all happen under the ledger's lock, the ledger read inside it.
///
/// # Errors
///
/// [`ReviewError::Lock`] when another writer keeps the ledger locked past
/// `how.lock_wait`; [`ReviewError::Io`] when the ledger exists but cannot be
/// read or written.
pub fn fill_ledger(
    workspace: &Path,
    night_dir: &Path,
    rec: &ReviewRecord,
    mode: Mode,
    how: &Ledgering,
) -> Result<FillOutcome, ReviewError> {
    let path = ledger_path(workspace, night_dir, &rec.repo);
    if !path.exists() {
        return Ok(FillOutcome::NoLedger(path));
    }
    let lock = match mode {
        Mode::Apply => Some(LedgerLock::acquire(&path, how.lock_wait)?),
        Mode::DryRun => None,
    };
    let read_from = lock.as_ref().map_or(path.as_path(), |l| l.ledger());
    let text = match std::fs::read_to_string(read_from) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(FillOutcome::NoLedger(path))
        }
        Err(e) => return Err(e.into()),
    };
    let fill = fill_ledger_text(
        &text,
        &rec.date,
        witness::short(&rec.witness),
        &rec.reviewer,
        &minutes_cell(rec.active_seconds),
    );
    let (
        FillOutcome::Filled {
            reviewer,
            minutes,
            widened_header,
            ..
        },
        Some(new_text),
    ) = (fill.outcome.clone(), fill.text)
    else {
        return Ok(fill.outcome);
    };
    let mut commit = None;
    if let Some(lock) = lock {
        ledger_io::replace(lock.ledger(), new_text.as_bytes())?;
        let repo_dir = workspace.join(&rec.repo);
        if crate::archive::is_own_work_tree(&repo_dir) {
            commit = Some(ledger_io::commit(
                &repo_dir,
                &path,
                &format!(
                    "dream: record human review of {} in the ledger",
                    rec.night_id
                ),
                how.identity.as_ref(),
            ));
        }
        drop(lock);
    }
    Ok(FillOutcome::Filled {
        ledger: path,
        reviewer,
        minutes,
        widened_header,
        commit,
    })
}

/// Validate a night's stored `review.json` and backfill its ledger row.
/// `Ok(None)` when the night has no review.
///
/// # Errors
///
/// Any validation error of [`validate_record`], or the errors of
/// [`load_record`] and [`fill_ledger`].
pub fn backfill_night(
    workspace: &Path,
    night_dir: &Path,
    mode: Mode,
    how: &Ledgering,
) -> Result<Option<FillOutcome>, ReviewError> {
    let Some(rec) = load_record(night_dir)? else {
        return Ok(None);
    };
    validate_record(&rec, night_dir)?;
    fill_ledger(workspace, night_dir, &rec, mode, how).map(Some)
}

/// Backfill every night under `artefact_dir` that holds a `review.json`, in
/// folder-name order. Returns one entry per reviewed night: its folder name
/// and the outcome or the reason it was refused.
pub fn backfill_all(
    artefact_dir: &Path,
    workspace: &Path,
    mode: Mode,
    how: &Ledgering,
) -> Vec<(String, Result<FillOutcome, ReviewError>)> {
    let Ok(entries) = std::fs::read_dir(artefact_dir) else {
        return Vec::new();
    };
    let mut nights: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join(REVIEW_FILE).is_file())
        .collect();
    nights.sort();
    nights
        .into_iter()
        .filter_map(|dir| {
            let name = dir.file_name()?.to_string_lossy().into_owned();
            match backfill_night(workspace, &dir, mode, how) {
                Ok(Some(outcome)) => Some((name, Ok(outcome))),
                Ok(None) => None,
                Err(e) => Some((name, Err(e))),
            }
        })
        .collect()
}

/// What became of one import line.
#[derive(Debug)]
pub enum LineResult {
    /// The record is stored (or already was) and the ledger step ran.
    Done(WriteOutcome, FillOutcome),
    /// The record is stored, but the ledger fill failed (the ledger stayed
    /// locked, or could not be written). The record stands; the next
    /// backfill, at the start of a night or by `dream-engine review backfill`,
    /// fills the row.
    FillPending(WriteOutcome, ReviewError),
    /// The line was refused; nothing was written.
    Refused(ReviewError),
}

/// The outcome of one import line.
#[derive(Debug)]
pub struct LineReport {
    /// 1-based line number in the import file.
    pub line: usize,
    /// `<date>-<repo>` when the line parsed far enough to name a night.
    pub night_id: Option<String>,
    /// What became of the line.
    pub result: LineResult,
}

impl LineReport {
    /// True when the line was refused and nothing was recorded.
    pub fn refused(&self) -> bool {
        matches!(self.result, LineResult::Refused(_))
    }

    /// True when the review was recorded but its ledger fill is pending.
    pub fn fill_pending(&self) -> bool {
        matches!(self.result, LineResult::FillPending(..))
    }
}

fn write_word(write: &WriteOutcome) -> &'static str {
    match write {
        WriteOutcome::Written => "review recorded",
        WriteOutcome::Unchanged => "review already recorded",
    }
}

impl fmt::Display for LineReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let night = self.night_id.as_deref().unwrap_or("?");
        match &self.result {
            LineResult::Done(write, fill) => {
                write!(
                    f,
                    "line {}: {night}: {}; {fill}",
                    self.line,
                    write_word(write)
                )
            }
            LineResult::FillPending(write, e) => write!(
                f,
                "line {}: {night}: {}, ledger fill pending ({e}); the next backfill retries it",
                self.line,
                write_word(write)
            ),
            LineResult::Refused(e) => write!(f, "line {}: {night}: REFUSED: {e}", self.line),
        }
    }
}

fn import_line(
    raw: &str,
    artefact_dir: &Path,
    workspace: &Path,
    mode: Mode,
    how: &Ledgering,
) -> (Option<String>, LineResult) {
    let imp: ReviewImport = match serde_json::from_str(raw) {
        Ok(i) => i,
        Err(e) => return (None, LineResult::Refused(e.into())),
    };
    let night_id = Some(format!("{}-{}", imp.date, imp.repo));
    let rec = match record_from_import(&imp, artefact_dir) {
        Ok(r) => r,
        Err(e) => return (night_id, LineResult::Refused(e)),
    };
    let dir = night_dir(artefact_dir, &rec.date, &rec.repo);
    let written = match write_record(&dir, &rec, mode) {
        Ok(w) => w,
        Err(e) => return (night_id, LineResult::Refused(e)),
    };
    let result = match fill_ledger(workspace, &dir, &rec, mode, how) {
        Ok(fill) => LineResult::Done(written, fill),
        // Nothing was written in a dry run, so nothing is pending.
        Err(e) if mode == Mode::DryRun => LineResult::Refused(e),
        Err(e) => LineResult::FillPending(written, e),
    };
    (night_id, result)
}

/// Import reviews from JSON Lines text: one [`ReviewImport`] object per
/// non-blank line. Each line is validated against its night folder, written as
/// that night's `review.json`, and backfilled into the ledger. A refused line
/// changes nothing and does not stop the others; a line whose record was
/// written but whose ledger fill failed is [`LineResult::FillPending`].
///
/// # Examples
///
/// ```
/// use dream_engine::review::{import_jsonl, Ledgering, Mode};
/// let dir = tempfile::tempdir()?;
/// let line = r#"{"repo":"demo","date":"2026-11-01","witness":"0123456789ab",
///   "reviewer":"reviewer-a","verdict":"approve","reason":"sound change",
///   "confidence":4,"active_seconds":300,"decided_at":"2026-11-02T09:00:00Z",
///   "blind_to_gate":true,"tool":"review-desk/1"}"#.replace('\n', "");
/// let reports = import_jsonl(&line, dir.path(), dir.path(), Mode::DryRun, &Ledgering::default());
/// // No such night folder: the line is refused, and says why.
/// assert!(reports[0].refused());
/// assert!(reports[0].to_string().contains("no night folder"));
/// # Ok::<(), std::io::Error>(())
/// ```
pub fn import_jsonl(
    text: &str,
    artefact_dir: &Path,
    workspace: &Path,
    mode: Mode,
    how: &Ledgering,
) -> Vec<LineReport> {
    text.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(i, raw)| {
            let (night_id, result) = import_line(raw, artefact_dir, workspace, mode, how);
            LineReport {
                line: i + 1,
                night_id,
                result,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use dream_core::ledger::{empty_ledger, parse_ledger, render_row, verify_ledger, LedgerRow};
    use dream_gate::manifest::ExperimentManifest;
    use tempfile::TempDir;

    const COMMIT: &str = "4c2f0e8a91b37d5e6f0a1b2c3d4e5f6071829304";
    const DATE: &str = "2026-11-01";
    const REPO: &str = "demo-repo";
    const REPORT: &str = "# Nightly report\n\nVerdict: INCONCLUSIVE\n";

    /// A workspace and artefact directory with one night folder for
    /// `demo-repo` on `DATE`, holding a report and a frozen manifest.
    struct Fixture {
        _root: TempDir,
        workspace: PathBuf,
        artefacts: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("tempdir");
            let workspace = root.path().join("workspace");
            let artefacts = root.path().join("artefacts");
            std::fs::create_dir_all(workspace.join(REPO)).expect("repo dir");
            let fx = Fixture {
                _root: root,
                workspace,
                artefacts,
            };
            fx.night(DATE, REPO, REPORT);
            fx
        }

        fn night(&self, date: &str, repo: &str, report: &str) -> PathBuf {
            let dir = night_dir(&self.artefacts, date, repo);
            std::fs::create_dir_all(&dir).expect("night dir");
            std::fs::write(dir.join("report.md"), report).expect("report");
            let manifest = manifest_json(date, repo);
            std::fs::write(dir.join("manifest.json"), manifest).expect("manifest");
            dir
        }

        fn dir(&self) -> PathBuf {
            night_dir(&self.artefacts, DATE, REPO)
        }

        fn ledger(&self) -> PathBuf {
            self.workspace.join(REPO).join(DEFAULT_LEDGER_PATH)
        }

        fn write_ledger(&self, text: &str) {
            let p = self.ledger();
            std::fs::create_dir_all(p.parent().expect("parent")).expect("ledger dir");
            std::fs::write(p, text).expect("ledger");
        }

        fn read_ledger(&self) -> String {
            std::fs::read_to_string(self.ledger()).expect("ledger readable")
        }

        fn import(&self, lines: &[String], mode: Mode) -> Vec<LineReport> {
            import_jsonl(
                &lines.join("\n"),
                &self.artefacts,
                &self.workspace,
                mode,
                &Ledgering::default(),
            )
        }
    }

    fn manifest_json(date: &str, repo: &str) -> String {
        let m = ExperimentManifest {
            schema: 1,
            run_id: "0000000000000000".into(),
            night_id: format!("{date}-{repo}"),
            repo: repo.into(),
            repo_slug: format!("owner/{repo}"),
            date: date.into(),
            day_int: 0,
            deep: "deep".into(),
            scan: vec![],
            baseline_revision: COMMIT.into(),
            baseline_tree_hash: String::new(),
            config_digest: String::new(),
            evaluators: vec![],
            model: dream_gate::manifest::ModelIdentity {
                provider: "test".into(),
                model: "test".into(),
                max_tokens: 1,
                fallback: None,
            },
            engine_version: "0".into(),
            created_at: "2026-11-01T01:00:00Z".into(),
        };
        serde_json::to_string(&m).expect("manifest serialises")
    }

    fn full_witness() -> String {
        witness::witness(REPORT, COMMIT).expect("witness")
    }

    fn short_witness() -> String {
        witness::short(&full_witness()).to_string()
    }

    fn import_line_json(witness: &str, active_seconds: &str) -> String {
        format!(
            r#"{{"repo":"{REPO}","date":"{DATE}","witness":"{witness}","reviewer":"reviewer-a","verdict":"needs-changes","reason":"right idea, the test does not exercise the fix","confidence":4,"active_seconds":{active_seconds},"decided_at":"2026-11-02T09:30:00Z","blind_to_gate":true,"tool":"review-desk/1"}}"#
        )
    }

    fn row(date: &str, witness: &str, finding: &str) -> LedgerRow {
        LedgerRow::unreviewed(
            date.into(),
            "deep".into(),
            finding.into(),
            "NONE".into(),
            "NONE".into(),
            "yes".into(),
            "INCONCLUSIVE".into(),
            String::new(),
            witness.into(),
            String::new(),
        )
    }

    /// A twelve-column ledger: an earlier night, tonight's row, a later night.
    fn twelve_column_ledger() -> String {
        format!(
            "{}{}\n{}\n{}\n",
            empty_ledger(),
            render_row(&row("2026-10-31", "aaaaaaaaaaaa", "earlier night")),
            render_row(&row(DATE, &short_witness(), "tonight")),
            render_row(&row("2026-11-02", "bbbbbbbbbbbb", "later night")),
        )
    }

    /// The legacy shape seen in real ledgers: a ten-column header and legacy
    /// rows, with twelve-cell rows appended beneath by the current writer.
    fn legacy_header_ledger() -> String {
        format!(
            "| {} |\n| {} |\n\
             | 2026-09-01 | deep | old night | NONE | NONE | yes | REJECT |  | cccccccccccc |  |\n\
             {}\n",
            LEGACY_HEADER.join(" | "),
            ["---"; 10].join(" | "),
            render_row(&row(DATE, &short_witness(), "tonight")),
        )
    }

    fn assert_only_line_changed(before: &str, after: &str, changed: &[usize]) {
        let b: Vec<&str> = before.split_inclusive('\n').collect();
        let a: Vec<&str> = after.split_inclusive('\n').collect();
        assert_eq!(a.len(), b.len(), "line count changed:\n{after}");
        for (i, (x, y)) in b.iter().zip(&a).enumerate() {
            if changed.contains(&i) {
                assert_ne!(x, y, "line {i} should have changed");
            } else {
                assert_eq!(x, y, "line {i} changed but should not have");
            }
        }
    }

    // --- import validation ---------------------------------------------------

    #[test]
    fn import_with_a_matching_short_witness_writes_the_record() {
        let fx = Fixture::new();
        let reports = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert_eq!(reports.len(), 1);
        assert!(!reports[0].refused(), "{}", reports[0]);
        let rec = load_record(&fx.dir())
            .expect("readable")
            .expect("record written");
        assert_eq!(rec.schema, SCHEMA);
        assert_eq!(rec.night_id, format!("{DATE}-{REPO}"));
        assert_eq!(rec.witness, full_witness(), "the full witness is stored");
        assert_eq!(rec.verdict, ReviewVerdict::NeedsChanges);
        assert_eq!(rec.active_seconds, Some(300));
        assert!(rec.blind_to_gate);
        validate_record(&rec, &fx.dir()).expect("a written record validates");
    }

    #[test]
    fn import_accepts_the_full_witness_in_any_case() {
        let fx = Fixture::new();
        let reports = fx.import(
            &[import_line_json(&full_witness().to_uppercase(), "60")],
            Mode::Apply,
        );
        assert!(!reports[0].refused(), "{}", reports[0]);
    }

    #[test]
    fn import_refuses_a_witness_from_another_night() {
        let fx = Fixture::new();
        let reports = fx.import(&[import_line_json("0123456789ab", "300")], Mode::Apply);
        let msg = reports[0].to_string();
        assert!(reports[0].refused());
        assert!(msg.contains("witness mismatch"), "{msg}");
        assert!(
            msg.contains(&short_witness()),
            "names the night's witness: {msg}"
        );
        assert!(
            load_record(&fx.dir()).expect("readable").is_none(),
            "nothing written on mismatch"
        );
    }

    #[test]
    fn import_refuses_a_changed_report() {
        let fx = Fixture::new();
        let w = short_witness();
        std::fs::write(fx.dir().join("report.md"), "edited after review").expect("rewrite");
        let reports = fx.import(&[import_line_json(&w, "300")], Mode::Apply);
        assert!(reports[0].to_string().contains("witness mismatch"));
    }

    #[test]
    fn import_refuses_a_short_prefix() {
        let fx = Fixture::new();
        let prefix = &short_witness()[..8];
        let reports = fx.import(&[import_line_json(prefix, "300")], Mode::Apply);
        let msg = reports[0].to_string();
        assert!(
            msg.contains("witness:") && msg.contains("12-64 hex"),
            "{msg}"
        );
    }

    #[test]
    fn import_refuses_a_missing_night() {
        let fx = Fixture::new();
        let line = import_line_json(&short_witness(), "300")
            .replace("\"date\":\"2026-11-01\"", "\"date\":\"2026-11-03\"")
            .replace("2026-11-02T09:30:00Z", "2026-11-04T09:00:00Z");
        let reports = fx.import(&[line], Mode::Apply);
        let msg = reports[0].to_string();
        assert!(msg.contains("no night folder"), "{msg}");
        assert!(msg.contains("2026-11-03-demo-repo"), "{msg}");
    }

    #[test]
    fn import_refuses_a_night_without_a_report() {
        let fx = Fixture::new();
        std::fs::remove_file(fx.dir().join("report.md")).expect("rm");
        let reports = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert!(reports[0].to_string().contains("no report.md"));
    }

    #[test]
    fn import_refuses_malformed_fields_with_the_field_named() {
        let fx = Fixture::new();
        let base = import_line_json(&short_witness(), "300");
        let cases = [
            (
                base.replace("\"repo\":\"demo-repo\"", "\"repo\":\"../demo-repo\""),
                "repo",
            ),
            (
                base.replace("\"confidence\":4", "\"confidence\":6"),
                "confidence",
            ),
            (
                base.replace("\"confidence\":4", "\"confidence\":0"),
                "confidence",
            ),
            (base.replace("reviewer-a", "a|b"), "reviewer"),
            (
                base.replace("\"reviewer\":\"reviewer-a\"", "\"reviewer\":\" \""),
                "reviewer",
            ),
            (base.replace("right idea", "line one\\nline two"), "reason"),
            (
                base.replace("2026-11-02T09:30:00Z", "yesterday"),
                "decided_at",
            ),
            (
                base.replace("2026-11-02T09:30:00Z", "2026-10-31T23:00:00Z"),
                "decided_at",
            ),
            (base.replace("needs-changes", "maybe"), "json"),
            (base.replace("\"tool\"", "\"tool_name\""), "json"),
            (base.replace(",\"blind_to_gate\":true", ""), "json"),
        ];
        for (line, want) in cases {
            let reports = fx.import(std::slice::from_ref(&line), Mode::Apply);
            let msg = reports[0].to_string();
            assert!(reports[0].refused(), "accepted: {line}");
            assert!(msg.contains(want), "expected {want:?} in {msg}");
        }
        assert!(load_record(&fx.dir()).expect("readable").is_none());
    }

    #[test]
    fn dry_run_writes_nothing_but_reports_the_fill() {
        let fx = Fixture::new();
        let ledger = twelve_column_ledger();
        fx.write_ledger(&ledger);
        let reports = fx.import(&[import_line_json(&short_witness(), "300")], Mode::DryRun);
        let msg = reports[0].to_string();
        assert!(
            msg.contains("review recorded") && msg.contains("minutes=5"),
            "{msg}"
        );
        assert!(load_record(&fx.dir()).expect("readable").is_none());
        assert_eq!(fx.read_ledger(), ledger, "dry run leaves the ledger alone");
    }

    #[test]
    fn a_bad_line_does_not_stop_the_good_ones() {
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        let reports = fx.import(
            &[
                "not json".to_string(),
                String::new(),
                import_line_json(&short_witness(), "300"),
            ],
            Mode::Apply,
        );
        assert_eq!(reports.len(), 2, "blank lines are skipped");
        assert!(reports[0].refused());
        assert_eq!(reports[0].line, 1);
        assert!(!reports[1].refused(), "{}", reports[1]);
        assert_eq!(reports[1].line, 3, "line numbers count blank lines");
    }

    #[test]
    fn a_different_second_review_is_refused_and_an_identical_one_is_a_no_op() {
        let fx = Fixture::new();
        let line = import_line_json(&short_witness(), "300");
        assert!(!fx.import(std::slice::from_ref(&line), Mode::Apply)[0].refused());
        let again = fx.import(std::slice::from_ref(&line), Mode::Apply);
        assert!(
            again[0].to_string().contains("review already recorded"),
            "{}",
            again[0]
        );
        let other = line.replace("reviewer-a", "reviewer-b");
        let refused = fx.import(&[other], Mode::Apply);
        assert!(refused[0]
            .to_string()
            .contains("already holds a different review"));
        let kept = load_record(&fx.dir()).expect("readable").expect("record");
        assert_eq!(kept.reviewer, "reviewer-a");
    }

    // --- backfill --------------------------------------------------------------

    #[test]
    fn import_backfills_a_twelve_column_ledger_and_nothing_else() {
        let fx = Fixture::new();
        let before = twelve_column_ledger();
        fx.write_ledger(&before);
        let reports = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert!(
            reports[0].to_string().contains("ledger filled"),
            "{}",
            reports[0]
        );
        let after = fx.read_ledger();
        assert_only_line_changed(&before, &after, &[3]);
        let parsed = parse_ledger(&after);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
        let tonight = &parsed.rows[1];
        assert_eq!(tonight.reviewer, "reviewer-a");
        assert_eq!(tonight.review_minutes, "5");
        assert_eq!(tonight.finding, "tonight", "other cells intact");
        assert!(verify_ledger(&after).ok);
        assert!(parsed.rows[0].reviewer.is_empty() && parsed.rows[2].reviewer.is_empty());
    }

    #[test]
    fn backfill_on_a_legacy_header_widens_the_header_and_fills_the_twelve_cell_row() {
        let fx = Fixture::new();
        let before = legacy_header_ledger();
        fx.write_ledger(&before);
        let reports = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert!(
            reports[0].to_string().contains("legacy header widened"),
            "{}",
            reports[0]
        );
        let after = fx.read_ledger();
        // Header, divider and tonight's row change; the legacy row does not.
        assert_only_line_changed(&before, &after, &[0, 1, 3]);
        let lines: Vec<&str> = after.lines().collect();
        assert_eq!(
            lines[0],
            format!(
                "| {} | Reviewer | Review-minutes |",
                LEGACY_HEADER.join(" | ")
            )
        );
        assert_eq!(lines[1], format!("| {} |", ["---"; 12].join(" | ")));
        let parsed = parse_ledger(&after);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
        assert_eq!(parsed.rows[1].reviewer, "reviewer-a");
        assert!(verify_ledger(&after).ok);
    }

    #[test]
    fn a_matching_legacy_ten_cell_row_is_skipped_not_widened() {
        let fx = Fixture::new();
        let before = format!(
            "| {} |\n| {} |\n| {DATE} | deep | old | NONE | NONE | yes | REJECT |  | {} |  |\n",
            LEGACY_HEADER.join(" | "),
            ["---"; 10].join(" | "),
            short_witness()
        );
        fx.write_ledger(&before);
        let reports = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert!(reports[0]
            .to_string()
            .contains("legacy ten-column; not widened"));
        assert_eq!(fx.read_ledger(), before);
    }

    #[test]
    fn backfill_is_idempotent() {
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        let once = fx.read_ledger();
        let again = backfill_all(
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &Ledgering::default(),
        );
        assert_eq!(again.len(), 1);
        assert!(
            matches!(again[0].1, Ok(FillOutcome::AlreadyFilled)),
            "{:?}",
            again[0]
        );
        assert_eq!(fx.read_ledger(), once);
    }

    #[test]
    fn backfill_never_overwrites_a_human_cell() {
        let fx = Fixture::new();
        let mut r = row(DATE, &short_witness(), "tonight");
        r.reviewer = "someone-else".into();
        let before = format!("{}{}\n", empty_ledger(), render_row(&r));
        fx.write_ledger(&before);
        fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert_eq!(fx.read_ledger(), before);
        let mut r = row(DATE, &short_witness(), "tonight");
        r.review_minutes = "7".into();
        let before = format!("{}{}\n", empty_ledger(), render_row(&r));
        fx.write_ledger(&before);
        let out = backfill_all(
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &Ledgering::default(),
        );
        assert!(matches!(out[0].1, Ok(FillOutcome::AlreadyFilled)));
        assert_eq!(fx.read_ledger(), before);
    }

    #[test]
    fn escaped_pipes_in_other_cells_survive_the_fill() {
        let fx = Fixture::new();
        let mut r = row(DATE, &short_witness(), "tonight");
        r.effect = "p50 | p95 both down".into();
        let neighbour = {
            let mut n = row("2026-10-31", "aaaaaaaaaaaa", "earlier");
            n.effect = "a|b|c".into();
            n
        };
        let before = format!(
            "{}{}\n{}\n",
            empty_ledger(),
            render_row(&neighbour),
            render_row(&r)
        );
        assert!(before.contains("p50 \\| p95"), "fixture escapes the pipe");
        fx.write_ledger(&before);
        fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        let after = fx.read_ledger();
        assert_only_line_changed(&before, &after, &[3]);
        assert!(after.contains("| p50 \\| p95 both down |"), "{after}");
        assert!(after.contains("| a\\|b\\|c |"), "{after}");
        let parsed = parse_ledger(&after);
        assert_eq!(parsed.rows[1].effect, "p50 | p95 both down");
        assert_eq!(parsed.rows[1].reviewer, "reviewer-a");
    }

    #[test]
    fn crlf_line_endings_and_a_missing_final_newline_are_preserved() {
        let fx = Fixture::new();
        let before = twelve_column_ledger().replace('\n', "\r\n");
        let before = before
            .strip_suffix("\r\n")
            .expect("trailing crlf")
            .to_string();
        fx.write_ledger(&before);
        fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        let after = fx.read_ledger();
        assert_only_line_changed(&before, &after, &[3]);
        assert!(after
            .split_inclusive('\n')
            .nth(3)
            .expect("row")
            .ends_with("|\r\n"));
        assert!(!after.ends_with('\n'));
    }

    #[test]
    fn no_fabricated_zero_minutes() {
        assert_eq!(minutes_cell(None), "");
        assert_eq!(minutes_cell(Some(0)), "");
        assert_eq!(minutes_cell(Some(29)), "0", "a measured 29 s rounds to 0");
        assert_eq!(minutes_cell(Some(30)), "1");
        assert_eq!(minutes_cell(Some(90)), "2");
        assert_eq!(minutes_cell(Some(3_599)), "60");

        for seconds in ["null", "0"] {
            let fx = Fixture::new();
            fx.write_ledger(&twelve_column_ledger());
            let r = fx.import(&[import_line_json(&short_witness(), seconds)], Mode::Apply);
            assert!(r[0].to_string().contains("minutes=(empty)"), "{}", r[0]);
            let parsed = parse_ledger(&fx.read_ledger());
            assert_eq!(parsed.rows[1].reviewer, "reviewer-a");
            assert_eq!(parsed.rows[1].review_minutes, "", "seconds={seconds}");
        }
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        let line = import_line_json(&short_witness(), "1").replace(",\"active_seconds\":1", "");
        assert!(!fx.import(&[line], Mode::Apply)[0].refused());
        assert_eq!(parse_ledger(&fx.read_ledger()).rows[1].review_minutes, "");
    }

    #[test]
    fn matching_needs_both_date_and_witness_and_a_unique_row() {
        let w = short_witness();
        let text = format!(
            "{}{}\n",
            empty_ledger(),
            render_row(&row("2026-10-30", &w, "same witness, other date"))
        );
        let fill = fill_ledger_text(&text, DATE, &w, "reviewer-a", "5");
        assert_eq!(fill.outcome, FillOutcome::NoRow);
        let text = format!(
            "{}{}\n{}\n",
            empty_ledger(),
            render_row(&row(DATE, &w, "first")),
            render_row(&row(DATE, &w, "second"))
        );
        let fill = fill_ledger_text(&text, DATE, &w, "reviewer-a", "5");
        assert_eq!(fill.outcome, FillOutcome::Ambiguous(2));
        assert!(fill.text.is_none());
    }

    #[test]
    fn a_foreign_table_before_the_ledger_is_left_alone() {
        let w = short_witness();
        let text = format!(
            "# Dream-cycle ledger\n\n| date | slot | verdict | finding |\n|---|---|---|---|\n| {DATE} | x | ok | y |\n\n{}{}\n",
            empty_ledger(),
            render_row(&row(DATE, &w, "tonight"))
        );
        let fill = fill_ledger_text(&text, DATE, &w, "reviewer-a", "5");
        let after = fill.text.expect("filled");
        assert_only_line_changed(&text, &after, &[8]);
    }

    #[test]
    fn backfill_validates_records_written_by_other_tools() {
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        let imp: ReviewImport =
            serde_json::from_str(&import_line_json(&short_witness(), "300")).expect("parses");
        let good = record_from_import(&imp, &fx.artefacts).expect("valid");

        // A record whose witness does not match its folder is refused.
        let mut forged = good.clone();
        forged.witness = "f".repeat(64);
        std::fs::write(
            fx.dir().join(REVIEW_FILE),
            serde_json::to_vec(&forged).expect("ser"),
        )
        .expect("write");
        let out = backfill_all(
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &Ledgering::default(),
        );
        assert!(
            matches!(out[0].1, Err(ReviewError::WitnessMismatch { .. })),
            "{:?}",
            out[0]
        );

        // A record copied into another night's folder is refused.
        let other = fx.night("2026-11-02", REPO, REPORT);
        std::fs::write(
            other.join(REVIEW_FILE),
            serde_json::to_vec(&good).expect("ser"),
        )
        .expect("write");
        std::fs::remove_file(fx.dir().join(REVIEW_FILE)).expect("rm");
        let out = backfill_all(
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &Ledgering::default(),
        );
        let msg = out[0].1.as_ref().expect_err("refused").to_string();
        assert!(msg.contains("night_id"), "{msg}");

        // An unknown schema is refused.
        let mut future = good.clone();
        future.schema = 2;
        std::fs::remove_file(other.join(REVIEW_FILE)).expect("rm");
        std::fs::write(
            fx.dir().join(REVIEW_FILE),
            serde_json::to_vec(&future).expect("ser"),
        )
        .expect("write");
        let out = backfill_all(
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &Ledgering::default(),
        );
        assert!(out[0]
            .1
            .as_ref()
            .expect_err("refused")
            .to_string()
            .contains("schema"));
        assert_eq!(
            fx.read_ledger(),
            twelve_column_ledger(),
            "no refused record edits the ledger"
        );

        // The valid record, written by hand, is picked up.
        std::fs::write(
            fx.dir().join(REVIEW_FILE),
            serde_json::to_vec(&good).expect("ser"),
        )
        .expect("write");
        let out = backfill_all(
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &Ledgering::default(),
        );
        assert!(
            matches!(out[0].1, Ok(FillOutcome::Filled { .. })),
            "{:?}",
            out[0]
        );
    }

    #[test]
    fn backfill_uses_the_ledger_path_frozen_in_the_night_folder() {
        let fx = Fixture::new();
        std::fs::write(
            fx.dir().join("config.json"),
            r#"{"repo":"owner/demo-repo","ledgerPath":"notes/L.md","slots":[{"deep":"d","scan":[]}]}"#,
        )
        .expect("config");
        let custom = fx.workspace.join(REPO).join("notes/L.md");
        std::fs::create_dir_all(custom.parent().expect("parent")).expect("dir");
        std::fs::write(&custom, twelve_column_ledger()).expect("ledger");
        fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        let parsed = parse_ledger(&std::fs::read_to_string(&custom).expect("read"));
        assert_eq!(parsed.rows[1].reviewer, "reviewer-a");
    }

    #[test]
    fn a_missing_ledger_is_reported_and_the_record_still_kept() {
        let fx = Fixture::new();
        let r = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert!(r[0].to_string().contains("no ledger at"), "{}", r[0]);
        assert!(load_record(&fx.dir()).expect("readable").is_some());
    }

    #[test]
    fn a_fill_commits_the_ledger_in_the_repositorys_own_work_tree() {
        let fx = Fixture::new();
        let repo = fx.workspace.join(REPO);
        let git = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .status()
                .expect("git runs")
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&["init", "--quiet", "--initial-branch=main"]);
        // The engine commits with the repository's own identity; give the
        // scratch repository one so the test does not depend on global config.
        git(&["config", "user.name", "t"]);
        git(&["config", "user.email", "t@example.invalid"]);
        fx.write_ledger(&twelve_column_ledger());
        git(&["add", "."]);
        git(&["commit", "--quiet", "-m", "ledger"]);
        let r = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        assert!(r[0].to_string().contains("committed"), "{}", r[0]);
    }

    #[test]
    fn no_commit_is_attempted_outside_the_repositorys_own_work_tree() {
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        let r = fx.import(&[import_line_json(&short_witness(), "300")], Mode::Apply);
        match &r[0].result {
            LineResult::Done(_, FillOutcome::Filled { commit, .. }) => assert_eq!(*commit, None),
            other => panic!("expected a fill, got {other:?}"),
        }
    }

    /// The race the ledger lock closes: an import reads the ledger, the night
    /// appends its row, the import writes. With the fill blocked on the lock
    /// while the night holds it, the fill re-reads after the append, so both
    /// the filled cells and tonight's row survive.
    #[test]
    fn a_fill_waiting_on_the_night_keeps_the_row_the_night_appended() {
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        let night = ledger_io::LedgerLock::acquire(&fx.ledger(), Duration::ZERO).expect("lock");

        let (artefacts, workspace) = (fx.artefacts.clone(), fx.workspace.clone());
        let line = import_line_json(&short_witness(), "300");
        let import = std::thread::spawn(move || {
            import_jsonl(
                &line,
                &artefacts,
                &workspace,
                Mode::Apply,
                &Ledgering::default(),
            )
        });
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(fx.read_ledger(), twelve_column_ledger(), "the fill waits");
        assert!(
            load_record(&fx.dir()).expect("readable").is_some(),
            "record first"
        );

        ledger_io::append_row(
            &night,
            &row("2026-11-03", "cccccccccccc", "the night's row"),
        )
        .expect("append");
        drop(night);
        let reports = import.join().expect("import thread");
        assert!(
            matches!(reports[0].result, LineResult::Done(..)),
            "{}",
            reports[0]
        );

        let parsed = parse_ledger(&fx.read_ledger());
        let tonight = parsed.rows.iter().find(|r| r.date == DATE).expect("row");
        assert_eq!(tonight.reviewer, "reviewer-a");
        assert!(
            parsed.rows.iter().any(|r| r.witness == "cccccccccccc"),
            "the appended row survived: {:?}",
            parsed.rows
        );
    }

    /// The other order: a fill holds the lock (here the test, standing in for
    /// it) when the night appends. The append waits, re-reads, and keeps the
    /// fill.
    #[test]
    fn an_append_waiting_on_a_fill_keeps_the_filled_cells() {
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        let fill = ledger_io::LedgerLock::acquire(&fx.ledger(), Duration::ZERO).expect("lock");
        let stale = ledger_io::read(&fill).expect("read");

        let ledger = fx.ledger();
        let append = std::thread::spawn(move || {
            let lock = ledger_io::LedgerLock::acquire(&ledger, Duration::from_secs(30))?;
            ledger_io::append_row(&lock, &row("2026-11-03", "cccccccccccc", "the night's row"))
        });
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(fx.read_ledger(), stale, "the append waits");

        let filled = fill_ledger_text(&stale, DATE, &short_witness(), "reviewer-a", "5");
        ledger_io::replace(fill.ledger(), filled.text.expect("filled").as_bytes())
            .expect("replace");
        drop(fill);
        append.join().expect("append thread").expect("append");

        let parsed = parse_ledger(&fx.read_ledger());
        assert_eq!(parsed.rows.len(), 4, "{:?}", parsed.rows);
        let tonight = parsed.rows.iter().find(|r| r.date == DATE).expect("row");
        assert_eq!(
            (tonight.reviewer.as_str(), tonight.review_minutes.as_str()),
            ("reviewer-a", "5")
        );
    }

    #[test]
    fn a_busy_ledger_leaves_the_record_and_reports_the_fill_pending() {
        let fx = Fixture::new();
        fx.write_ledger(&twelve_column_ledger());
        let _night = ledger_io::LedgerLock::acquire(&fx.ledger(), Duration::ZERO).expect("lock");
        let how = Ledgering {
            identity: None,
            lock_wait: Duration::from_millis(200),
        };
        let reports = import_jsonl(
            &import_line_json(&short_witness(), "300"),
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &how,
        );
        assert!(
            reports[0].fill_pending() && !reports[0].refused(),
            "{}",
            reports[0]
        );
        let text = reports[0].to_string();
        assert!(
            text.contains("review recorded, ledger fill pending"),
            "{text}"
        );
        assert!(
            text.contains("dream-ledger.lock") || text.contains("LEDGER.md.lock"),
            "{text}"
        );
        assert!(
            load_record(&fx.dir()).expect("readable").is_some(),
            "the record stands"
        );
        assert_eq!(
            fx.read_ledger(),
            twelve_column_ledger(),
            "the ledger is untouched"
        );

        // Once the night lets go, the backfill fills the row.
        drop(_night);
        let out = backfill_all(
            &fx.artefacts,
            &fx.workspace,
            Mode::Apply,
            &Ledgering::default(),
        );
        assert!(
            matches!(out[0].1, Ok(FillOutcome::Filled { .. })),
            "{:?}",
            out[0]
        );
    }
}
