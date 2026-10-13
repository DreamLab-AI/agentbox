//! Idle Cargo `target/` directory sweeper.
//!
//! Agents build in many worktrees and scratch directories, and every build
//! leaves a `target/` that is regenerable but can reach tens of gigabytes. This
//! module finds those directories and removes the idle ones. It is the logic
//! behind the `target-gc` binary; the binary is read-only unless it is told to
//! delete.
//!
//! A directory is deleted only when every check passes:
//!
//! 1. **It is a Cargo target directory.** `CACHEDIR.TAG` carries the standard
//!    signature, and either `.rustc_info.json` exists or a profile directory
//!    holds a `.fingerprint` directory. Other tools write `CACHEDIR.TAG` too,
//!    so the tag alone is not enough.
//! 2. **No build is using it.** Cargo holds an exclusive `flock` on
//!    `.cargo-lock` for the whole of a build; a non-blocking probe on every
//!    such file near the top of the tree must succeed.
//! 3. **It is idle.** Nothing within three levels has been modified for the
//!    configured age.
//!
//! Symlinks are never followed, `.git` and `node_modules` are never entered,
//! and a found target directory is not searched for nested ones.

use rustix::fs::{flock, FlockOperation};
use rustix::io::Errno;
use serde::Serialize;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// First line of every `CACHEDIR.TAG` file, from the Cache Directory Tagging spec.
const CACHEDIR_SIGNATURE: &str = "Signature: 8a477f597d28d172789f06886806bc55";

/// Directory names that are never entered while searching for targets.
const SKIPPED_DIRS: [&str; 2] = [".git", "node_modules"];

/// How deep below a target directory the idle check and lock probe look.
const PROBE_DEPTH: usize = 3;

/// Default workspace root searched when the manifest names none.
pub const DEFAULT_ROOT: &str = "/home/devuser/workspace";

/// What to search, what to leave alone, and how idle a directory must be.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    /// Directories searched for Cargo targets.
    pub roots: Vec<PathBuf>,
    /// Paths (and everything below them) that are never touched.
    pub exclude: Vec<PathBuf>,
    /// A target modified more recently than this is kept.
    pub max_age: Duration,
    /// Seconds between passes in `--loop` mode.
    pub interval_secs: u64,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            roots: vec![PathBuf::from(DEFAULT_ROOT)],
            exclude: vec![PathBuf::from(DEFAULT_ROOT).join("project")],
            max_age: Duration::from_secs(7 * 86_400),
            interval_secs: 21_600,
        }
    }
}

impl Policy {
    /// Reads `[resources.target_gc]` from manifest text; absent keys keep their defaults.
    ///
    /// Unparseable text yields the defaults, so a broken manifest never widens the sweep.
    pub fn from_manifest(text: &str) -> Self {
        let mut policy = Self::default();
        let Ok(doc) = text.parse::<toml::Table>() else {
            return policy;
        };
        let Some(section) = doc
            .get("resources")
            .and_then(|r| r.get("target_gc"))
            .and_then(|t| t.as_table())
        else {
            return policy;
        };
        let paths = |key: &str| -> Option<Vec<PathBuf>> {
            let list = section.get(key)?.as_array()?;
            Some(
                list.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|s| s.starts_with('/'))
                    .map(PathBuf::from)
                    .collect(),
            )
        };
        if let Some(roots) = paths("roots") {
            policy.roots = roots;
        }
        if let Some(exclude) = paths("exclude") {
            policy.exclude = exclude;
        }
        if let Some(days) = section.get("max_age_days").and_then(|v| v.as_integer()) {
            policy.max_age = Duration::from_secs(days.max(0) as u64 * 86_400);
        }
        if let Some(secs) = section.get("interval_secs").and_then(|v| v.as_integer()) {
            policy.interval_secs = secs.max(60) as u64;
        }
        policy
    }
}

/// What the sweep decided for one target directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// Idle and unlocked: removed (or would be, in a read-only pass).
    Delete,
    /// Modified more recently than the policy allows.
    KeepRecent,
    /// A Cargo build holds, or may hold, a lock inside it.
    KeepBusy,
}

