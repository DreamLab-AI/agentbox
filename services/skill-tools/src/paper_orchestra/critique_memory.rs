//! Structured critique memory across refinement iterations (derived from
//! `update_critique_memory.py`).
//!
//! Reads the worklog plus the current iteration's review and classifies every
//! distinct weakness (near-duplicates are merged at similarity ≥ 0.55, see
//! [`super::seqmatch`]) into persistent issues, resolved issues and open
//! Devil's Advocate criticals, then derives the prompts the next reviewer
//! should focus on or must not re-flag.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;

use super::json_util::truthy;
use super::seqmatch::similarity;

const MATCH_THRESHOLD: f64 = 0.55;

#[derive(Debug, Clone)]
struct Weakness {
    text: String,
    axis: Option<String>,
    da_critical: bool,
}

fn find_match<'a, I: IntoIterator<Item = &'a str>>(finding: &str, pool: I) -> Option<&'a str> {
    let mut best: Option<&str> = None;
    let mut best_score = 0.0;
    for item in pool {
        let s = similarity(finding, item);
        if s > best_score {
            best = Some(item);
            best_score = s;
        }
    }
    if best_score >= MATCH_THRESHOLD {
        best
    } else {
        None
    }
}

fn text_of(item: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = item.get(k).filter(|v| truthy(v)) {
            return v.as_str().map_or_else(|| v.to_string(), str::to_string);
        }
    }
    item.to_string()
}

fn extract_weaknesses(review: &Value) -> Vec<Weakness> {
    let mut out = Vec::new();
    if let Some(arr) = review.get("weaknesses").and_then(Value::as_array) {
        for item in arr {
            match item {
                Value::String(s) => out.push(Weakness {
                    text: s.clone(),
                    axis: None,
                    da_critical: false,
                }),
                Value::Object(_) => out.push(Weakness {
                    text: text_of(item, &["text", "finding"]),
                    axis: item.get("axis").and_then(Value::as_str).map(str::to_string),
                    da_critical: item.get("da_critical").is_some_and(truthy),
                }),
                _ => {}
            }
        }
    }
    if let Some(arr) = review.get("da_critical_findings").and_then(Value::as_array) {
        for item in arr {
            let text = match item {
                Value::String(s) => s.clone(),
                other => text_of(other, &["finding"]),
            };
            out.push(Weakness {
                text,
                axis: None,
                da_critical: true,
            });
        }
    }
    out
}

fn extract_addressed(block: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for field in ["addressed_weaknesses", "actions_taken"] {
        if let Some(arr) = block.get(field).and_then(Value::as_array) {
            for item in arr {
                match item {
                    Value::String(s) => out.push(s.clone()),
                    Value::Object(_) => out.push(text_of(item, &["weakness", "action"])),
                    _ => {}
                }
            }
        }
    }
    out
}

/// A finding that is still open or was resolved.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Issue {
    /// The finding text.
    pub finding: String,
    /// First iteration in which it was flagged.
    pub first_flagged_iter: i64,
    /// Number of distinct iterations that flagged it (open issues only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub times_flagged: Option<usize>,
    /// Iteration whose actions addressed it (resolved issues only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_by_iter: Option<i64>,
    /// Rubric axis, when known.
    pub axis: Option<String>,
}

/// Counters in the memory document.
#[derive(Debug, Serialize, PartialEq)]
pub struct Stats {
    /// Distinct findings after merging near-duplicates.
    pub total_unique_findings: usize,
    /// Persistent issues.
    pub persistent_count: usize,
    /// Resolved issues.
    pub resolved_count: usize,
    /// Open Devil's Advocate criticals.
    pub da_critical_open: usize,
}

