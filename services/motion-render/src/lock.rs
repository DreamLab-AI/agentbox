//! One render at a time from this container.
//!
//! Two renders would fight over the sidecar's GPU and double every frame time. The lock is a
//! pid file, so it is local: it cannot see another container, or an agent driving the same
//! Chrome through an MCP server. The private browser context keeps those apart, not this.

use anyhow::{bail, Context, Result};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Held for the life of a render; removes the lock file on drop if it is still ours.
#[derive(Debug)]
pub struct Guard {
    path: PathBuf,
    pid: u32,
}

/// Default lock path: `$XDG_RUNTIME_DIR` when set, else the system temp directory.
pub fn default_path() -> PathBuf {
    let dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    dir.join("motion-designer-render.lock")
}

fn holder(path: &Path) -> Option<u32> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

/// Whether a process with this pid exists, whoever owns it.
fn alive(pid: u32) -> bool {
    Path::new("/proc").join(pid.to_string()).exists()
}

/// Take the lock, clearing one left by a process that no longer exists.
pub fn acquire(path: &Path) -> Result<Guard> {
    let pid = std::process::id();
    for _ in 0..2 {
        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(mut f) => {
                write!(f, "{pid}").with_context(|| format!("cannot write {}", path.display()))?;
                drop(f);
                // Two runs clearing the same stale lock can each delete the other's: settle,
                // then confirm the file still names this process.
                std::thread::sleep(std::time::Duration::from_millis(100));
                if holder(path) == Some(pid) {
                    return Ok(Guard { path: path.to_path_buf(), pid });
                }
                bail!("another render took the lock at the same moment. Run again when it finishes.");
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => match holder(path) {
                Some(other) if alive(other) => {
                    bail!("another render is running (pid {other}). Wait for it, or remove {} if that process is gone.", path.display())
                }
                _ => {
                    let _ = fs::remove_file(path);
                }
            },
            Err(e) => return Err(e).with_context(|| format!("cannot create {}", path.display())),
        }
    }
    bail!("cannot take the render lock {}", path.display())
}

impl Drop for Guard {
    fn drop(&mut self) {
        if holder(&self.path) == Some(self.pid) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_releases_and_refuses_a_live_holder() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("l.lock");
        let g = acquire(&p).unwrap();
        assert_eq!(holder(&p), Some(std::process::id()));
        // This process is alive, so a second acquire is refused.
        let err = acquire(&p).unwrap_err().to_string();
        assert!(err.contains("another render is running"), "{err}");
        drop(g);
        assert!(!p.exists());
    }

    #[test]
    fn clears_a_lock_left_by_a_dead_process_or_holding_garbage() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("l.lock");
        // No live process has this pid: pid_max on Linux is at most 2^22.
        fs::write(&p, "4194999").unwrap();
        drop(acquire(&p).unwrap());
        fs::write(&p, "not a pid").unwrap();
        drop(acquire(&p).unwrap());
        assert!(!p.exists());
    }

    #[test]
    fn drop_leaves_a_lock_that_is_no_longer_ours() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("l.lock");
        let g = acquire(&p).unwrap();
        fs::write(&p, "1").unwrap();
        drop(g);
        assert!(p.exists());
    }
}
