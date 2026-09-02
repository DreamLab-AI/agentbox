//! Unit tests for the token-audit collector, split out to keep `mod.rs`
//! under the repository's 500-line-per-file limit.

use super::*;
use chrono::Utc;

#[test]
fn model_families_cover_every_priced_tier() {
    assert_eq!(family(Some("claude-opus-4-20250514")), "opus");
    assert_eq!(
        family(Some("claude-fable-5-1")),
        "opus",
        "Fable is priced as Opus"
    );
    assert_eq!(family(Some("claude-sonnet-4-5")), "sonnet");
    assert_eq!(family(Some("claude-haiku-4-5-20251001")), "haiku");
    assert_eq!(family(Some("some-other-model")), "other");
    assert_eq!(family(None), "other");
}

#[test]
fn unknown_models_are_priced_as_opus_not_free() {
    let p = price_for("other");
    assert_eq!(p.input, OPUS.input);
    assert_eq!(p.output, OPUS.output);
}

#[test]
fn fmt_switches_units_at_the_python_thresholds() {
    assert_eq!(fmt(999), "999");
    assert_eq!(fmt(1_000), "1K");
    assert_eq!(fmt(340_000), "340K");
    assert_eq!(fmt(999_999), "1000K");
    assert_eq!(fmt(1_000_000), "1.0M");
    assert_eq!(fmt(1_234_567), "1.2M");
    assert_eq!(fmt(0), "0");
}

#[test]
fn project_label_strips_the_development_active_prefix() {
    assert_eq!(
        project_label("/a/b/-home-Development-active-myrepo"),
        "myrepo"
    );
    assert_eq!(project_label("/a/b/plain-project"), "plain-project");
}

#[test]
fn project_label_is_capped_at_42_characters() {
    let long = format!("/a/{}", "x".repeat(80));
    assert_eq!(project_label(&long).len(), 42);
}

#[test]
fn session_label_joins_project_and_short_id() {
    assert_eq!(
        session_label("/root/myproj/0123456789abcdef.jsonl"),
        "myproj/01234567"
    );
}

fn write_transcript(dir: &std::path::Path, name: &str, lines: &[String]) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join(name), lines.join("\n")).unwrap();
}

fn assistant_line(model: &str, inp: i64, out: i64, cr: i64, cc: i64) -> String {
    let ts = Utc::now().to_rfc3339();
    serde_json::json!({
        "type": "assistant",
        "timestamp": ts,
        "message": {
            "model": model,
            "usage": {
                "input_tokens": inp, "output_tokens": out,
                "cache_read_input_tokens": cr, "cache_creation_input_tokens": cc
            }
        }
    })
    .to_string()
}

#[test]
fn collect_aggregates_assistant_messages() {
    let tmp = tempfile::tempdir().unwrap();
    write_transcript(
        &tmp.path().join("projA"),
        "sess1.jsonl",
        &[assistant_line("claude-opus-4", 100, 50, 10, 5)],
    );
    let a = collect(tmp.path(), 7);
    assert_eq!(a.msg_count, 1);
    assert_eq!(a.totals.input, 100);
    assert_eq!(a.totals.output, 50);
    assert_eq!(a.totals.total, 165);
    assert_eq!(a.active_sessions.len(), 1);
    assert!(a.total_cost > 0.0);
}

#[test]
fn collect_ignores_non_assistant_and_usage_free_lines() {
    let tmp = tempfile::tempdir().unwrap();
    write_transcript(
        &tmp.path().join("projA"),
        "sess1.jsonl",
        &[
            r#"{"type": "user", "timestamp": "2026-09-01T00:00:00Z", "message": {"usage": {"input_tokens": 999}}}"#.to_string(),
            r#"{"type": "assistant", "timestamp": "2026-09-01T00:00:00Z", "message": {}}"#.to_string(),
            "not json at all".to_string(),
        ],
    );
    let a = collect(tmp.path(), 3650);
    assert_eq!(
        a.msg_count, 0,
        "only assistant messages carrying usage count"
    );
}

#[test]
fn collect_honours_the_lookback_window() {
    let tmp = tempfile::tempdir().unwrap();
    let old = serde_json::json!({
        "type": "assistant",
        "timestamp": "2020-01-01T00:00:00Z",
        "message": {"model": "claude-opus-4", "usage": {"input_tokens": 100}}
    })
    .to_string();
    write_transcript(&tmp.path().join("projA"), "sess1.jsonl", &[old]);
    assert_eq!(collect(tmp.path(), 7).msg_count, 0, "older than the cutoff");
    assert!(
        collect(tmp.path(), 20_000).msg_count > 0,
        "inside a wide window"
    );
}

#[test]
fn tool_and_mcp_calls_are_counted_and_grouped_by_server() {
    let tmp = tempfile::tempdir().unwrap();
    let line = serde_json::json!({
        "type": "assistant",
        "timestamp": Utc::now().to_rfc3339(),
        "message": {
            "model": "claude-opus-4",
            "usage": {"input_tokens": 10},
            "content": [
                {"type": "tool_use", "name": "Bash"},
                {"type": "tool_use", "name": "mcp__claude-flow__memory_store"},
                {"type": "tool_use", "name": "mcp__claude-flow__memory_search"},
                {"type": "tool_use", "name": "Task"},
                {"type": "text", "text": "ignored"}
            ]
        }
    })
    .to_string();
    write_transcript(&tmp.path().join("projA"), "s.jsonl", &[line]);
    let a = collect(tmp.path(), 7);
    assert_eq!(a.tools.get("Bash"), 1);
    assert_eq!(a.tools.total(), 4, "text blocks are not tool calls");
    assert_eq!(a.mcp.get("claude-flow"), 2, "MCP calls group by server");
    assert_eq!(a.subagent_spawns, 1);
}

