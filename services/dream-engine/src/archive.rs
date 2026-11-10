//! End-of-night archive: commit and push the artefact directory when it is a git checkout.
//!
//! The artefact directory may be the checkout of a private archive repository.
//! When it is the top of its own git work tree and has a remote, the night ends
//! by making sure its `.gitignore` keeps lock files, temporary files and the
//! loop log out ([`ensure_gitignore`]), staging everything that file admits,
//! committing it with a message naming the night date and the number of
//! repositories dreamed, and pushing to the checkout's upstream (or, with no
//! upstream, its single remote). The remote is whatever the checkout has;
//! nothing here names one.
//!
//! The step is fail-open. A failed commit or push is returned as
//! [`ArchiveOutcome::Failed`], which the engine logs and raises as an inbox
//! alert; it never aborts the night. It never force-pushes: a rejected push
//! leaves the local commit in place for the next night (or the operator) to
//! push once the histories are reconciled. A directory that is not a git work
//! tree, or one without a remote, is left completely alone.
//!
//! # Commit identity
//!
//! The configured identity ([`GitIdentity`], `[dream_machine]`
//! `git_author_name` and `git_author_email`) is a **fallback**, never an
//! override. A repository that resolves its own `user.name` and `user.email`
//! (from its own config, or the account's) commits under them. The engine's own
//! commits (this archive step, ledger rows) resolve the identity per repository
//! and pass the fallback to that one invocation only when the repository's
//! effective identity is empty ([`GitIdentity::args_for`]). Commits made inside
//! `dream-core` (candidate worktrees) take no identity argument, so for those
//! the engine installs the fallback as a process-wide git configuration layer
//! *below* every repository's and the account's own settings
//! ([`fallback_layer`]): git consults it only where nothing else names an
//! identity.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::gitcmd::{config_value, git, git_env};

/// Longest a local git step (status, add, commit) may run.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(120);
/// Longest the push may run before it is killed and reported as failed.
const PUSH_TIMEOUT: Duration = Duration::from_secs(300);

/// The non-interactive SSH command a push uses when the checkout configures
/// none: a push must fail, not wait for a passphrase or host-key prompt.
pub const BATCH_SSH_COMMAND: &str = "ssh -o BatchMode=yes";

/// Patterns the archive's `.gitignore` must hold: the night and ledger lock
/// files, partial writes, and the loop log a fallback launcher may write.
pub const ARCHIVE_IGNORES: [&str; 4] = [".lock", "*.lock", "*.tmp*", "loop.log"];

/// The fallback git identity the engine commits under where a repository has
/// none of its own, from `[dream_machine]` `git_author_name` and
/// `git_author_email`.
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
    /// The identity when both parts are present and non-blank. A value holding
    /// a line break is refused: it could not be one git config value.
    pub fn from_parts(name: Option<&str>, email: Option<&str>) -> Option<Self> {
        let clean = |v: Option<&str>| {
            v.map(str::trim)
                .filter(|s| !s.is_empty() && !s.contains(['\n', '\r']))
                .map(String::from)
        };
        Some(GitIdentity {
            name: clean(name)?,
            email: clean(email)?,
        })
    }

    /// The `-c user.name=… -c user.email=…` arguments a git invocation in
    /// `repo` needs to commit under this fallback: empty when the repository's
    /// effective identity (its own config, else the account's) already names
    /// both a user and an email, so its own identity is kept.
    pub fn args_for(&self, repo: &Path) -> Vec<String> {
        if effective_identity(repo).is_some() {
            return Vec::new();
        }
        vec![
            "-c".into(),
            format!("user.name={}", self.name),
            "-c".into(),
            format!("user.email={}", self.email),
        ]
    }
}

/// The identity git would commit under in `repo` from configuration alone:
/// `Some((name, email))` when both resolve non-blank, else `None`.
pub fn effective_identity(repo: &Path) -> Option<(String, String)> {
    let name = config_value(repo, "user.name", LOCAL_TIMEOUT)?;
    let email = config_value(repo, "user.email", LOCAL_TIMEOUT)?;
    Some((name, email))
}

/// `-c` arguments for an engine-owned commit in `repo`: the fallback's when the
/// repository has no identity of its own ([`GitIdentity::args_for`]), else none.
pub(crate) fn identity_args(repo: &Path, identity: Option<&GitIdentity>) -> Vec<String> {
    identity.map(|i| i.args_for(repo)).unwrap_or_default()
}

