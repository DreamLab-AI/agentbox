//! Hermes scheduler — a background cron daemon for Claude Code agent tasks.
//!
//! Ported from `skills/hermes-scheduler/scripts/scheduler.py`. Jobs live in
//! `~/.claude/scheduler/jobs.json`, output under `~/.claude/scheduler/output/`,
//! and each due job is dispatched as `claude --print "<prompt>"`.
//!
//! The daemon records its `(pid, argv, starttime)` identity at launch
//! (`scheduler.identity.json`, next to `scheduler.pid`). Every path that
//! signals it re-verifies that identity immediately before the signal and
//! refuses anything short of a match — ADR-2032's rule for any signalling
//! tool, applied here as well as in the reaper.

pub mod jobs;
pub mod schedule;

use crate::process_identity::{self, IdentityVerdict, ProcError, ProcFs, ProcSource};
use chrono::Local;
use jobs::Store;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Seconds between daemon ticks.
pub const TICK_INTERVAL: u64 = 60;
/// Per-job wall-clock budget. Long sweeps need more than ten minutes.
pub const JOB_TIMEOUT_SECS: u64 = 1800;

/// Result of executing one job.
pub struct RunOutcome {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/// Runs a job through the `claude` CLI, returning its combined output.
pub fn run_job(prompt: &str, workdir: Option<&str>) -> RunOutcome {
    run_job_with_cli(prompt, workdir, Path::new("claude"))
}

fn run_job_with_cli(prompt: &str, workdir: Option<&str>, cli: &Path) -> RunOutcome {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home/devuser".into());
    let cwd = workdir
        .map(str::to_string)
        .unwrap_or_else(|| Path::new(&home).join("workspace").display().to_string());

    let child = Command::new(cli)
        .arg("--print")
        .arg(prompt)
        .current_dir(&cwd)
        .env("CLAUDE_NO_TELEMETRY", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return RunOutcome {
                success: false,
                output: String::new(),
                error: Some("claude CLI not found in PATH".into()),
            }
        }
        Err(e) => {
            return RunOutcome {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
            }
        }
    };

    let deadline = Instant::now() + Duration::from_secs(JOB_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut s) = child.stdout.take() {
                    let _ = s.read_to_string(&mut stdout);
                }
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_string(&mut stderr);
                }
                if status.success() {
                    return RunOutcome {
                        success: true,
                        output: stdout,
                        error: None,
                    };
                }
                let error = if stderr.is_empty() {
                    format!("Exit code {}", status.code().unwrap_or(-1))
                } else {
                    stderr
                };
                return RunOutcome {
                    success: false,
                    output: format!("{stdout}\n\n---\nSTDERR:\n{error}"),
                    error: Some(error),
                };
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return RunOutcome {
                        success: false,
                        output: String::new(),
                        error: Some(format!("Job timed out after {JOB_TIMEOUT_SECS}s")),
                    };
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => {
                return RunOutcome {
                    success: false,
                    output: String::new(),
                    error: Some(e.to_string()),
                }
            }
        }
    }
}

/// Holds the tick lock for as long as it is alive.
struct TickLock {
    _file: File,
}

impl TickLock {
    /// Takes the exclusive non-blocking lock, or `None` when another tick
    /// already holds it.
    fn acquire(path: &Path) -> Option<Self> {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)
            .ok()?;
        rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive).ok()?;
        Some(Self { _file: file })
    }
}

