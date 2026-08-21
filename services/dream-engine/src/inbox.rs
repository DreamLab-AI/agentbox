//! Dream inbox — the loop's channel for asking the human questions.
//!
//! The engine has no session with the operator; hooks do. Nights that need a
//! human decision (a "Human action recommended" item in a report, an
//! environment fault, a health anomaly) append an item here; the
//! `dream-inbox-surface.cjs` UserPromptSubmit hook injects open items into
//! whatever Claude session the operator is in next, and `/dream answer`
//! resolves them (recording the answer for the next night's carry-over).
//!
//! The file is control-plane truth (`~/workspace/.agentbox/dream-inbox.json`); RuVector
//! gets the *answers* (via the in-session resolve path), not the queue.
//! Everything here is fail-open: an inbox failure never taints a night.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    /// Short stable id: first 8 hex chars of a hash of (night_id, text).
    pub id: String,
    /// "question" (report asked for a human decision) or "alert" (engine
    /// detected an anomaly needing attention).
    pub kind: String,
    pub repo: String,
    pub night_id: String,
    pub date: String,
    pub text: String,
    /// "open" | "answered" | "dismissed" — only "open" items are surfaced.
    pub status: String,
    /// Filled in by /dream answer.
    #[serde(default)]
    pub answer: String,
    /// Set by the surfacing hook (epoch seconds) for rate-limiting.
    #[serde(default)]
    pub last_surfaced: u64,
}

pub fn inbox_path() -> PathBuf {
    PathBuf::from("/home/devuser/workspace/.agentbox/dream-inbox.json")
}

fn short_hash(s: &str) -> String {
    // FNV-1a, hex — stable, dependency-free; collision space is fine for an
    // operator inbox of tens of items.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:08x}", (h >> 32) as u32 ^ h as u32)
}

fn load() -> Vec<InboxItem> {
    std::fs::read_to_string(inbox_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(items: &[InboxItem]) -> std::io::Result<()> {
    let path = inbox_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_string_pretty(items).unwrap_or_default(),
    )?;
    std::fs::rename(&tmp, path)
}

/// Append an item unless an open item with the same id already exists.
/// Returns the item id. Errors are the caller's to log (fail-open).
pub fn add(
    kind: &str,
    repo: &str,
    night_id: &str,
    date: &str,
    text: &str,
) -> std::io::Result<String> {
    let id = short_hash(&format!("{}:{}", night_id, text));
    let mut items = load();
    if items.iter().any(|i| i.id == id && i.status == "open") {
        return Ok(id); // already queued — idempotent across retries
    }
    items.push(InboxItem {
        id: id.clone(),
        kind: kind.into(),
        repo: repo.into(),
        night_id: night_id.into(),
        date: date.into(),
        text: text.trim().into(),
        status: "open".into(),
        answer: String::new(),
        last_surfaced: 0,
    });
    // Keep the file bounded: drop resolved items older than the newest 200.
    if items.len() > 200 {
        let excess = items.len() - 200;
        let mut dropped = 0;
        items.retain(|i| {
            if dropped < excess && i.status != "open" {
                dropped += 1;
                false
            } else {
                true
            }
        });
    }
    save(&items)?;
    Ok(id)
}

/// Extract "human action recommended" items from a report. Matches the bullet
/// or numbered lines directly following a line containing the marker
/// (case-insensitive), stopping at the first non-list line.
pub fn extract_questions(report: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_section = false;
    for line in report.lines() {
        let t = line.trim();
        let lower = t.to_lowercase();
        if lower.contains("human action recommended") {
            // Inline form: "**Human action recommended:** do X" on one line —
            // the ask is complete, so following bullets are NOT part of it.
            let idx = lower.find("recommended").unwrap_or(0);
            let rest = t[idx + "recommended".len().min(t.len() - idx)..]
                .trim_start_matches([':', '*', ' ']);
            if rest.len() > 8 {
                out.push(rest.to_string());
                in_section = false;
            } else {
                // Heading form: the asks are the list lines that follow.
                in_section = true;
            }
            continue;
        }
        if in_section {
            let is_list = t.starts_with('-')
                || t.starts_with('*')
                || t.chars().next().is_some_and(|c| c.is_ascii_digit());
            if is_list && t.len() > 4 {
                out.push(
                    t.trim_start_matches(['-', '*', ' '])
                        .trim_start_matches(|c: char| {
                            c.is_ascii_digit() || c == '.' || c == ')' || c == '(' || c == ' '
                        })
                        .to_string(),
                );
            } else if !t.is_empty() {
                break;
            }
        }
    }
    out.retain(|q| q.len() > 8);
    out.truncate(5);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_numbered_recommendations() {
        let report = "\
## Summary
- **Human action recommended:** (1) Re-provision the HP annexe workspace. (2) Re-run pin-parity manually.
- **Next steps:** something else
";
        let qs = extract_questions(report);
        assert_eq!(qs.len(), 1);
        assert!(qs[0].contains("Re-provision"));
    }

    #[test]
    fn extracts_bullet_list_form() {
        let report = "\
**Human action recommended:**
- Re-provision the HP annexe workspace mount.
- Verify pin parity once readable.

Other text.
";
        let qs = extract_questions(report);
        assert_eq!(qs.len(), 2);
        assert!(qs[1].starts_with("Verify pin parity"));
    }

    #[test]
    fn no_marker_no_questions() {
        assert!(extract_questions("just a report with no asks").is_empty());
    }

    #[test]
    fn short_hash_is_stable() {
        assert_eq!(short_hash("a:b"), short_hash("a:b"));
        assert_ne!(short_hash("a:b"), short_hash("a:c"));
    }
}
