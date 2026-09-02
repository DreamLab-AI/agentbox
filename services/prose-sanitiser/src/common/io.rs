//! Size-capped reads and symlink-safe atomic writes.

use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use super::binary::{looks_binary, BINARY_SNIFF_BYTES, TEXT_TOOL_ADVICE};
use super::surrogate::{self, Unit};
use super::{env_usize, CliError};

/// Hard caps on attacker-influenced input sizes. Whole-file in-memory
/// processing means a 1 GiB default is a host-memory DoS; keep defaults low.
/// The env overrides remain as an explicit escape hatch.
pub fn max_input_bytes() -> u64 {
    env_usize("WATERMARKS_MAX_INPUT_BYTES", 256 << 20) as u64
}

pub fn max_stdin_bytes() -> u64 {
    env_usize("WATERMARKS_MAX_STDIN_BYTES", 64 << 20) as u64
}

/// Refuse binary input for the text-only tools unless explicitly overridden.
pub fn guard_binary(
    data: &[u8],
    origin: &str,
    allow_binary: bool,
    advice: &[&str],
) -> Result<(), CliError> {
    if allow_binary {
        return Ok(());
    }
    let Some(kind) = looks_binary(data) else {
        return Ok(());
    };
    let mut message = format!("refusing to treat {origin} as text: it looks like {kind}.");
    for line in advice {
        message.push('\n');
        message.push_str(line);
    }
    Err(CliError::new(2, message))
}

/// Read a file (or stdin for `-`/`None`) as text units, capped and sniffed.
pub fn read_text_input(
    path: Option<&str>,
    allow_binary: bool,
    advice: Option<&[&str]>,
) -> Result<Vec<Unit>, CliError> {
    let advice = advice.unwrap_or(TEXT_TOOL_ADVICE);
    match path {
        None | Some("-") => read_stdin_capped(allow_binary, advice),
        Some(path) => {
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let cap = max_input_bytes();
            if size > cap {
                return Err(CliError::new(
                    2,
                    format!("refusing input larger than {cap} bytes: {path}"),
                ));
            }
            let data = fs::read(path)
                .map_err(|e| CliError::new(2, format!("cannot read {path}: {e}")))?;
            guard_binary(&data, path, allow_binary, advice)?;
            Ok(surrogate::decode(&data))
        }
    }
}

