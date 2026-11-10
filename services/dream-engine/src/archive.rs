//! End-of-night archive: commit and push the artefact directory when it is a git checkout.
//!
//! The artefact directory may be the checkout of a private archive repository.
//! When it is the top of its own git work tree and has a remote, the night ends
//! by staging everything its `.gitignore` admits, committing it with a message
//! naming the night date and the number of repositories dreamed, and pushing
//! to the checkout's upstream (or, with no upstream, its single remote). The
//! remote is whatever the checkout has; nothing here names one.
//!
//! The step is fail-open. A failed commit or push is returned as
//! [`ArchiveOutcome::Failed`], which the engine logs and raises as an inbox
//! alert; it never aborts the night. It never force-pushes: a rejected push
//! leaves the local commit in place for the next night (or the operator) to
//! push once the histories are reconciled. A directory that is not a git work
//! tree, or one without a remote, is left completely alone.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Longest a local git step (status, add, commit) may run.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(120);
/// Longest the push may run before it is killed and reported as failed.
const PUSH_TIMEOUT: Duration = Duration::from_secs(300);
/// How often a running git command is polled for completion.
const POLL: Duration = Duration::from_millis(50);

/// The git identity the engine commits under, from `[dream_machine]`
/// `git_author_name` and `git_author_email`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitIdentity {
    /// Author and committer name.
    pub name: String,
    /// Author and committer email.
    pub email: String,
}

/// The configuration keys that supply [`GitIdentity`], for messages that say
/// what is missing.
pub const IDENTITY_KEYS: &str = "[dream_machine].git_author_name and git_author_email";

impl GitIdentity {
    /// The identity when both parts are present and non-blank.
    pub fn from_parts(name: Option<&str>, email: Option<&str>) -> Option<Self> {
        let name = name.map(str::trim).filter(|s| !s.is_empty())?;
        let email = email.map(str::trim).filter(|s| !s.is_empty())?;
        Some(GitIdentity {
            name: name.to_string(),
            email: email.to_string(),
        })
    }

    /// The environment that makes every git commit the process spawns use this
    /// identity, including commits made inside `dream-core` (candidate
    /// worktrees, ledger rows), which take no identity argument.
    pub fn env(&self) -> [(&'static str, &str); 4] {
        [
            ("GIT_AUTHOR_NAME", self.name.as_str()),
            ("GIT_AUTHOR_EMAIL", self.email.as_str()),
            ("GIT_COMMITTER_NAME", self.name.as_str()),
            ("GIT_COMMITTER_EMAIL", self.email.as_str()),
        ]
    }
}

/// What the end-of-night archive step did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchiveOutcome {
    /// The directory is not the top of its own git work tree; nothing done.
    NotARepository,
    /// The directory is a work tree with no remote; nothing done.
    NoRemote,
    /// Pushed. `commit` is tonight's short commit id, or `None` when there was
    /// nothing new to commit (the push then only carries earlier commits).
    Archived {
        /// Tonight's commit, when there was anything to commit.
        commit: Option<String>,
        /// Where it was pushed: the upstream (`origin/main`) or the remote.
        pushed_to: String,
    },
    /// A step failed. Whatever earlier steps did stays done: a commit made
    /// before a failed push is kept, and `commit` names it.
    Failed {
        /// The failing step: `branch`, `remote`, `add`, `status`, `commit` or `push`.
        step: &'static str,
        /// git's message, or why the step could not run.
        detail: String,
        /// Tonight's commit, when the failure came after it.
        commit: Option<String>,
    },
}

impl ArchiveOutcome {
    /// The inbox alert for a failed archive, in plain English; `None` for
    /// every other outcome.
    pub fn alert(&self, dir: &Path) -> Option<String> {
        let ArchiveOutcome::Failed {
            step,
            detail,
            commit,
        } = self
        else {
            return None;
        };
        let kept = match commit {
            Some(id) => {
                format!(" Tonight's artefacts are committed locally as {id} but not pushed.")
            }
            None => " Tonight's artefacts are on disk but not committed.".to_string(),
        };
        Some(format!(
            "The dream artefact archive at {} was not archived: the {step} step failed ({}).{kept} \
             The night itself completed, and the next night retries. Reconcile the checkout by \
             hand if the remote has moved on; never force-push it.",
            dir.display(),
            one_line(detail)
        ))
    }
}

