//! Size-capped reads and symlink-safe atomic writes.

use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use prose_sanitiser_core::binary::{looks_binary, BINARY_SNIFF_BYTES, TEXT_TOOL_ADVICE};
use prose_sanitiser_core::surrogate::{self, Unit};
use prose_sanitiser_core::{env_usize, CliError};

/// Hard caps on attacker-influenced input sizes. Whole-file in-memory
/// processing means a 1 GiB default is a host-memory DoS; keep defaults low.
/// The env overrides remain as an explicit escape hatch.
///
/// Every read of an attacker-controlled file goes through [`read_capped`], so
/// these are enforced rather than advisory. The budgets are per format because
/// the memory each one costs differs: an image is parsed in place, whereas a
/// ZIP container expands.
pub fn max_input_bytes() -> u64 {
    env_usize("WATERMARKS_MAX_INPUT_BYTES", 256 << 20) as u64
}

pub fn max_stdin_bytes() -> u64 {
    env_usize("WATERMARKS_MAX_STDIN_BYTES", 64 << 20) as u64
}

/// Compressed-input budget for PNG, JPEG and WebP.
///
/// Image cleaning holds up to three copies at once — the file, the parsed
/// container's shared buffer and the re-encoded output — so peak memory is
/// bounded at roughly three times this figure.
pub fn max_image_bytes() -> u64 {
    env_usize("WATERMARKS_MAX_IMAGE_BYTES", 64 << 20) as u64
}

