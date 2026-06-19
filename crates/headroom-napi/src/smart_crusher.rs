use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::ccr_store;
use crate::types::{CcrEntry, CompressResult, SmartCrushOptions};

/// Crush a JSON array by analysing its schema, preserving anchors and outliers,
/// sampling the rest, and emitting CCR sentinels for dropped rows.
pub fn crush(input: &str, options: &SmartCrushOptions) -> Result<CompressResult, String> {
    let target_ratio = options.target_ratio.unwrap_or(0.3);
    let min_items = options.min_items.unwrap_or(2) as usize;
    let original_bytes = input.len() as u32;

    let arr: Vec<Value> =
        serde_json::from_str(input).map_err(|e| format!("invalid JSON array: {e}"))?;

    if arr.is_empty() {
        return Ok(CompressResult {
            compressed: "[]".to_string(),
            original_bytes,
            compressed_bytes: 2,
            ratio: if original_bytes > 0 {
                2.0 / original_bytes as f64
            } else {
                1.0
            },
            ccr_entries: vec![],
        });
    }

    if arr.len() <= min_items.max(2) {
        let compressed = serde_json::to_string(&arr).map_err(|e| e.to_string())?;
        let compressed_bytes = compressed.len() as u32;
        return Ok(CompressResult {
            compressed,
            original_bytes,
            compressed_bytes,
            ratio: compressed_bytes as f64 / original_bytes as f64,
            ccr_entries: vec![],
        });
    }

    // Schema analysis: find common keys across objects.
    let schema = analyse_schema(&arr);

    // Classify each item.
    let mut anchored: HashSet<usize> = HashSet::new();
    let mut error_indices: HashSet<usize> = HashSet::new();

    // Position anchors: first and last.
    anchored.insert(0);
    anchored.insert(arr.len() - 1);

    // Error/outlier detection.
    for (i, item) in arr.iter().enumerate() {
        if contains_error_signal(item) {
            error_indices.insert(i);
        }
    }

    // Calculate how many items we can keep.
    let target_count = ((arr.len() as f64 * target_ratio).ceil() as usize).max(min_items);
    let must_keep: HashSet<usize> = anchored.union(&error_indices).copied().collect();

    // If must-keep already exceeds target, keep them all.
    let kept_indices = if must_keep.len() >= target_count {
        must_keep
    } else {
        // Stratified sampling of the remainder.
        let remaining_budget = target_count - must_keep.len();
        let candidates: Vec<usize> = (0..arr.len())
            .filter(|i| !must_keep.contains(i))
            .collect();

        let mut sampled = must_keep;
        if !candidates.is_empty() && remaining_budget > 0 {
            let step = candidates.len() as f64 / remaining_budget as f64;
            for s in 0..remaining_budget.min(candidates.len()) {
                let idx = (s as f64 * step).floor() as usize;
                if idx < candidates.len() {
                    sampled.insert(candidates[idx]);
                }
            }
        }
        sampled
    };

    // Build output array and collect dropped items for CCR.
    let mut output: Vec<Value> = Vec::with_capacity(arr.len());
    let mut ccr_entries: Vec<CcrEntry> = Vec::new();
    let store = ccr_store::global();

    // Group consecutive dropped items to batch them into single CCR entries.
    let mut drop_run: Vec<&Value> = Vec::new();

    let mut sorted_kept: Vec<usize> = kept_indices.iter().copied().collect();
    sorted_kept.sort();

    let kept_set: HashSet<usize> = sorted_kept.iter().copied().collect();

    // Walk through all items in order.
    for (i, item) in arr.iter().enumerate() {
        if kept_set.contains(&i) {
            // Flush any pending drop run.
            if !drop_run.is_empty() {
                if let Some(entry) = flush_drop_run(&drop_run, &store, &schema) {
                    output.push(entry.0);
                    ccr_entries.push(entry.1);
                }
                drop_run.clear();
            }
            output.push(item.clone());
        } else {
            drop_run.push(item);
        }
    }

    // Flush final drop run.
    if !drop_run.is_empty() {
        if let Some(entry) = flush_drop_run(&drop_run, &store, &schema) {
            output.push(entry.0);
            ccr_entries.push(entry.1);
        }
    }

    let compressed = serde_json::to_string(&output).map_err(|e| e.to_string())?;
    let compressed_bytes = compressed.len() as u32;

    Ok(CompressResult {
        compressed,
        original_bytes,
        compressed_bytes,
        ratio: if original_bytes > 0 {
            compressed_bytes as f64 / original_bytes as f64
        } else {
            1.0
        },
        ccr_entries,
    })
}

