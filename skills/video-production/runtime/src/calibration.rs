//! Calibration claims on threshold sets, honoured only with verifiable evidence.
//!
//! A threshold set's `calibrated: true` is a claim made in a configuration file
//! that anyone can edit, so on its own it must never let a borrowed threshold
//! back acceptance. A claim counts only when the set also names a
//! `calibration` record by path and sha256, the bytes match, and the record is
//! a `threshold-calibration/2` document for the same tool and provenance. A
//! claim without such evidence is refused, never silently downgraded, so a
//! receipt cannot be mistaken for a calibrated one.
use crate::{
    comfy::{read_verified, sha256_hex},
    paths::Root,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{error::Error, path::Path};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// Schema tag a calibration record must carry.
pub const SCHEMA: &str = "threshold-calibration/2";

/// Reference to a hashed file (the calibration record, or a data file it lists), relative to the production root.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    /// Root-relative path of the `threshold-calibration/2` record.
    pub path: String,
    /// Declared sha256 of the file's bytes.
    pub sha256: String,
}

/// Canonical sha256 of a threshold object: sorted keys, compact JSON, with the
/// top-level `calibrated` and `calibration` fields removed.
///
/// Pass the *effective* set (a deserialised, defaulted struct), never the raw
/// file, so omitted fields hash as the values actually used.
pub fn thresholds_digest<T: Serialize>(thresholds: &T) -> Result<String> {
    let mut value = serde_json::to_value(thresholds)?;
    let object = value
        .as_object_mut()
        .ok_or("threshold set must serialise to an object")?;
    object.remove("calibrated");
    object.remove("calibration");
    // `Value` maps are ordered (BTreeMap), so compact output is canonical.
    Ok(sha256_hex(&serde_json::to_vec(&value)?))
}

