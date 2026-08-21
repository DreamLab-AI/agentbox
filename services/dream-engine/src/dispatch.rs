use std::path::Path;
use std::process::Command;
use thiserror::Error;

/// Single-quote a string for safe embedding in a shell command line.
pub(crate) fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

#[derive(Debug, Error)]
pub enum DispatchError {
    #[error("SSH command failed: {0}")]
    Ssh(String),
    #[error("SCP failed: {0}")]
    Scp(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Run a command on HP via SSH.
///
/// HP's login shell is fish — every remote command is wrapped in `bash -lc`
/// so POSIX syntax (&&, redirects, cd) behaves as written.
pub fn ssh(hp_host: &str, cmd: &str) -> Result<String, DispatchError> {
    let wrapped = format!("bash -lc {}", shell_quote(cmd));
    let output = Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            hp_host,
            &wrapped,
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(DispatchError::Ssh(format!(
            "exit {}: {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// SCP a local file to HP.
pub fn scp_to(local: &Path, hp_host: &str, remote: &str) -> Result<(), DispatchError> {
    let output = Command::new("scp")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            local.to_str().unwrap_or(""),
            &format!("{}:{}", hp_host, remote),
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(DispatchError::Scp(stderr.trim().into()));
    }
    Ok(())
}

/// SCP a remote file from HP to local.
pub fn scp_from(hp_host: &str, remote: &str, local: &Path) -> Result<(), DispatchError> {
    let output = Command::new("scp")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            &format!("{}:{}", hp_host, remote),
            local.to_str().unwrap_or(""),
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(DispatchError::Scp(stderr.trim().into()));
    }
    Ok(())
}

/// Clone a repo to the HP annexe.
///
/// Uses `git archive` locally (this container has no system tar; git carries
/// its own tar writer) and extracts with HP's tar on the remote side.
/// Archives HEAD — uncommitted changes are deliberately excluded so the
/// witness commit always matches the evaluated tree.
pub fn clone_to_hp(
    local_repo: &Path,
    hp_host: &str,
    remote_dir: &str,
    repo_name: &str,
) -> Result<(), DispatchError> {
    let archive_name = format!("dream-{}.tar.gz", repo_name);
    let archive_path = std::env::temp_dir().join(&archive_name);

    let archive_file = std::fs::File::create(&archive_path)?;
    let status = Command::new("git")
        .args([
            "-C",
            &local_repo.display().to_string(),
            "archive",
            "--format=tar.gz",
            "HEAD",
        ])
        .stdout(archive_file)
        .status()?;
    if !status.success() {
        return Err(DispatchError::Ssh(format!(
            "git archive failed for {}",
            local_repo.display()
        )));
    }

    let remote_repo = format!("{}/{}", remote_dir, repo_name);
    ssh(hp_host, &format!("mkdir -p {}", shell_quote(&remote_repo)))?;
    scp_to(&archive_path, hp_host, &format!("{}/", remote_dir))?;
    ssh(
        hp_host,
        &format!(
            "tar xzf {} -C {}",
            shell_quote(&format!("{}/{}", remote_dir, archive_name)),
            shell_quote(&remote_repo)
        ),
    )?;
    let _ = std::fs::remove_file(&archive_path);
    Ok(())
}

/// Run build + evaluators on HP. Returns (build_output, eval_outputs).
pub fn run_on_hp(
    hp_host: &str,
    remote_dir: &str,
    repo_name: &str,
    build_cmd: Option<&str>,
    evaluators: &[(&str, &str)],
) -> Result<(String, Vec<(String, String)>), DispatchError> {
    let work_dir = format!("{}/{}", remote_dir, repo_name);

    let build_output = if let Some(cmd) = build_cmd {
        ssh(
            hp_host,
            &format!("cd {} && {}", shell_quote(&work_dir), cmd),
        )?
    } else {
        "(no build step)".into()
    };

    let mut eval_outputs = Vec::new();
    for (name, cmd) in evaluators {
        let output = match ssh(
            hp_host,
            &format!("cd {} && {}", shell_quote(&work_dir), cmd),
        ) {
            Ok(out) => out,
            Err(e) => format!("BLOCKED: {}", e),
        };
        eval_outputs.push((name.to_string(), output));
    }

    Ok((build_output, eval_outputs))
}

#[cfg(test)]
mod tests {
    use super::shell_quote;

    #[test]
    fn shell_quote_handles_spaces_and_single_quotes() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("two words"), "'two words'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
