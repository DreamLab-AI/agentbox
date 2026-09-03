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

/// Why a child run did not produce output.
#[derive(Debug)]
pub enum RunError {
    Spawn(io::Error),
    TimedOut(Duration),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::Spawn(error) => write!(f, "{error}"),
            RunError::TimedOut(limit) => write!(f, "timed out after {}s", limit.as_secs()),
        }
    }
}

/// Run a command under `limits`, with a wall-clock `timeout` and optional stdin.
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
    unsafe {
        command.pre_exec(move || {
            set_rlimit(libc::RLIMIT_AS, limits.address_space);
            set_rlimit(libc::RLIMIT_FSIZE, limits.file_size);
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(RunError::Spawn)?;
    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            // A child that exits before reading everything is not an error here;
            // its exit status and output are what the caller inspects.
            let _ = stdin.write_all(data);
        }
    }

    let started = Instant::now();
    loop {
        match child.try_wait().map_err(RunError::Spawn)? {
            Some(_) => {
                return child.wait_with_output().map_err(RunError::Spawn);
            }
            None => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(RunError::TimedOut(timeout));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

/// Best-effort `setrlimit`; a platform that refuses simply runs unlimited, as
/// the Python's `except (ImportError, OSError, ValueError): pass` did.
fn set_rlimit(resource: u32, value: u64) {
    let limit = libc::rlimit {
        rlim_cur: value as libc::rlim_t,
        rlim_max: value as libc::rlim_t,
    };
    // SAFETY: `limit` is a fully initialised, correctly typed rlimit.
    unsafe {
        libc::setrlimit(resource, &limit);
    }
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
}
