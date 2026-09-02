//! `token-audit` — a full picture of local Claude Code usage.
//!
//! Ported from `skills/token-audit/scripts/token-audit.py` (itself adapted
//! from pacphi/agentic-kit, MIT, Copyright (c) 2026 Chris Phillipson).
//!
//! Walks the session transcripts under `~/.claude/projects/**/*.jsonl` — which
//! record per-message token usage, tool calls and metadata — and aggregates
//! them over a lookback window. The cost figure is an Opus-equivalent
//! *reference* for comparing line items against each other, never a billing
//! estimate.

pub mod counter;
pub mod report;

use chrono::{DateTime, Duration, Local, Utc};
use counter::{Counter, FloatCounter};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Opus-equivalent reference pricing per 1M tokens (USD).
#[derive(Debug, Clone, Copy)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    /// 5-minute ephemeral cache write.
    pub cw5: f64,
    /// 1-hour ephemeral cache write.
    pub cw1h: f64,
    /// Cache read.
    pub cr: f64,
}

pub const OPUS: Price = Price {
    input: 15.0,
    output: 75.0,
    cw5: 18.75,
    cw1h: 30.0,
    cr: 1.5,
};
pub const SONNET: Price = Price {
    input: 3.0,
    output: 15.0,
    cw5: 3.75,
    cw1h: 6.0,
    cr: 0.30,
};
pub const HAIKU: Price = Price {
    input: 1.0,
    output: 5.0,
    cw5: 1.25,
    cw1h: 2.0,
    cr: 0.10,
};

/// Maps a model id onto its pricing family. Unrecognised models fall through
/// to `other`, which is priced as Opus so it is never silently cheap.
pub fn family(model: Option<&str>) -> &'static str {
    let Some(model) = model else { return "other" };
    let m = model.to_lowercase();
    if m.contains("opus") || m.contains("fable") {
        "opus"
    } else if m.contains("sonnet") {
        "sonnet"
    } else if m.contains("haiku") {
        "haiku"
    } else {
        "other"
    }
}

pub fn price_for(fam: &str) -> Price {
    match fam {
        "opus" => OPUS,
        "sonnet" => SONNET,
        "haiku" => HAIKU,
        _ => OPUS,
    }
}

/// Python's `fmt()`: `1.2M` / `340K` / `991`.
pub fn fmt(n: i64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1e6)
    } else if n >= 1_000 {
        format!("{:.0}K", n as f64 / 1e3)
    } else {
        n.to_string()
    }
}

/// Shortens a transcript directory into a readable project label.
pub fn project_label(path: &str) -> String {
    let base = Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    let candidate = match base.split_once("Development-active-") {
        Some((_, tail)) => tail.to_string(),
        None => base,
    };
    candidate.chars().take(42).collect()
}

/// `project / short-session-id` for one transcript file.
pub fn session_label(transcript: &str) -> String {
    let path = Path::new(transcript);
    let proj = path
        .parent()
        .map(|p| project_label(&p.to_string_lossy()))
        .unwrap_or_default();
    let sid: String = path
        .file_name()
        .map(|s| s.to_string_lossy().replace(".jsonl", ""))
        .unwrap_or_default()
        .chars()
        .take(8)
        .collect();
    format!("{proj}/{sid}")
}

/// A four-way token split, mirroring the Python bucket Counters.
#[derive(Debug, Default, Clone, Copy)]
pub struct Bucket {
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub total: i64,
}

impl Bucket {
    fn accumulate(&mut self, inp: i64, out: i64, cr: i64, cc: i64) {
        self.input += inp;
        self.output += out;
        self.cache_read += cr;
        self.cache_write += cc;
        self.total += inp + out + cr + cc;
    }
}

/// Everything the report needs, in one pass over the transcripts.
#[derive(Default)]
pub struct Audit {
    pub cutoff: Option<DateTime<Local>>,
    pub by_day: Vec<(String, Bucket)>,
    pub by_model: Vec<(String, Bucket)>,
    pub by_proj: HashMap<String, Bucket>,
    pub by_proj_cost: FloatCounter,
    pub by_day_cost: FloatCounter,
    pub totals: Bucket,
    pub total_cost: f64,
    pub msg_count: i64,
    pub active_sessions: HashSet<String>,
    pub sess_day: Vec<(String, HashSet<String>)>,
    pub sess_proj: HashMap<String, HashSet<String>>,
    pub sess_tokens: Counter,
    pub startup_tax: Vec<i64>,
    pub tools: Counter,
    pub mcp: Counter,
    pub by_hour: [i64; 24],
    pub web_search: i64,
    pub web_fetch: i64,
    pub subagent_tokens: i64,
    pub subagent_spawns: i64,
}

fn upsert<'a>(rows: &'a mut Vec<(String, Bucket)>, key: &str) -> &'a mut Bucket {
    if let Some(idx) = rows.iter().position(|(k, _)| k == key) {
        return &mut rows[idx].1;
    }
    rows.push((key.to_string(), Bucket::default()));
    &mut rows.last_mut().unwrap().1
}

