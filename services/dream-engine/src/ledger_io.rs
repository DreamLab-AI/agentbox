//! Serialised, durable ledger writes: one advisory lock per ledger, a
//! crash-safe replace, and the row append and ledger commit run under it.
//!
//! Two writers edit a repository's `docs/dream-cycle/LEDGER.md`: the night
//! appending its row, and the review backfill filling a row's human cells
//! (run at the start of a night, or by `dream-engine review import` at any
//! time). Each reads the whole file and writes a whole new one, so without a
//! lock an import that read before the night appended, and wrote after, would
//! silently drop tonight's row. Every writer therefore:
//!
//! 1. takes the ledger's [`LedgerLock`] (bounded wait, a clear error on
//!    timeout),
//! 2. reads the ledger **inside** the lock, immediately before writing,
//! 3. writes it: the night's row through `dream_core::ledger::append_row`
//!    followed by an `fsync` ([`append_row`]), a review fill through
//!    [`replace`] (temporary file, `fsync`, rename, directory `fsync`); both
//!    write through a symlinked ledger rather than over the link,
//! 4. commits it through `dream_core::ledger::commit_ledger` ([`commit`]),
//!    and only then releases the lock, so two commits never collide on
//!    `index.lock`.
//!
//! The ledger mechanism itself (row rendering, the row contract, the commit
//! rules) stays in `dream-core` (ADR-2141); this module only serialises it.
//!
//! The lock lives in the repository's git directory (`dream-ledger.lock`),
//! keyed on the symlink-resolved ledger, so every caller derives the same
//! file; a ledger outside any git repository locks a hidden file beside it.
//! A second, separate lock ([`NightRunning`]) marks a night in progress, so
//! `review import` can refuse to run during one.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use dream_core::ledger::{self, LedgerCommit, LedgerRow};
use thiserror::Error;

use crate::archive::{identity_hint, GitIdentity};
use crate::gitcmd::git;

/// How long a ledger writer waits for another to finish before giving up.
/// A normal holder keeps the lock for a read, a write and a local commit, well
/// under this. The commit is `dream_core::ledger::commit_ledger`, whose git
/// calls are not time-limited: a git hung under the lock makes every waiter
/// give up after this wait with [`LockError::Busy`], naming the lock file.
pub const DEFAULT_LOCK_WAIT: Duration = Duration::from_secs(300);

/// Longest the git-directory lookup for the lock path may run.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// How often a held lock is retried.
const RETRY: Duration = Duration::from_millis(100);

/// File name of the ledger lock inside a repository's git directory.
pub const LOCK_FILE: &str = "dream-ledger.lock";

/// File name of the night-in-progress lock inside the artefact directory.
pub const NIGHT_RUNNING_FILE: &str = ".night-running.lock";

/// Why a ledger lock could not be taken.
#[derive(Debug, Error)]
pub enum LockError {
    /// Another writer kept the lock for the whole wait.
    #[error(
        "the ledger lock {path} is held by another dream-engine writer (a night or a review \
         import); gave up after {}s — retry once it finishes",
        waited.as_secs()
    )]
    Busy {
        /// The lock file.
        path: PathBuf,
        /// How long this writer waited.
        waited: Duration,
    },
    /// The lock file could not be created or locked.
    #[error("ledger lock {path}: {source}")]
    Io {
        /// The lock file.
        path: PathBuf,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },
}

impl From<LockError> for std::io::Error {
    fn from(e: LockError) -> Self {
        let kind = match &e {
            LockError::Busy { .. } => std::io::ErrorKind::WouldBlock,
            LockError::Io { source, .. } => source.kind(),
        };
        std::io::Error::new(kind, e.to_string())
    }
}

/// The ledger as every writer names it: symlinks resolved, so a symlinked
/// ledger and its target share one lock and one write path. A ledger that does
/// not exist yet resolves through its (created) parent directory.
fn resolved(ledger: &Path) -> std::io::Result<PathBuf> {
    if let Ok(p) = ledger.canonicalize() {
        return Ok(p);
    }
    let parent = match ledger.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    std::fs::create_dir_all(parent)?;
    let name = ledger.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("ledger path {} has no file name", ledger.display()),
        )
    })?;
    Ok(parent.canonicalize()?.join(name))
}

