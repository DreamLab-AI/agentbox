//! `ingest-status::` marker on line 1 of every transcript markdown file.
//!
//! Ported from `ingest.py`'s `get_ingest_status`/`set_ingest_status` and the
//! matching constants in `bulk_ingest.py`.

use std::fs;
use std::io;
use std::path::Path;

pub const INGEST_PREFIX: &str = "ingest-status::";
pub const INGEST_STATUS_DOWNLOADED_LINE: &str = "ingest-status:: downloaded";

/// Python:
/// ```python
/// def get_ingest_status(content: str) -> str | None:
///     if content.startswith(INGEST_PREFIX):
///         return content.split('\n', 1)[0].replace(INGEST_PREFIX, '').strip()
///     return None
/// ```
pub fn get_ingest_status(content: &str) -> Option<String> {
    if !content.starts_with(INGEST_PREFIX) {
        return None;
    }
    let first_line = content.split('\n').next().unwrap_or("");
    Some(first_line.replace(INGEST_PREFIX, "").trim().to_string())
}

/// Python:
/// ```python
/// def set_ingest_status(path: Path, status: str):
///     content = path.read_text()
///     if content.startswith(INGEST_PREFIX):
///         content = content.split('\n', 1)[1]
///     path.write_text(f"{INGEST_PREFIX} {status}\n{content}")
/// ```
pub fn set_ingest_status(path: &Path, status: &str) -> io::Result<()> {
    let content = fs::read_to_string(path)?;
    let rest = if content.starts_with(INGEST_PREFIX) {
        content.split_once('\n').map(|x| x.1).unwrap_or_default()
    } else {
        content.as_str()
    };
    let new_content = format!("{INGEST_PREFIX} {status}\n{rest}");
    fs::write(path, new_content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_status_none_when_absent() {
        assert_eq!(get_ingest_status("# Title\n\nbody"), None);
    }

    #[test]
    fn get_status_present() {
        assert_eq!(
            get_ingest_status("ingest-status:: downloaded\n# Title\n"),
            Some("downloaded".to_string())
        );
    }

    #[test]
    fn set_status_replaces_first_line() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("ep.md");
        fs::write(&path, "ingest-status:: downloaded\n# Title\n\nbody\n").unwrap();
        set_ingest_status(&path, "processed:2026-01-01:3-assertions").unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(
            content,
            "ingest-status:: processed:2026-01-01:3-assertions\n# Title\n\nbody\n"
        );
    }

    #[test]
    fn set_status_prepends_when_absent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("ep.md");
        fs::write(&path, "# Title\n\nbody\n").unwrap();
        set_ingest_status(&path, "downloaded").unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "ingest-status:: downloaded\n# Title\n\nbody\n");
    }
}
