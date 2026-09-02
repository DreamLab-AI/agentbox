//! Dossier IO — port of `load_processed_fingerprint_sets`,
//! `clear_slug_outputs`, `write_dossier_json`, and `write_dossier_md` from
//! `promote.py`. Field order in every JSON object built here is significant
//! — it must match the Python dict-literal order exactly for on-disk byte
//! parity with the committed `promotions/proposals/*.json` fixtures.

use super::candidate::Candidate;
use super::judge::JudgeResult;
use super::loom::DraftResult;
use crate::common::to_json_pretty_ascii;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Port of `load_processed_fingerprint_sets`.
pub fn load_processed_fingerprint_sets(
    proposals_dir: &Path,
    rejects_dir: &Path,
) -> HashMap<String, HashSet<String>> {
    let mut out: HashMap<String, HashSet<String>> = HashMap::new();
    for dir in [proposals_dir, rejects_dir] {
        if !dir.exists() {
            continue;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e != "json").unwrap_or(true) {
                continue;
            }
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let data: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if data.get("status").and_then(|v| v.as_str()) == Some("candidate_deferred") {
                continue;
            }
            let slug = data.get("topic_slug").and_then(|v| v.as_str());
            let fps = data
                .get("assertion_fingerprints")
                .and_then(|v| v.as_array());
            if let (Some(slug), Some(fps)) = (slug, fps) {
                let set: HashSet<String> = fps
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                out.insert(slug.to_string(), set);
            }
        }
    }
    out
}

/// Port of `clear_slug_outputs`.
pub fn clear_slug_outputs(slug: &str, dirs: &[&Path]) {
    for dir in dirs {
        for ext in [".json", ".md"] {
            let f = dir.join(format!("{slug}{ext}"));
            if f.exists() {
                let _ = std::fs::remove_file(&f);
            }
        }
    }
}

/// Port of `write_dossier_json`. Writes `path` and returns the built
/// document (the caller passes it on to [`write_dossier_md`], mirroring
/// `write_dossier_md(path, data)` in Python).
#[allow(clippy::too_many_arguments)]
pub fn write_dossier_json(
    path: &Path,
    candidate: &Candidate,
    draft: &DraftResult,
    judge: Option<&JudgeResult>,
    completeness: f64,
    completeness_detail: &[Value],
    status: &str,
    reasons: &[String],
    target_page_rel: &str,
) -> Value {
    let assertions_json: Vec<Value> = candidate
        .assertions
        .iter()
        .map(|a| {
            json!({
                "claim": a.claim, "tier": a.tier, "confidence": a.confidence,
                "source": a.source, "episode": a.episode_slug,
                "claim_date": a.claim_date, "evidence": a.evidence, "fp": a.fp,
            })
        })
        .collect();

    let mut data = Map::new();
    data.insert("topic".to_string(), json!(candidate.topic));
    data.insert("topic_slug".to_string(), json!(candidate.slug()));
    data.insert("status".to_string(), json!(status));
    data.insert("reasons".to_string(), json!(reasons));
    data.insert(
        "n_assertions".to_string(),
        json!(candidate.assertions.len()),
    );
    data.insert("episodes".to_string(), json!(candidate.sorted_episodes()));
    data.insert(
        "assertion_fingerprints".to_string(),
        json!(candidate.sorted_fingerprints()),
    );
    data.insert("target_page".to_string(), json!(target_page_rel));
    data.insert("assertions".to_string(), json!(assertions_json));
    data.insert(
        "draft".to_string(),
        json!({"ok": draft.ok, "error": draft.error, "edit": draft.edit}),
    );
    data.insert("judge".to_string(), Value::Null);
    data.insert(
        "completeness".to_string(),
        json!({"score": completeness, "detail": completeness_detail}),
    );
    data.insert("ontology_propose_payload".to_string(), Value::Null);

    if let Some(j) = judge {
        data.insert(
            "judge".to_string(),
            json!({
                "ok": j.ok, "error": j.error,
                "rubric_a_improvement": j.rubric_a_improvement,
                "rubric_b_improvement": j.rubric_b_improvement,
                "raw_a": j.raw_a, "raw_b": j.raw_b,
            }),
        );
    }

    if status == "candidate_survivor" && draft.ok {
        data.insert(
            "ontology_propose_payload".to_string(),
            json!({
                "target_page": target_page_rel,
                "edit": draft.edit,
                "provenance": {
                    "assertion_fingerprints": candidate.sorted_fingerprints(),
                    "source_episodes": candidate.sorted_episodes(),
                },
                "scores": {
                    "rubric_a_improvement": judge.and_then(|j| j.rubric_a_improvement),
                    "rubric_b_improvement": judge.and_then(|j| j.rubric_b_improvement),
                    "completeness": completeness,
                },
            }),
        );
    }

    let value = Value::Object(data);
    if let Ok(text) = to_json_pretty_ascii(&value) {
        let _ = std::fs::write(path, text);
    }
    value
}

