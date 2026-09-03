//! Locating and running child processes, under resource limits.
//!
//! Nothing on the implementation path uses this any more: `img-parts`, `lopdf`,
//! `zip` and `quick-xml` do the container work in-process. What is left needs a
//! subprocess for a real reason:
//!
//! * the pixel-domain torch harnesses in [`crate::image::harness`], which are
//!   model stacks rather than parsers;
//! * the advisory `exiftool` and `c2patool` cross-check in
//!   [`crate::image::tools`], behind the non-default `external-verify` feature.

use std::io;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use prose_sanitiser_core::env_usize;

/// Child-process resource limits (address space / output file size). A crafted
/// file must not make a child exhaust host memory or fill the disk.
fn child_rlimit_as() -> u64 {
    env_usize("WATERMARKS_CHILD_RLIMIT_AS", 4 << 30) as u64
}

fn child_rlimit_fsize() -> u64 {
    env_usize("WATERMARKS_CHILD_RLIMIT_FSIZE", 2 << 30) as u64
}

/// CtrlRegen and MarkDiffusion are torch-based and need far more address space
/// than the stdlib parsers, so they get their own env-overridable caps.
pub fn ctrlregen_rlimit_as() -> u64 {
    env_usize("WATERMARKS_CTRLREGEN_RLIMIT_AS", 32 << 30) as u64
}

pub fn ctrlregen_rlimit_fsize() -> u64 {
    env_usize("WATERMARKS_CTRLREGEN_RLIMIT_FSIZE", 2 << 30) as u64
}

/// Resource caps applied inside a child between fork and exec.
#[derive(Debug, Clone, Copy)]
pub struct Rlimits {
    pub address_space: u64,
    pub file_size: u64,
}

impl Rlimits {
    /// The conservative defaults used for the SynthID scorer and the optional
    /// `exiftool`/`c2patool` cross-check.
    pub fn default_child() -> Self {
        Self {
            address_space: child_rlimit_as(),
            file_size: child_rlimit_fsize(),
        }
    }

    /// The larger caps used for the torch harnesses.
    pub fn torch_child() -> Self {
        Self {
            address_space: ctrlregen_rlimit_as(),
            file_size: ctrlregen_rlimit_fsize(),
        }
    }
}

/// Find `name` on `PATH`, like `shutil.which`.
pub fn which(name: &str) -> Option<PathBuf> {
    if name.contains('/') {
        let path = PathBuf::from(name);
        return is_executable(&path).then_some(path);
    }
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable(candidate))
}

fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// Guard paths passed to option-parsing CLIs (exiftool, c2patool).
///
/// A filename starting with `-` would otherwise be interpreted as an option
/// (e.g. exiftool's `-@argfile`), turning a crafted filename into argv
/// injection.
pub fn safe_arg(path: &str) -> String {
    if path.starts_with('-') {
        format!("./{path}")
    } else {
        path.to_string()
    }
}

/// Hard cap on captured stdout and stderr individually, to stop a malicious
/// child from exhausting host memory through pipe output.
const MAX_OUTPUT_BYTES: usize = 64 << 20; // 64 MiB

/// Why a child run did not produce output.
#[derive(Debug)]
pub enum RunError {
    Spawn(io::Error),
    TimedOut(Duration),
    /// `setrlimit` failed in the child pre-exec hook.
    RlimitFailed(io::Error),
    /// Captured output exceeded [`MAX_OUTPUT_BYTES`].
    OutputTooLarge,
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::Spawn(error) => write!(f, "{error}"),
            RunError::TimedOut(limit) => write!(f, "timed out after {}s", limit.as_secs()),
            RunError::RlimitFailed(error) => write!(f, "setrlimit failed: {error}"),
            RunError::OutputTooLarge => {
                write!(f, "child output exceeded {} bytes", MAX_OUTPUT_BYTES)
            }
        }
    }
}