/// Analyse common keys across all objects in the array.
fn analyse_schema(arr: &[Value]) -> Vec<String> {
    if arr.is_empty() {
        return vec![];
    }
    let mut key_counts: HashMap<String, usize> = HashMap::new();
    let mut obj_count = 0usize;

    for item in arr {
        if let Value::Object(map) = item {
            obj_count += 1;
            for key in map.keys() {
                *key_counts.entry(key.clone()).or_insert(0) += 1;
            }
        }
    }

    if obj_count == 0 {
        return vec![];
    }

    let threshold = obj_count / 2;
    let mut common: Vec<String> = key_counts
        .into_iter()
        .filter(|(_, count)| *count > threshold)
        .map(|(key, _)| key)
        .collect();
    common.sort();
    common
}

/// Check whether a JSON value contains error/failure signals.
fn contains_error_signal(value: &Value) -> bool {
    match value {
        Value::String(s) => has_error_keyword(s),
        Value::Object(map) => map.values().any(|v| contains_error_signal(v)),
        Value::Array(arr) => arr.iter().any(|v| contains_error_signal(v)),
        _ => false,
    }
}

fn has_error_keyword(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.contains("error")
        || lower.contains("fail")
        || lower.contains("exception")
        || lower.contains("panic")
        || lower.contains("fatal")
}

/// Flush a run of dropped items: serialise them, store in CCR, return sentinel + entry.
fn flush_drop_run(
    items: &[&Value],
    store: &ccr_store::CcrStore,
    _schema: &[String],
) -> Option<(Value, CcrEntry)> {
    let serialised = serde_json::to_string(items).ok()?;
    let data = serialised.as_bytes();
    let hash = ccr_store::ccr_hash(data);
    let size_bytes = data.len() as u32;

    // Store in the CCR backend.
    let _ = store.store(&hash, data);

    let sentinel = serde_json::json!({
        "_ccr_dropped": format!("<<ccr:{} {} rows>>", hash, items.len())
    });

    let entry = CcrEntry { hash, size_bytes };
    Some((sentinel, entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crush_empty_array() {
        let result = crush("[]", &SmartCrushOptions::default()).unwrap();
        assert_eq!(result.compressed, "[]");
        assert!(result.ccr_entries.is_empty());
    }

    #[test]
    fn crush_small_array_passes_through() {
        let input = r#"[{"a":1},{"a":2}]"#;
        let result = crush(input, &SmartCrushOptions::default()).unwrap();
        assert!(result.ccr_entries.is_empty());
    }

    #[test]
    fn crush_large_array_compresses() {
        let items: Vec<Value> = (0..20)
            .map(|i| serde_json::json!({"idx": i, "data": "x".repeat(50)}))
            .collect();
        let input = serde_json::to_string(&items).unwrap();
        let opts = SmartCrushOptions {
            target_ratio: Some(0.3),
            min_items: Some(2),
        };
        let result = crush(&input, &opts).unwrap();
        assert!(result.ratio < 1.0);
        assert!(!result.ccr_entries.is_empty());
    }

    #[test]
    fn crush_preserves_error_items() {
        let mut items: Vec<Value> = (0..10)
            .map(|i| serde_json::json!({"idx": i, "status": "ok"}))
            .collect();
        items[5] = serde_json::json!({"idx": 5, "status": "error: connection refused"});
        let input = serde_json::to_string(&items).unwrap();
        let opts = SmartCrushOptions {
            target_ratio: Some(0.2),
            min_items: Some(2),
        };
        let result = crush(&input, &opts).unwrap();
        // The error item should appear in the compressed output.
        assert!(result.compressed.contains("connection refused"));
    }
}