/// One target directory and the decision made for it.
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    /// Absolute path of the target directory.
    pub path: PathBuf,
    /// Disk blocks used, in bytes.
    pub bytes: u64,
    /// Whole days since anything within the probe depth changed.
    pub idle_days: u64,
    /// The decision.
    pub verdict: Verdict,
    /// True only if the directory was actually removed.
    pub removed: bool,
}

/// Result of one pass.
#[derive(Debug, Default, Serialize)]
pub struct Report {
    /// Every verified target directory found, largest first.
    pub entries: Vec<Entry>,
    /// Bytes reclaimed by removals that succeeded.
    pub reclaimed_bytes: u64,
    /// Bytes a read-only pass would reclaim, or that failed to remove.
    pub reclaimable_bytes: u64,
    /// Removals that failed, as `path: error`.
    pub errors: Vec<String>,
}

/// True if `dir` is a Cargo target directory rather than some other cache.
pub fn is_cargo_target(dir: &Path) -> bool {
    let tag = dir.join("CACHEDIR.TAG");
    let tagged = fs::symlink_metadata(&tag).map(|m| m.is_file()).unwrap_or(false)
        && fs::read_to_string(&tag)
            .map(|t| t.starts_with(CACHEDIR_SIGNATURE))
            .unwrap_or(false);
    if !tagged {
        return false;
    }
    if dir.join(".rustc_info.json").is_file() {
        return true;
    }
    let Ok(children) = fs::read_dir(dir) else {
        return false;
    };
    children
        .flatten()
        .filter(|c| c.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .any(|c| c.path().join(".fingerprint").is_dir())
}

/// Finds verified Cargo target directories under `roots`, skipping `exclude`.
pub fn discover(roots: &[PathBuf], exclude: &[PathBuf]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack: Vec<PathBuf> = roots.to_vec();
    while let Some(dir) = stack.pop() {
        if exclude.iter().any(|x| dir.starts_with(x)) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&dir) else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        if is_cargo_target(&dir) {
            found.push(dir);
            continue;
        }
        let Ok(children) = fs::read_dir(&dir) else {
            continue;
        };
        for child in children.flatten() {
            let name = child.file_name();
            let skipped = name
                .to_str()
                .map(|n| SKIPPED_DIRS.contains(&n))
                .unwrap_or(false);
            if !skipped && child.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push(child.path());
            }
        }
    }
    found.sort();
    found
}

/// Disk bytes used under `dir`, counting allocated blocks and not following symlinks.
pub fn disk_usage(dir: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(children) = fs::read_dir(&d) else {
            continue;
        };
        for child in children.flatten() {
            let Ok(meta) = fs::symlink_metadata(child.path()) else {
                continue;
            };
            total += meta.blocks() * 512;
            if meta.is_dir() {
                stack.push(child.path());
            }
        }
    }
    total
}

/// Newest modification time within `PROBE_DEPTH` levels of `dir`, `dir` itself included.
pub fn newest_mtime(dir: &Path) -> Option<SystemTime> {
    let mut newest = fs::symlink_metadata(dir).and_then(|m| m.modified()).ok()?;
    let mut level = vec![dir.to_path_buf()];
    for _ in 0..PROBE_DEPTH {
        let mut next = Vec::new();
        for d in &level {
            let Ok(children) = fs::read_dir(d) else {
                continue;
            };
            for child in children.flatten() {
                let Ok(meta) = fs::symlink_metadata(child.path()) else {
                    continue;
                };
                if let Ok(m) = meta.modified() {
                    newest = newest.max(m);
                }
                if meta.is_dir() {
                    next.push(child.path());
                }
            }
        }
        level = next;
    }
    Some(newest)
}

/// Collects `.cargo-lock` files within two levels of `dir` (`target/<profile>` and
/// `target/<triple>/<profile>`), plus any at the root.
fn lock_files(dir: &Path) -> Vec<PathBuf> {
    let mut locks = vec![dir.join(".cargo-lock")];
    let mut level = vec![dir.to_path_buf()];
    for _ in 0..2 {
        let mut next = Vec::new();
        for d in &level {
            let Ok(children) = fs::read_dir(d) else {
                continue;
            };
            for child in children.flatten() {
                if child.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    locks.push(child.path().join(".cargo-lock"));
                    next.push(child.path());
                }
            }
        }
        level = next;
    }
    locks.retain(|p| fs::symlink_metadata(p).map(|m| m.is_file()).unwrap_or(false));
    locks
}

