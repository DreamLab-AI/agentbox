//! Blind before/after judge orchestration — port of `MAX_JUDGE_CHARS`,
//! `_judge_windows`, `_item_seed`, `extract_judge_json`, `JudgeResult`, and
//! `judge_before_after` from `promote.py`.

use super::gemini::{rubric_a_prompt, rubric_b_prompt, run_gemini_judge};
use super::splice::extract_splice_json;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const MAX_JUDGE_CHARS: usize = 6000;

/// Port of `_judge_windows`: comparable excerpts of before/after that always
/// contain the edit. Naive head-truncation auto-rejects every page longer
/// than `max_chars` (the splice sits beyond the cut); instead this locates
/// the first divergence point and windows both versions from the same
/// shared-prefix start offset.
pub fn judge_windows(before: &str, after: &str, max_chars: usize) -> (String, String) {
    if before.chars().count() <= max_chars && after.chars().count() <= max_chars {
        return (before.to_string(), after.to_string());
    }
    let before_chars: Vec<char> = before.chars().collect();
    let after_chars: Vec<char> = after.chars().collect();
    let limit = before_chars.len().min(after_chars.len());
    let mut p = 0usize;
    while p < limit && before_chars[p] == after_chars[p] {
        p += 1;
    }
    let start = p.saturating_sub(max_chars / 3);
    // Snap back to a line start (still inside the common prefix).
    let start = before_chars[..start]
        .iter()
        .rposition(|c| *c == '\n')
        .map(|i| i + 1)
        .unwrap_or(0);

    let before_window: String = before_chars[start..(start + max_chars).min(before_chars.len())]
        .iter()
        .collect();
    let after_window: String = after_chars[start..(start + max_chars).min(after_chars.len())]
        .iter()
        .collect();
    (before_window, after_window)
}

/// Port of `_item_seed`: `int(sha256(f"{seed}|{topic}|{rubric}").hexdigest()[:8], 16)`.
pub fn item_seed(seed: i64, topic: &str, rubric: &str) -> u32 {
    let mut hasher = Sha256::new();
    hasher.update(format!("{seed}|{topic}|{rubric}").as_bytes());
    let digest = hasher.finalize();
    let hex = hex::encode(digest);
    u32::from_str_radix(&hex[..8], 16).unwrap_or(0)
}

/// Port of `extract_judge_json`: reuses `extract_splice_json`'s fail-closed
/// brace-matching, additionally unwrapping a one-element array (observed
/// live from Gemini) to its sole object.
pub fn extract_judge_json(text: &str) -> Option<Value> {
    match extract_splice_json(text)? {
        Value::Array(mut arr) if arr.len() == 1 && arr[0].is_object() => Some(arr.remove(0)),
        v @ Value::Object(_) => Some(v),
        _ => None,
    }
}

#[derive(Debug, Clone, Default)]
pub struct JudgeResult {
    pub ok: bool,
    pub rubric_a_improvement: Option<f64>,
    pub rubric_b_improvement: Option<f64>,
    pub raw_a: Option<Value>,
    pub raw_b: Option<Value>,
    pub error: Option<String>,
}

impl JudgeResult {
    fn failed(error: impl Into<String>) -> Self {
        JudgeResult {
            ok: false,
            error: Some(error.into()),
            ..Default::default()
        }
    }
}

