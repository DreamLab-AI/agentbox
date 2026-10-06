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
    #[error(
        "no annexe host configured: CONNECTED_NODE_SSH is unset or empty \
         (the docker-compose contract says empty means \"no annexe\" — \
         reported here instead of shelling out to nowhere)"
    )]
    NoAnnexeHost,
}

/// Run a command on the connected node via SSH.
///
/// the connected node's login shell is fish — every remote command is wrapped in `bash -lc`
/// so POSIX syntax (&&, redirects, cd) behaves as written.
pub fn ssh(hp_host: &str, cmd: &str) -> Result<String, DispatchError> {
    if hp_host.trim().is_empty() {
        return Err(DispatchError::NoAnnexeHost);
    }
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

/// Run a command on the connected node and capture the full result, *without* treating a
/// non-zero exit as an error.
///
/// [`ssh`] collapses "the evaluator disagreed" and "the transport broke" into
/// one `Err`, which is exactly the ambiguity ADR-2024's gate has to resolve.
/// This variant keeps the exit code, both streams and the elapsed time, and
/// reserves `transport_error` for the case where ssh itself could not run the
/// command. Classification into a typed outcome happens in
/// [`crate::receipts::classify`].
pub fn ssh_capture(hp_host: &str, cmd: &str) -> crate::runner::ExecOutcome {
    use crate::runner::ExecOutcome;
    if hp_host.trim().is_empty() {
        return ExecOutcome::blocked(DispatchError::NoAnnexeHost.to_string());
    }
    let started_at = chrono::Utc::now().to_rfc3339();
    let t0 = std::time::Instant::now();
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
        .output();
    match output {
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).into_owned();
            // ssh's own 255 means the connection failed, not the command — the
            // remote command never ran, so this is a transport fault.
            let transport_error = if o.status.code() == Some(255) {
                Some(format!("ssh transport failed: {}", stderr.trim()))
            } else {
                None
            };
            ExecOutcome {
                exit_code: o.status.code(),
                stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
                stderr,
                duration_ms: t0.elapsed().as_millis(),
                transport_error,
                timed_out: false,
                started_at,
            }
        }
        Err(e) => ExecOutcome::blocked(format!("spawning ssh to {hp_host}: {e}")),
    }
}

/// SCP a local file to the connected node.
pub fn scp_to(local: &Path, hp_host: &str, remote: &str) -> Result<(), DispatchError> {
    if hp_host.trim().is_empty() {
        return Err(DispatchError::NoAnnexeHost);
    }
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

/// SCP a remote file from the connected node to local.
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

/// Clone a repo to the connected node annexe.
///
/// Uses `git archive` locally (this container has no system tar; git carries
/// its own tar writer) and extracts with the connected node's tar on the remote side.
/// Archives HEAD — uncommitted changes are deliberately excluded so the
/// witness commit always matches the evaluated tree.
pub fn clone_to_hp(
    local_repo: &Path,
    hp_host: &str,
    remote_dir: &str,
    repo_name: &str,
) -> Result<(), DispatchError> {
    // `repo_name` may be a nested annexe subpath (`project/agentbox`); the
    // archive is a flat file in `remote_dir`, so flatten the separators.
    let archive_name = format!("dream-{}.tar.gz", repo_name.replace('/', "-"));
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

/// Run build + evaluators on the connected node. Returns (build_output, eval_outputs).
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

/// Free space the annexe must have before a run is attempted. A Rust clone
/// plus its `target/` tree runs to several GiB; below this the build fails
/// mid-night and burns an attempt on a fault that was visible up front.
pub const ANNEXE_MIN_FREE_GIB: u64 = 10;

/// Remote command behind [`annexe_health`]: create the annexe, write and
/// delete a probe file in it, then report free space in KiB.
///
/// The write is the real test. On a fully allocated btrfs volume `df` still
/// reports tens of GiB free while every file creation fails with ENOSPC
/// (metadata chunks exhausted, 2026-09-26), so free space alone would pass.
pub(crate) fn annexe_probe_cmd(annexe_dir: &str) -> String {
    let d = shell_quote(annexe_dir);
    format!(
        "mkdir -p {d} && p={d}/.dream-probe-$$ && printf ok > \"$p\" && rm -f \"$p\" \
         && echo \"AVAIL-KB=$(df -Pk {d} | awk 'NR==2{{print $4}}')\""
    )
}

/// Parse the `AVAIL-KB=<n>` line printed by [`annexe_probe_cmd`].
pub(crate) fn parse_avail_kb(out: &str) -> Option<u64> {
    out.lines()
        .find_map(|l| l.trim().strip_prefix("AVAIL-KB="))
        .and_then(|v| v.trim().parse().ok())
}

/// Check the connected node can take a run: reachable, annexe writable, and
/// at least `min_free_gib` free. Returns the free GiB, or the reason it can't.
///
/// Runs before the run journal counts an attempt, so an unhealthy node costs
/// the night but never the experiment's retry budget.
pub fn annexe_health(hp_host: &str, annexe_dir: &str, min_free_gib: u64) -> Result<u64, String> {
    let out = ssh(hp_host, &annexe_probe_cmd(annexe_dir)).map_err(|e| e.to_string())?;
    let kb = parse_avail_kb(&out)
        .ok_or_else(|| format!("annexe probe printed no free-space figure: {}", out.trim()))?;
    let gib = kb / (1024 * 1024);
    if gib < min_free_gib {
        return Err(format!(
            "annexe {annexe_dir} has {gib} GiB free, below the {min_free_gib} GiB floor"
        ));
    }
    Ok(gib)
}

#[cfg(test)]
mod tests {
    use super::{annexe_probe_cmd, parse_avail_kb, shell_quote};

    #[test]
    fn annexe_probe_writes_before_it_measures() {
        let cmd = annexe_probe_cmd("/home/j o/dream-annexe");
        assert!(cmd.starts_with("mkdir -p '/home/j o/dream-annexe' && "));
        let write = cmd.find("printf ok").unwrap();
        let measure = cmd.find("df -Pk").unwrap();
        assert!(write < measure, "the write must gate the free-space report");
        assert!(cmd.contains("awk 'NR==2{print $4}'"));
    }

    #[test]
    fn parse_avail_kb_reads_the_marker_line_only() {
        assert_eq!(
            parse_avail_kb("motd noise\nAVAIL-KB=236978176\n"),
            Some(236_978_176)
        );
        assert_eq!(parse_avail_kb("AVAIL-KB=\n"), None);
        assert_eq!(parse_avail_kb("no marker"), None);
    }

    #[test]
    fn shell_quote_handles_spaces_and_single_quotes() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("two words"), "'two words'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