/// Prefix a commit failure with the configuration to set, when no fallback
/// identity is configured and the repository resolves none of its own.
pub(crate) fn identity_hint(repo: &Path, identity: Option<&GitIdentity>, detail: String) -> String {
    if identity.is_none() && effective_identity(repo).is_none() {
        format!(
            "the repository has no git identity and no engine fallback is configured \
             (set {IDENTITY_KEYS}): {detail}"
        )
    } else {
        detail
    }
}

/// Quote a value for a git config file: double quotes, with `\` and `"` escaped.
fn config_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The account-level git configuration files git would read with no
/// `GIT_CONFIG_GLOBAL` override, in git's own order (XDG, then `~/.gitconfig`).
fn default_account_configs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let xdg = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| home.as_ref().map(|h| h.join(".config")))
        .map(|d| d.join("git").join("config"));
    xdg.into_iter()
        .chain(home.map(|h| h.join(".gitconfig")))
        .collect()
}

/// The text of the fallback configuration layer: the fallback identity first,
/// then an include of every account configuration file, so anything the
/// account sets (an identity included) overrides the fallback, and anything a
/// repository sets overrides both (repository config outranks account config).
pub fn fallback_layer(identity: &GitIdentity, account_configs: &[PathBuf]) -> String {
    let mut out = String::from(
        "# Written by dream-engine at start-up: its fallback commit identity, used\n\
         # only where neither the repository nor the account configures one.\n",
    );
    out.push_str(&format!(
        "[user]\n\tname = {}\n\temail = {}\n",
        config_quote(&identity.name),
        config_quote(&identity.email)
    ));
    for path in account_configs {
        out.push_str(&format!(
            "[include]\n\tpath = {}\n",
            config_quote(&path.to_string_lossy())
        ));
    }
    out
}

