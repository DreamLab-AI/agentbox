//! Process identity for every `agentbox-ops` path that signals a process.
//!
//! ADR-2032 fixed daemon *discovery*: a process is recognised by argv elements
//! against a launcher allowlist, never by text embedded in a shell command, a
//! search query or an agent prompt. That rule lives here as
//! [`is_ruflo_daemon_argv`] (the reaper's matcher, moved verbatim so both tools
//! share one implementation) and [`is_hermes_daemon_argv`].
//!
//! Recognising a command *shape* is not identity. A PID confirmed a moment ago
//! can belong to a different process by the time the signal lands, and a stale
//! PID file can name an unrelated live process that happens to fit the shape.
//! The identity half of this module closes that gap the way the ADR's
//! "next strengthening step" describes, without a pidfd:
//!
//! * [`ProcessIdentity`] records the tuple `(pid, argv, starttime)`, where
//!   `starttime` is field 22 of `/proc/<pid>/stat` — the process's start time in
//!   clock ticks since boot. The kernel never reissues a `(pid, starttime)` pair
//!   for a different process, so the pair is an identity, not a guess.
//! * The identity is captured **when the process is launched** and persisted
//!   alongside the PID.
//! * [`verify`] re-reads `/proc` immediately before the caller signals and
//!   returns a four-way verdict. Only [`IdentityVerdict::Match`] permits a
//!   signal.
//!
//! Everything that is not a positive match is a refusal, and each refusal is
//! distinct so the caller can report it honestly:
//!
//! | Verdict | Meaning | Caller must |
//! |---|---|---|
//! | [`IdentityVerdict::Match`] | same argv and same start time | may signal |
//! | [`IdentityVerdict::Mismatch`] | PID is live but is another process (reuse) | refuse, report |
//! | [`IdentityVerdict::NoSuchProcess`] | PID is gone | refuse, treat as already stopped |
//! | [`IdentityVerdict::Inaccessible`] | `/proc` could not be read at all | refuse, report — never assume a match |
//!
//! `/proc` is reached through the [`ProcSource`] trait so tests can inject a
//! denied or absent procfs instead of relying on kernel state. [`ProcFs`] is the
//! real implementation.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Why a `/proc` read did not produce an answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcError {
    /// `/proc` is readable and the PID has no entry: the process is gone.
    NoSuchProcess,
    /// `/proc` itself could not be read (not mounted, `hidepid`, denied). This
    /// is never evidence about the target process, only about our own access.
    Inaccessible(String),
    /// The file was read but did not have the documented shape.
    Malformed(String),
}

impl std::fmt::Display for ProcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoSuchProcess => write!(f, "no such process"),
            Self::Inaccessible(why) => write!(f, "proc data inaccessible: {why}"),
            Self::Malformed(why) => write!(f, "malformed proc data: {why}"),
        }
    }
}

/// Read access to the two `/proc` files that establish identity.
///
/// Implemented by [`ProcFs`] for the real filesystem; tests substitute their own
/// so a denied or missing procfs is exercised deterministically.
pub trait ProcSource {
    /// Raw `/proc/<pid>/cmdline`: NUL-separated argv, NUL-terminated.
    fn cmdline(&self, pid: u32) -> Result<Vec<u8>, ProcError>;
    /// Raw `/proc/<pid>/stat`.
    fn stat(&self, pid: u32) -> Result<String, ProcError>;
}

/// The real procfs, rooted at `/proc` unless told otherwise.
#[derive(Debug, Clone)]
pub struct ProcFs {
    root: PathBuf,
}

impl ProcFs {
    /// Roots the reader at `root` (`/proc` in production; a fixture directory in
    /// tests that want file-shaped inputs).
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn read(&self, pid: u32, file: &str) -> Result<Vec<u8>, ProcError> {
        let path = self.root.join(pid.to_string()).join(file);
        match std::fs::read(&path) {
            Ok(bytes) => Ok(bytes),
            Err(e) => Err(match e.kind() {
                std::io::ErrorKind::NotFound => {
                    // Distinguish "this PID is gone" from "we cannot see /proc
                    // at all". Only the first is evidence about the target.
                    if self.root.is_dir() {
                        ProcError::NoSuchProcess
                    } else {
                        ProcError::Inaccessible(format!(
                            "{} is not present — process identity cannot be established",
                            self.root.display()
                        ))
                    }
                }
                std::io::ErrorKind::PermissionDenied => ProcError::Inaccessible(format!(
                    "{} is not readable by this process: {e}",
                    path.display()
                )),
                _ => ProcError::Inaccessible(format!("{}: {e}", path.display())),
            }),
        }
    }
}