/// The commit message for a night: its date and how many repositories it dreamed.
pub fn commit_message(date: &str, repos: usize) -> String {
    let noun = if repos == 1 {
        "repository"
    } else {
        "repositories"
    };
    format!("dream night {date}: artefacts of {repos} {noun}")
}

fn one_line(s: &str) -> String {
    let joined = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = joined.chars().take(300).collect();
    if joined.chars().count() > 300 {
        out.push('…');
    }
    out
}

/// The result of one git invocation.
struct GitRun {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl GitRun {
    fn message(&self) -> String {
        let text = if self.stderr.trim().is_empty() {
            &self.stdout
        } else {
            &self.stderr
        };
        match (text.trim().is_empty(), self.code) {
            (false, _) => text.trim().to_string(),
            (true, Some(c)) => format!("git exited {c}"),
            (true, None) => "git was killed".to_string(),
        }
    }
}

/// Run `git -C dir <args>` non-interactively, killing it after `timeout`.
fn git(dir: &Path, args: &[&str], timeout: Duration) -> Result<GitRun, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        // A push must fail, not wait for a passphrase or host-key prompt.
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    let mut child = cmd.spawn().map_err(|e| format!("cannot run git: {e}"))?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_string(&mut buf);
            }
            buf
        })
    };
    let out = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "git {} timed out after {}s",
                    args.first().copied().unwrap_or(""),
                    timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(POLL),
            Err(e) => return Err(format!("waiting for git: {e}")),
        }
    };
    Ok(GitRun {
        success: status.success(),
        code: status.code(),
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
    })
}