/// True if a Cargo build holds a lock under `dir`.
///
/// Cargo takes an exclusive `flock` on `.cargo-lock` for a whole build, so a
/// non-blocking exclusive attempt fails with `EWOULDBLOCK` while one runs. A lock
/// file that cannot be opened or probed is treated as held: the safe answer.
pub fn is_locked(dir: &Path) -> bool {
    for path in lock_files(dir) {
        let Ok(file) = fs::File::open(&path) else {
            return true;
        };
        match flock(&file, FlockOperation::NonBlockingLockExclusive) {
            Ok(()) => {}
            Err(Errno::WOULDBLOCK) => return true,
            Err(_) => return true,
        }
    }
    false
}

/// Runs one pass over `policy`, removing idle targets only when `delete` is true.
///
/// The idle check and lock probe are repeated immediately before each removal, so
/// a build that starts while the pass is running keeps its directory.
pub fn sweep(policy: &Policy, delete: bool, now: SystemTime) -> Report {
    let mut report = Report::default();
    for path in discover(&policy.roots, &policy.exclude) {
        let idle = newest_mtime(&path)
            .and_then(|m| now.duration_since(m).ok())
            .unwrap_or_default();
        let bytes = disk_usage(&path);
        let verdict = if idle < policy.max_age {
            Verdict::KeepRecent
        } else if is_locked(&path) {
            Verdict::KeepBusy
        } else {
            Verdict::Delete
        };
        let mut removed = false;
        if verdict == Verdict::Delete {
            if delete {
                let still_idle = newest_mtime(&path)
                    .and_then(|m| now.duration_since(m).ok())
                    .map(|d| d >= policy.max_age)
                    .unwrap_or(false);
                if still_idle && !is_locked(&path) {
                    match fs::remove_dir_all(&path) {
                        Ok(()) => {
                            removed = true;
                            report.reclaimed_bytes += bytes;
                        }
                        Err(e) => {
                            report.errors.push(format!("{}: {e}", path.display()));
                            report.reclaimable_bytes += bytes;
                        }
                    }
                }
            } else {
                report.reclaimable_bytes += bytes;
            }
        }
        report.entries.push(Entry {
            path,
            bytes,
            idle_days: idle.as_secs() / 86_400,
            verdict,
            removed,
        });
    }
    report.entries.sort_by_key(|e| std::cmp::Reverse(e.bytes));
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_target(dir: &Path) {
        fs::create_dir_all(dir.join("debug/.fingerprint")).unwrap();
        fs::write(dir.join("CACHEDIR.TAG"), format!("{CACHEDIR_SIGNATURE}\n# cargo\n")).unwrap();
        fs::write(dir.join("debug/.cargo-lock"), "").unwrap();
        fs::write(dir.join("debug/artefact"), vec![0u8; 8192]).unwrap();
    }

    fn policy(root: &Path) -> Policy {
        Policy {
            roots: vec![root.to_path_buf()],
            exclude: vec![],
            max_age: Duration::from_secs(86_400),
            interval_secs: 60,
        }
    }

    /// A pass far enough in the future that everything counts as idle.
    fn later() -> SystemTime {
        SystemTime::now() + Duration::from_secs(30 * 86_400)
    }

    #[test]
    fn a_cargo_target_is_recognised_and_other_caches_are_not() {
        let tmp = tempfile::tempdir().unwrap();
        make_target(&tmp.path().join("a/target"));
        let other = tmp.path().join("b/cache");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("CACHEDIR.TAG"), CACHEDIR_SIGNATURE).unwrap();
        let wrong_tag = tmp.path().join("c/target");
        make_target(&wrong_tag);
        fs::write(wrong_tag.join("CACHEDIR.TAG"), "Signature: something-else").unwrap();

        assert!(is_cargo_target(&tmp.path().join("a/target")));
        assert!(!is_cargo_target(&other), "a tag with no Cargo content is not a target");
        assert!(!is_cargo_target(&wrong_tag), "the signature must match");
        assert_eq!(discover(&[tmp.path().to_path_buf()], &[]), vec![tmp.path().join("a/target")]);
    }

    #[test]
    fn a_read_only_pass_deletes_nothing_and_reports_the_reclaimable_size() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("p/target");
        make_target(&target);

        let report = sweep(&policy(tmp.path()), false, later());

        assert!(target.exists(), "no delete flag, no deletion");
        assert_eq!(report.entries.len(), 1);
        assert_eq!(report.entries[0].verdict, Verdict::Delete);
        assert!(!report.entries[0].removed);
        assert!(report.reclaimable_bytes >= 8192);
        assert_eq!(report.reclaimed_bytes, 0);
    }

    #[test]
    fn an_idle_target_is_removed_and_its_siblings_are_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("p/target");
        make_target(&target);
        fs::write(tmp.path().join("p/Cargo.toml"), "[package]").unwrap();

        let report = sweep(&policy(tmp.path()), true, later());

        assert!(!target.exists());
        assert!(tmp.path().join("p/Cargo.toml").exists(), "only the target goes");
        assert!(report.entries[0].removed);
        assert!(report.reclaimed_bytes >= 8192);
        assert!(report.errors.is_empty());
    }

    #[test]
    fn a_recently_modified_target_is_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("p/target");
        make_target(&target);

        let report = sweep(&policy(tmp.path()), true, SystemTime::now());

        assert!(target.exists());
        assert_eq!(report.entries[0].verdict, Verdict::KeepRecent);
    }

    #[test]
    fn a_target_with_a_held_cargo_lock_is_kept_even_when_idle() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("p/target");
        make_target(&target);
        let holder = fs::File::open(target.join("debug/.cargo-lock")).unwrap();
        flock(&holder, FlockOperation::NonBlockingLockExclusive).expect("test takes the lock");

        let report = sweep(&policy(tmp.path()), true, later());

        assert!(target.exists(), "a running build keeps its directory");
        assert_eq!(report.entries[0].verdict, Verdict::KeepBusy);
        drop(holder);
        assert!(!is_locked(&target), "released locks are no longer busy");
    }

    #[test]
    fn excluded_paths_are_not_searched() {
        let tmp = tempfile::tempdir().unwrap();
        make_target(&tmp.path().join("project/target"));
        make_target(&tmp.path().join("other/target"));
        let mut p = policy(tmp.path());
        p.exclude = vec![tmp.path().join("project")];

        let report = sweep(&p, true, later());

        assert!(tmp.path().join("project/target").exists());
        assert!(!tmp.path().join("other/target").exists());
        assert_eq!(report.entries.len(), 1);
    }

    #[test]
    fn symlinks_are_not_followed() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        make_target(&outside.path().join("target"));
        std::os::unix::fs::symlink(outside.path(), tmp.path().join("link")).unwrap();

        let report = sweep(&policy(tmp.path()), true, later());

        assert!(outside.path().join("target").exists(), "a link out of the root is not entered");
        assert!(report.entries.is_empty());
    }

    #[test]
    fn nested_targets_are_not_searched_for_and_skipped_dirs_are_not_entered() {
        let tmp = tempfile::tempdir().unwrap();
        make_target(&tmp.path().join("p/target"));
        make_target(&tmp.path().join("p/target/inner"));
        make_target(&tmp.path().join("node_modules/pkg/target"));
        make_target(&tmp.path().join(".git/x/target"));

        let found = discover(&[tmp.path().to_path_buf()], &[]);

        assert_eq!(found, vec![tmp.path().join("p/target")]);
    }

    #[test]
    fn the_manifest_sets_the_policy_and_a_broken_one_keeps_the_defaults() {
        let p = Policy::from_manifest(
            "[resources.target_gc]\nroots=[\"/w\",\"relative\"]\nexclude=[\"/w/keep\"]\nmax_age_days=3\ninterval_secs=5\n",
        );
        assert_eq!(p.roots, vec![PathBuf::from("/w")], "relative roots are dropped");
        assert_eq!(p.exclude, vec![PathBuf::from("/w/keep")]);
        assert_eq!(p.max_age, Duration::from_secs(3 * 86_400));
        assert_eq!(p.interval_secs, 60, "the interval has a floor");

        assert_eq!(Policy::from_manifest("not = [toml"), Policy::default());
        assert_eq!(Policy::from_manifest("[other]\nx=1\n"), Policy::default());
        assert!(Policy::default().exclude.iter().any(|x| x.ends_with("project")));
    }
}