impl Default for ProcFs {
    fn default() -> Self {
        Self::new("/proc")
    }
}

impl ProcSource for ProcFs {
    fn cmdline(&self, pid: u32) -> Result<Vec<u8>, ProcError> {
        self.read(pid, "cmdline")
    }

    fn stat(&self, pid: u32) -> Result<String, ProcError> {
        let bytes = self.read(pid, "stat")?;
        String::from_utf8(bytes)
            .map_err(|e| ProcError::Malformed(format!("/proc/{pid}/stat is not UTF-8: {e}")))
    }
}

/// The identity of one process, recorded when it was launched.
///
/// `starttime` is field 22 of `/proc/<pid>/stat`. A PID alone is not an
/// identity; `(pid, starttime)` is, and `argv` additionally pins *what* is
/// running so a wrapper swap is caught as well as a PID reuse.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessIdentity {
    pub pid: u32,
    /// argv as separate elements, never a joined string (ADR-2032).
    pub argv: Vec<String>,
    /// `/proc/<pid>/stat` field 22, in clock ticks since boot.
    pub starttime: u64,
    /// When the identity was captured, for operator diagnostics only. It is
    /// never part of the identity comparison.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recorded_at: Option<String>,
}

impl ProcessIdentity {
    /// argv as borrowed elements, for the launcher-allowlist predicates.
    pub fn argv_refs(&self) -> Vec<&str> {
        self.argv.iter().map(String::as_str).collect()
    }

    /// A single-line rendering for logs. argv elements are quoted individually
    /// so a path containing a space cannot be misread as two arguments.
    pub fn display(&self) -> String {
        let argv = self
            .argv
            .iter()
            .map(|a| format!("{a:?}"))
            .collect::<Vec<_>>()
            .join(" ");
        format!("pid={} starttime={} argv=[{}]", self.pid, self.starttime, argv)
    }
}

/// The result of re-checking a recorded identity against live `/proc` data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityVerdict {
    /// Same PID, same start time, same argv. The only verdict that permits a
    /// signal.
    Match,
    /// The PID is live but is not the recorded process (PID reuse, or the
    /// recorded process was replaced by a different command).
    Mismatch { reason: String },
    /// The PID has no `/proc` entry: the recorded process has exited.
    NoSuchProcess,
    /// `/proc` could not be read. Says nothing about the target, so the caller
    /// must refuse rather than assume either way.
    Inaccessible { reason: String },
}

impl IdentityVerdict {
    /// True only for [`IdentityVerdict::Match`].
    pub fn is_match(&self) -> bool {
        matches!(self, Self::Match)
    }
}

/// Splits raw `/proc/<pid>/cmdline` bytes into argv elements.
///
/// The buffer is NUL-*terminated*, so the final split is always empty and is
/// dropped; interior empty arguments (legal, if unusual) are preserved.
pub fn parse_argv(raw: &[u8]) -> Vec<String> {
    let mut parts: Vec<&[u8]> = raw.split(|b| *b == 0).collect();
    while parts.last().is_some_and(|p| p.is_empty()) {
        parts.pop();
    }
    parts
        .into_iter()
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect()
}

/// Field 22 (`starttime`) of a `/proc/<pid>/stat` line.
///
/// Field 2 (`comm`) is parenthesised and may itself contain spaces and
/// parentheses, so the fields are counted from the **last** `)` — splitting the
/// whole line on whitespace is the classic way to read the wrong number.
pub fn parse_starttime(stat: &str) -> Result<u64, ProcError> {
    let close = stat
        .rfind(')')
        .ok_or_else(|| ProcError::Malformed("stat has no ')' terminating comm".to_string()))?;
    let fields: Vec<&str> = stat[close + 1..].split_whitespace().collect();
    // fields[0] is stat field 3 (state), so field N sits at index N - 3.
    const STARTTIME_FIELD: usize = 22;
    let index = STARTTIME_FIELD - 3;
    let raw = fields.get(index).ok_or_else(|| {
        ProcError::Malformed(format!(
            "stat has {} fields after comm, need at least {}",
            fields.len(),
            index + 1
        ))
    })?;
    raw.parse::<u64>()
        .map_err(|e| ProcError::Malformed(format!("starttime {raw:?} is not a number: {e}")))
}

/// Captures the identity of a live process.
///
/// Call this **at launch**, and persist the result next to the PID. An identity
/// captured later is only as trustworthy as the PID it started from.
pub fn capture(source: &dyn ProcSource, pid: u32) -> Result<ProcessIdentity, ProcError> {
    let argv = parse_argv(&source.cmdline(pid)?);
    if argv.is_empty() {
        return Err(ProcError::Malformed(format!(
            "pid {pid} exposes no argv (kernel thread, or already exited)"
        )));
    }
    let starttime = parse_starttime(&source.stat(pid)?)?;
    Ok(ProcessIdentity {
        pid,
        argv,
        starttime,
        recorded_at: None,
    })
}

