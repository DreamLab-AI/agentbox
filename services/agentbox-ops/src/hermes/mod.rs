//! Hermes scheduler — a background cron daemon for Claude Code agent tasks.
//!
//! Ported from `skills/hermes-scheduler/scripts/scheduler.py`. Jobs live in
//! `~/.claude/scheduler/jobs.json`, output under `~/.claude/scheduler/output/`,
//! and each due job is dispatched as `claude --print "<prompt>"`.

pub mod jobs;
pub mod schedule;

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

/// True when the recorded PID is a live process.
pub fn is_running(store: &Store) -> bool {
    let Some(pid) = read_pid(store) else {
        return false;
    };
    Path::new(&format!("/proc/{pid}")).exists()
}

/// The supervised loop the detached daemon runs. Blocks forever.
pub fn run_loop(store: &Store) -> ! {
    let _ = std::fs::write(store.pid_file(), std::process::id().to_string());
    log(&format!(
        "Scheduler daemon started (PID {}, tick every {TICK_INTERVAL}s)",
        std::process::id()
    ));
    loop {
        tick(store, false);
        std::thread::sleep(Duration::from_secs(TICK_INTERVAL));
    }
}

/// Detaches a daemon that runs [`run_loop`], appending its output to the log.
pub fn daemon_start(store: &Store) -> std::io::Result<()> {
    if is_running(store) {
        println!(
            "Scheduler already running (PID {})",
            read_pid(store).unwrap_or(0)
        );
        return Ok(());
    }
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

/// Signals the daemon to stop and clears a stale PID file.
pub fn daemon_stop(store: &Store) {
    let pid = read_pid(store);
    if pid.is_none() || !is_running(store) {
        println!("Scheduler not running");
        let _ = std::fs::remove_file(store.pid_file());
        return;
    }
    let pid = pid.unwrap();
    let signalled = rustix::process::kill_process(
        rustix::process::Pid::from_raw(pid as i32).expect("a live PID is non-zero"),
        rustix::process::Signal::Term,
    );
    match signalled {
        Ok(()) => println!("Scheduler stopped (PID {pid})"),
        Err(e) => println!("Scheduler stop failed (PID {pid}): {e}"),
    }
    let _ = std::fs::remove_file(store.pid_file());
}

/// Prints daemon state plus a one-line summary of every enabled job.
pub fn daemon_status(store: &Store) {
    match (read_pid(store), is_running(store)) {
        (Some(pid), true) => {
            let all = store.load();
            let enabled: Vec<_> = all.iter().filter(|j| j.enabled).collect();
            println!("Scheduler running (PID {pid})");
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
        _ => {
            println!("Scheduler not running");
            let _ = std::fs::remove_file(store.pid_file());
        }
    }
}

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
