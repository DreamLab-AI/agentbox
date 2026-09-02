//! Phase 4: mark existing files that lack an `ingest-status` — port of
//! `run_mark_files` from `bulk_ingest.py`.

use crate::common::ingest_status::{INGEST_PREFIX, INGEST_STATUS_DOWNLOADED_LINE};
use std::path::Path;

/// Port of `run_mark_files`.
pub fn run_mark_files(out_dir: &Path) {
    let mut md_files: Vec<std::path::PathBuf> = std::fs::read_dir(out_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    md_files.sort();

    let mut marked = 0usize;
    for md_path in &md_files {
        let content = std::fs::read_to_string(md_path).unwrap_or_default();
        if content.starts_with(INGEST_PREFIX) {
            continue;
        }
        let new_content = format!("{INGEST_STATUS_DOWNLOADED_LINE}\n{content}");
        if std::fs::write(md_path, new_content).is_ok() {
            marked += 1;
        }
    }
    println!("Marked {marked} files with ingest-status.");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn marks_unmarked_files_only() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "# Title\n\nbody\n").unwrap();
        std::fs::write(
            dir.path().join("b.md"),
            "ingest-status:: processed:2026-01-01:1-assertions\n# Title\n",
        )
        .unwrap();
        run_mark_files(dir.path());
        let a = std::fs::read_to_string(dir.path().join("a.md")).unwrap();
        let b = std::fs::read_to_string(dir.path().join("b.md")).unwrap();
        assert!(a.starts_with("ingest-status:: downloaded\n# Title"));
        assert!(b.starts_with("ingest-status:: processed:2026-01-01:1-assertions\n"));
    }
}