/// True when `dir` is the top level of its own git work tree, so a commit
/// there cannot land in an enclosing repository instead. Symlinks resolve.
pub fn is_own_work_tree(dir: &Path) -> bool {
    let Ok(run) = git(dir, &["rev-parse", "--show-toplevel"], LOCAL_TIMEOUT) else {
        return false;
    };
    if !run.success {
        return false;
    }
    let top = PathBuf::from(run.stdout.trim());
    match (top.canonicalize(), dir.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Where a plain push goes: the branch's upstream, or the single remote.
enum PushTarget {
    Upstream(String),
    Remote(String),
}

fn failed(step: &'static str, detail: String, commit: Option<String>) -> ArchiveOutcome {
    ArchiveOutcome::Failed {
        step,
        detail,
        commit,
    }
}

/// Commit and push the artefact directory at the end of a night.
///
/// Does nothing unless `dir` is the top of its own git work tree with at least
/// one remote. Stages with `git add -A` (the checkout's `.gitignore` decides
/// what is archived), commits only when something is staged, and pushes
/// without force: to the branch's upstream when it has one, else to the single
/// remote under the current branch name. Never panics and never returns an
/// error; failures come back as [`ArchiveOutcome::Failed`].
///
/// With `identity`, the commit is made under it explicitly (`-c user.name`,
/// `-c user.email`), whatever the checkout or the account configures. Without
/// one, the checkout's own identity is used, and a commit that fails for want
/// of one names the configuration keys to set ([`IDENTITY_KEYS`]).
pub fn archive_night(
    dir: &Path,
    date: &str,
    repos: usize,
    identity: Option<&GitIdentity>,
) -> ArchiveOutcome {
    if !is_own_work_tree(dir) {
        return ArchiveOutcome::NotARepository;
    }
    let remotes = match git(dir, &["remote"], LOCAL_TIMEOUT) {
        Ok(r) if r.success => r
            .stdout
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect::<Vec<_>>(),
        Ok(r) => return failed("remote", r.message(), None),
        Err(e) => return failed("remote", e, None),
    };
    if remotes.is_empty() {
        return ArchiveOutcome::NoRemote;
    }
    let branch = match git(
        dir,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        LOCAL_TIMEOUT,
    ) {
        Ok(r) if r.success => r.stdout.trim().to_string(),
        Ok(_) => {
            return failed(
                "branch",
                "HEAD is detached; check out the archive branch".into(),
                None,
            )
        }
        Err(e) => return failed("branch", e, None),
    };
    let upstream = git(
        dir,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        LOCAL_TIMEOUT,
    )
    .ok()
    .filter(|r| r.success)
    .map(|r| r.stdout.trim().to_string())
    .filter(|u| !u.is_empty());
    let target = match (upstream, remotes.as_slice()) {
        (Some(u), _) => PushTarget::Upstream(u),
        (None, [only]) => PushTarget::Remote(only.clone()),
        (None, many) => {
            return failed(
                "push",
                format!(
                "branch {branch} has no upstream and the checkout has {} remotes; set an upstream",
                many.len()
            ),
                None,
            )
        }
    };

    match git(dir, &["add", "-A"], LOCAL_TIMEOUT) {
        Ok(r) if r.success => {}
        Ok(r) => return failed("add", r.message(), None),
        Err(e) => return failed("add", e, None),
    }
    let staged = match git(dir, &["diff", "--cached", "--quiet"], LOCAL_TIMEOUT) {
        Ok(r) if r.success => false,
        Ok(r) if r.code == Some(1) => true,
        Ok(r) => return failed("status", r.message(), None),
        Err(e) => return failed("status", e, None),
    };
    let mut commit = None;
    if staged {
        let message = commit_message(date, repos);
        let name_arg = identity.map(|i| format!("user.name={}", i.name));
        let email_arg = identity.map(|i| format!("user.email={}", i.email));
        let mut args: Vec<&str> = Vec::new();
        if let (Some(n), Some(e)) = (&name_arg, &email_arg) {
            args.extend(["-c", n.as_str(), "-c", e.as_str()]);
        }
        args.extend(["commit", "--quiet", "-m", &message]);
        let hint = |detail: String| match identity {
            Some(_) => detail,
            None => format!("no engine git identity is configured (set {IDENTITY_KEYS}): {detail}"),
        };
        match git(dir, &args, LOCAL_TIMEOUT) {
            Ok(r) if r.success => {}
            Ok(r) => return failed("commit", hint(r.message()), None),
            Err(e) => return failed("commit", hint(e), None),
        }
        commit = git(dir, &["rev-parse", "--short", "HEAD"], LOCAL_TIMEOUT)
            .ok()
            .filter(|r| r.success)
            .map(|r| r.stdout.trim().to_string());
    }

    let refspec = format!("HEAD:refs/heads/{branch}");
    let (args, pushed_to): (Vec<&str>, String) = match &target {
        PushTarget::Upstream(u) => (vec!["push", "--quiet"], u.clone()),
        PushTarget::Remote(r) => (
            vec!["push", "--quiet", r.as_str(), refspec.as_str()],
            format!("{r}/{branch}"),
        ),
    };
    match git(dir, &args, PUSH_TIMEOUT) {
        Ok(r) if r.success => ArchiveOutcome::Archived { commit, pushed_to },
        Ok(r) => failed("push", r.message(), commit),
        Err(e) => failed("push", e, commit),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Run git in `dir` for fixture set-up, asserting success.
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

    /// A local bare repository as the remote, and an archive checkout cloned
    /// from it with a first commit pushed, as the live archive is set up.
    struct Fixture {
        root: TempDir,
        bare: PathBuf,
        archive: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("tempdir");
            let bare = root.path().join("remote.git");
            let archive = root.path().join("dream-artefacts");
            sh(
                root.path(),
                &[
                    "init",
                    "--quiet",
                    "--bare",
                    "--initial-branch=main",
                    "remote.git",
                ],
            );
            sh(
                root.path(),
                &[
                    "clone",
                    "--quiet",
                    bare.to_str().expect("utf8"),
                    "dream-artefacts",
                ],
            );
            identity(&archive);
            sh(&archive, &["checkout", "--quiet", "-b", "main"]);
            std::fs::write(archive.join(".gitignore"), ".lock\n*.lock\n*.tmp*\n").expect("ignore");
            sh(&archive, &["add", "-A"]);
            sh(&archive, &["commit", "--quiet", "-m", "first"]);
            sh(&archive, &["push", "--quiet", "-u", "origin", "main"]);
            Fixture {
                root,
                bare,
                archive,
            }
        }

        fn night(&self, name: &str) {
            let dir = self.archive.join(name);
            std::fs::create_dir_all(&dir).expect("night");
            std::fs::write(dir.join("report.md"), format!("# {name}\n")).expect("report");
            std::fs::write(dir.join(".lock"), "").expect("lock");
            std::fs::write(dir.join("review.tmp123"), "partial").expect("tmp");
        }

        fn remote_log(&self) -> String {
            sh(&self.bare, &["log", "--format=%s", "main"])
        }

        fn remote_files(&self) -> String {
            sh(&self.bare, &["ls-tree", "-r", "--name-only", "main"])
        }
    }

    fn identity(repo: &Path) {
        sh(repo, &["config", "user.name", "t"]);
        sh(repo, &["config", "user.email", "t@example.invalid"]);
    }

    #[test]
    fn a_night_is_committed_and_pushed_with_ignored_files_left_out() {
        let fx = Fixture::new();
        fx.night("2026-11-01-demo-repo");
        fx.night("2026-11-01-other-repo");
        let out = archive_night(&fx.archive, "2026-11-01", 2, None);
        let ArchiveOutcome::Archived { commit, pushed_to } = &out else {
            panic!("expected archived, got {out:?}");
        };
        assert!(commit.is_some());
        assert_eq!(pushed_to, "origin/main");
        assert_eq!(
            fx.remote_log().lines().next(),
            Some("dream night 2026-11-01: artefacts of 2 repositories")
        );
        let files = fx.remote_files();
        assert!(files.contains("2026-11-01-demo-repo/report.md"), "{files}");
        assert!(!files.contains(".lock"), "lock files are ignored: {files}");
        assert!(!files.contains(".tmp"), "temp files are ignored: {files}");
        assert_eq!(out.alert(&fx.archive), None);
    }

    #[test]
    fn nothing_new_makes_no_commit_and_still_succeeds() {
        let fx = Fixture::new();
        fx.night("2026-11-01-demo-repo");
        archive_night(&fx.archive, "2026-11-01", 1, None);
        let before = fx.remote_log();
        let out = archive_night(&fx.archive, "2026-11-02", 0, None);
        assert_eq!(
            out,
            ArchiveOutcome::Archived {
                commit: None,
                pushed_to: "origin/main".into()
            }
        );
        assert_eq!(fx.remote_log(), before, "no empty commit");
    }

    #[test]
    fn a_previous_failed_push_is_carried_by_the_next_night() {
        let fx = Fixture::new();
        fx.night("2026-11-01-demo-repo");
        let moved = fx.root.path().join("remote-away.git");
        std::fs::rename(&fx.bare, &moved).expect("remote unavailable");
        let out = archive_night(&fx.archive, "2026-11-01", 1, None);
        let ArchiveOutcome::Failed { step, commit, .. } = &out else {
            panic!("expected failure, got {out:?}");
        };
        assert_eq!(*step, "push");
        assert!(commit.is_some(), "the local commit is kept");
        let alert = out.alert(&fx.archive).expect("alert");
        assert!(
            alert.contains("committed locally") && alert.contains("never force-push"),
            "{alert}"
        );

        std::fs::rename(&moved, &fx.bare).expect("remote back");
        let out = archive_night(&fx.archive, "2026-11-02", 0, None);
        assert!(
            matches!(out, ArchiveOutcome::Archived { commit: None, .. }),
            "{out:?}"
        );
        assert!(fx.remote_log().contains("dream night 2026-11-01"));
    }

    #[test]
    fn a_diverged_remote_is_never_force_pushed() {
        let fx = Fixture::new();
        // Someone else advances the remote.
        let other = fx.root.path().join("other");
        sh(
            fx.root.path(),
            &["clone", "--quiet", fx.bare.to_str().expect("utf8"), "other"],
        );
        identity(&other);
        std::fs::write(other.join("note.md"), "elsewhere").expect("note");
        sh(&other, &["add", "-A"]);
        sh(&other, &["commit", "--quiet", "-m", "remote moved on"]);
        sh(&other, &["push", "--quiet"]);
        let remote_head = sh(&fx.bare, &["rev-parse", "main"]);

        fx.night("2026-11-01-demo-repo");
        let out = archive_night(&fx.archive, "2026-11-01", 1, None);
        assert!(
            matches!(
                out,
                ArchiveOutcome::Failed {
                    step: "push",
                    commit: Some(_),
                    ..
                }
            ),
            "{out:?}"
        );
        assert_eq!(
            sh(&fx.bare, &["rev-parse", "main"]),
            remote_head,
            "the remote branch is untouched"
        );
    }

    #[test]
    fn a_directory_that_is_not_a_work_tree_is_left_alone() {
        let root = tempfile::tempdir().expect("tempdir");
        let dir = root.path().join("plain");
        std::fs::create_dir_all(dir.join("2026-11-01-demo-repo")).expect("dir");
        assert_eq!(
            archive_night(&dir, "2026-11-01", 1, None),
            ArchiveOutcome::NotARepository
        );
        assert!(!dir.join(".git").exists());
        assert_eq!(
            archive_night(&root.path().join("missing"), "2026-11-01", 1, None),
            ArchiveOutcome::NotARepository
        );
    }

    #[test]
    fn a_subdirectory_of_another_repository_is_left_alone() {
        let fx = Fixture::new();
        let inner = fx.archive.join("nested");
        std::fs::create_dir_all(&inner).expect("dir");
        std::fs::write(inner.join("f"), "x").expect("file");
        let before = sh(&fx.archive, &["rev-parse", "HEAD"]);
        assert_eq!(
            archive_night(&inner, "2026-11-01", 1, None),
            ArchiveOutcome::NotARepository
        );
        assert_eq!(sh(&fx.archive, &["rev-parse", "HEAD"]), before);
    }

    #[test]
    fn a_work_tree_without_a_remote_is_left_alone() {
        let root = tempfile::tempdir().expect("tempdir");
        let dir = root.path().join("local");
        sh(
            root.path(),
            &["init", "--quiet", "--initial-branch=main", "local"],
        );
        identity(&dir);
        std::fs::write(dir.join("f"), "x").expect("file");
        assert_eq!(
            archive_night(&dir, "2026-11-01", 1, None),
            ArchiveOutcome::NoRemote
        );
        let status = sh(&dir, &["status", "--porcelain"]);
        assert_eq!(status, "?? f", "nothing staged or committed");
    }

    #[test]
    fn without_an_upstream_the_single_remote_receives_the_branch() {
        let fx = Fixture::new();
        sh(&fx.archive, &["branch", "--unset-upstream"]);
        fx.night("2026-11-01-demo-repo");
        let out = archive_night(&fx.archive, "2026-11-01", 1, None);
        assert!(
            matches!(&out, ArchiveOutcome::Archived { pushed_to, .. } if pushed_to == "origin/main"),
            "{out:?}"
        );
        assert!(fx.remote_log().contains("dream night 2026-11-01"));
    }

    #[test]
    fn a_failed_commit_is_reported_and_nothing_is_pushed() {
        let fx = Fixture::new();
        fx.night("2026-11-01-demo-repo");
        let before = fx.remote_log();
        // A pre-commit hook that refuses stands in for any commit failure
        // (missing identity, a full disk) without touching global config.
        let hook = fx.archive.join(".git/hooks/pre-commit");
        std::fs::write(&hook, "#!/bin/sh\necho refused by hook >&2\nexit 1\n").expect("hook");
        let mut perms = std::fs::metadata(&hook).expect("meta").permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
        std::fs::set_permissions(&hook, perms).expect("chmod");
        let out = archive_night(&fx.archive, "2026-11-01", 1, None);
        let ArchiveOutcome::Failed {
            step,
            detail,
            commit,
        } = &out
        else {
            panic!("expected failure, got {out:?}");
        };
        assert_eq!((*step, commit.as_deref()), ("commit", None));
        assert!(detail.contains("refused by hook"), "{detail}");
        assert!(out
            .alert(&fx.archive)
            .expect("alert")
            .contains("not committed"));
        assert_eq!(fx.remote_log(), before);
    }

    #[test]
    fn a_symlinked_path_to_the_checkout_is_archived() {
        let fx = Fixture::new();
        let link = fx.root.path().join("old-path");
        std::os::unix::fs::symlink(&fx.archive, &link).expect("symlink");
        fx.night("2026-11-01-demo-repo");
        assert!(matches!(
            archive_night(&link, "2026-11-01", 1, None),
            ArchiveOutcome::Archived {
                commit: Some(_),
                ..
            }
        ));
    }

    fn ident() -> GitIdentity {
        GitIdentity {
            name: "dream-engine".into(),
            email: "dream-engine@example.invalid".into(),
        }
    }

    /// Blank identity in the checkout: overrides any account-wide identity, so
    /// these tests do not depend on the machine running them.
    fn blank_identity(repo: &Path) {
        sh(repo, &["config", "user.name", ""]);
        sh(repo, &["config", "user.email", ""]);
    }

    #[test]
    fn the_configured_identity_is_passed_explicitly() {
        let fx = Fixture::new();
        blank_identity(&fx.archive);
        fx.night("2026-11-01-demo-repo");
        let out = archive_night(&fx.archive, "2026-11-01", 1, Some(&ident()));
        assert!(
            matches!(
                out,
                ArchiveOutcome::Archived {
                    commit: Some(_),
                    ..
                }
            ),
            "{out:?}"
        );
        let who = sh(
            &fx.bare,
            &["log", "-1", "--format=%an <%ae> / %cn <%ce>", "main"],
        );
        assert_eq!(
            who,
            "dream-engine <dream-engine@example.invalid> / dream-engine <dream-engine@example.invalid>"
        );
    }

    #[test]
    fn a_missing_identity_names_the_configuration_to_set() {
        let fx = Fixture::new();
        blank_identity(&fx.archive);
        fx.night("2026-11-01-demo-repo");
        let before = fx.remote_log();
        let out = archive_night(&fx.archive, "2026-11-01", 1, None);
        let ArchiveOutcome::Failed {
            step,
            detail,
            commit,
        } = &out
        else {
            panic!("expected failure, got {out:?}");
        };
        assert_eq!((*step, commit.as_deref()), ("commit", None));
        assert!(detail.contains(IDENTITY_KEYS), "{detail}");
        assert!(out
            .alert(&fx.archive)
            .expect("alert")
            .contains("git_author_email"));
        assert_eq!(fx.remote_log(), before);
    }

    #[test]
    fn identity_needs_both_parts_and_maps_to_author_and_committer() {
        assert_eq!(GitIdentity::from_parts(Some("n"), None), None);
        assert_eq!(GitIdentity::from_parts(Some(" "), Some("e@x")), None);
        let id = GitIdentity::from_parts(Some(" n "), Some("e@x")).expect("both");
        assert_eq!(
            id.env(),
            [
                ("GIT_AUTHOR_NAME", "n"),
                ("GIT_AUTHOR_EMAIL", "e@x"),
                ("GIT_COMMITTER_NAME", "n"),
                ("GIT_COMMITTER_EMAIL", "e@x"),
            ]
        );
    }

    #[test]
    fn the_commit_message_names_the_date_and_count() {
        assert_eq!(
            commit_message("2026-11-10", 1),
            "dream night 2026-11-10: artefacts of 1 repository"
        );
        assert_eq!(
            commit_message("2026-11-10", 0),
            "dream night 2026-11-10: artefacts of 0 repositories"
        );
    }
}