/// Run a command under `limits`, with a wall-clock `timeout` and optional stdin.
///
/// Stdout and stderr are drained concurrently on dedicated threads, so a child
/// that fills one pipe buffer cannot deadlock. The timeout covers the whole
/// operation including any stdin write, and on expiry the entire process group
/// is killed so grandchildren do not linger.
pub fn run_capture(
    program: &std::path::Path,
    args: &[String],
    limits: Rlimits,
    timeout: Duration,
    stdin_data: Option<&[u8]>,
) -> Result<Output, RunError> {
    use std::io::Write;
    use std::os::unix::process::CommandExt;

    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if stdin_data.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });

    // Start a new process group so we can kill the child and all its
    // descendants with one signal.
    // SAFETY: `setpgid(0, 0)` and `setrlimit` are async-signal-safe.
    unsafe {
        command.pre_exec(move || {
            // New process group (pgid = own pid).
            if libc::setpgid(0, 0) != 0 {
                // Not fatal: the kill will just target the child alone.
            }
            set_rlimit(libc::RLIMIT_AS, limits.address_space)?;
            set_rlimit(libc::RLIMIT_FSIZE, limits.file_size)?;
            Ok(())
        });
    }

    let started = Instant::now();
    let mut child = command.spawn().map_err(RunError::Spawn)?;

    // Feed stdin on this thread (bounded by the data the caller provided).
    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            // A child that exits before reading everything is not an error here;
            // its exit status and output are what the caller inspects.
            let _ = stdin.write_all(data);
        }
        // Drop stdin so the child sees EOF.
    }

    // Drain stdout and stderr concurrently on separate threads, each capped.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let stdout_handle = std::thread::spawn(move || drain_capped(stdout_pipe, MAX_OUTPUT_BYTES));
    let stderr_handle = std::thread::spawn(move || drain_capped(stderr_pipe, MAX_OUTPUT_BYTES));

    // Wait for exit with a timeout.
    let status = loop {
        match child.try_wait().map_err(RunError::Spawn)? {
            Some(status) => break status,
            None => {
                if started.elapsed() >= timeout {
                    kill_group(&child);
                    let _ = child.wait();
                    return Err(RunError::TimedOut(timeout));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    };

    let stdout = stdout_handle.join().map_err(|_| {
        RunError::Spawn(io::Error::other("stdout reader panicked"))
    })??;
    let stderr = stderr_handle.join().map_err(|_| {
        RunError::Spawn(io::Error::other("stderr reader panicked"))
    })??;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

/// Read up to `cap` bytes from a pipe, returning an error if exceeded.
fn drain_capped(
    pipe: Option<impl io::Read>,
    cap: usize,
) -> Result<Vec<u8>, RunError> {
    let Some(mut reader) = pipe else {
        return Ok(Vec::new());
    };
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = reader.read(&mut chunk).map_err(RunError::Spawn)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > cap {
            return Err(RunError::OutputTooLarge);
        }
    }
    Ok(buffer)
}

/// Kill the child's entire process group (child + any grandchildren).
fn kill_group(child: &std::process::Child) {
    let pid = child.id() as libc::pid_t;
    // SAFETY: `kill(-pid, SIGKILL)` sends SIGKILL to the process group.
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
    }
}

/// `setrlimit` with error propagation. Returns `Err` if the kernel refuses.
fn set_rlimit(resource: u32, value: u64) -> io::Result<()> {
    let limit = libc::rlimit {
        rlim_cur: value as libc::rlim_t,
        rlim_max: value as libc::rlim_t,
    };
    // SAFETY: `limit` is a fully initialised, correctly typed rlimit.
    let result = unsafe { libc::setrlimit(resource, &limit) };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_arg_neutralises_leading_dashes() {
        assert_eq!(safe_arg("-@argfile"), "./-@argfile");
        assert_eq!(safe_arg("normal.png"), "normal.png");
        assert_eq!(safe_arg("./already"), "./already");
    }

    #[test]
    fn which_finds_a_real_binary_and_misses_a_fake_one() {
        assert!(which("sh").is_some());
        assert!(which("definitely-not-a-real-binary-9f3a").is_none());
    }

    #[test]
    fn run_capture_collects_output_and_honours_stdin() {
        let sh = which("sh").unwrap();
        let output = run_capture(
            &sh,
            &["-c".into(), "cat; echo tail".into()],
            Rlimits::default_child(),
            Duration::from_secs(30),
            Some(b"head\n"),
        )
        .unwrap();
        assert_eq!(String::from_utf8_lossy(&output.stdout), "head\ntail\n");
    }

    #[test]
    fn run_capture_times_out_a_hung_child() {
        let sh = which("sh").unwrap();
        let error = run_capture(
            &sh,
            &["-c".into(), "sleep 30".into()],
            Rlimits::default_child(),
            Duration::from_millis(200),
            None,
        )
        .unwrap_err();
        assert!(matches!(error, RunError::TimedOut(_)));
    }

    #[test]
    fn run_capture_does_not_deadlock_on_large_stdout() {
        // Produce more than the default 64 KiB pipe buffer on stdout.
        let sh = which("sh").unwrap();
        let output = run_capture(
            &sh,
            &[
                "-c".into(),
                "dd if=/dev/zero bs=1024 count=256 2>/dev/null".into(),
            ],
            Rlimits::default_child(),
            Duration::from_secs(10),
            None,
        )
        .unwrap();
        assert_eq!(output.stdout.len(), 256 * 1024);
    }

    #[test]
    fn run_capture_kills_grandchildren_on_timeout() {
        // The shell spawns a sub-shell; the timeout must kill the whole group.
        let sh = which("sh").unwrap();
        let error = run_capture(
            &sh,
            &["-c".into(), "(sleep 60)".into()],
            Rlimits::default_child(),
            Duration::from_millis(200),
            None,
        )
        .unwrap_err();
        assert!(matches!(error, RunError::TimedOut(_)));
    }
}
