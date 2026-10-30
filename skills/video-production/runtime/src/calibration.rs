//! Calibration claims on threshold sets, honoured only with verifiable evidence.
//!
//! A threshold set's `calibrated: true` is a claim made in a configuration file
//! that anyone can edit, so on its own it must never let a borrowed threshold
//! back acceptance. A claim counts only when the set also names a
//! `calibration` record by path and sha256, the bytes match, and the record is
//! a `threshold-calibration/1` document for the same tool and provenance. A
//! claim without such evidence is refused, never silently downgraded, so a
//! receipt cannot be mistaken for a calibrated one.
use crate::{comfy::read_verified, paths::Root};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{error::Error, path::Path};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// Schema tag a calibration record must carry.
pub const SCHEMA: &str = "threshold-calibration/1";

/// Reference to a calibration record, relative to the production root.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    /// Root-relative path of the `threshold-calibration/1` record.
    pub path: String,
    /// Declared sha256 of the record's bytes.
    pub sha256: String,
}

/// Decide whether a threshold set is calibrated.
///
/// Returns `Ok(None)` for an uncalibrated set, `Ok(Some(receipt))` with the
/// verified record's path and hash for a substantiated claim, and an error
/// for a claim without matching evidence.
pub fn honour(
    root: &Root,
    tool: &str,
    provenance: &str,
    claimed: bool,
    evidence: Option<&Evidence>,
) -> Result<Option<Value>> {
    if !claimed {
        return Ok(None);
    }
    let evidence = evidence.ok_or_else(|| {
        format!("{tool}: calibrated: true needs a calibration {{path, sha256}} record")
    })?;
    let path = root.resolve(Path::new(&evidence.path))?;
    let (bytes, digest) = read_verified(&path, Some(&evidence.sha256))
        .map_err(|e| format!("{tool}: calibration record rejected: {e}"))?;
    let record: Value = serde_json::from_slice(&bytes)?;
    let field = |k: &str| record[k].as_str().unwrap_or_default();
    if field("schema") != SCHEMA || field("tool") != tool || field("provenance") != provenance {
        return Err(format!(
            "{tool}: calibration record must be {SCHEMA} for tool {tool} and provenance {provenance}"
        )
        .into());
    }
    Ok(Some(json!({"path":root.rel(&path)?,"sha256":digest})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comfy::sha256_hex;

    fn fixture() -> (std::path::PathBuf, Root) {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("calibration-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        let root = Root::new(&dir).unwrap();
        (dir, root)
    }

    fn write(dir: &Path, name: &str, value: Value) -> Evidence {
        let bytes = serde_json::to_vec(&value).unwrap();
        std::fs::write(dir.join(name), &bytes).unwrap();
        Evidence {
            path: name.into(),
            sha256: sha256_hex(&bytes),
        }
    }

    #[test]
    fn an_unclaimed_set_is_uncalibrated_without_evidence() {
        let (dir, root) = fixture();
        assert_eq!(honour(&root, "seam-qa", "p", false, None).unwrap(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_bare_claim_is_refused() {
        let (dir, root) = fixture();
        let err = honour(&root, "seam-qa", "p", true, None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("calibration"), "{err}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn matching_evidence_is_honoured_and_receipted() {
        let (dir, root) = fixture();
        let good = write(
            &dir,
            "cal.json",
            json!({"schema":SCHEMA,"tool":"seam-qa","provenance":"estate-2026-11"}),
        );
        let receipt = honour(&root, "seam-qa", "estate-2026-11", true, Some(&good))
            .unwrap()
            .unwrap();
        assert_eq!(receipt["path"], "cal.json");
        assert_eq!(receipt["sha256"], good.sha256);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn wrong_hash_tool_provenance_or_schema_is_refused() {
        let (dir, root) = fixture();
        let good = write(
            &dir,
            "cal.json",
            json!({"schema":SCHEMA,"tool":"seam-qa","provenance":"p"}),
        );
        let stale = Evidence {
            sha256: "0".repeat(64),
            ..good.clone()
        };
        assert!(honour(&root, "seam-qa", "p", true, Some(&stale)).is_err());
        assert!(honour(&root, "stitch", "p", true, Some(&good)).is_err());
        assert!(honour(&root, "seam-qa", "other", true, Some(&good)).is_err());
        let wrong = write(
            &dir,
            "w.json",
            json!({"schema":"x/1","tool":"seam-qa","provenance":"p"}),
        );
        assert!(honour(&root, "seam-qa", "p", true, Some(&wrong)).is_err());
        let escape = Evidence {
            path: "../outside.json".into(),
            sha256: good.sha256.clone(),
        };
        assert!(honour(&root, "seam-qa", "p", true, Some(&escape)).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
