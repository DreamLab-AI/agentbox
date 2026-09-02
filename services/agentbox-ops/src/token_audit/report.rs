//! Rendering for `token-audit`: the human report and the JSON projection.
//!
//! Both shapes are reproduced from `token-audit.py` line for line so existing
//! dashboards and CI consumers of `--json` keep working.

use super::{fmt, session_label, Audit};
use crate::pyjson;
use serde_json::{json, Map, Value};

/// Percentile helper matching Python's `st[int(n * 0.9)]` indexing.
fn pct(sorted: &[i64], fraction: f64) -> i64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64) * fraction) as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn median(sorted: &[i64]) -> i64 {
    if sorted.is_empty() {
        0
    } else {
        sorted[sorted.len() / 2]
    }
}

fn bucket_json(b: &super::Bucket) -> Value {
    json!({"in": b.input, "out": b.output, "cr": b.cache_read, "cw": b.cache_write, "total": b.total})
}

/// Groups the digits of an integer with commas, as Python's `{:,}` does.
fn commas(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

fn commas_f(v: f64, places: usize) -> String {
    let whole = v.trunc().abs() as i64;
    let frac = format!("{:.*}", places, v.abs().fract());
    let frac = frac.trim_start_matches('0');
    let sign = if v < 0.0 { "-" } else { "" };
    format!("{sign}{}{frac}", commas(whole))
}

/// The default human-readable report.
pub fn human(a: &Audit, top: usize, show_daemons: bool) -> String {
    let t = &a.totals;
    let mut out: Vec<String> = Vec::new();
    let cutoff = a
        .cutoff
        .map(|c| c.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default();

    out.push(format!(
        "\n=== Claude Code USAGE AUDIT — since {cutoff} ==="
    ));
    out.push(format!(
        "Assistant API responses: {}   Active sessions: {}",
        commas(a.msg_count),
        commas(a.active_sessions.len() as i64)
    ));
    out.push(format!("\nTOTAL TOKENS: {:.1}M", t.total as f64 / 1e6));
    out.push(format!(
        "  input(fresh) {}  |  output {}  |  cache-read {}  |  cache-write {}",
        fmt(t.input),
        fmt(t.output),
        fmt(t.cache_read),
        fmt(t.cache_write)
    ));
    let denom = t.cache_read + t.input + t.cache_write;
    if denom != 0 {
        out.push(format!(
            "  cache efficiency: {:.0}% of context tokens are cache-reads (reused, cheap) vs fresh+write",
            100.0 * t.cache_read as f64 / denom as f64
        ));
    }
    out.push(format!(
        "Cost-weighted (Opus-equivalent reference $, NOT plan billing): ${}",
        commas_f(a.total_cost, 2)
    ));

    out.push("\n--- BY DAY  (cost-weight $ | total tokens | output) ---".into());
    for (day, b) in &a.by_day {
        out.push(format!(
            "  {day}:  ${:8.2}   {:>7}   out={}",
            a.by_day_cost.get(day),
            fmt(b.total),
            fmt(b.output)
        ));
    }

    out.push(
        "\n--- BY MODEL  (interactive work is usually Opus; high Haiku/Sonnet = automation) ---"
            .into(),
    );
    let mut models: Vec<_> = a.by_model.iter().enumerate().collect();
    models.sort_by(|x, y| y.1 .1.total.cmp(&x.1 .1.total).then(x.0.cmp(&y.0)));
    for (_, (fam, b)) in models {
        out.push(format!(
            "  {fam:8} total={:>7}  out={:>7}  cache-read={:>7}",
            fmt(b.total),
            fmt(b.output),
            fmt(b.cache_read)
        ));
    }

    out.push(
        "\n--- SESSIONS PER DAY  (>~100/day with little interactive Opus => automation) ---".into(),
    );
    for (day, sessions) in &a.sess_day {
        out.push(format!(
            "  {day}:  {:>6} sessions",
            commas(sessions.len() as i64)
        ));
    }

    let mut st = a.startup_tax.clone();
    st.sort_unstable();
    if !st.is_empty() {
        out.push(
            "\n--- STARTUP CONTEXT TAX  (tokens loaded before any work, per session) ---".into(),
        );
        out.push(format!(
            "  sessions: {}   median: {}   p90: {}   max: {}   sum: {}",
            commas(st.len() as i64),
            fmt(median(&st)),
            fmt(pct(&st, 0.9)),
            fmt(*st.last().unwrap()),
            fmt(st.iter().sum())
        ));
    }

    let mut sv: Vec<i64> = a.sess_tokens.keys().map(|k| a.sess_tokens.get(k)).collect();
    sv.sort_unstable();
    if !sv.is_empty() {
        let tiny = sv.iter().filter(|x| **x < 200_000).count();
        out.push("\n--- SESSION SIZE  (many tiny sessions = hooks/workers/subagents) ---".into());
        out.push(format!(
            "  total: {}   tiny (<200K tok): {} ({:.0}%)   median: {}   p90: {}",
            commas(sv.len() as i64),
            commas(tiny as i64),
            100.0 * tiny as f64 / sv.len() as f64,
            fmt(median(&sv)),
            fmt(pct(&sv, 0.9))
        ));
    }

    out.push(format!(
        "\n--- TOP {top} BUSIEST SESSIONS (a single runaway conversation shows here) ---"
    ));
    for (jf, tok) in a.sess_tokens.most_common(top) {
        out.push(format!("  {:>7}  {}", fmt(tok), session_label(&jf)));
    }

    out.push(format!("\n--- TOP {top} PROJECTS by cost-weight ---"));
    for (proj, cost) in a.by_proj_cost.most_common(top) {
        let b = a.by_proj.get(&proj).copied().unwrap_or_default();
        let sessions = a.sess_proj.get(&proj).map(|s| s.len()).unwrap_or(0);
        out.push(format!(
            "  ${cost:8.2}  {:>7}  out={:>6}  sess={sessions:>5}  {proj}",
            fmt(b.total),
            fmt(b.output)
        ));
    }

    if !a.tools.is_empty() {
        let total_calls = a.tools.total();
        out.push(format!(
            "\n--- TOOL USAGE  ({} tool calls — what you actually do) ---",
            commas(total_calls)
        ));
        for (name, c) in a.tools.most_common(top) {
            out.push(format!(
                "  {:>7}  {:4.0}%  {name}",
                commas(c),
                100.0 * c as f64 / total_calls as f64
            ));
        }
    }

    if !a.mcp.is_empty() {
        out.push(format!(
            "\n--- MCP USAGE  ({} calls by server — MCP tool defs cost ~tokens/session) ---",
            commas(a.mcp.total())
        ));
        for (server, c) in a.mcp.most_common(top) {
            out.push(format!("  {:>7}  {server}", commas(c)));
        }
    }

    let share = if t.total != 0 {
        100.0 * a.subagent_tokens as f64 / t.total as f64
    } else {
        0.0
    };
    out.push("\n--- SUBAGENT FAN-OUT (delegated/parallel work) ---".into());
    out.push(format!(
        "  Task/Agent spawns: {}   sidechain tokens: {} ({share:.0}% of total)",
        commas(a.subagent_spawns),
        fmt(a.subagent_tokens)
    ));

    if a.web_search != 0 || a.web_fetch != 0 {
        out.push("\n--- WEB TOOLS (server-side, billed) ---".into());
        out.push(format!(
            "  web_search: {}   web_fetch: {}",
            commas(a.web_search),
            commas(a.web_fetch)
        ));
    }

    if a.by_hour.iter().any(|c| *c != 0) {
        out.push(
            "\n--- ACTIVITY BY HOUR (local; flat 24h spread = automation, not a human) ---".into(),
        );
        let peak = *a.by_hour.iter().max().unwrap_or(&1);
        let peak = if peak == 0 { 1 } else { peak };
        for (h, c) in a.by_hour.iter().enumerate() {
            let width = (20.0 * *c as f64 / peak as f64).round() as usize;
            let bar = "█".repeat(width);
            out.push(format!("  {h:02}h {bar:<20} {}", commas(*c)));
        }
    }

    if show_daemons {
        let daemons = crate::procs::sweep();
        out.push("\n--- RUNNING ruflo/claude-flow DAEMONS (token-leak suspects) ---".into());
        if daemons.is_empty() {
            out.push("  ✓ none running".into());
        } else {
            let top_projects: Vec<String> = a
                .by_proj_cost
                .most_common(top)
                .into_iter()
                .map(|(p, _)| p)
                .collect();
            for d in &daemons {
                let flag = if top_projects.contains(&super::project_label(&d.workspace)) {
                    "  <-- TOP BURN PROJECT"
                } else {
                    ""
                };
                out.push(format!(
                    "  pid={:>7}  uptime={:>12}  {}{flag}",
                    d.pid,
                    crate::procs::format_etime(d.run_time_secs),
                    d.workspace
                ));
            }
            out.push(format!(
                "\n  {} daemon(s) running. Inspect/stop: ruflo-daemon-gc [--kill]",
                daemons.len()
            ));
        }
    }

    out.join("\n")
}

/// The `--json` projection consumed by dashboards and CI.
pub fn json_report(a: &Audit, top: usize, show_daemons: bool) -> String {
    let t = &a.totals;
    let mut st = a.startup_tax.clone();
    st.sort_unstable();
    let mut sv: Vec<i64> = a.sess_tokens.keys().map(|k| a.sess_tokens.get(k)).collect();
    sv.sort_unstable();
    let denom = t.cache_read + t.input + t.cache_write;

    let mut by_day = Map::new();
    for (day, b) in &a.by_day {
        let mut row = Map::new();
        row.insert(
            "cost".into(),
            json!((a.by_day_cost.get(day) * 100.0).round() / 100.0),
        );
        for (k, v) in [
            ("in", b.input),
            ("out", b.output),
            ("cr", b.cache_read),
            ("cw", b.cache_write),
            ("total", b.total),
        ] {
            row.insert(k.into(), json!(v));
        }
        by_day.insert(day.clone(), Value::Object(row));
    }

    let mut by_model = Map::new();
    for (fam, b) in &a.by_model {
        by_model.insert(fam.clone(), bucket_json(b));
    }

    let mut sessions_per_day = Map::new();
    for (day, s) in &a.sess_day {
        sessions_per_day.insert(day.clone(), json!(s.len()));
    }

    let mut activity_by_hour = Map::new();
    for (h, c) in a.by_hour.iter().enumerate() {
        activity_by_hour.insert(h.to_string(), json!(c));
    }

    let mut tool_usage = Map::new();
    for (k, v) in a.tools.most_common(top) {
        tool_usage.insert(k, json!(v));
    }
    let mut mcp_usage = Map::new();
    for (k, v) in a.mcp.most_common(top) {
        mcp_usage.insert(k, json!(v));
    }

    let mut obj = Map::new();
    obj.insert(
        "since".into(),
        json!(a
            .cutoff
            .map(|c| crate::hermes::schedule::iso(&c))
            .unwrap_or_default()),
    );
    obj.insert("responses".into(), json!(a.msg_count));
    obj.insert("active_sessions".into(), json!(a.active_sessions.len()));
    obj.insert("totals".into(), bucket_json(t));
    obj.insert(
        "cache_efficiency_pct".into(),
        json!(if denom != 0 {
            (1000.0 * t.cache_read as f64 / denom as f64).round() / 10.0
        } else {
            0.0
        }),
    );
    obj.insert(
        "cost_weight_opus_equiv".into(),
        json!((a.total_cost * 100.0).round() / 100.0),
    );
    obj.insert("by_day".into(), Value::Object(by_day));
    obj.insert("by_model".into(), Value::Object(by_model));
    obj.insert("sessions_per_day".into(), Value::Object(sessions_per_day));
    obj.insert(
        "startup_tax".into(),
        json!({
            "median": median(&st), "p90": pct(&st, 0.9),
            "max": st.last().copied().unwrap_or(0), "sum": st.iter().sum::<i64>(),
        }),
    );
    obj.insert(
        "session_size".into(),
        json!({
            "count": sv.len(),
            "tiny_lt_200k": sv.iter().filter(|x| **x < 200_000).count(),
            "median": median(&sv),
        }),
    );
    obj.insert(
        "busiest_sessions".into(),
        json!(a
            .sess_tokens
            .most_common(top)
            .into_iter()
            .map(|(jf, tok)| json!({"session": session_label(&jf), "tokens": tok}))
            .collect::<Vec<_>>()),
    );
    obj.insert(
        "top_projects".into(),
        json!(a
            .by_proj_cost
            .most_common(top)
            .into_iter()
            .map(|(p, cost)| {
                let b = a.by_proj.get(&p).copied().unwrap_or_default();
                json!({
                    "project": p,
                    "cost_weight": (cost * 100.0).round() / 100.0,
                    "total_tokens": b.total,
                    "sessions": a.sess_proj.get(&p).map(|s| s.len()).unwrap_or(0),
                })
            })
            .collect::<Vec<_>>()),
    );
    obj.insert("tool_usage".into(), Value::Object(tool_usage));
    obj.insert("mcp_usage".into(), Value::Object(mcp_usage));
    obj.insert(
        "subagent".into(),
        json!({"spawns": a.subagent_spawns, "sidechain_tokens": a.subagent_tokens}),
    );
    obj.insert(
        "web_tools".into(),
        json!({"search": a.web_search, "fetch": a.web_fetch}),
    );
    obj.insert("activity_by_hour".into(), Value::Object(activity_by_hour));

    if show_daemons {
        obj.insert(
            "daemons".into(),
            json!(crate::procs::sweep()
                .into_iter()
                .map(|d| json!({
                    "pid": d.pid.to_string(),
                    "uptime": crate::procs::format_etime(d.run_time_secs),
                    "workspace": d.workspace,
                }))
                .collect::<Vec<_>>()),
        );
    }

    pyjson::dumps_indent(&Value::Object(obj), 2)
}