/// Re-checks a recorded identity against live `/proc` data.
///
/// Call this immediately before signalling — not at plan time. The window
/// between verdict and signal is the residual race, and it is as small as the
/// caller can make it.
pub fn verify(source: &dyn ProcSource, recorded: &ProcessIdentity) -> IdentityVerdict {
    if recorded.argv.is_empty() {
        return IdentityVerdict::Mismatch {
            reason: "the recorded identity has no argv and cannot be matched".to_string(),
        };
    }

    let raw = match source.cmdline(recorded.pid) {
        Ok(raw) => raw,
        Err(ProcError::NoSuchProcess) => return IdentityVerdict::NoSuchProcess,
        Err(e) => return IdentityVerdict::Inaccessible { reason: e.to_string() },
    };
    let live_argv = parse_argv(&raw);
    if live_argv.is_empty() {
        // A zombie or a reaped PID exposes an empty cmdline: whatever is at this
        // PID now, it is not the running process we recorded.
        return IdentityVerdict::Mismatch {
            reason: format!(
                "pid {} exposes no argv — the recorded process has exited",
                recorded.pid
            ),
        };
    }

    let stat = match source.stat(recorded.pid) {
        Ok(stat) => stat,
        Err(ProcError::NoSuchProcess) => return IdentityVerdict::NoSuchProcess,
        Err(e) => return IdentityVerdict::Inaccessible { reason: e.to_string() },
    };
    let live_starttime = match parse_starttime(&stat) {
        Ok(t) => t,
        Err(e) => return IdentityVerdict::Inaccessible { reason: e.to_string() },
    };

    if live_starttime != recorded.starttime {
        return IdentityVerdict::Mismatch {
            reason: format!(
                "pid {} start time is {live_starttime}, recorded {} — the PID has been reused",
                recorded.pid, recorded.starttime
            ),
        };
    }
    if live_argv != recorded.argv {
        return IdentityVerdict::Mismatch {
            reason: format!(
                "pid {} argv is {live_argv:?}, recorded {:?}",
                recorded.pid, recorded.argv
            ),
        };
    }
    IdentityVerdict::Match
}

/// The final path component of `path`, or `""` when there is none.
pub fn basename(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
}

/// Match a `ruflo` / `claude-flow` daemon invocation using argv boundaries,
/// never text embedded in a shell command, search query or prompt. Unknown
/// launchers fail closed (ADR-2032).
///
/// A process qualifies when its program basename is `ruflo` or `claude-flow`,
/// or is `node`/`nodejs` running a script whose basename is one of those names
/// or a `cli.js` under a `ruflo`, `claude-flow` or `@claude-flow` package path,
/// **and** the following arguments begin with the separate elements `daemon`,
/// `start`.
pub fn is_ruflo_daemon_argv(args: &[&str]) -> bool {
    let Some(program) = args.first() else {
        return false;
    };
    let daemon_args = match basename(program) {
        "ruflo" | "claude-flow" => &args[1..],
        "node" | "nodejs" => {
            let Some(script) = args.get(1) else {
                return false;
            };
            let named_launcher = matches!(basename(script), "ruflo" | "claude-flow");
            let package_script = basename(script) == "cli.js"
                && Path::new(script).components().any(|part| {
                    matches!(
                        part.as_os_str().to_str(),
                        Some("ruflo" | "claude-flow" | "@claude-flow")
                    )
                });
            if !named_launcher && !package_script {
                return false;
            }
            &args[2..]
        }
        _ => return false,
    };
    daemon_args.starts_with(&["daemon", "start"])
}

/// Match the Hermes scheduler daemon's own launcher shape by argv elements.
///
/// The daemon is `hermes-scheduler run-loop --root <path>`, exec'd from
/// [`crate::hermes::daemon_start`]. This is the same lexical allowlist rule the
/// reaper applies to `ruflo`: a shell whose command *string* contains the words,
/// or an unrecognised wrapper, does not qualify.
///
/// It is defence in depth, not the identity check — a stop path must still
/// [`verify`] the recorded `(pid, argv, starttime)`.
pub fn is_hermes_daemon_argv(args: &[&str]) -> bool {
    let Some(program) = args.first() else {
        return false;
    };
    if basename(program) != "hermes-scheduler" {
        return false;
    }
    args.get(1).is_some_and(|arg| *arg == "run-loop")
}

#[cfg(test)]
#[path = "process_identity_tests.rs"]
mod tests;
