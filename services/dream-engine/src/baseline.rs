//! The baseline a night is frozen against.

use std::path::Path;

/// Why the baseline could not be resolved.
#[derive(Debug, thiserror::Error)]
pub enum BaselineError {
    /// `git` could not be spawned.
    #[error("spawning git: {0}")]
    Io(#[from] std::io::Error),
    /// `git` ran and failed (arguments, repo).
    #[error("git {0} failed in {1}")]
    Git(String, String),
}

fn git(repo: &Path, args: &[&str]) -> Result<String, BaselineError> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()?;
    if !out.status.success() {
        return Err(BaselineError::Git(
            args.join(" "),
            repo.display().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// `(commit, tree)` of the repo's HEAD.
///
/// `git archive HEAD` is what the dispatcher ships, so the *tree* of HEAD is
/// the exact content the evaluators see — recording it (not just the commit)
/// makes the manifest bind to bytes rather than to a label.
pub fn of(repo: &Path) -> Result<(String, String), BaselineError> {
    let rev = git(repo, &["rev-parse", "HEAD"])?;
    let tree = git(repo, &["rev-parse", "HEAD^{tree}"])?;
    Ok((rev, tree))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn head_commit_and_tree_are_full_hashes() {
        let d = tempfile::tempdir().unwrap();
        let run = |a: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(d.path())
                .args(a)
                .output()
                .unwrap()
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(d.path().join("a"), "x").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-qm", "init"]);
        let (rev, tree) = of(d.path()).unwrap();
        assert_eq!(rev.len(), 40);
        assert_eq!(tree.len(), 40);
        assert_ne!(rev, tree);
    }

    #[test]
    fn a_directory_that_is_not_a_repo_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(of(d.path()).is_err());
    }
}