/// The lock file for `ledger`: `<git-dir>/dream-ledger.lock` of the work tree
/// holding the resolved ledger, else `.<ledger name>.lock` beside it.
///
/// # Errors
///
/// An I/O error creating the ledger's directory or resolving its path.
pub fn lock_path(ledger: &Path) -> std::io::Result<PathBuf> {
    let file = resolved(ledger)?;
    let dir = file.parent().unwrap_or(Path::new("/")).to_path_buf();
    let git_dir = git(&dir, &["rev-parse", "--absolute-git-dir"], GIT_TIMEOUT)
        .ok()
        .filter(|r| r.success)
        .map(|r| PathBuf::from(r.stdout.trim()))
        .filter(|p| p.is_dir());
    Ok(match git_dir {
        Some(g) => g.join(LOCK_FILE),
        None => dir.join(format!(
            ".{}.lock",
            file.file_name().unwrap_or_default().to_string_lossy()
        )),
    })
}

/// Take an exclusive lock on `path`, retrying every [`RETRY`] for up to `wait`.
fn lock_file(path: &Path, wait: Duration) -> Result<File, LockError> {
    let io = |source| LockError::Io {
        path: path.to_path_buf(),
        source,
    };
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .map_err(io)?;
    let start = Instant::now();
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(TryLockError::WouldBlock) if start.elapsed() < wait => {
                std::thread::sleep(RETRY.min(wait.saturating_sub(start.elapsed())));
            }
            Err(TryLockError::WouldBlock) => {
                return Err(LockError::Busy {
                    path: path.to_path_buf(),
                    waited: start.elapsed(),
                })
            }
            Err(TryLockError::Error(e)) => return Err(io(e)),
        }
    }
}

/// An exclusive advisory lock on one ledger, released on drop (or on process
/// death, however abrupt). `flock`-style, so per open file: hold one guard
/// across the read, the write and the commit; a second acquire in the same
/// process waits like any other writer.
#[derive(Debug)]
pub struct LedgerLock {
    _file: File,
    path: PathBuf,
    ledger: PathBuf,
}

impl LedgerLock {
    /// Lock `ledger`, waiting up to `wait` for another writer.
    ///
    /// # Errors
    ///
    /// [`LockError::Busy`] when the wait runs out, naming the lock file;
    /// [`LockError::Io`] when it cannot be created.
    pub fn acquire(ledger: &Path, wait: Duration) -> Result<Self, LockError> {
        let path = lock_path(ledger).map_err(|source| LockError::Io {
            path: ledger.to_path_buf(),
            source,
        })?;
        let file = lock_file(&path, wait)?;
        let ledger = resolved(ledger).map_err(|source| LockError::Io {
            path: ledger.to_path_buf(),
            source,
        })?;
        Ok(LedgerLock {
            _file: file,
            path,
            ledger,
        })
    }

    /// The lock file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The ledger it guards, symlinks resolved: the file to read and replace.
    pub fn ledger(&self) -> &Path {
        &self.ledger
    }
}

/// Marks a night in progress: held by the loop (or a one-shot run) for the
/// whole night, probed by `review import` ([`night_in_progress`]).
#[derive(Debug)]
pub struct NightRunning {
    _file: File,
}

impl NightRunning {
    /// Take the night-in-progress lock in `artefact_dir` (created if absent),
    /// waiting up to `wait`.
    ///
    /// # Errors
    ///
    /// As [`LedgerLock::acquire`].
    pub fn acquire(artefact_dir: &Path, wait: Duration) -> Result<Self, LockError> {
        std::fs::create_dir_all(artefact_dir).map_err(|source| LockError::Io {
            path: artefact_dir.to_path_buf(),
            source,
        })?;
        Ok(NightRunning {
            _file: lock_file(&artefact_dir.join(NIGHT_RUNNING_FILE), wait)?,
        })
    }
}

/// True when a night holds the night-in-progress lock in `artefact_dir`. The
/// probe takes and drops the lock at once, so it never delays a night.
pub fn night_in_progress(artefact_dir: &Path) -> bool {
    let path = artefact_dir.join(NIGHT_RUNNING_FILE);
    if !path.exists() {
        return false;
    }
    matches!(
        lock_file(&path, Duration::ZERO),
        Err(LockError::Busy { .. })
    )
}

