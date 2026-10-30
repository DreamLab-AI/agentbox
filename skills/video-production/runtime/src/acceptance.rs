//! Acceptance is editorial: no tool here can back it.
//!
//! The thresholds the measuring tools use are borrowed numbers, and a
//! `calibrated` flag in a config file is an assertion anyone can edit. The
//! calibrated-acceptance mechanism was therefore removed (ADR-2163): every
//! receipt reports `provisional: true`, `acceptance_backing: false` and
//! `acceptance: "editorial"`, and a verdict (`PASS`, `FAIL`, `BLOCKED`,
//! `NOT_RUN`) is only a measurement. A stale config that still claims
//! calibration is refused so the claim cannot be silently ignored.
use serde_json::{Value, json};

/// The value of `acceptance` on every receipt.
pub const EDITORIAL: &str = "editorial";

/// Refuse a threshold set or config that claims calibration.
///
/// `calibrated` is the legacy flag and `calibration_present` whether a legacy
/// `calibration` field was supplied. `tool` names the caller in the error.
///
/// ```
/// use video_production_runtime::acceptance::refuse_calibration;
/// assert!(refuse_calibration("seam-qa", false, false).is_ok());
/// assert!(refuse_calibration("seam-qa", true, false).is_err());
/// assert!(refuse_calibration("seam-qa", false, true).is_err());
/// ```
pub fn refuse_calibration(
    tool: &str,
    calibrated: bool,
    calibration_present: bool,
) -> Result<(), String> {
    if calibrated || calibration_present {
        return Err(format!(
            "{tool}: calibrated acceptance was removed (ADR-2163); acceptance is editorial"
        ));
    }
    Ok(())
}

/// Deserialize a legacy field so that its mere presence is visible, including an
/// explicit `null` (which plain `Option` would read as absent).
///
/// Use with `#[serde(default, deserialize_with = "crate::acceptance::present")]`.
///
/// ```
/// #[derive(serde::Deserialize)]
/// struct T {
///     #[serde(default, deserialize_with = "video_production_runtime::acceptance::present")]
///     calibration: Option<serde_json::Value>,
/// }
/// let t: T = serde_json::from_str(r#"{"calibration": null}"#).unwrap();
/// assert!(t.calibration.is_some());
/// let t: T = serde_json::from_str("{}").unwrap();
/// assert!(t.calibration.is_none());
/// ```
pub fn present<'de, D>(d: D) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    <serde_json::Value as serde::Deserialize>::deserialize(d).map(Some)
}

/// Stamp a receipt as measurement-only: provisional, never acceptance-backing.
///
/// ```
/// use serde_json::json;
/// use video_production_runtime::acceptance::stamp;
/// let mut r = json!({"verdict": "PASS"});
/// stamp(&mut r);
/// assert_eq!(r["acceptance"], "editorial");
/// assert_eq!(r["acceptance_backing"], false);
/// ```
pub fn stamp(receipt: &mut Value) {
    receipt["provisional"] = json!(true);
    receipt["acceptance_backing"] = json!(false);
    receipt["acceptance"] = json!(EDITORIAL);
}