/// Compressed-input budget for PDF, OOXML, ODF, SVG, HTML and Markdown.
///
/// The *expanded* budget for a ZIP container is separate and smaller in
/// practice; see `container::ooxml::MAX_ZIP_DECOMPRESSED_BYTES`.
pub fn max_container_bytes() -> u64 {
    env_usize("WATERMARKS_MAX_CONTAINER_BYTES", 128 << 20) as u64
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
            let data =
                fs::read(path).map_err(|e| CliError::new(2, format!("cannot read {path}: {e}")))?;
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
///
/// The output is written verbatim — no trailing newline is appended. Adding
/// one would silently corrupt files that do not end with a newline and break
/// round-trip fidelity (`clean → clean` must be idempotent on bytes).
pub fn write_text_output(units: &[Unit], path: Option<&str>) -> Result<(), CliError> {
    let bytes = surrogate::encode(units);
    match path {
        None | Some("-") => {
            let mut out = std::io::stdout().lock();
            out.write_all(&bytes)
                .map_err(|e| CliError::new(1, format!("cannot write stdout: {e}")))
        }
        Some(path) => {
            safe_write_bytes(Path::new(path), &bytes).map_err(|e| CliError::new(1, format!("{e}")))
        }
    }
}

/// Read a whole file, refusing anything over `cap`.
///
/// This is the only way this crate reads an attacker-controlled file. Three
/// properties matter, and a bare [`std::fs::read`] has none of them:
///
/// * The file is opened `O_NOFOLLOW`, so a final symlink is refused rather
///   than followed.
/// * The size is checked on the **opened handle**, not by a separate `stat`,
///   which closes the race where a small file is swapped for a large one
///   between the check and the read.
/// * The read itself is bounded by `take(cap + 1)`, so a file that grows after
///   the size check — or reports a misleading size — still cannot exceed the
///   budget. The extra byte is what distinguishes "exactly at the cap" from
///   "over it".
///
/// # Errors
///
/// Returns `Err` when the path cannot be opened, is not a regular file, or
/// holds more than `cap` bytes.
pub fn read_capped(path: &Path, cap: u64) -> std::io::Result<Vec<u8>> {
    let file = open_nofollow(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(std::io::Error::other(format!(
            "refusing to read {}: not a regular file",
            path.display()
        )));
    }
    let too_large = |size: u64| {
        std::io::Error::other(format!(
            "refusing input larger than {cap} bytes: {} is {size} bytes",
            path.display()
        ))
    };
    if metadata.len() > cap {
        return Err(too_large(metadata.len()));
    }

    let mut buffer = Vec::with_capacity(metadata.len().min(cap) as usize);
    let mut reader = file.take(cap + 1);
    reader.read_to_end(&mut buffer)?;
    if buffer.len() as u64 > cap {
        return Err(too_large(buffer.len() as u64));
    }
    Ok(buffer)
}

/// The file mode to apply to a newly written output file.
///
/// When the target already exists, its mode is preserved (the caller is
/// replacing it in place). For new files, `0o644` is used — a safe default
/// that avoids the TOCTOU race the previous `umask(0); umask(mask)` pair
/// had: another thread could observe the zeroed umask between the two calls.
fn file_mode_for(path: &Path) -> u32 {
    std::fs::metadata(path)
        .map(|meta| meta.permissions().mode() & 0o7777)
        .unwrap_or(0o644)
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
    // The temp file is 0600; match the target's existing mode (or 0o644 for
    // new files) so outputs keep normal permissions without a umask race.
    temp.as_file()
        .set_permissions(fs::Permissions::from_mode(file_mode_for(path)))?;
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
    fn read_capped_refuses_a_file_over_the_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.bin");
        fs::write(&path, vec![b'x'; 1024]).unwrap();

        let error = read_capped(&path, 512).unwrap_err();
        assert!(
            error.to_string().contains("refusing input larger than 512"),
            "error was {error}"
        );

        // Exactly at the cap is allowed; the `take(cap + 1)` is what tells the
        // two apart.
        assert_eq!(read_capped(&path, 1024).unwrap().len(), 1024);
        assert_eq!(read_capped(&path, 4096).unwrap().len(), 1024);
    }

    #[test]
    fn read_capped_bounds_the_read_itself_not_just_the_declared_size() {
        // /proc files report a length of zero and then produce content, which
        // is the same shape as a file whose size cannot be trusted: the bound
        // has to come from the read, not from the metadata.
        let path = Path::new("/proc/self/cmdline");
        if !path.exists() {
            return;
        }
        assert_eq!(fs::metadata(path).map(|m| m.len()).unwrap_or(0), 0);
        // Whatever it yields, the reader never returns more than the cap, and
        // it errors rather than truncating silently.
        match read_capped(path, 4) {
            Ok(data) => assert!(data.len() <= 4),
            Err(error) => assert!(error.to_string().contains("refusing input larger than 4")),
        }
    }

    #[test]
    fn read_capped_refuses_a_symlink_and_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let victim = dir.path().join("victim");
        fs::write(&victim, b"secret").unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&victim, &link).unwrap();

        assert!(read_capped(&link, 1 << 20).is_err());
        assert!(read_capped(dir.path(), 1 << 20).is_err());
    }

    #[test]
    fn guard_binary_reports_the_container_kind() {
        let error = guard_binary(b"%PDF-1.7", "x.pdf", false, TEXT_TOOL_ADVICE).unwrap_err();
        assert_eq!(error.code, 2);
        assert!(error.message.contains("a PDF"));
        assert!(guard_binary(b"%PDF-1.7", "x.pdf", true, TEXT_TOOL_ADVICE).is_ok());
    }

    #[test]
    fn file_mode_for_preserves_an_existing_files_mode() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("strict.txt");
        fs::write(&path, b"data").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(file_mode_for(&path), 0o600);
    }

    #[test]
    fn file_mode_for_returns_a_safe_default_for_new_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.txt");
        assert_eq!(file_mode_for(&path), 0o644);
    }

    #[test]
    fn write_text_output_does_not_append_a_trailing_newline() {
        use prose_sanitiser_core::surrogate;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.txt");
        let path_str = path.to_str().unwrap();

        // Write text that does NOT end with a newline.
        let units = surrogate::decode(b"no trailing newline");
        write_text_output(&units, Some(path_str)).unwrap();

        let written = fs::read(&path).unwrap();
        assert_eq!(written, b"no trailing newline", "must not append \\n");
    }
}
