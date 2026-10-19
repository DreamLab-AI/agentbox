//! `.ingest-state.json` — video-id delta-detection state shared by
//! `podcast-ingest` and `podcast-bulk-ingest`.
//!
//! There is one shape, the nested `{videos, assertions, created_pages}`. The
//! Python originals disagreed: `ingest.py` wrote that nested form while
//! `bulk_ingest.py` wrote a flat `{video_id: record}`, and the file on disk
//! today is a hybrid of the two. Loading accepts all of them and folds them
//! into the nested form; saving always writes it, after keeping a one-off copy
//! of a legacy-shaped file. A file that cannot be understood is an error, never
//! an empty history: reading one as empty is how 242 recorded episodes were
//! overwritten by a run that saw none.

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
    /// Absent in some legacy records.
    #[serde(default)]
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

fn invalid(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.into())
}

/// Whether a JSON value looks like a [`VideoRecord`] (`status` and `file`).
fn is_video_record(v: &serde_json::Value) -> bool {
    v.as_object()
        .map(|o| o.contains_key("status") && o.contains_key("file"))
        .unwrap_or(false)
}

/// Parse state text in any of the accepted shapes: nested, flat (bulk), or the
/// hybrid on disk. Anything else is [`io::ErrorKind::InvalidData`].
fn parse_state(text: &str) -> io::Result<IngestState> {
    use serde_json::Value;
    let value: Value = serde_json::from_str(text).map_err(|e| invalid(e.to_string()))?;
    let Value::Object(map) = value else {
        return Err(invalid("state is not a JSON object"));
    };
    let mut state = IngestState::default();
    for (key, val) in map {
        match key.as_str() {
            "videos" => {
                state.videos =
                    serde_json::from_value(val).map_err(|e| invalid(format!("`videos`: {e}")))?;
            }
            "assertions" => {
                state.assertions = serde_json::from_value(val)
                    .map_err(|e| invalid(format!("`assertions`: {e}")))?;
            }
            "created_pages" => {
                state.created_pages = serde_json::from_value(val)
                    .map_err(|e| invalid(format!("`created_pages`: {e}")))?;
            }
            _ if is_video_record(&val) => {
                let record: VideoRecord = serde_json::from_value(val)
                    .map_err(|e| invalid(format!("video `{key}`: {e}")))?;
                // A record under `videos` wins over a stray flat one.
                state.videos.entry(key).or_insert(record);
            }
            _ => return Err(invalid(format!("unrecognised top-level key `{key}`"))),
        }
    }
    Ok(state)
}

/// Load the state at `state_path`. A missing file is the only case that yields
/// an empty state; an unreadable, unparseable or wrong-typed file is an error
/// so the caller stops instead of overwriting history.
pub fn load_ingest_state(state_path: &Path) -> io::Result<IngestState> {
    if !state_path.exists() {
        return Ok(IngestState::default());
    }
    let text = fs::read_to_string(state_path)?;
    parse_state(&text).map_err(|e| invalid(format!("{}: {e}", state_path.display())))
}

/// Whether the file at `state_path` is in a legacy (non-nested) shape.
fn is_legacy_shape(state_path: &Path) -> bool {
    fs::read_to_string(state_path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.as_object().map(|o| !o.contains_key("videos")))
        .unwrap_or(false)
}