/// Write the fallback layer ([`fallback_layer`]) to `path` and return the
/// value `GIT_CONFIG_GLOBAL` should take. The account files included are the
/// current `GIT_CONFIG_GLOBAL` when set, else git's defaults.
///
/// # Errors
///
/// Any I/O error writing the file.
pub fn install_fallback_layer(identity: &GitIdentity, path: &Path) -> std::io::Result<PathBuf> {
    let accounts = match std::env::var_os("GIT_CONFIG_GLOBAL") {
        // An inherited value naming this very file (a nested engine) would
        // include itself; read git's defaults instead.
        Some(p) if !p.is_empty() && Path::new(&p) != path => vec![PathBuf::from(p)],
        _ => default_account_configs(),
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    crate::ledger_io::replace(path, fallback_layer(identity, &accounts).as_bytes())?;
    Ok(path.to_path_buf())
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
        /// The failing step: `branch`, `remote`, `gitignore`, `add`, `status`,
        /// `commit` or `push`.
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

/// Make sure `dir/.gitignore` holds every [`ARCHIVE_IGNORES`] pattern,
/// appending only the missing lines and never rewriting what is there.
/// Returns whether the file changed.
///
/// # Errors
///
/// Any I/O error reading or appending to the file.
pub fn ensure_gitignore(dir: &Path) -> std::io::Result<bool> {
    let path = dir.join(".gitignore");
    let existing = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    let present: Vec<&str> = existing.lines().map(str::trim).collect();
    let missing: Vec<&str> = ARCHIVE_IGNORES
        .iter()
        .copied()
        .filter(|p| !present.contains(p))
        .collect();
    if missing.is_empty() {
        return Ok(false);
    }
    let mut add = String::new();
    if !existing.is_empty() && !existing.ends_with('\n') {
        add.push('\n');
    }
    for p in missing {
        add.push_str(p);
        add.push('\n');
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    f.write_all(add.as_bytes())?;
    f.sync_all()?;
    Ok(true)
}

/// The `GIT_SSH_COMMAND` a push from `dir` needs: [`BATCH_SSH_COMMAND`] when
/// nothing chooses an SSH command already, `None` when the environment sets
/// `GIT_SSH_COMMAND` or `GIT_SSH`, or the checkout (or the account) configures
/// `core.sshCommand`, such as a deploy-key command, which must win.
pub fn batch_ssh_command(dir: &Path) -> Option<&'static str> {
    let env_set = |k: &str| std::env::var_os(k).is_some_and(|v| !v.is_empty());
    if env_set("GIT_SSH_COMMAND") || env_set("GIT_SSH") {
        return None;
    }
    if config_value(dir, "core.sshCommand", LOCAL_TIMEOUT).is_some() {
        return None;
    }
    Some(BATCH_SSH_COMMAND)
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
/// one remote. Then it appends any missing [`ARCHIVE_IGNORES`] line to the
/// checkout's `.gitignore` (and stops tracking a `loop.log` committed before
/// that line existed), stages with `git add -A`, commits only when something
/// is staged, and pushes without force: to the branch's upstream when it has
/// one, else to the single remote under the current branch name. Never panics
/// and never returns an error; failures come back as [`ArchiveOutcome::Failed`].
///
/// `identity` is a fallback ([`GitIdentity::args_for`]): used only when the
/// checkout resolves no identity of its own. With neither, a failed commit
/// names the configuration keys to set ([`IDENTITY_KEYS`]). The push uses the
/// checkout's own SSH command when it configures one ([`batch_ssh_command`]).
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

    if let Err(e) = ensure_gitignore(dir) {
        return failed("gitignore", e.to_string(), None);
    }
    // A loop log committed before `.gitignore` named it stays tracked (and
    // grows in every commit) until it is removed from the index.
    match git(
        dir,
        &[
            "rm",
            "--cached",
            "--quiet",
            "--ignore-unmatch",
            "--",
            "loop.log",
        ],
        LOCAL_TIMEOUT,
    ) {
        Ok(r) if r.success => {}
        Ok(r) => return failed("gitignore", r.message(), None),
        Err(e) => return failed("gitignore", e, None),
    }

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
        let id_args = identity_args(dir, identity);
        let mut args: Vec<&str> = id_args.iter().map(String::as_str).collect();
        args.extend(["commit", "--quiet", "-m", &message]);
        match git(dir, &args, LOCAL_TIMEOUT) {
            Ok(r) if r.success => {}
            Ok(r) => return failed("commit", identity_hint(dir, identity, r.message()), None),
            Err(e) => return failed("commit", identity_hint(dir, identity, e), None),
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
    let ssh: Vec<(&str, &str)> = batch_ssh_command(dir)
        .map(|c| vec![("GIT_SSH_COMMAND", c)])
        .unwrap_or_default();
    match git_env(dir, &args, PUSH_TIMEOUT, &ssh) {
        Ok(r) if r.success => ArchiveOutcome::Archived { commit, pushed_to },
        Ok(r) => failed("push", r.message(), commit),
        Err(e) => failed("push", e, commit),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
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
    fn identity_needs_both_clean_parts() {
        assert_eq!(GitIdentity::from_parts(Some("n"), None), None);
        assert_eq!(GitIdentity::from_parts(Some(" "), Some("e@x")), None);
        assert_eq!(GitIdentity::from_parts(Some("a\nb"), Some("e@x")), None);
        let id = GitIdentity::from_parts(Some(" n "), Some("e@x")).expect("both");
        assert_eq!((id.name.as_str(), id.email.as_str()), ("n", "e@x"));
    }

    #[test]
    fn a_checkout_with_its_own_identity_keeps_it() {
        let fx = Fixture::new();
        fx.night("2026-11-01-demo-repo");
        assert!(ident().args_for(&fx.archive).is_empty());
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
        assert_eq!(who, "t <t@example.invalid> / t <t@example.invalid>");
    }

    /// Run `git commit` in `repo` with only `layer` as the account-level
    /// configuration, and return the author it recorded.
    fn commit_with_layer(repo: &Path, layer: &Path, home: &Path) -> String {
        std::fs::write(
            repo.join("f"),
            format!("{:?}", std::time::SystemTime::now()),
        )
        .expect("f");
        let run = |args: &[&str]| {
            let out = Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(args)
                .env("GIT_CONFIG_GLOBAL", layer)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("HOME", home)
                .env_remove("GIT_AUTHOR_NAME")
                .env_remove("GIT_AUTHOR_EMAIL")
                .env_remove("GIT_COMMITTER_NAME")
                .env_remove("GIT_COMMITTER_EMAIL")
                .env_remove("EMAIL")
                .output()
                .expect("git runs");
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        run(&["add", "-A"]);
        run(&["commit", "--quiet", "-m", "m"]);
        run(&["log", "-1", "--format=%an <%ae>"])
    }

    #[test]
    fn the_fallback_layer_yields_to_the_repository_and_the_account() {
        let root = tempfile::tempdir().expect("tempdir");
        let home = root.path();
        let account = home.join("account.gitconfig");
        let layer = home.join("layer.gitconfig");
        let repo = home.join("r");
        std::fs::create_dir_all(&repo).expect("dir");
        sh(&repo, &["init", "--quiet", "--initial-branch=main"]);
        let fallback =
            GitIdentity::from_parts(Some("Fall \"Back\" Bot"), Some("fb@example.invalid"))
                .expect("identity");
        std::fs::write(
            &layer,
            fallback_layer(&fallback, std::slice::from_ref(&account)),
        )
        .expect("layer");

        // Neither the repository nor the account names anyone: the fallback.
        std::fs::write(&account, "[core]\n\tautocrlf = false\n").expect("account");
        assert_eq!(
            commit_with_layer(&repo, &layer, home),
            "Fall \"Back\" Bot <fb@example.invalid>"
        );
        // The account's identity outranks the fallback.
        std::fs::write(
            &account,
            "[user]\n\tname = acct\n\temail = a@example.invalid\n",
        )
        .expect("account");
        assert_eq!(
            commit_with_layer(&repo, &layer, home),
            "acct <a@example.invalid>"
        );
        // The repository's own identity outranks both.
        sh(&repo, &["config", "user.name", "own"]);
        sh(&repo, &["config", "user.email", "own@example.invalid"]);
        assert_eq!(
            commit_with_layer(&repo, &layer, home),
            "own <own@example.invalid>"
        );
    }

    #[test]
    fn the_gitignore_gains_only_missing_lines_and_keeps_its_content() {
        let root = tempfile::tempdir().expect("tempdir");
        let ignore = root.path().join(".gitignore");
        std::fs::write(&ignore, "# archive\nscratch/\n*.lock").expect("ignore");
        assert!(ensure_gitignore(root.path()).expect("ensure"));
        assert_eq!(
            std::fs::read_to_string(&ignore).expect("read"),
            "# archive\nscratch/\n*.lock\n.lock\n*.tmp*\nloop.log\n"
        );
        assert!(
            !ensure_gitignore(root.path()).expect("again"),
            "a second run changes nothing"
        );

        let fresh = tempfile::tempdir().expect("tempdir");
        assert!(ensure_gitignore(fresh.path()).expect("ensure"));
        assert_eq!(
            std::fs::read_to_string(fresh.path().join(".gitignore")).expect("read"),
            ".lock\n*.lock\n*.tmp*\nloop.log\n"
        );
    }

    #[test]
    fn the_loop_log_is_never_archived_even_if_tracked_before() {
        let fx = Fixture::new();
        // An older launcher's log, committed before `.gitignore` named it.
        std::fs::write(fx.archive.join("loop.log"), "line 1\n").expect("log");
        sh(&fx.archive, &["add", "-f", "loop.log"]);
        sh(&fx.archive, &["commit", "--quiet", "-m", "log"]);
        sh(&fx.archive, &["push", "--quiet"]);
        std::fs::write(fx.archive.join("loop.log"), "line 1\nline 2\n").expect("log");
        fx.night("2026-11-01-demo-repo");
        let out = archive_night(&fx.archive, "2026-11-01", 1, None);
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
        let files = fx.remote_files();
        assert!(!files.contains("loop.log"), "{files}");
        assert!(files.contains("2026-11-01-demo-repo/report.md"), "{files}");
        assert!(
            fx.archive.join("loop.log").exists(),
            "the log itself stays on disk"
        );
        let ignore = sh(&fx.bare, &["show", "main:.gitignore"]);
        for p in ARCHIVE_IGNORES {
            assert!(ignore.lines().any(|l| l == p), "{p} in {ignore}");
        }
    }

    #[test]
    fn a_configured_ssh_command_is_not_overridden() {
        if std::env::var_os("GIT_SSH_COMMAND").is_some() || std::env::var_os("GIT_SSH").is_some() {
            eprintln!("skipped: the environment chooses an SSH command already");
            return;
        }
        let fx = Fixture::new();
        assert_eq!(batch_ssh_command(&fx.archive), Some(BATCH_SSH_COMMAND));

        // A deploy-key style command that records it ran, then refuses.
        let marker = fx.root.path().join("ssh-ran");
        let script = fx.root.path().join("deploy-ssh");
        std::fs::write(
            &script,
            format!("#!/bin/sh\ntouch '{}'\nexit 1\n", marker.display()),
        )
        .expect("script");
        let mut perms = std::fs::metadata(&script).expect("meta").permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o755);
        std::fs::set_permissions(&script, perms).expect("chmod");
        sh(
            &fx.archive,
            &["config", "core.sshCommand", script.to_str().expect("utf8")],
        );
        sh(
            &fx.archive,
            &[
                "remote",
                "set-url",
                "origin",
                "ssh://git@archive.invalid/a.git",
            ],
        );
        assert_eq!(batch_ssh_command(&fx.archive), None);

        fx.night("2026-11-01-demo-repo");
        let out = archive_night(&fx.archive, "2026-11-01", 1, None);
        assert!(
            matches!(out, ArchiveOutcome::Failed { step: "push", .. }),
            "{out:?}"
        );
        assert!(marker.exists(), "the checkout's own core.sshCommand ran");
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