fn int_at(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// Aggregates every assistant message newer than the cutoff.
pub fn collect(root: &Path, days: i64) -> Audit {
    let now = Utc::now().with_timezone(&Local);
    let cutoff = now - Duration::days(days);
    let mut a = Audit {
        cutoff: Some(cutoff),
        ..Default::default()
    };

    let pattern = format!("{}/*", root.display());
    let mut project_dirs: Vec<_> = glob::glob(&pattern)
        .map(|g| g.filter_map(Result::ok).filter(|p| p.is_dir()).collect())
        .unwrap_or_else(|_| Vec::new());
    project_dirs.sort();

    for pdir in project_dirs {
        let proj = project_label(&pdir.to_string_lossy());
        let mut transcripts: Vec<_> = glob::glob(&format!("{}/*.jsonl", pdir.display()))
            .map(|g| g.filter_map(Result::ok).collect())
            .unwrap_or_else(|_| Vec::new());
        transcripts.sort();

        for jf in transcripts {
            let Ok(text) = std::fs::read_to_string(&jf) else {
                continue;
            };
            let jf_key = jf.to_string_lossy().into_owned();
            let mut seen_first = false;

            for line in text.lines() {
                if !line.contains("\"usage\"") {
                    continue;
                }
                let Ok(d) = serde_json::from_str::<Value>(line) else {
                    continue;
                };
                if d.get("type").and_then(Value::as_str) != Some("assistant") {
                    continue;
                }
                let Some(ts) = d.get("timestamp").and_then(Value::as_str) else {
                    continue;
                };
                let Ok(parsed) = DateTime::parse_from_rfc3339(&ts.replace('Z', "+00:00")) else {
                    continue;
                };
                let t = parsed.with_timezone(&Local);
                if t < cutoff {
                    continue;
                }
                let Some(msg) = d.get("message") else {
                    continue;
                };
                let Some(u) = msg.get("usage").filter(|u| u.is_object()) else {
                    continue;
                };

                let fam = family(msg.get("model").and_then(Value::as_str));
                let inp = int_at(u, "input_tokens");
                let out = int_at(u, "output_tokens");
                let cr = int_at(u, "cache_read_input_tokens");
                let cc = int_at(u, "cache_creation_input_tokens");
                let (cw5, cw1h) = match u.get("cache_creation") {
                    Some(c) if c.is_object() => (
                        int_at(c, "ephemeral_5m_input_tokens"),
                        int_at(c, "ephemeral_1h_input_tokens"),
                    ),
                    _ => (0, 0),
                };

                let day = t.format("%Y-%m-%d").to_string();
                let p = price_for(fam);
                let mut cost = (inp as f64 * p.input
                    + out as f64 * p.output
                    + cr as f64 * p.cr
                    + cw5 as f64 * p.cw5
                    + cw1h as f64 * p.cw1h)
                    / 1e6;
                if cw5 == 0 && cw1h == 0 && cc > 0 {
                    cost += cc as f64 * p.cw5 / 1e6;
                }

                upsert(&mut a.by_day, &day).accumulate(inp, out, cr, cc);
                upsert(&mut a.by_model, fam).accumulate(inp, out, cr, cc);
                a.by_proj
                    .entry(proj.clone())
                    .or_default()
                    .accumulate(inp, out, cr, cc);
                a.totals.accumulate(inp, out, cr, cc);

                a.by_proj_cost.add(&proj, cost);
                a.by_day_cost.add(&day, cost);
                a.total_cost += cost;
                a.msg_count += 1;
                a.active_sessions.insert(jf_key.clone());

                if let Some(idx) = a.sess_day.iter().position(|(k, _)| *k == day) {
                    a.sess_day[idx].1.insert(jf_key.clone());
                } else {
                    a.sess_day
                        .push((day.clone(), HashSet::from([jf_key.clone()])));
                }
                a.sess_proj
                    .entry(proj.clone())
                    .or_default()
                    .insert(jf_key.clone());
                a.sess_tokens.add(&jf_key, inp + out + cr + cc);
                a.by_hour[t.format("%H").to_string().parse::<usize>().unwrap_or(0)] += 1;

                if !seen_first {
                    seen_first = true;
                    a.startup_tax.push(cr + cc + inp);
                }
                if d.get("isSidechain")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    a.subagent_tokens += inp + out + cr + cc;
                }
                if let Some(stu) = u.get("server_tool_use") {
                    a.web_search += int_at(stu, "web_search_requests");
                    a.web_fetch += int_at(stu, "web_fetch_requests");
                }
                if let Some(blocks) = msg.get("content").and_then(Value::as_array) {
                    for block in blocks {
                        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                            continue;
                        }
                        let name = block.get("name").and_then(Value::as_str).unwrap_or("?");
                        a.tools.add(name, 1);
                        if name.starts_with("mcp__") {
                            // Python: parts[1] if len(parts) > 1 else name.
                            let parts: Vec<&str> = name.split("__").collect();
                            a.mcp.add(if parts.len() > 1 { parts[1] } else { name }, 1);
                        }
                        if name == "Task" || name == "Agent" {
                            a.subagent_spawns += 1;
                        }
                    }
                }
            }
        }
    }

    a.by_day.sort_by(|a, b| a.0.cmp(&b.0));
    a.sess_day.sort_by(|a, b| a.0.cmp(&b.0));
    a
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