/// Read stdin with a hard cap (uncapped stdin was a memory-DoS hole), sniffing
/// the raw byte stream so the magic-number check sees the real octets.
fn read_stdin_capped(allow_binary: bool, advice: &[&str]) -> Result<Vec<Unit>, CliError> {
    let cap = max_stdin_bytes();
    let mut stdin = std::io::stdin().lock();
    let mut buffer = Vec::new();
    let mut chunk = vec![0u8; 1 << 20];
    let mut sniffed = false;
    loop {
        let read = stdin
            .read(&mut chunk)
            .map_err(|e| CliError::new(2, format!("cannot read stdin: {e}")))?;
        if read == 0 {
            break;
        }
        if !sniffed {
            let head = &chunk[..read.min(BINARY_SNIFF_BYTES)];
            guard_binary(head, "stdin", allow_binary, advice)?;
            sniffed = true;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() as u64 > cap {
            return Err(CliError::new(
                2,
                format!("refusing stdin input larger than {cap} bytes"),
            ));
        }
    }
    Ok(surrogate::decode(&buffer))
}

/// Write cleaned text to `path`, or stdout for `-`/`None`.
pub fn write_text_output(units: &[Unit], path: Option<&str>) -> Result<(), CliError> {
    let bytes = surrogate::encode(units);
    match path {
        None | Some("-") => {
            let mut out = std::io::stdout().lock();
            out.write_all(&bytes)
                .and_then(|()| {
                    if !bytes.is_empty() && !bytes.ends_with(b"\n") {
                        out.write_all(b"\n")
                    } else {
                        Ok(())
                    }
                })
                .map_err(|e| CliError::new(1, format!("cannot write stdout: {e}")))
        }
        Some(path) => safe_write_bytes(Path::new(path), &bytes)
            .map_err(|e| CliError::new(1, format!("{e}"))),
    }
}

/// `0o666 & ~umask` — the mode a plain `open()` would produce.
fn default_file_mode() -> u32 {
    // SAFETY: umask is always available and has no failure mode; the pair of
    // calls restores the process umask before anything else can observe it.
    let mask = unsafe { libc::umask(0) };
    unsafe { libc::umask(mask) };
    0o666 & !(mask as u32)
}

/// Atomically write bytes to `path` without following symlinks.
///
/// Writes to a temp file in the destination directory and renames it into
/// place. `rename` replaces a symlink rather than following it, and the
/// explicit symlink check gives a clear error instead of surprising behaviour.
/// This defeats pre-placed symlinks (e.g. in /tmp or download dirs) redirecting
/// a clean write onto an arbitrary victim file.
pub fn safe_write_bytes(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());
    let parent = match parent {
        Some(parent) => {
            fs::create_dir_all(parent)?;
            parent.to_path_buf()
        }
        None => PathBuf::from("."),
    };
    if fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(std::io::Error::other(format!(
            "refusing to write through symlink: {}",
            path.display()
        )));
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".to_string());
    let temp = tempfile::Builder::new()
        .prefix(&format!(".{name}."))
        .suffix(".tmp")
        .tempfile_in(&parent)?;
    // The temp file is 0600; restore the umask-default mode so outputs keep
    // normal permissions.
    temp.as_file()
        .set_permissions(fs::Permissions::from_mode(default_file_mode()))?;
    {
        let mut handle = temp.as_file();
        handle.write_all(data)?;
        handle.flush()?;
        handle.sync_all()?;
    }
    temp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

pub fn safe_write_text(path: &Path, units: &[Unit]) -> std::io::Result<()> {
    safe_write_bytes(path, &surrogate::encode(units))
}

/// Create a `.bak` copy of `src` via a safe write; return the backup path.
///
/// Used by `--in-place` flows so the original is never partially lost: it stays
/// untouched until the cleaned output is atomically renamed over it.
pub fn backup_path(src: &Path) -> Result<PathBuf, CliError> {
    let mut name = src.as_os_str().to_os_string();
    name.push(".bak");
    let backup = PathBuf::from(name);
    let data = fs::read(src)
        .map_err(|e| CliError::new(2, format!("cannot create backup {}: {e}", backup.display())))?;
    safe_write_bytes(&backup, &data)
        .map_err(|e| CliError::new(2, format!("cannot create backup {}: {e}", backup.display())))?;
    Ok(backup)
}

/// `path/to/file.ext` -> `path/to/file.cleaned.ext`
pub fn cleaned_path(src: &Path, suffix: &str) -> PathBuf {
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned());
    let extension = src.extension().map(|s| s.to_string_lossy().into_owned());
    let mut name = stem.unwrap_or_default();
    name.push_str(suffix);
    if let Some(extension) = extension {
        name.push('.');
        name.push_str(&extension);
    }
    src.with_file_name(name)
}

/// A file opened without following a final symlink, for read-side safety.
pub fn open_nofollow(path: &Path) -> std::io::Result<fs::File> {
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleaned_path_inserts_before_the_extension() {
        assert_eq!(
            cleaned_path(Path::new("a/b/notes.md"), ".cleaned"),
            PathBuf::from("a/b/notes.cleaned.md")
        );
        assert_eq!(
            cleaned_path(Path::new("README"), ".cleaned"),
            PathBuf::from("README.cleaned")
        );
        assert_eq!(
            cleaned_path(Path::new("a/notes.md"), ".rewritten"),
            PathBuf::from("a/notes.rewritten.md")
        );
    }

    #[test]
    fn safe_write_refuses_symlinks_and_writes_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim");
        fs::write(&victim, b"original").unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&victim, &link).unwrap();

        assert!(safe_write_bytes(&link, b"attack").is_err());
        assert_eq!(fs::read(&victim).unwrap(), b"original");

        let plain = dir.path().join("nested/plain.txt");
        safe_write_bytes(&plain, b"clean").unwrap();
        assert_eq!(fs::read(&plain).unwrap(), b"clean");
    }

    #[test]
    fn backup_copies_then_leaves_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("doc.txt");
        fs::write(&source, b"body").unwrap();
        let backup = backup_path(&source).unwrap();
        assert_eq!(backup, dir.path().join("doc.txt.bak"));
        assert_eq!(fs::read(&backup).unwrap(), b"body");
        assert_eq!(fs::read(&source).unwrap(), b"body");
    }

    #[test]
    fn guard_binary_reports_the_container_kind() {
        let error = guard_binary(b"%PDF-1.7", "x.pdf", false, TEXT_TOOL_ADVICE).unwrap_err();
        assert_eq!(error.code, 2);
        assert!(error.message.contains("a PDF"));
        assert!(guard_binary(b"%PDF-1.7", "x.pdf", true, TEXT_TOOL_ADVICE).is_ok());
    }
}