/// Runs one scheduler cycle. Returns the number of jobs executed, or 0 when
/// another instance holds the lock.
pub fn tick(store: &Store, verbose: bool) -> usize {
    let _ = store.ensure_dirs();
    let Some(_lock) = TickLock::acquire(&store.lock_file()) else {
        if verbose {
            eprintln!("Tick skipped — another instance holds the lock");
        }
        return 0;
    };

    let now = Local::now();
    let mut all = store.load();
    let scan = jobs::scan_due(&mut all, now);

    for (_, name, missed, grace, new_next) in &scan.fast_forwarded {
        log(&format!(
            "Job '{name}' stale (missed by {missed}s, grace={grace}s). Fast-forwarding to {new_next}"
        ));
    }
    if scan.dirty {
        let _ = store.save(&all, now);
    }

    let due = scan.due;
    if due.is_empty() {
        return 0;
    }
    log(&format!("{} job(s) due", due.len()));

    let mut executed = 0usize;
    for job in due {
        let now = Local::now();
        let mut current = store.load();
        if jobs::advance_next_run(&mut current, &job.id, now) {
            let _ = store.save(&current, now);
        }

        let outcome = run_job(&job.prompt, job.workdir.as_deref());
        let saved = store.save_output(&job.id, &outcome.output, Local::now());
        log(&format!(
            "Job '{}' {}. Output: {}",
            job.name,
            if outcome.success {
                "succeeded".to_string()
            } else {
                format!("failed: {}", outcome.error.clone().unwrap_or_default())
            },
            saved
                .map(|p| p.display().to_string())
                .unwrap_or_else(|e| e.to_string())
        ));

        let now = Local::now();
        let mut current = store.load();
        jobs::mark_run(
            &mut current,
            &job.id,
            outcome.success,
            outcome.error.as_deref(),
            now,
        );
        let _ = store.save(&current, now);
        executed += 1;
    }
    executed
}

fn log(message: &str) {
    println!(
        "{} [INFO] {}",
        Local::now().format("%Y-%m-%d %H:%M:%S"),
        message
    );
}

/// Reads the recorded daemon PID, if any.
pub fn read_pid(store: &Store) -> Option<u32> {
    std::fs::read_to_string(store.pid_file())
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// What the recorded daemon state means when checked against live `/proc`.
///
/// A PID file is a claim, not a fact. ADR-2032 requires every signalling path to
/// bind identity to the intended process instance, so the daemon state is a
/// verdict with named refusals rather than a boolean.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DaemonProbe {
    /// No PID has been recorded.
    NoPidFile,
    /// The recorded PID no longer exists: the daemon has exited.
    Gone { pid: u32 },
    /// The recorded PID is live and its argv and start time match what was
    /// recorded at launch.
    Running { pid: u32 },
    /// The PID is live but no usable identity was recorded, so it cannot be
    /// bound to the daemon we started. Alive-but-unidentified: never signal it.
    Unverifiable { pid: u32, reason: String },
    /// The PID is live and is a *different* process — a recycled PID or a
    /// replaced command.
    Mismatch { pid: u32, reason: String },
    /// `/proc` could not be read, so nothing can be concluded either way.
    Inaccessible { pid: u32, reason: String },
}

impl DaemonProbe {
    /// The recorded PID, when there is one.
    pub fn pid(&self) -> Option<u32> {
        match self {
            Self::NoPidFile => None,
            Self::Gone { pid }
            | Self::Running { pid }
            | Self::Unverifiable { pid, .. }
            | Self::Mismatch { pid, .. }
            | Self::Inaccessible { pid, .. } => Some(*pid),
        }
    }

    /// True when the recorded daemon is known to be gone, so its records can be
    /// cleared and a fresh daemon started. `Inaccessible` and `Unverifiable` are
    /// deliberately *not* "gone".
    pub fn is_retired(&self) -> bool {
        matches!(self, Self::NoPidFile | Self::Gone { .. } | Self::Mismatch { .. })
    }
}

