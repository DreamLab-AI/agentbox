//! Phase 3: verification — port of `phase_verify` in `ingest.py`.
//!
//! In cron mode the Python original notes that agent-mode callers should use
//! the `perplexity_search` MCP tool instead of this tier-aware pass-through;
//! this port keeps the same pass-through behaviour as the batch/cron path.

use super::pyval::{get_f64, get_tier, Assertion};
use indexmap::IndexMap;

/// `TIER_THRESHOLDS = {1: 0.7, 2: 0.5, 3: 0.4}` — tier 1 (hard facts) needs
/// the highest confidence to survive verification; unknown tiers fall back
/// to the tier-1 (strictest) threshold, matching `TIER_THRESHOLDS.get(tier, 0.7)`.
fn tier_threshold(tier: i64) -> f64 {
    match tier {
        1 => 0.7,
        2 => 0.5,
        3 => 0.4,
        _ => 0.7,
    }
}

/// Port of `phase_verify`.
pub fn phase_verify(
    assertions_by_file: &IndexMap<String, Vec<Assertion>>,
) -> IndexMap<String, Vec<Assertion>> {
    let mut verified = IndexMap::new();
    for (filename, assertions) in assertions_by_file {
        let kept: Vec<Assertion> = assertions
            .iter()
            .filter(|a| {
                let tier = get_tier(a, "tier", 1);
                get_f64(a, "confidence", 0.0) >= tier_threshold(tier)
            })
            .cloned()
            .collect();
        if !kept.is_empty() {
            verified.insert(filename.clone(), kept);
        }
    }
    verified
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn assertion(tier: i64, confidence: f64) -> Assertion {
        match json!({"tier": tier, "confidence": confidence}) {
            serde_json::Value::Object(o) => o,
            _ => unreachable!(),
        }
    }

    #[test]
    fn tier1_needs_0_7() {
        let mut m = IndexMap::new();
        m.insert(
            "ep.md".to_string(),
            vec![assertion(1, 0.65), assertion(1, 0.75)],
        );
        let verified = phase_verify(&m);
        assert_eq!(verified["ep.md"].len(), 1);
    }

    #[test]
    fn tier3_needs_only_0_4() {
        let mut m = IndexMap::new();
        m.insert("ep.md".to_string(), vec![assertion(3, 0.45)]);
        let verified = phase_verify(&m);
        assert_eq!(verified["ep.md"].len(), 1);
    }

    #[test]
    fn empty_kept_omits_file() {
        let mut m = IndexMap::new();
        m.insert("ep.md".to_string(), vec![assertion(1, 0.1)]);
        let verified = phase_verify(&m);
        assert!(!verified.contains_key("ep.md"));
    }
}