/// Port of `judge_before_after`. Blind A/B judge, primary (Gemini 3.1 Pro,
/// temperature 0) only, both rubrics. Position of before/after is
/// randomised per-topic/per-rubric with a seeded RNG so the judge cannot
/// infer draft-vs-original from ordering; the sign of `improvement` is
/// un-blinded after parsing so it always means "after relative to before".
pub async fn judge_before_after(topic: &str, before: &str, after: &str, seed: i64) -> JudgeResult {
    let api_key = match std::env::var("GOOGLE_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => return JudgeResult::failed("GOOGLE_API_KEY not set — judge skipped (fail-closed)"),
    };

    let (before_w, after_w) = judge_windows(before, after, MAX_JUDGE_CHARS);

    let mut rubric_a_improvement = None;
    let mut rubric_b_improvement = None;
    let mut raw_a = None;
    let mut raw_b = None;

    for rubric_name in ["a", "b"] {
        let seed_val = item_seed(seed, topic, rubric_name);
        let mut rng = StdRng::seed_from_u64(seed_val as u64);
        let swap = rng.gen::<f64>() < 0.5;

        let (version_a, version_b, version_b_is_after) = if swap {
            (after_w.as_str(), before_w.as_str(), false)
        } else {
            (before_w.as_str(), after_w.as_str(), true)
        };

        let prompt = match rubric_name {
            "a" => rubric_a_prompt(topic, version_a, version_b),
            _ => rubric_b_prompt(topic, version_a, version_b),
        };

        let raw = match run_gemini_judge(&prompt, &api_key, 120).await {
            Some(r) => r,
            None => {
                return JudgeResult::failed(format!("gemini_call_failed(rubric_{rubric_name})"))
            }
        };

        let parsed = match extract_judge_json(&raw) {
            Some(Value::Object(o)) => Value::Object(o),
            _ => {
                let truncated: String = raw.chars().take(300).collect();
                return JudgeResult::failed(format!(
                    "malformed_judge_json(rubric_{rubric_name}): {truncated:?}"
                ));
            }
        };

        let improvement = match parsed.get("improvement").and_then(|v| v.as_f64()) {
            Some(v) => v,
            None => {
                return JudgeResult::failed(format!(
                    "missing_improvement_field(rubric_{rubric_name})"
                ))
            }
        };

        // Un-blind: `improvement` is "version_b minus version_a"; the
        // dossier always wants "after minus before".
        let signed = if version_b_is_after {
            improvement
        } else {
            -improvement
        };

        match rubric_name {
            "a" => {
                rubric_a_improvement = Some(signed);
                raw_a = Some(parsed);
            }
            _ => {
                rubric_b_improvement = Some(signed);
                raw_b = Some(parsed);
            }
        }
    }

    JudgeResult {
        ok: true,
        rubric_a_improvement,
        rubric_b_improvement,
        raw_a,
        raw_b,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_return_unchanged_when_short() {
        let (b, a) = judge_windows("short before", "short after", 6000);
        assert_eq!(b, "short before");
        assert_eq!(a, "short after");
    }

    #[test]
    fn windows_locate_divergence_when_long() {
        // Realistic wiki-page content: periodic newlines, so the "snap back
        // to a line start" step has a nearby line to snap to instead of
        // falling all the way back to offset 0 (which is what happens, by
        // design, when the shared prefix contains no newline at all).
        let line = "x".repeat(40) + "\n";
        let prefix = line.repeat(300); // well over max_chars, many line breaks
        let before = format!("{prefix}BEFORE_MARKER");
        let after = format!("{prefix}AFTER_MARKER");
        let (bw, aw) = judge_windows(&before, &after, 100);
        assert!(
            bw.ends_with("BEFORE_MARKER"),
            "window did not reach the divergence: {bw:?}"
        );
        assert!(
            aw.ends_with("AFTER_MARKER"),
            "window did not reach the divergence: {aw:?}"
        );
    }

    #[test]
    fn windows_fall_back_to_start_with_no_newline_in_shared_prefix() {
        // Documents the real (bug-compatible) behaviour: with no "\n"
        // anywhere before the divergence point, `rfind("\n", 0, start)`
        // finds nothing and the snap-back resets all the way to offset 0 —
        // so the window can miss the divergence entirely on pathological
        // (single-line) input. Ported verbatim from `_judge_windows`.
        let prefix = "x".repeat(10000);
        let before = format!("{prefix}BEFORE_MARKER");
        let after = format!("{prefix}AFTER_MARKER");
        let (bw, aw) = judge_windows(&before, &after, 100);
        assert_eq!(bw, "x".repeat(100));
        assert_eq!(aw, "x".repeat(100));
    }

    #[test]
    fn item_seed_is_deterministic() {
        assert_eq!(item_seed(42, "Topic", "a"), item_seed(42, "Topic", "a"));
        assert_ne!(item_seed(42, "Topic", "a"), item_seed(42, "Topic", "b"));
    }

    #[test]
    fn extract_judge_json_unwraps_single_element_array() {
        let v = extract_judge_json("[{\"improvement\": 1}]").unwrap();
        assert_eq!(v["improvement"], 1);
    }

    #[test]
    fn extract_judge_json_rejects_multi_element_array() {
        assert!(extract_judge_json("[{\"a\":1},{\"b\":2}]").is_none());
    }

    #[tokio::test]
    async fn judge_before_after_fails_closed_without_api_key() {
        std::env::remove_var("GOOGLE_API_KEY");
        let result = judge_before_after("Topic", "before", "after", 42).await;
        assert!(!result.ok);
        assert!(result.error.unwrap().contains("GOOGLE_API_KEY"));
    }
}