/// Checks the recorded daemon state against a given `/proc`.
pub fn probe_with(store: &Store, source: &dyn ProcSource) -> DaemonProbe {
    let Some(pid) = read_pid(store) else {
        return DaemonProbe::NoPidFile;
    };
    let Some(recorded) = store.load_identity() else {
        // No identity on file. Establish only whether something is alive at that
        // PID; it can never be signalled on this evidence.
        return match source.cmdline(pid) {
            Ok(_) => DaemonProbe::Unverifiable {
                pid,
                reason: format!(
                    "no identity recorded in {} — this daemon predates identity capture, \
                     or the record was lost",
                    store.identity_file().display()
                ),
            },
            Err(ProcError::NoSuchProcess) => DaemonProbe::Gone { pid },
            Err(e) => DaemonProbe::Inaccessible {
                pid,
                reason: e.to_string(),
            },
        };
    };
    if recorded.pid != pid {
        return DaemonProbe::Unverifiable {
            pid,
            reason: format!(
                "the recorded identity is for pid {}, but the PID file says {pid}",
                recorded.pid
            ),
        };
    }
    match process_identity::verify(source, &recorded) {
        IdentityVerdict::Match => DaemonProbe::Running { pid },
        IdentityVerdict::NoSuchProcess => DaemonProbe::Gone { pid },
        IdentityVerdict::Mismatch { reason } => DaemonProbe::Mismatch { pid, reason },
        IdentityVerdict::Inaccessible { reason } => DaemonProbe::Inaccessible { pid, reason },
    }
}

/// Checks the recorded daemon state against the real `/proc`.
pub fn probe(store: &Store) -> DaemonProbe {
    probe_with(store, &ProcFs::default())
}

/// True when a start would collide with an existing daemon.
///
/// Deliberately conservative: an unverifiable or unreadable state counts as
/// running, because starting a second daemon on top of a live one is worse than
/// declining to start. It is *not* sufficient authority to signal — only
/// [`DaemonProbe::Running`] is.
pub fn is_running(store: &Store) -> bool {
    !probe(store).is_retired()
}

/// The supervised loop the detached daemon runs. Blocks forever.
///
/// The daemon records its own identity here, from inside the exec'd process, and
/// writes the identity before the PID file. Capturing it in the parent would race
/// the exec: between `fork` and `exec` the child still shows the parent's argv,
/// so a parent-side capture can record a command that was never running.
pub fn run_loop(store: &Store) -> ! {
    let pid = std::process::id();
    match process_identity::capture(&ProcFs::default(), pid) {
        Ok(mut identity) => {
            identity.recorded_at = Some(Local::now().to_rfc3339());
            match store.save_identity(&identity) {
                Ok(()) => log(&format!("Daemon identity recorded: {}", identity.display())),
                Err(e) => log(&format!(
                    "[WARN] Could not record daemon identity ({e}); \
                     `stop` will refuse to signal this daemon"
                )),
            }
        }
        Err(e) => log(&format!(
            "[WARN] Could not read own process identity ({e}); \
             `stop` will refuse to signal this daemon"
        )),
    }
    let _ = std::fs::write(store.pid_file(), pid.to_string());
    log(&format!(
        "Scheduler daemon started (PID {pid}, tick every {TICK_INTERVAL}s)"
    ));
    loop {
        tick(store, false);
        std::thread::sleep(Duration::from_secs(TICK_INTERVAL));
    }
}

/// Detaches a daemon that runs [`run_loop`], appending its output to the log.
pub fn daemon_start(store: &Store) -> std::io::Result<()> {
    let state = probe(store);
    if !state.is_retired() {
        match &state {
            DaemonProbe::Running { pid } => println!("Scheduler already running (PID {pid})"),
            DaemonProbe::Unverifiable { pid, reason } => println!(
                "Scheduler PID {pid} is live but unverifiable ({reason}); not starting a second daemon"
            ),
            DaemonProbe::Inaccessible { pid, reason } => println!(
                "Scheduler PID {pid} state cannot be read ({reason}); not starting a second daemon"
            ),
            _ => unreachable!("retired states were excluded above"),
        }
        return Ok(());
    }
    if let DaemonProbe::Mismatch { pid, reason } = &state {
        // The PID file named a recycled PID. Clearing it here is safe precisely
        // because identity proved the daemon is gone.
        println!("Clearing stale PID file (PID {pid} is another process: {reason})");
    }
    store.clear_daemon_record();
    store.ensure_dirs()?;

    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(store.log_file())?;
    let log_err = log.try_clone()?;
    let exe = std::env::current_exe()?;

    let mut cmd = Command::new(exe);
    cmd.arg("run-loop")
        .arg("--root")
        .arg(&store.root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    // Detach from the controlling terminal so the daemon outlives the shell.
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            let _ = rustix::process::setsid();
            Ok(())
        });
    }

    let child = cmd.spawn()?;
    println!("Scheduler started (PID {})", child.id());
    println!("  Jobs: {}", store.jobs_file().display());
    println!("  Output: {}", store.output_dir().display());
    println!("  Log: {}", store.log_file().display());
    Ok(())
}

