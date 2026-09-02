//! Phase 5: mark complete — port of `phase_mark_complete` in `ingest.py`.

use super::pyval::Assertion;
use crate::common::ingest_status::set_ingest_status;
use indexmap::IndexMap;
use std::path::PathBuf;

/// Port of `phase_mark_complete`.
pub fn phase_mark_complete(
    files: &[PathBuf],
    assertions_by_file: &IndexMap<String, Vec<Assertion>>,
) {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    for md_path in files {
        let file_name = md_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let count = assertions_by_file
            .get(&file_name)
            .map(|v| v.len())
            .unwrap_or(0);
        let status = if count > 0 {
            format!("processed:{today}:{count}-assertions")
        } else {
            "skipped".to_string()
        };
        let _ = set_ingest_status(md_path, &status);
    }
}
