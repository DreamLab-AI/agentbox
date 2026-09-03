//! Command execution helpers, ported from `run_imagemagick()` /
//! `get_convert_command()` in the Python source. Builds the same
//! `serde_json::Value` shapes the Python dict branches produced so the
//! JSON returned to a client is unchanged.

use std::os::unix::fs::PermissionsExt;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::process::Command;

/// Resolve the ImageMagick CLI entry point, preferring the v7 `magick`
/// wrapper and falling back to the v6 `convert` binary.
pub fn get_convert_command() -> Result<&'static str, String> {
    if which("magick") {
        Ok("magick")
    } else if which("convert") {
        Ok("convert")
    } else {
        Err("ImageMagick not found. Install with: pacman -S imagemagick".to_string())
    }
}

fn which(bin: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|dir| {
        let candidate = dir.join(bin);
        candidate.is_file()
            && candidate
                .metadata()
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
    })
}

/// Execute an ImageMagick command and return a structured JSON response
/// matching the Python `run_imagemagick()` dict shapes exactly.
pub async fn run_imagemagick(args: &[String], timeout: Duration) -> Value {
    let cmd = match get_convert_command() {
        Ok(cmd) => cmd,
        Err(error) => return json!({"success": false, "error": error}),
    };

    let full_args: Vec<String> =
        if cmd == "magick" && args.first().map(String::as_str) != Some("identify") {
            std::iter::once(cmd.to_string())
                .chain(std::iter::once("convert".to_string()))
                .chain(args.iter().cloned())
                .collect()
        } else {
            std::iter::once(cmd.to_string())
                .chain(args.iter().cloned())
                .collect()
        };

    let command_str = full_args.join(" ");
    let mut command = Command::new(&full_args[0]);
    command
        .args(&full_args[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match tokio::time::timeout(timeout, command.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.success() {
                json!({
                    "success": true,
                    "stdout": stdout,
                    "stderr": stderr,
                    "command": command_str,
                })
            } else {
                json!({
                    "success": false,
                    "error": "Command failed",
                    "stdout": stdout,
                    "stderr": stderr,
                    "returncode": output.status.code(),
                    "command": command_str,
                })
            }
        }
        Ok(Err(io_error)) => {
            if io_error.kind() == std::io::ErrorKind::NotFound {
                json!({
                    "success": false,
                    "error": "ImageMagick not found. Install with: pacman -S imagemagick",
                })
            } else {
                json!({"success": false, "error": io_error.to_string()})
            }
        }
        Err(_) => json!({
            "success": false,
            "error": format!("Command timed out after {} seconds", timeout.as_secs()),
        }),
    }
}

/// Hardcoded 30s timeout, matching the Python `identify_image` tool, which
/// runs `identify` directly rather than through `run_imagemagick()`.
const IDENTIFY_TIMEOUT: Duration = Duration::from_secs(30);

/// Run `identify` (or `magick identify`) on a file, matching the Python
/// `identify_image()` dict shapes exactly.
pub async fn run_identify(input_path: &str, verbose: bool) -> Value {
    let cmd = match get_convert_command() {
        Ok(cmd) => cmd,
        Err(error) => return json!({"success": false, "error": error}),
    };

    let mut full_args: Vec<String> = if cmd == "magick" {
        vec!["magick".to_string(), "identify".to_string()]
    } else {
        vec!["identify".to_string()]
    };
    if verbose {
        full_args.push("-verbose".to_string());
    }
    full_args.push(input_path.to_string());

    let mut command = Command::new(&full_args[0]);
    command
        .args(&full_args[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match tokio::time::timeout(IDENTIFY_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() {
                json!({"success": true, "info": stdout, "file": input_path})
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let error = if stderr.is_empty() {
                    "Failed to identify image".to_string()
                } else {
                    stderr
                };
                json!({"success": false, "error": error})
            }
        }
        Ok(Err(io_error)) => json!({"success": false, "error": io_error.to_string()}),
        Err(_) => json!({
            "success": false,
            "error": format!(
                "Command '{}' timed out after {} seconds",
                full_args.join(" "),
                IDENTIFY_TIMEOUT.as_secs()
            ),
        }),
    }
}