/// How long `stop` waits for a signalled daemon to actually exit.
pub const STOP_GRACE_SECS: u64 = 5;
/// How often the grace period re-checks identity.
const STOP_POLL: Duration = Duration::from_millis(100);

/// The outcome of a stop attempt.
///
/// Signal *delivery* and confirmed *shutdown* are different facts and are
/// reported as different outcomes: `kill(2)` returning `Ok` proves only that the
/// signal was queued, never that the process handled it or exited.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopOutcome {
    /// Nothing was recorded, or the recorded process is already gone.
    NotRunning { pid: Option<u32> },
    /// SIGTERM was delivered and the process was confirmed gone within the
    /// grace period.
    Exited { pid: u32, waited_ms: u64 },
    /// SIGTERM was delivered and accepted by the kernel, but the process was
    /// still running when the grace period expired.
    Signalled { pid: u32, waited_ms: u64 },
    /// The signal was refused because the PID could not be bound to the daemon
    /// that was launched.
    RefusedUnverifiable { pid: u32, reason: String },
    /// The signal was refused because the PID belongs to a different process.
    RefusedMismatch { pid: u32, reason: String },
    /// The signal was refused because `/proc` could not be read at all.
    RefusedInaccessible { pid: u32, reason: String },
    /// Identity matched but the kernel rejected the signal.
    SignalFailed { pid: u32, error: String },
}

impl StopOutcome {
    /// True when the stop attempt did what it set out to do: the daemon is gone,
    /// or was already gone, or the signal was delivered.
    pub fn is_success(&self) -> bool {
        matches!(
            self,
            Self::NotRunning { .. } | Self::Exited { .. } | Self::Signalled { .. }
        )
    }

    /// True only when the process is confirmed to have exited.
    pub fn is_confirmed_shutdown(&self) -> bool {
        matches!(self, Self::NotRunning { .. } | Self::Exited { .. })
    }

    /// The operator-facing line for this outcome.
    pub fn message(&self) -> String {
        match self {
            Self::NotRunning { .. } => "Scheduler not running".to_string(),
            Self::Exited { pid, waited_ms } => {
                format!("Scheduler stopped (PID {pid}, confirmed exited after {waited_ms}ms)")
            }
            Self::Signalled { pid, waited_ms } => format!(
                "Scheduler SIGTERM delivered (PID {pid}) but the process was still running \
                 after {waited_ms}ms — signal delivery is not confirmed shutdown; \
                 state preserved for a retry"
            ),
            Self::RefusedUnverifiable { pid, reason } => format!(
                "Scheduler stop REFUSED (PID {pid}): identity unverifiable — {reason}. \
                 Nothing was signalled. Confirm the process by hand, then remove the stale \
                 record; a daemon restarted by this version records its identity and can be \
                 stopped normally"
            ),
            Self::RefusedMismatch { pid, reason } => format!(
                "Scheduler stop REFUSED (PID {pid}): that PID is another process now — \
                 {reason}. Nothing was signalled"
            ),
            Self::RefusedInaccessible { pid, reason } => format!(
                "Scheduler stop REFUSED (PID {pid}): process state could not be read — \
                 {reason}. Nothing was signalled"
            ),
            Self::SignalFailed { pid, error } => {
                format!("Scheduler stop failed (PID {pid}): {error}; state preserved")
            }
        }
    }
}