/// Replace `path` with `bytes` crash-safely: write a temporary file beside the
/// target, `fsync` it, rename it over the target, and `fsync` the directory.
/// A symlinked `path` is written through: its target is replaced and the link
/// is left in place.
///
/// # Errors
///
/// Any I/O error; on failure the original file is untouched.
pub fn replace(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let target = match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => resolved(path)?,
        _ => path.to_path_buf(),
    };
    let dir = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let tmp = dir.join(format!(".{name}.tmp-{}", std::process::id()));
    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        if let Ok(meta) = std::fs::metadata(&target) {
            std::fs::set_permissions(&tmp, meta.permissions())?;
        }
        std::fs::rename(&tmp, &target)?;
        File::open(&dir)?.sync_all()
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Read the ledger the lock guards, as it is now (`""` when absent).
///
/// # Errors
///
/// Any read error other than the file not existing.
pub fn read(lock: &LedgerLock) -> std::io::Result<String> {
    match std::fs::read_to_string(lock.ledger()) {
        Ok(t) => Ok(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e),
    }
}

/// Append `row` to the ledger the lock guards with
/// `dream_core::ledger::append_row` (which re-reads the ledger, bootstraps an
/// absent one and repairs the row against the row contract), then `fsync` the
/// ledger and its directory. Writes through a symlinked ledger.
///
/// # Errors
///
/// Any I/O error appending or syncing.
pub fn append_row(lock: &LedgerLock, row: &LedgerRow) -> std::io::Result<()> {
    ledger::append_row(lock.ledger(), row).map_err(|ledger::LedgerError::Io(e)| e)?;
    File::open(lock.ledger())?.sync_all()?;
    if let Some(dir) = lock.ledger().parent() {
        File::open(dir)?.sync_all()?;
    }
    Ok(())
}