/// Decide whether a threshold set is calibrated.
///
/// Returns `Ok(None)` for an uncalibrated set, `Ok(Some(receipt))` with the
/// verified record's path and hash for a substantiated claim, and an error
/// for a claim without matching evidence or whose record binds other values.
pub fn honour<T: Serialize>(
    root: &Root,
    tool: &str,
    provenance: &str,
    claimed: bool,
    evidence: Option<&Evidence>,
    thresholds: &T,
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
    let effective = thresholds_digest(thresholds)?;
    if field("thresholds_sha256") != effective {
        return Err(format!(
            "{tool}: calibration record binds thresholds {} but the set in use hashes to {effective}",
            field("thresholds_sha256")
        )
        .into());
    }
    let files = record["evidence"]
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or_else(|| format!("{tool}: calibration record lists no evidence files"))?;
    let mut checked = Vec::new();
    for file in files {
        let item: Evidence = serde_json::from_value(file.clone())
            .map_err(|e| format!("{tool}: bad calibration evidence entry: {e}"))?;
        let data = root.resolve(Path::new(&item.path))?;
        let (_, sha) = read_verified(&data, Some(&item.sha256))
            .map_err(|e| format!("{tool}: calibration evidence {} rejected: {e}", item.path))?;
        checked.push(json!({"path":root.rel(&data)?,"sha256":sha}));
    }
    Ok(Some(json!({"path":root.rel(&path)?,"sha256":digest,
        "thresholds_sha256":effective,"evidence":checked})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize)]
    struct Set {
        provenance: String,
        calibrated: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        calibration: Option<Evidence>,
        pop_ratio: f64,
    }

    fn set(pop: f64) -> Set {
        Set {
            provenance: "p".into(),
            calibrated: true,
            calibration: None,
            pop_ratio: pop,
        }
    }

    fn fixture() -> (std::path::PathBuf, Root) {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("calibration-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("data.csv"), b"clip,pop\na,1.2\n").unwrap();
        let root = Root::new(&dir).unwrap();
        (dir, root)
    }

    fn data() -> Value {
        json!({"path":"data.csv","sha256":sha256_hex(b"clip,pop\na,1.2\n")})
    }

    fn write(dir: &Path, name: &str, value: Value) -> Evidence {
        let bytes = serde_json::to_vec(&value).unwrap();
        std::fs::write(dir.join(name), &bytes).unwrap();
        Evidence {
            path: name.into(),
            sha256: sha256_hex(&bytes),
        }
    }

    fn record(tool: &str, thresholds: &Set) -> Value {
        json!({"schema":SCHEMA,"tool":tool,"provenance":"p",
            "thresholds_sha256":thresholds_digest(thresholds).unwrap(),"evidence":[data()]})
    }

    #[test]
    fn an_unclaimed_set_is_uncalibrated_without_evidence() {
        let (dir, root) = fixture();
        assert_eq!(
            honour(&root, "seam-qa", "p", false, None, &set(1.3)).unwrap(),
            None
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_bare_claim_is_refused() {
        let (dir, root) = fixture();
        let err = honour(&root, "seam-qa", "p", true, None, &set(1.3))
            .unwrap_err()
            .to_string();
        assert!(err.contains("calibration"), "{err}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_digest_ignores_calibration_fields_and_orders_keys() {
        let a = thresholds_digest(&set(1.3)).unwrap();
        let mut other = set(1.3);
        other.calibrated = false;
        other.calibration = Some(Evidence {
            path: "x".into(),
            sha256: "y".into(),
        });
        assert_eq!(a, thresholds_digest(&other).unwrap());
        let by_hand = sha256_hex(br#"{"pop_ratio":1.3,"provenance":"p"}"#);
        assert_eq!(a, by_hand);
        assert_ne!(a, thresholds_digest(&set(1.31)).unwrap());
    }

    #[test]
    fn matching_thresholds_and_evidence_are_honoured_and_receipted() {
        let (dir, root) = fixture();
        let t = set(1.3);
        let good = write(&dir, "cal.json", record("seam-qa", &t));
        let receipt = honour(&root, "seam-qa", "p", true, Some(&good), &t)
            .unwrap()
            .unwrap();
        assert_eq!(receipt["path"], "cal.json");
        assert_eq!(receipt["sha256"], good.sha256);
        assert_eq!(receipt["evidence"][0]["path"], "data.csv");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_record_cannot_back_a_forged_or_different_threshold_set() {
        let (dir, root) = fixture();
        let honest = set(1.3);
        let good = write(&dir, "cal.json", record("seam-qa", &honest));
        // The reviewer's forgery: 1e9 gates under a record for the honest set.
        let err = honour(&root, "seam-qa", "p", true, Some(&good), &set(1e9))
            .unwrap_err()
            .to_string();
        assert!(err.contains("binds thresholds"), "{err}");
        // A record for set A used with set B.
        let b = write(&dir, "b.json", record("seam-qa", &set(2.0)));
        assert!(honour(&root, "seam-qa", "p", true, Some(&b), &honest).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_empty_or_tampered_evidence_is_refused() {
        let (dir, root) = fixture();
        let t = set(1.3);
        let mut empty = record("seam-qa", &t);
        empty["evidence"] = json!([]);
        let e = write(&dir, "e.json", empty);
        assert!(honour(&root, "seam-qa", "p", true, Some(&e), &t).is_err());
        let mut absent = record("seam-qa", &t);
        absent.as_object_mut().unwrap().remove("evidence");
        let a = write(&dir, "a.json", absent);
        assert!(honour(&root, "seam-qa", "p", true, Some(&a), &t).is_err());
        let mut missing = record("seam-qa", &t);
        missing["evidence"] = json!([{"path":"gone.csv","sha256":"0".repeat(64)}]);
        let m = write(&dir, "m.json", missing);
        assert!(honour(&root, "seam-qa", "p", true, Some(&m), &t).is_err());
        let ok = write(&dir, "ok.json", record("seam-qa", &t));
        assert!(honour(&root, "seam-qa", "p", true, Some(&ok), &t).is_ok());
        std::fs::write(dir.join("data.csv"), b"tampered").unwrap();
        let err = honour(&root, "seam-qa", "p", true, Some(&ok), &t)
            .unwrap_err()
            .to_string();
        assert!(err.contains("evidence"), "{err}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn wrong_hash_tool_provenance_schema_or_path_is_refused() {
        let (dir, root) = fixture();
        let t = set(1.3);
        let good = write(&dir, "cal.json", record("seam-qa", &t));
        let stale = Evidence {
            sha256: "0".repeat(64),
            ..good.clone()
        };
        assert!(honour(&root, "seam-qa", "p", true, Some(&stale), &t).is_err());
        assert!(honour(&root, "stitch", "p", true, Some(&good), &t).is_err());
        assert!(honour(&root, "seam-qa", "other", true, Some(&good), &t).is_err());
        let mut v1 = record("seam-qa", &t);
        v1["schema"] = json!("threshold-calibration/1");
        let wrong = write(&dir, "w.json", v1);
        assert!(honour(&root, "seam-qa", "p", true, Some(&wrong), &t).is_err());
        let escape = Evidence {
            path: "../outside.json".into(),
            sha256: good.sha256.clone(),
        };
        assert!(honour(&root, "seam-qa", "p", true, Some(&escape), &t).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