#[test]
fn sidechain_messages_are_attributed_to_subagents() {
    let tmp = tempfile::tempdir().unwrap();
    let line = serde_json::json!({
        "type": "assistant",
        "timestamp": Utc::now().to_rfc3339(),
        "isSidechain": true,
        "message": {"model": "claude-haiku-4-5", "usage": {"input_tokens": 100, "output_tokens": 20}}
    })
    .to_string();
    write_transcript(&tmp.path().join("projA"), "s.jsonl", &[line]);
    assert_eq!(collect(tmp.path(), 7).subagent_tokens, 120);
}

#[test]
fn server_side_web_tool_requests_are_tallied() {
    let tmp = tempfile::tempdir().unwrap();
    let line = serde_json::json!({
        "type": "assistant",
        "timestamp": Utc::now().to_rfc3339(),
        "message": {"model": "claude-opus-4", "usage": {
            "input_tokens": 1,
            "server_tool_use": {"web_search_requests": 3, "web_fetch_requests": 2}
        }}
    })
    .to_string();
    write_transcript(&tmp.path().join("projA"), "s.jsonl", &[line]);
    let a = collect(tmp.path(), 7);
    assert_eq!((a.web_search, a.web_fetch), (3, 2));
}

#[test]
fn the_first_message_of_a_session_records_the_startup_tax() {
    let tmp = tempfile::tempdir().unwrap();
    write_transcript(
        &tmp.path().join("projA"),
        "s.jsonl",
        &[
            assistant_line("claude-opus-4", 100, 10, 500, 50),
            assistant_line("claude-opus-4", 20, 10, 600, 0),
        ],
    );
    let a = collect(tmp.path(), 7);
    assert_eq!(
        a.startup_tax,
        vec![650],
        "cache-read + cache-write + input of the first message"
    );
}

#[test]
fn one_hour_cache_writes_are_priced_above_five_minute_ones() {
    let mk = |field: &str| {
        serde_json::json!({
            "type": "assistant",
            "timestamp": Utc::now().to_rfc3339(),
            "message": {"model": "claude-opus-4", "usage": {
                "input_tokens": 0, "cache_creation": {field: 1_000_000}
            }}
        })
        .to_string()
    };
    let a = tempfile::tempdir().unwrap();
    write_transcript(
        &a.path().join("p"),
        "s.jsonl",
        &[mk("ephemeral_5m_input_tokens")],
    );
    let b = tempfile::tempdir().unwrap();
    write_transcript(
        &b.path().join("p"),
        "s.jsonl",
        &[mk("ephemeral_1h_input_tokens")],
    );
    let cost5 = collect(a.path(), 7).total_cost;
    let cost1h = collect(b.path(), 7).total_cost;
    assert!((cost5 - OPUS.cw5).abs() < 1e-9);
    assert!((cost1h - OPUS.cw1h).abs() < 1e-9);
    assert!(cost1h > cost5);
}

#[test]
fn an_empty_root_produces_an_empty_audit() {
    let tmp = tempfile::tempdir().unwrap();
    let a = collect(tmp.path(), 7);
    assert_eq!(a.msg_count, 0);
    assert_eq!(a.totals.total, 0);
    assert!(a.by_day.is_empty());
}

#[test]
fn the_json_report_carries_every_documented_section() {
    let tmp = tempfile::tempdir().unwrap();
    write_transcript(
        &tmp.path().join("projA"),
        "s.jsonl",
        &[assistant_line("claude-opus-4", 100, 50, 10, 5)],
    );
    let a = collect(tmp.path(), 7);
    let text = report::json_report(&a, 15, false);
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    for key in [
        "since",
        "responses",
        "active_sessions",
        "totals",
        "cache_efficiency_pct",
        "cost_weight_opus_equiv",
        "by_day",
        "by_model",
        "sessions_per_day",
        "startup_tax",
        "session_size",
        "busiest_sessions",
        "top_projects",
        "tool_usage",
        "mcp_usage",
        "subagent",
        "web_tools",
        "activity_by_hour",
    ] {
        assert!(v.get(key).is_some(), "missing section: {key}");
    }
    assert!(
        v.get("daemons").is_none(),
        "--no-daemons omits the section entirely"
    );
    assert_eq!(v["totals"]["total"], 165);
    assert_eq!(v["activity_by_hour"].as_object().unwrap().len(), 24);
}

#[test]
fn the_human_report_renders_the_headline_sections() {
    let tmp = tempfile::tempdir().unwrap();
    write_transcript(
        &tmp.path().join("projA"),
        "s.jsonl",
        &[assistant_line("claude-opus-4", 100, 50, 10, 5)],
    );
    let a = collect(tmp.path(), 7);
    let text = report::human(&a, 15, false);
    assert!(text.contains("=== Claude Code USAGE AUDIT — since"));
    assert!(text.contains("TOTAL TOKENS:"));
    assert!(text.contains("--- BY DAY"));
    assert!(text.contains("--- SUBAGENT FAN-OUT"));
}