/// Commit the ledger with `dream_core::ledger::commit_ledger` (the ledger file
/// only, on the default branch only, never pushed). Call it while holding the
/// ledger's [`LedgerLock`]. A failure in a repository with no identity, when
/// no fallback is configured, names the configuration keys to set.
pub fn commit(
    repo: &Path,
    ledger_path: &Path,
    message: &str,
    identity: Option<&GitIdentity>,
) -> LedgerCommit {
    match ledger::commit_ledger(repo, ledger_path, message) {
        LedgerCommit::Failed(e) => LedgerCommit::Failed(identity_hint(repo, identity, e)),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn sh(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("git runs");
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn repo() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().expect("tempdir");
        let r = d.path().join("repo");
        std::fs::create_dir_all(&r).expect("dir");
        sh(&r, &["init", "--quiet", "--initial-branch=main"]);
        sh(&r, &["config", "user.name", "t"]);
        sh(&r, &["config", "user.email", "t@example.invalid"]);
        std::fs::write(r.join("README.md"), "x\n").expect("readme");
        sh(&r, &["add", "-A"]);
        sh(&r, &["commit", "--quiet", "-m", "init"]);
        (d, r)
    }

    fn row(date: &str, witness: &str) -> LedgerRow {
        LedgerRow::unreviewed(
            date.into(),
            "deep".into(),
            "a finding that says what changed tonight".into(),
            "NONE".into(),
            "NONE".into(),
            "yes".into(),
            "REJECT".into(),
            "none".into(),
            witness.into(),
            String::new(),
        )
    }

    #[test]
    fn the_lock_lives_in_the_git_directory_and_is_shared_by_a_symlink() {
        let (_d, r) = repo();
        let ledger = r.join("docs/dream-cycle/LEDGER.md");
        std::fs::create_dir_all(ledger.parent().expect("parent")).expect("dir");
        std::fs::write(&ledger, ledger::empty_ledger()).expect("ledger");
        let link = r.join("LEDGER-link.md");
        std::os::unix::fs::symlink(&ledger, &link).expect("symlink");
        let p = lock_path(&ledger).expect("path");
        assert!(p.ends_with(".git/dream-ledger.lock"), "{}", p.display());
        assert_eq!(lock_path(&link).expect("path"), p);
    }

    #[test]
    fn outside_a_repository_the_lock_sits_beside_the_ledger() {
        let d = tempfile::tempdir().expect("tempdir");
        let p = lock_path(&d.path().join("sub/LEDGER.md")).expect("path");
        assert_eq!(
            p,
            d.path()
                .canonicalize()
                .expect("canon")
                .join("sub/.LEDGER.md.lock")
        );
    }

    #[test]
    fn a_held_lock_times_out_naming_its_file() {
        let (_d, r) = repo();
        let ledger = r.join("LEDGER.md");
        let _held = LedgerLock::acquire(&ledger, Duration::ZERO).expect("first");
        let err = LedgerLock::acquire(&ledger, Duration::from_millis(250)).expect_err("busy");
        let text = err.to_string();
        assert!(matches!(err, LockError::Busy { .. }), "{text}");
        assert!(text.contains("dream-ledger.lock"), "{text}");
        assert!(text.contains("gave up"), "{text}");
    }

    #[test]
    fn replace_writes_through_a_symlink_and_keeps_the_link() {
        let d = tempfile::tempdir().expect("tempdir");
        let target = d.path().join("real.md");
        let link = d.path().join("link.md");
        std::fs::write(&target, "old\n").expect("write");
        std::os::unix::fs::symlink(&target, &link).expect("symlink");
        replace(&link, b"new\n").expect("replace");
        assert!(std::fs::symlink_metadata(&link)
            .expect("meta")
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&target).expect("read"), "new\n");
        let leftovers: Vec<_> = std::fs::read_dir(d.path())
            .expect("dir")
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "no temporary file left behind");
    }

    #[test]
    fn append_bootstraps_and_keeps_existing_rows() {
        let d = tempfile::tempdir().expect("tempdir");
        let ledger = d.path().join("docs/LEDGER.md");
        let lock = LedgerLock::acquire(&ledger, Duration::ZERO).expect("lock");
        append_row(&lock, &row("2026-11-01", "aaaaaaaaaaaa")).expect("first");
        std::fs::write(
            &ledger,
            std::fs::read_to_string(&ledger).expect("read").trim_end(),
        )
        .expect("strip newline");
        append_row(&lock, &row("2026-11-02", "bbbbbbbbbbbb")).expect("second");
        let text = std::fs::read_to_string(&ledger).expect("read");
        assert!(text.starts_with("| Date |"), "{text}");
        assert!(text.contains("aaaaaaaaaaaa |") && text.contains("bbbbbbbbbbbb |"));
        assert_eq!(ledger::parse_ledger(&text).rows.len(), 2, "{text}");
    }

    #[test]
    fn the_commit_takes_only_the_ledger_and_keeps_the_repository_identity() {
        let (_d, r) = repo();
        let ledger = r.join("docs/dream-cycle/LEDGER.md");
        std::fs::write(r.join("wip.txt"), "operator work\n").expect("wip");
        sh(&r, &["add", "wip.txt"]);
        let lock = LedgerLock::acquire(&ledger, Duration::ZERO).expect("lock");
        append_row(&lock, &row("2026-11-01", "aaaaaaaaaaaa")).expect("append");
        let fallback = GitIdentity::from_parts(Some("fallback"), Some("f@example.invalid"));
        let out = commit(&r, &ledger, "ledger row", fallback.as_ref());
        assert!(matches!(out, LedgerCommit::Committed(_)), "{out:?}");
        assert_eq!(
            sh(&r, &["log", "-1", "--format=%an", "--name-only"]),
            "t\n\ndocs/dream-cycle/LEDGER.md"
        );
        assert_eq!(sh(&r, &["diff", "--cached", "--name-only"]), "wip.txt");
    }

    #[test]
    fn night_in_progress_reflects_the_held_lock() {
        let d = tempfile::tempdir().expect("tempdir");
        assert!(!night_in_progress(d.path()));
        let held = NightRunning::acquire(d.path(), Duration::ZERO).expect("lock");
        assert!(night_in_progress(d.path()));
        drop(held);
        // Another test thread forking git between our open and its exec holds
        // a duplicate of the lock descriptor for that instant (close-on-exec
        // releases it), so a just-released lock can look held: poll briefly.
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while night_in_progress(d.path()) {
            assert!(std::time::Instant::now() < deadline, "the lock stayed held");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