/// Save `state` in the nested shape, atomically (temp file in the same
/// directory, then rename). If the file on disk is legacy-shaped it is first
/// copied, once, to `<path>.pre-nested.bak`.
pub fn save_ingest_state(state_path: &Path, state: &IngestState) -> io::Result<()> {
    let name = state_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| ".ingest-state.json".to_string());
    let dir = state_path.parent().unwrap_or_else(|| Path::new("."));
    if state_path.exists() && is_legacy_shape(state_path) {
        let bak = dir.join(format!("{name}.pre-nested.bak"));
        if !bak.exists() {
            fs::copy(state_path, &bak)?;
        }
    }
    let json = to_json_pretty_ascii(state).map_err(invalid_from)?;
    let tmp = dir.join(format!("{name}.tmp-{}", std::process::id()));
    fs::write(&tmp, json)?;
    fs::rename(&tmp, state_path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn invalid_from<E: std::fmt::Display>(e: E) -> io::Error {
    invalid(e.to_string())
}

/// The flat video map `podcast-bulk-ingest` works on; it is the `videos` part
/// of [`IngestState`] and is saved through it so nothing else is lost.
pub type BulkState = IndexMap<String, VideoRecord>;

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

    /// A hybrid file as it is on disk today: video ids at the top level beside
    /// `assertions` and `created_pages` (synthetic ids and text).
    const LEGACY_HYBRID: &str = r#"{
  "vid-aaa": {"status": "downloaded", "file": "a.md", "date": "2026-08-01T00:00:00"},
  "vid-bbb": {"status": "downloaded", "file": "b.md"},
  "assertions": {"fp1": {"claim": "c", "source": "s", "file": "a.md", "date": "d"}},
  "created_pages": [{"page": "P", "slug": "p", "date": "d", "assertions": 2}]
}"#;

    #[test]
    fn a_legacy_flat_file_loads_without_losing_a_video() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        std::fs::write(&path, LEGACY_HYBRID).unwrap();
        let state = load_ingest_state(&path).unwrap();
        assert_eq!(state.videos.len(), 2);
        assert_eq!(state.videos["vid-aaa"].file, "a.md");
        assert_eq!(state.videos["vid-bbb"].date, "", "a missing date defaults");
        assert_eq!(state.assertions.len(), 1);
        assert_eq!(state.created_pages.len(), 1);
        assert_eq!(state.created_pages[0].slug, "p");
    }

    #[test]
    fn a_pure_flat_bulk_file_loads_as_videos() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        std::fs::write(
            &path,
            r#"{"v1": {"status": "downloaded", "file": "x.md", "date": "d"}}"#,
        )
        .unwrap();
        let state = load_ingest_state(&path).unwrap();
        assert_eq!(state.videos.len(), 1);
        assert!(state.assertions.is_empty());
    }

    #[test]
    fn a_nested_file_with_stray_flat_ids_keeps_both() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        std::fs::write(
            &path,
            r#"{"videos": {"n1": {"status": "downloaded", "file": "n.md", "date": "d"}},
                "f1": {"status": "downloaded", "file": "f.md", "date": "d"}}"#,
        )
        .unwrap();
        let state = load_ingest_state(&path).unwrap();
        assert_eq!(state.videos.len(), 2);
    }

    #[test]
    fn a_corrupt_file_is_an_error_and_is_left_untouched() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        std::fs::write(&path, "{ this is not json").unwrap();
        assert!(load_ingest_state(&path).is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{ this is not json"
        );
    }

    #[test]
    fn a_wrong_typed_file_is_an_error() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        for bad in [
            "[1, 2]",
            r#"{"videos": []}"#,
            r#"{"v": 5}"#,
            r#"{"created_pages": {}}"#,
        ] {
            std::fs::write(&path, bad).unwrap();
            assert!(load_ingest_state(&path).is_err(), "{bad}");
        }
    }

    #[test]
    fn saving_a_legacy_file_backs_it_up_once_and_writes_nested() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        std::fs::write(&path, LEGACY_HYBRID).unwrap();
        let mut state = load_ingest_state(&path).unwrap();
        save_ingest_state(&path, &state).unwrap();
        let bak = dir.path().join(".ingest-state.json.pre-nested.bak");
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), LEGACY_HYBRID);
        let nested: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(nested["videos"].as_object().unwrap().len(), 2);
        assert!(nested.get("vid-aaa").is_none());

        // Saving again never overwrites the backup with the nested file.
        state.videos.shift_remove("vid-bbb");
        save_ingest_state(&path, &state).unwrap();
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), LEGACY_HYBRID);
        assert_eq!(load_ingest_state(&path).unwrap().videos.len(), 1);
    }

    #[test]
    fn a_nested_file_gets_no_backup() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        save_ingest_state(&path, &IngestState::default()).unwrap();
        save_ingest_state(&path, &IngestState::default()).unwrap();
        assert!(!dir
            .path()
            .join(".ingest-state.json.pre-nested.bak")
            .exists());
    }

    #[test]
    fn save_is_atomic_and_leaves_no_temp_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        save_ingest_state(&path, &IngestState::default()).unwrap();
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec![".ingest-state.json".to_string()], "{names:?}");
    }

    #[test]
    fn touching_only_videos_preserves_assertions_and_pages() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".ingest-state.json");
        std::fs::write(&path, LEGACY_HYBRID).unwrap();
        let mut state = load_ingest_state(&path).unwrap();
        state.videos.insert(
            "vid-new".to_string(),
            VideoRecord {
                status: "downloaded".to_string(),
                file: "n.md".to_string(),
                date: "d".to_string(),
            },
        );
        save_ingest_state(&path, &state).unwrap();
        let back = load_ingest_state(&path).unwrap();
        assert_eq!(back.videos.len(), 3);
        assert_eq!(back.assertions.len(), 1);
        assert_eq!(back.created_pages.len(), 1);
    }
}