fn py_json_display(v: &Value) -> String {
    match v {
        Value::Null => "None".to_string(),
        Value::Bool(b) => {
            if *b {
                "True".to_string()
            } else {
                "False".to_string()
            }
        }
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(f) = n.as_f64() {
                if f.is_finite() && f == f.trunc() {
                    format!("{f:.1}")
                } else {
                    format!("{f}")
                }
            } else {
                n.to_string()
            }
        }
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn field_display(obj: &Value, key: &str) -> String {
    obj.get(key)
        .map(py_json_display)
        .unwrap_or_else(|| "None".to_string())
}

/// Port of `write_dossier_md`. `data` is the `Value` returned by
/// [`write_dossier_json`].
pub fn write_dossier_md(path: &Path, data: &Value) {
    let topic = data
        .get("topic")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let status = data
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let target_page = data
        .get("target_page")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let n_assertions = data
        .get("n_assertions")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let episodes: Vec<String> = data
        .get("episodes")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let reasons: Vec<String> = data
        .get("reasons")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut lines: Vec<String> = vec![format!("# Dossier: {topic}"), String::new()];
    lines.push(format!("- status: `{status}`"));
    lines.push(format!("- target page: `{target_page}`"));
    lines.push(format!(
        "- assertions: {n_assertions} across episodes: {}",
        episodes.join(", ")
    ));
    if !reasons.is_empty() {
        lines.push(format!("- reasons: {}", reasons.join("; ")));
    }
    lines.push(String::new());
    lines.push("## Scores".to_string());
    let default_judge = Value::Object(Map::new());
    let judge = data
        .get("judge")
        .filter(|v| !v.is_null())
        .unwrap_or(&default_judge);
    lines.push(format!(
        "- judge ok: {}  error: {}",
        field_display(judge, "ok"),
        field_display(judge, "error")
    ));
    lines.push(format!(
        "- rubric-A improvement (after vs before): {}",
        field_display(judge, "rubric_a_improvement")
    ));
    lines.push(format!(
        "- rubric-B improvement (after vs before): {}",
        field_display(judge, "rubric_b_improvement")
    ));
    let score = data
        .get("completeness")
        .and_then(|c| c.get("score"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    lines.push(format!("- answer-completeness: {score:.2}"));
    lines.push(String::new());
    lines.push("## Assertions".to_string());
    if let Some(assertions) = data.get("assertions").and_then(|v| v.as_array()) {
        for a in assertions {
            let claim = a.get("claim").and_then(|v| v.as_str()).unwrap_or_default();
            lines.push(format!("- **{claim}**"));
            lines.push(format!(
                "  - tier {}, confidence {}, source {}, episode `{}`, fp `{}`",
                field_display(a, "tier"),
                field_display(a, "confidence"),
                a.get("source").and_then(|v| v.as_str()).unwrap_or(""),
                a.get("episode").and_then(|v| v.as_str()).unwrap_or(""),
                a.get("fp").and_then(|v| v.as_str()).unwrap_or(""),
            ));
        }
    }
    lines.push(String::new());

    let draft_ok = data
        .get("draft")
        .and_then(|d| d.get("ok"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if draft_ok {
        lines.push("## Draft splice edit".to_string());
        lines.push("```json".to_string());
        if let Some(edit) = data.get("draft").and_then(|d| d.get("edit")) {
            if let Ok(edit_json) = to_json_pretty_ascii(edit) {
                lines.push(edit_json);
            }
        }
        lines.push("```".to_string());
    } else {
        let error = field_display(data.get("draft").unwrap_or(&Value::Null), "error");
        lines.push(format!("## Draft failed: {error}"));
    }

    let content = lines.join("\n") + "\n";
    let _ = std::fs::write(path, content);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::promote::ledger_parse::Assertion;
    use tempfile::tempdir;

    fn sample_candidate() -> Candidate {
        Candidate {
            topic: "Advertising".to_string(),
            assertions: vec![Assertion {
                claim: "A claim.".to_string(),
                topics: vec!["Advertising".to_string()],
                tier: "1".to_string(),
                confidence: "0.9".to_string(),
                source: "Host".to_string(),
                fp: "aaaa000000000000".to_string(),
                episode_slug: "ep1".to_string(),
                ledger_file: "podcast-evidence___ep1.md".to_string(),
                claim_date: "2026-01-01".to_string(),
                evidence: String::new(),
            }],
        }
    }

    #[test]
    fn dossier_json_has_python_field_order() {
        let candidate = sample_candidate();
        let draft = DraftResult {
            ok: false,
            spliced_text: None,
            edit: None,
            error: Some("x".to_string()),
        };
        let value = write_dossier_json(
            Path::new("/dev/null"),
            &candidate,
            &draft,
            None,
            0.0,
            &[],
            "candidate_rejected",
            &["some_reason".to_string()],
            "Advertising.md",
        );
        let obj = value.as_object().unwrap();
        let keys: Vec<&String> = obj.keys().collect();
        assert_eq!(
            keys,
            vec![
                "topic",
                "topic_slug",
                "status",
                "reasons",
                "n_assertions",
                "episodes",
                "assertion_fingerprints",
                "target_page",
                "assertions",
                "draft",
                "judge",
                "completeness",
                "ontology_propose_payload",
            ]
        );
        assert_eq!(obj["judge"], Value::Null);
        assert_eq!(obj["ontology_propose_payload"], Value::Null);
    }

    /// Round-trips real, committed `promotions/proposals/` /
    /// `promotions/rejects/` dossier fixtures byte-for-byte: parse with
    /// `serde_json`, re-serialise with [`to_json_pretty_ascii`], and assert
    /// the bytes are identical to what `promote.py` actually wrote on disk.
    /// Covers a survivor, a terminal reject, and an instrument-deferred
    /// dossier (each a different field-population shape).
    #[test]
    fn round_trips_real_fixtures_byte_for_byte() {
        for fixture in [
            "advertising.json",
            "human-in-the-loop-deferred.json",
            "rejected-sample.json",
        ] {
            let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(fixture);
            let original = std::fs::read_to_string(&fixture_path)
                .unwrap_or_else(|e| panic!("fixture {fixture} must exist: {e}"));
            let parsed: Value = serde_json::from_str(&original)
                .unwrap_or_else(|e| panic!("fixture {fixture} must parse: {e}"));
            let rebuilt = to_json_pretty_ascii(&parsed).unwrap();
            assert_eq!(
                rebuilt, original,
                "re-serialising {fixture} must reproduce it byte-for-byte"
            );
        }
    }

    /// Same byte-for-byte guarantee for the `.submitted.json` idempotency
    /// ledger (written by `submit-proposals.mjs`, but read by nothing in
    /// this crate — still a JSON artefact this crate's `to_json_pretty_ascii`
    /// convention must stay compatible with, since it lives in the same
    /// `promotions/` directory tree and follows the same `indent=2`/
    /// `ensure_ascii` convention as every other file here).
    #[test]
    fn round_trips_submitted_ledger_byte_for_byte() {
        let fixture_path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/submitted.json");
        let original = std::fs::read_to_string(&fixture_path).unwrap();
        let parsed: Value = serde_json::from_str(&original).unwrap();
        let rebuilt = to_json_pretty_ascii(&parsed).unwrap();
        assert_eq!(rebuilt, original);
    }

    #[test]
    fn dossier_md_renders_judge_and_assertions() {
        let dir = tempdir().unwrap();
        let candidate = sample_candidate();
        let draft = DraftResult {
            ok: true,
            spliced_text: Some("spliced".to_string()),
            edit: Some(json!({"mode": "insert_after", "anchor": "X", "content": "Y"})),
            error: None,
        };
        let judge = JudgeResult {
            ok: true,
            rubric_a_improvement: Some(1.0),
            rubric_b_improvement: Some(2.0),
            raw_a: Some(json!({"improvement": 1})),
            raw_b: Some(json!({"improvement": 2})),
            error: None,
        };
        let json_path = dir.path().join("advertising.json");
        let data = write_dossier_json(
            &json_path,
            &candidate,
            &draft,
            Some(&judge),
            1.0,
            &[],
            "candidate_survivor",
            &[],
            "Advertising.md",
        );
        let md_path = dir.path().join("advertising.md");
        write_dossier_md(&md_path, &data);
        let content = std::fs::read_to_string(&md_path).unwrap();
        assert!(content.starts_with("# Dossier: Advertising\n"));
        assert!(content.contains("- judge ok: True  error: None\n"));
        assert!(content.contains("- rubric-A improvement (after vs before): 1.0\n"));
        assert!(content.contains("- answer-completeness: 1.00\n"));
        assert!(content.contains("- **A claim.**\n"));
        assert!(content.ends_with("```\n"));
    }
}