/// Sends SIGTERM to `pid` through the real kernel.
fn sigterm(pid: u32) -> Result<(), String> {
    let raw = i32::try_from(pid)
        .ok()
        .and_then(rustix::process::Pid::from_raw)
        .ok_or_else(|| format!("PID {pid} is outside the signallable range"))?;
    rustix::process::kill_process(raw, rustix::process::Signal::Term).map_err(|e| e.to_string())
}

/// Signals the daemon to stop, and reports what actually happened.
///
/// Prints the operator-facing line and returns the outcome so a caller can set
/// an exit status. See [`daemon_stop_with`] for the behaviour.
pub fn daemon_stop(store: &Store) -> StopOutcome {
    let outcome = daemon_stop_with(
        store,
        &ProcFs::default(),
        &sigterm,
        Duration::from_secs(STOP_GRACE_SECS),
    );
    println!("{}", outcome.message());
    outcome
}

/// The stop path, with `/proc` and the signal function injected.
///
/// The sequence is deliberate:
///
/// 1. Probe the recorded state. Anything short of an identity match is a refusal
///    with a named reason; nothing is signalled.
/// 2. Re-verify identity **immediately before** the signal, not at plan time, so
///    the window in which the PID could be recycled is as narrow as the code can
///    make it.
/// 3. Send SIGTERM, then wait up to `grace`, re-verifying identity on each poll,
///    and report delivery and confirmed exit as separate outcomes.
/// 4. Remove the PID and identity records only once the daemon is confirmed gone.
///    A refusal, a failed signal, or a daemon still shutting down all keep their
///    records, because those records are what a later attempt needs.
pub fn daemon_stop_with(
    store: &Store,
    source: &dyn ProcSource,
    signal: &dyn Fn(u32) -> Result<(), String>,
    grace: Duration,
) -> StopOutcome {
    let pid = match probe_with(store, source) {
        DaemonProbe::NoPidFile => return StopOutcome::NotRunning { pid: None },
        DaemonProbe::Gone { pid } => {
            // Proven gone: clearing the record is safe and keeps `start` unblocked.
            store.clear_daemon_record();
            return StopOutcome::NotRunning { pid: Some(pid) };
        }
        DaemonProbe::Unverifiable { pid, reason } => {
            return StopOutcome::RefusedUnverifiable { pid, reason }
        }
        DaemonProbe::Mismatch { pid, reason } => {
            return StopOutcome::RefusedMismatch { pid, reason }
        }
        DaemonProbe::Inaccessible { pid, reason } => {
            return StopOutcome::RefusedInaccessible { pid, reason }
        }
        DaemonProbe::Running { pid } => pid,
    };

    // Re-check identity immediately before signalling, never on the earlier verdict.
    let Some(recorded) = store.load_identity() else {
        return StopOutcome::RefusedUnverifiable {
            pid,
            reason: "the identity record disappeared between probe and signal".to_string(),
        };
    };
    match process_identity::verify(source, &recorded) {
        IdentityVerdict::Match => {}
        IdentityVerdict::NoSuchProcess => {
            store.clear_daemon_record();
            return StopOutcome::NotRunning { pid: Some(pid) };
        }
        IdentityVerdict::Mismatch { reason } => {
            return StopOutcome::RefusedMismatch { pid, reason }
        }
        IdentityVerdict::Inaccessible { reason } => {
            return StopOutcome::RefusedInaccessible { pid, reason }
        }
    }

    if let Err(error) = signal(pid) {
        return StopOutcome::SignalFailed { pid, error };
    }

    // Delivered. Now find out whether it actually exited.
    let started = Instant::now();
    loop {
        match process_identity::verify(source, &recorded) {
            // Gone, or no longer the process we signalled: either way the daemon
            // we recorded is not running any more.
            IdentityVerdict::NoSuchProcess | IdentityVerdict::Mismatch { .. } => {
                store.clear_daemon_record();
                return StopOutcome::Exited {
                    pid,
                    waited_ms: started.elapsed().as_millis() as u64,
                };
            }
            IdentityVerdict::Inaccessible { .. } | IdentityVerdict::Match => {
                if started.elapsed() >= grace {
                    return StopOutcome::Signalled {
                        pid,
                        waited_ms: started.elapsed().as_millis() as u64,
                    };
                }
                std::thread::sleep(STOP_POLL);
            }
        }
    }
}

