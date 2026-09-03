//! `.ingest-state.json` — video-id delta-detection state, shared shape
//! between `ingest.py::load_state`/`save_state` (nested `{videos, assertions,
//! created_pages}`) and `bulk_ingest.py::load_state`/`save_state` (flat
//! `{video_id: record}`).

use super::pyjson::to_json_pretty_ascii;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

/// `{"status": ..., "file": ..., "date": ...}` — identical shape written by
/// both `phase_download` (ingest.py) and `download_single`/`run_download`
/// (bulk_ingest.py).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VideoRecord {
    pub status: String,
    pub file: String,
    pub date: String,
}

/// `{"page": ..., "slug": ..., "date": ..., "assertions": N}` — written by
/// `_propose_new_pages` in ingest.py.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CreatedPageRecord {
    pub page: String,
    pub slug: String,
    pub date: String,
    pub assertions: usize,
}

/// The nested state ingest.py reads/writes: `{"videos": {...}, "assertions":
/// {...}, "created_pages": [...]}`. Assertion records carry two different
/// shapes across the Python code's lifetime of a single fingerprint key
/// (extraction-time `{claim, source, file, date}` vs. post-integration
/// `{claim, integrated_into, date}`), so they are kept as raw JSON values
/// rather than a single fixed struct.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct IngestState {
    #[serde(default)]
    pub videos: IndexMap<String, VideoRecord>,
    #[serde(default)]
    pub assertions: IndexMap<String, serde_json::Value>,
    #[serde(default)]
    pub created_pages: Vec<CreatedPageRecord>,
}

/// Python:
/// ```python
/// def load_state(state_path: Path) -> dict:
///     if state_path.exists():
///         return json.loads(state_path.read_text())
///     return {"videos": {}, "assertions": {}}
/// ```
pub fn load_ingest_state(state_path: &Path) -> io::Result<IngestState> {
    if state_path.exists() {
        let text = fs::read_to_string(state_path)?;
        serde_json::from_str(&text).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    } else {
        Ok(IngestState::default())
    }
}

/// Python: `state_path.write_text(json.dumps(state, indent=2))`.
pub fn save_ingest_state(state_path: &Path, state: &IngestState) -> io::Result<()> {
    let json =
        to_json_pretty_ascii(state).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(state_path, json)
}

/// The flat state bulk_ingest.py reads/writes: `{video_id: VideoRecord}`.
pub type BulkState = IndexMap<String, VideoRecord>;

pub fn load_bulk_state(state_path: &Path) -> io::Result<BulkState> {
    if state_path.exists() {
        let text = fs::read_to_string(state_path)?;
        serde_json::from_str(&text).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    } else {
        Ok(BulkState::new())
    }
}

pub fn save_bulk_state(state_path: &Path, state: &BulkState) -> io::Result<()> {
    let json =
        to_json_pretty_ascii(state).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(state_path, json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn ingest_state_round_trips_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        let state = load_ingest_state(&path).unwrap();
        assert!(state.videos.is_empty());
        save_ingest_state(&path, &state).unwrap();
        let reloaded = load_ingest_state(&path).unwrap();
        assert!(reloaded.videos.is_empty());
    }

    #[test]
    fn ingest_state_preserves_video_insertion_order() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        let mut state = IngestState::default();
        state.videos.insert(
            "zid".to_string(),
            VideoRecord {
                status: "downloaded".to_string(),
                file: "z.md".to_string(),
                date: "2026-01-01T00:00:00".to_string(),
            },
        );
        state.videos.insert(
            "aid".to_string(),
            VideoRecord {
                status: "downloaded".to_string(),
                file: "a.md".to_string(),
                date: "2026-01-02T00:00:00".to_string(),
            },
        );
        save_ingest_state(&path, &state).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.find("zid").unwrap() < text.find("aid").unwrap());
        assert!(!text.ends_with('\n'));
    }

    #[test]
    fn bulk_state_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        let mut state = BulkState::new();
        state.insert(
            "vid1".to_string(),
            VideoRecord {
                status: "downloaded".to_string(),
                file: "ep.md".to_string(),
                date: "2026-01-01T00:00:00".to_string(),
            },
        );
        save_bulk_state(&path, &state).unwrap();
        let reloaded = load_bulk_state(&path).unwrap();
        assert_eq!(reloaded.get("vid1").unwrap().file, "ep.md");
    }
}