/// The `critique_memory.json` document.
#[derive(Debug, Serialize)]
pub struct CritiqueMemory {
    /// Current iteration.
    pub current_iter: i64,
    /// Flagged in two or more iterations and never addressed.
    pub persistent_issues: Vec<Issue>,
    /// Addressed by a later revision.
    pub resolved_issues: Vec<Issue>,
    /// Open Devil's Advocate criticals.
    pub da_critical_unresolved: Vec<Issue>,
    /// What the next reviewer should prioritise.
    pub focus_on: Vec<String>,
    /// Resolved issues the next reviewer must not re-flag (at most ten).
    pub do_not_reflag: Vec<String>,
    /// Counters.
    pub _stats: Stats,
}

struct Meta {
    first_iter: i64,
    iters: BTreeSet<i64>,
    axis: Option<String>,
    da_critical: bool,
}

/// Builds the updated memory from the worklog document and the current review.
#[must_use]
pub fn build_memory(worklog: &Value, current_review: &Value, current_iter: i64) -> CritiqueMemory {
    let mut weaknesses: BTreeMap<i64, Vec<Weakness>> = BTreeMap::new();
    let mut addressed: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    let empty = Value::Object(serde_json::Map::new());
    if let Some(its) = worklog.get("iterations").and_then(Value::as_array) {
        for entry in its {
            let i = entry.get("iter").and_then(Value::as_i64).unwrap_or(-1);
            let review = entry
                .get("review")
                .filter(|v| truthy(v) && v.is_object())
                .unwrap_or(&empty);
            let actions = entry
                .get("actions")
                .filter(|v| truthy(v) && v.is_object())
                .unwrap_or(&empty);
            weaknesses.insert(i, extract_weaknesses(review));
            addressed.insert(i, extract_addressed(actions));
        }
    }
    weaknesses.insert(current_iter, extract_weaknesses(current_review));

    // Insertion-ordered canonical findings (first match wins on ties).
    let mut canonical: Vec<(String, Meta)> = Vec::new();
    for (&i, list) in &weaknesses {
        for w in list {
            let text = w.text.trim();
            if text.is_empty() {
                continue;
            }
            let hit =
                find_match(text, canonical.iter().map(|(t, _)| t.as_str())).map(str::to_string);
            if let Some(existing) = hit {
                let meta = &mut canonical
                    .iter_mut()
                    .find(|(t, _)| *t == existing)
                    .expect("present")
                    .1;
                meta.iters.insert(i);
                if w.axis.is_some() {
                    meta.axis.clone_from(&w.axis);
                }
                if w.da_critical {
                    meta.da_critical = true;
                }
            } else {
                canonical.push((
                    text.to_string(),
                    Meta {
                        first_iter: i,
                        iters: BTreeSet::from([i]),
                        axis: w.axis.clone(),
                        da_critical: w.da_critical,
                    },
                ));
            }
        }
    }

    let all_addressed: Vec<&str> = addressed.values().flatten().map(String::as_str).collect();
    let mut persistent = Vec::new();
    let mut resolved = Vec::new();
    let mut da_open = Vec::new();
    for (text, meta) in &canonical {
        let times = meta.iters.len();
        let was_addressed = find_match(text, all_addressed.iter().copied()).is_some();
        if meta.da_critical && !was_addressed {
            da_open.push(Issue {
                finding: text.clone(),
                first_flagged_iter: meta.first_iter,
                times_flagged: Some(times),
                resolved_by_iter: None,
                axis: meta.axis.clone(),
            });
        } else if times >= 2 && !was_addressed {
            persistent.push(Issue {
                finding: text.clone(),
                first_flagged_iter: meta.first_iter,
                times_flagged: Some(times),
                resolved_by_iter: None,
                axis: meta.axis.clone(),
            });
        } else if was_addressed {
            let by = addressed
                .iter()
                .filter(|(_, list)| find_match(text, list.iter().map(String::as_str)).is_some())
                .map(|(i, _)| *i)
                .max()
                .unwrap_or(current_iter);
            resolved.push(Issue {
                finding: text.clone(),
                first_flagged_iter: meta.first_iter,
                times_flagged: None,
                resolved_by_iter: Some(by),
                axis: meta.axis.clone(),
            });
        }
    }
    persistent.sort_by_key(|p| (std::cmp::Reverse(p.times_flagged), p.first_flagged_iter));

    let mut focus_on: Vec<String> = da_open
        .iter()
        .map(|d| {
            format!(
                "[DA-CRITICAL, iter {}+] {}",
                d.first_flagged_iter, d.finding
            )
        })
        .collect();
    focus_on.extend(persistent.iter().take(5).map(|p| {
        format!(
            "[iter {}+, {}x] {}",
            p.first_flagged_iter,
            p.times_flagged.unwrap_or(0),
            p.finding
        )
    }));
    let do_not_reflag: Vec<String> = resolved
        .iter()
        .rev()
        .take(10)
        .rev()
        .map(|r| r.finding.clone())
        .collect();

    CritiqueMemory {
        current_iter,
        _stats: Stats {
            total_unique_findings: canonical.len(),
            persistent_count: persistent.len(),
            resolved_count: resolved.len(),
            da_critical_open: da_open.len(),
        },
        persistent_issues: persistent,
        resolved_issues: resolved,
        da_critical_unresolved: da_open,
        focus_on,
        do_not_reflag,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn wl(entries: Vec<Value>) -> Value {
        json!({"iterations": entries})
    }

    #[test]
    fn repeated_weakness_becomes_persistent_and_leads_focus() {
        let w = wl(vec![
            json!({"iter":0,"review":{"weaknesses":["The ablation study omits the temperature sweep"]},"actions":{}}),
        ]);
        let m = build_memory(
            &w,
            &json!({"weaknesses":["Ablation study omits the temperature sweep entirely"]}),
            1,
        );
        assert_eq!(m._stats.persistent_count, 1);
        assert_eq!(m.persistent_issues[0].times_flagged, Some(2));
        assert!(m.focus_on[0].starts_with("[iter 0+, 2x]"));
    }

    #[test]
    fn addressed_weakness_is_resolved_and_not_reflagged() {
        let w = wl(vec![json!({"iter":0,
            "review":{"weaknesses":["Related work lacks comparison to retrieval baselines"]},
            "actions":{"addressed_weaknesses":["Related work lacks comparison to retrieval baselines"]}})]);
        let m = build_memory(&w, &json!({"weaknesses": []}), 1);
        assert_eq!(m.resolved_issues.len(), 1);
        assert_eq!(m.resolved_issues[0].resolved_by_iter, Some(0));
        assert_eq!(m.do_not_reflag.len(), 1);
        assert!(m.persistent_issues.is_empty());
    }

    #[test]
    fn da_critical_stays_open_until_addressed() {
        let m = build_memory(
            &wl(vec![]),
            &json!({"weaknesses":[{"text":"Causal claim in Section 4 rests on correlation only","da_critical":true,"axis":"logical_flow"}]}),
            2,
        );
        assert_eq!(m.da_critical_unresolved.len(), 1);
        assert!(m.focus_on[0].starts_with("[DA-CRITICAL, iter 2+]"));
        assert_eq!(
            m.da_critical_unresolved[0].axis.as_deref(),
            Some("logical_flow")
        );
    }

    #[test]
    fn unrelated_findings_stay_distinct_and_json_shape_is_stable() {
        let m = build_memory(
            &wl(vec![]),
            &json!({"weaknesses":["Figure 2 is unreadable","Statistical tests are missing"]}),
            0,
        );
        assert_eq!(m._stats.total_unique_findings, 2);
        let s = serde_json::to_string(&m).unwrap();
        assert!(s.starts_with(r#"{"current_iter":0,"persistent_issues":[],"resolved_issues":[]"#));
        assert!(s.contains(r#""_stats":{"total_unique_findings":2"#));
    }
}