/// Prints daemon state plus a one-line summary of every enabled job.
pub fn daemon_status(store: &Store) {
    let state = probe(store);
    match &state {
        DaemonProbe::Running { pid } => {
            println!("Scheduler running (PID {pid}, identity verified)");
            print_job_summary(store);
        }
        DaemonProbe::Unverifiable { pid, reason } => {
            println!("Scheduler PID {pid} is live but UNVERIFIABLE — {reason}");
            println!("  `stop` will refuse to signal it; restart the daemon to record its identity");
            print_job_summary(store);
        }
        DaemonProbe::Inaccessible { pid, reason } => {
            println!("Scheduler PID {pid} state UNREADABLE — {reason}");
            print_job_summary(store);
        }
        DaemonProbe::Mismatch { pid, reason } => {
            println!("Scheduler not running (recorded PID {pid} is another process: {reason})");
            store.clear_daemon_record();
        }
        DaemonProbe::Gone { .. } | DaemonProbe::NoPidFile => {
            println!("Scheduler not running");
            store.clear_daemon_record();
        }
    }
}

fn print_job_summary(store: &Store) {
    let all = store.load();
    let enabled: Vec<_> = all.iter().filter(|j| j.enabled).collect();
    println!("  Jobs: {} enabled / {} total", enabled.len(), all.len());
    for j in enabled {
        println!(
            "  - [{}] {} | next: {} | last: {}",
            j.id,
            j.name,
            j.next_run_at.as_deref().unwrap_or("unknown"),
            j.last_status.as_deref().unwrap_or("never")
        );
    }
}

#[cfg(test)]
#[path = "stop_tests.rs"]
mod stop_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tick_lock_is_exclusive() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(".tick.lock");
        let first = TickLock::acquire(&path);
        assert!(first.is_some(), "the first tick must take the lock");
        assert!(
            TickLock::acquire(&path).is_none(),
            "a concurrent tick must be refused"
        );
        drop(first);
        assert!(
            TickLock::acquire(&path).is_some(),
            "the lock is released on drop"
        );
    }

    #[test]
    fn a_tick_with_no_jobs_executes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(tick(&Store::new(tmp.path()), false), 0);
    }

    #[test]
    fn is_running_is_false_without_a_pid_file() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!is_running(&Store::new(tmp.path())));
    }

    #[test]
    fn is_running_detects_this_live_process() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::new(tmp.path());
        store.ensure_dirs().unwrap();
        std::fs::write(store.pid_file(), std::process::id().to_string()).unwrap();
        assert_eq!(read_pid(&store), Some(std::process::id()));
        assert!(is_running(&store));
    }

    #[test]
    fn a_stale_pid_file_does_not_report_running() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::new(tmp.path());
        store.ensure_dirs().unwrap();
        // PID 0 never names a real process in /proc.
        std::fs::write(store.pid_file(), "0").unwrap();
        assert!(!is_running(&store));
    }

    #[test]
    fn a_missing_claude_binary_is_reported_not_panicked_on() {
        // Never invoke an installed provider or mutate process-global PATH.
        let tmp = tempfile::tempdir().unwrap();
        let outcome = run_job_with_cli("noop", Some("/"), &tmp.path().join("missing-claude"));
        assert!(!outcome.success);
        assert_eq!(
            outcome.error.as_deref(),
            Some("claude CLI not found in PATH")
        );
    }
}
