//! Resident hook path (ADR-2034 §1).
//!
//! Claude Code fires a hook process on every tool call. The per-project
//! settings that shipped with the ruflo plugin template ran a full
//! `ruflo hooks pre-command` / `post-command` CLI boot on each Bash call —
//! measured at 2.6–3.6 CPU-seconds and ≈7.6 s of wall time per call across
//! forty sessions, which was most of the container's CPU budget.
//!
//! This module is the replacement. Three pieces:
//!
//! * [`capture`] — parse the hook payload on stdin into a compact
//!   [`HookEvent`] and append it to a per-workspace spool file. One `write(2)`
//!   under 4 KiB, no CLI boot, no network. Pre-command events are also run
//!   through [`check_command_safety`] so the guard that ruflo's
//!   `--validate-safety` provided survives.
//! * [`reconcile_settings`] — rewrite a `.claude/settings.json` so the ruflo
//!   CLI hook commands become `agentbox-hook event <kind>` calls and the
//!   per-prompt `route` hook (which overran its own timeout) is dropped.
//!   Idempotent; the boot path runs it over every checkout under the workspace.
//! * [`drain_once`] — rotate the spool files, fold the events into
//!   `hook-metrics.json` and a dated `hook-events-*.jsonl` under the events
//!   volume. This is the learning signal the ruflo hooks recorded, now batched
//!   off the tool-call path by the supervised `agentbox-hook drain --loop`.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// Hook kinds the shim accepts. The names are the ruflo hook subcommands they
/// replace, plus the three lifecycle events the ruflo template routed to
/// `ruflo memory store` / `session-restore`.
pub const KINDS: [&str; 9] = [
    "pre-command",
    "post-command",
    "pre-edit",
    "post-edit",
    "pre-task",
    "post-task",
    "notification",
    "session-start",
    "session-end",
];

/// Upper bound on the summary field so one event stays one small write.
pub const SUMMARY_MAX: usize = 512;

/// One spooled hook event. Field names are stable: the drain and any later
/// RuVector ingest read them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookEvent {
    /// RFC 3339 UTC timestamp.
    pub ts: String,
    pub kind: String,
    /// Workspace key (basename plus path hash) — the spool file name.
    pub workspace: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    /// Command line, file path, task description or message — truncated.
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
}

/// Returns `true` when `kind` is one of [`KINDS`].
pub fn is_kind(kind: &str) -> bool {
    KINDS.contains(&kind)
}

/// Derives the spool key for a working directory: the nearest ancestor that
/// holds `.claude/settings.json` or `.git` (else the directory itself), keyed
/// as `<basename>-<8 hex of sha256(path)>` so two checkouts with the same
/// basename never share a spool.
pub fn workspace_key(cwd: &Path) -> String {
    let root = workspace_root(cwd);
    let text = root.to_string_lossy();
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    let base = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "root".to_string());
    let base: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!("{base}-{}", hex::encode(&digest[..4]))
}

fn workspace_root(cwd: &Path) -> PathBuf {
    let mut cur = Some(cwd);
    while let Some(dir) = cur {
        if dir.join(".claude").join("settings.json").is_file() || dir.join(".git").exists() {
            return dir.to_path_buf();
        }
        cur = dir.parent();
    }
    cwd.to_path_buf()
}

/// Truncates `s` to [`SUMMARY_MAX`] characters on a char boundary, marking the cut.
pub fn truncate_summary(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() <= SUMMARY_MAX {
        return s.to_string();
    }
    let mut out: String = s.chars().take(SUMMARY_MAX - 1).collect();
    out.push('…');
    out
}

/// Builds a [`HookEvent`] from the Claude Code hook payload (`raw`, the JSON
/// on stdin) for `kind`. `cwd_fallback` is used when the payload carries no
/// `cwd`. `success_override` wins over anything derived from the payload.
pub fn capture(
    kind: &str,
    raw: &str,
    cwd_fallback: &Path,
    success_override: Option<bool>,
    now: &str,
) -> HookEvent {
    let payload: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
    let str_at = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).map(str::to_string);

    let cwd = str_at(&payload, "cwd")
        .map(PathBuf::from)
        .unwrap_or_else(|| cwd_fallback.to_path_buf());
    let tool = str_at(&payload, "tool_name");
    let input = payload.get("tool_input").cloned().unwrap_or(Value::Null);
    let response = payload.get("tool_response").cloned().unwrap_or(Value::Null);

    let summary_src = match kind {
        "pre-command" | "post-command" => str_at(&input, "command"),
        "pre-edit" | "post-edit" => str_at(&input, "file_path"),
        "pre-task" | "post-task" => str_at(&input, "prompt")
            .or_else(|| str_at(&input, "description"))
            .or_else(|| str_at(&payload, "agent_id")),
        "notification" => str_at(&payload, "message").or_else(|| str_at(&payload, "title")),
        _ => str_at(&payload, "hook_event_name"),
    }
    .unwrap_or_default();

    let success = success_override.or_else(|| derive_success(kind, &response));

    HookEvent {
        ts: now.to_string(),
        kind: kind.to_string(),
        workspace: workspace_key(&cwd),
        session_id: str_at(&payload, "session_id"),
        cwd: Some(cwd.to_string_lossy().to_string()),
        tool,
        summary: truncate_summary(&summary_src),
        success,
    }
}

/// Post-events derive success from the tool response: an interrupted command
/// or a non-zero exit code is a failure; an absent response is unknown.
fn derive_success(kind: &str, response: &Value) -> Option<bool> {
    if !kind.starts_with("post-") || response.is_null() {
        return None;
    }
    if response.get("interrupted").and_then(Value::as_bool) == Some(true) {
        return Some(false);
    }
    for key in ["exit_code", "exitCode", "code"] {
        if let Some(code) = response.get(key).and_then(Value::as_i64) {
            return Some(code == 0);
        }
    }
    if let Some(ok) = response.get("success").and_then(Value::as_bool) {
        return Some(ok);
    }
    if response.get("error").map(|e| !e.is_null()).unwrap_or(false) {
        return Some(false);
    }
    Some(true)
}

/// Catastrophic-command guard. Returns the reason when `cmd` must be blocked.
///
/// Deliberately narrow: this replaces ruflo's `--validate-safety`, which
/// refused the same handful of destructive shapes. Everything else is the
/// permission classifier's job, not the hook's.
pub fn check_command_safety(cmd: &str) -> Option<String> {
    let patterns: [(&str, &str); 7] = [
        (
            r"(?i)(^|[;&|]\s*|sudo\s+)rm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(--no-preserve-root\s+)?(/|/\*|~|\$HOME|/home|/etc|/usr|/var|/opt|/nix)(\s|$)",
            "recursive delete of a root-level path",
        ),
        (r"(?i)(^|[;&|]\s*|sudo\s+)mkfs(\.[a-z0-9]+)?\s", "filesystem format"),
        (
            r"(?i)(^|[;&|]\s*|sudo\s+)dd\s+.*of=/dev/(sd|nvme|vd|hd|mmcblk|dm-)",
            "raw write to a block device",
        ),
        (r"(?i)>\s*/dev/(sd|nvme|vd|hd|mmcblk)[a-z0-9]*(\s|$)", "redirect onto a block device"),
        (r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:", "fork bomb"),
        (
            r"(?i)(^|[;&|]\s*|sudo\s+)chmod\s+(-[a-z]*R[a-z]*\s+)?[0-7]{3,4}\s+/(\s|$)",
            "recursive mode change on /",
        ),
        (
            r"(?i)(^|[;&|]\s*|sudo\s+)(shutdown|reboot|halt|poweroff)(\s|$)",
            "host power control",
        ),
    ];
    for (pat, why) in patterns {
        if Regex::new(pat).expect("static regex").is_match(cmd) {
            return Some(why.to_string());
        }
    }
    None
}

/// Appends `event` as one JSON line to `<spool_dir>/<workspace>.jsonl`,
/// creating the directory (0700) on first use. Returns the spool path.
pub fn append_event(spool_dir: &Path, event: &HookEvent) -> std::io::Result<PathBuf> {
    fs::create_dir_all(spool_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(spool_dir, fs::Permissions::from_mode(0o700));
    }
    let path = spool_dir.join(format!("{}.jsonl", event.workspace));
    let mut line = serde_json::to_string(event).map_err(std::io::Error::other)?;
    line.push('\n');
    let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
    f.write_all(line.as_bytes())?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Settings reconcile
// ---------------------------------------------------------------------------

/// What [`reconcile_settings`] changed.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ReconcileReport {
    /// Hook commands rewritten to the shim.
    pub replaced: usize,
    /// Hook entries removed outright (the per-prompt `route`).
    pub removed: usize,
}

impl ReconcileReport {
    pub fn changed(&self) -> bool {
        self.replaced + self.removed > 0
    }
}

/// Rewrites the hook commands in a Claude Code settings document in place.
///
/// * `ruflo|claude-flow|aqe|agentic-qe hooks <kind>` (also via `npx …`) for the
///   six tool-call kinds → `agentbox-hook event <kind> || true` (timeout 3000 ms).
/// * `ruflo hooks route` (and `claude-flow hooks route`) → removed.
/// * `ruflo memory store --namespace notifications …` → `agentbox-hook event notification || true`.
///
/// Everything else (session-restore, daemon start, the operator's own hooks)
/// is left byte-identical. Empty groups and empty event arrays left behind by
/// a removal are pruned.
pub fn reconcile_settings(doc: &mut Value) -> ReconcileReport {
    let mut report = ReconcileReport::default();
    let Some(hooks) = doc.get_mut("hooks").and_then(Value::as_object_mut) else {
        return report;
    };

    let tool_kinds = Regex::new(
        r"(?:^|\s|;|&&|\|\|)(?:ruflo|claude-flow|aqe|agentic-qe|npx\s+(?:-y\s+)?(?:ruflo|claude-flow|@claude-flow/cli|agentic-qe)(?:@[a-z0-9.]+)?)\s+hooks\s+(pre-command|post-command|pre-edit|post-edit|pre-task|post-task)\b",
    )
    .expect("static regex");
    let route = Regex::new(
        r"(?:^|\s|;|&&|\|\|)(?:ruflo|claude-flow|aqe|agentic-qe|npx\s+(?:-y\s+)?(?:ruflo|claude-flow|@claude-flow/cli|agentic-qe)(?:@[a-z0-9.]+)?)\s+hooks\s+route\b",
    )
    .expect("static regex");
    let notify = Regex::new(
        r"(?:^|\s|;|&&|\|\|)(?:ruflo|claude-flow)\s+memory\s+store\s+--namespace\s+notifications\b",
    )
    .expect("static regex");

    let mut empty_events = Vec::new();
    for (event, groups) in hooks.iter_mut() {
        let Some(groups) = groups.as_array_mut() else { continue };
        for group in groups.iter_mut() {
            let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else { continue };
            list.retain_mut(|hook| {
                let Some(cmd) = hook.get("command").and_then(Value::as_str).map(str::to_string) else {
                    return true;
                };
                if route.is_match(&cmd) {
                    report.removed += 1;
                    return false;
                }
                let replacement = if let Some(m) = tool_kinds.captures(&cmd) {
                    Some(format!("agentbox-hook event {} || true", &m[1]))
                } else if notify.is_match(&cmd) {
                    Some("agentbox-hook event notification || true".to_string())
                } else {
                    None
                };
                if let Some(new_cmd) = replacement {
                    if let Some(obj) = hook.as_object_mut() {
                        obj.insert("command".into(), Value::String(new_cmd));
                        obj.insert("timeout".into(), json!(3000));
                        report.replaced += 1;
                    }
                }
                true
            });
        }
        groups.retain(|g| {
            g.get("hooks")
                .and_then(Value::as_array)
                .map(|l| !l.is_empty())
                .unwrap_or(true)
        });
        if groups.is_empty() {
            empty_events.push(event.clone());
        }
    }
    for event in empty_events {
        hooks.remove(&event);
    }
    report
}

/// Applies [`reconcile_settings`] to a file, writing atomically (temp + rename,
/// mode preserved) only when something changed. `dry` reports without writing.
pub fn reconcile_file(path: &Path, dry: bool) -> Result<ReconcileReport, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut doc: Value =
        serde_json::from_str(&text).map_err(|e| format!("{}: not JSON: {e}", path.display()))?;
    let report = reconcile_settings(&mut doc);
    if report.changed() && !dry {
        write_atomic_json(path, &doc).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(report)
}

/// Finds `.claude/settings.json` and `.claude/settings.local.json` under
/// `root` to `max_depth` directory levels (0 = root only). Skips
/// `node_modules`, `target`, `.git` and hidden directories other than `.claude`.
pub fn discover_settings(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    walk(root, 0, max_depth, &mut found);
    found.sort();
    found
}

fn walk(dir: &Path, depth: usize, max_depth: usize, found: &mut Vec<PathBuf>) {
    for name in ["settings.json", "settings.local.json"] {
        let p = dir.join(".claude").join(name);
        if p.is_file() {
            found.push(p);
        }
    }
    if depth >= max_depth {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else { continue };
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        walk(&path, depth + 1, max_depth, found);
    }
}

fn write_atomic_json(path: &Path, doc: &Value) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("settings"),
        std::process::id()
    ));
    let mut text = serde_json::to_string_pretty(doc).map_err(std::io::Error::other)?;
    text.push('\n');
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
    }
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
        // Boot runs the reconcile as root before supervisord drops privileges;
        // the settings file must stay owned by whoever owned it (devuser), or
        // Claude Code can no longer update its own settings.
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let _ = std::os::unix::fs::chown(&tmp, Some(meta.uid()), Some(meta.gid()));
        }
    }
    fs::rename(&tmp, path)
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

/// Per-workspace rollup kept in `hook-metrics.json`.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceMetrics {
    pub events: u64,
    pub by_kind: BTreeMap<String, u64>,
    pub by_tool: BTreeMap<String, u64>,
    pub post_ok: u64,
    pub post_fail: u64,
    /// Leading word of each command, counted — the cheap "what does this
    /// workspace run" signal the ruflo post-command hook tracked.
    pub commands: BTreeMap<String, u64>,
    pub first_seen: String,
    pub last_seen: String,
}

/// Outcome of one [`drain_once`] pass.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct DrainReport {
    pub files: usize,
    pub events: u64,
    pub malformed: u64,
}

const METRICS_FILE: &str = "hook-metrics.json";

/// Rotates every `*.jsonl` spool under `spool_dir`, folds the events into
/// `<out_dir>/hook-metrics.json` and appends them to
/// `<out_dir>/hook-events-<YYYY-MM-DD>.jsonl`. Safe to run concurrently with
/// writers: a spool is renamed first, so new events land in a fresh file.
pub fn drain_once(spool_dir: &Path, out_dir: &Path) -> std::io::Result<DrainReport> {
    let mut report = DrainReport::default();
    let Ok(entries) = fs::read_dir(spool_dir) else { return Ok(report) };
    fs::create_dir_all(out_dir)?;

    let mut metrics: BTreeMap<String, WorkspaceMetrics> = fs::read_to_string(out_dir.join(METRICS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
        .and_then(|m| m.get("workspaces").cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let mut rotated = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_spool = path.extension().map(|e| e == "jsonl").unwrap_or(false);
        if !is_spool {
            continue;
        }
        let draining = path.with_extension(format!("draining-{}", std::process::id()));
        if fs::rename(&path, &draining).is_ok() {
            rotated.push(draining);
        }
    }
    // Pick up drains abandoned by a crashed previous pass.
    if let Ok(entries) = fs::read_dir(spool_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext.starts_with("draining-") && !rotated.contains(&path) {
                rotated.push(path);
            }
        }
    }

    let mut by_day: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for path in &rotated {
        report.files += 1;
        let text = fs::read_to_string(path)?;
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(ev) = serde_json::from_str::<HookEvent>(line) else {
                report.malformed += 1;
                continue;
            };
            fold(&mut metrics, &ev);
            let day = ev.ts.get(..10).unwrap_or("undated").to_string();
            by_day.entry(day).or_default().push(line.to_string());
            report.events += 1;
        }
    }

    for (day, lines) in by_day {
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(out_dir.join(format!("hook-events-{day}.jsonl")))?;
        for line in lines {
            f.write_all(line.as_bytes())?;
            f.write_all(b"\n")?;
        }
    }

    let doc = json!({
        "schema": "agentbox.hook-metrics.v1",
        "updated": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "workspaces": metrics,
    });
    write_atomic_json(&out_dir.join(METRICS_FILE), &doc)?;

    for path in rotated {
        let _ = fs::remove_file(path);
    }
    Ok(report)
}

/// Folds one event into the per-workspace rollup.
pub fn fold(metrics: &mut BTreeMap<String, WorkspaceMetrics>, ev: &HookEvent) {
    let m = metrics.entry(ev.workspace.clone()).or_default();
    m.events += 1;
    *m.by_kind.entry(ev.kind.clone()).or_default() += 1;
    if let Some(tool) = &ev.tool {
        *m.by_tool.entry(tool.clone()).or_default() += 1;
    }
    if ev.kind == "post-command" {
        match ev.success {
            Some(true) => m.post_ok += 1,
            Some(false) => m.post_fail += 1,
            None => {}
        }
        if let Some(head) = ev.summary.split_whitespace().next() {
            let head: String = head.chars().take(32).collect();
            *m.commands.entry(head).or_default() += 1;
        }
    }
    if m.first_seen.is_empty() || ev.ts < m.first_seen {
        m.first_seen = ev.ts.clone();
    }
    if ev.ts > m.last_seen {
        m.last_seen = ev.ts.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[test]
    fn kinds_are_recognised() {
        for k in KINDS {
            assert!(is_kind(k));
        }
        assert!(!is_kind("route"));
    }

    #[test]
    fn workspace_key_uses_nearest_checkout_root() {
        let dir = tmp();
        let root = dir.path().join("proj");
        fs::create_dir_all(root.join(".git")).unwrap();
        let deep = root.join("src").join("x");
        fs::create_dir_all(&deep).unwrap();
        let a = workspace_key(&deep);
        let b = workspace_key(&root);
        assert_eq!(a, b);
        assert!(a.starts_with("proj-"));
        assert_eq!(a.len(), "proj-".len() + 8);
    }

    #[test]
    fn capture_reads_command_and_derives_success() {
        let raw = r#"{"session_id":"s1","cwd":"/nonexistent/ws","tool_name":"Bash","tool_input":{"command":"cargo test"},"tool_response":{"stdout":"ok","interrupted":false}}"#;
        let ev = capture("post-command", raw, Path::new("/tmp"), None, "2026-09-05T10:00:00Z");
        assert_eq!(ev.kind, "post-command");
        assert_eq!(ev.session_id.as_deref(), Some("s1"));
        assert_eq!(ev.tool.as_deref(), Some("Bash"));
        assert_eq!(ev.summary, "cargo test");
        assert_eq!(ev.success, Some(true));
        assert!(ev.workspace.starts_with("ws-"));

        let raw = r#"{"tool_name":"Bash","tool_input":{"command":"x"},"tool_response":{"interrupted":true}}"#;
        let ev = capture("post-command", raw, Path::new("/tmp"), None, "t");
        assert_eq!(ev.success, Some(false));

        let ev = capture("post-command", raw, Path::new("/tmp"), Some(true), "t");
        assert_eq!(ev.success, Some(true), "explicit override wins");

        let ev = capture("pre-command", raw, Path::new("/tmp"), None, "t");
        assert_eq!(ev.success, None, "pre events carry no outcome");
    }

    #[test]
    fn capture_tolerates_garbage_payload() {
        let ev = capture("pre-edit", "not json", Path::new("/tmp/w"), None, "t");
        assert_eq!(ev.summary, "");
        assert_eq!(ev.cwd.as_deref(), Some("/tmp/w"));
    }

    #[test]
    fn summary_is_bounded() {
        let long = "a".repeat(SUMMARY_MAX * 3);
        let s = truncate_summary(&long);
        assert_eq!(s.chars().count(), SUMMARY_MAX);
        assert!(s.ends_with('…'));
    }

    #[test]
    fn safety_blocks_catastrophic_and_allows_ordinary() {
        for bad in [
            "rm -rf /",
            "sudo rm -rf /*",
            "rm -fr ~",
            "cd /tmp && rm -rf /home",
            "mkfs.ext4 /dev/sda1",
            "dd if=/dev/zero of=/dev/nvme0n1 bs=1M",
            "cat x > /dev/sda",
            ":(){ :|:& };:",
            "chmod -R 777 /",
            "reboot",
        ] {
            assert!(check_command_safety(bad).is_some(), "should block: {bad}");
        }
        for ok in [
            "rm -rf ./target",
            "rm -rf /tmp/build-123",
            "cargo test",
            "git rm -r --cached node_modules",
            "echo reboot",
            "dd if=in.img of=out.img",
            "rm -rf $HOME/.cache/foo",
        ] {
            assert!(check_command_safety(ok).is_none(), "should allow: {ok}");
        }
    }

    #[test]
    fn append_then_drain_round_trips() {
        let dir = tmp();
        let spool = dir.path().join("spool");
        let out = dir.path().join("out");
        let ev = HookEvent {
            ts: "2026-09-05T10:00:00Z".into(),
            kind: "post-command".into(),
            workspace: "ws-deadbeef".into(),
            session_id: Some("s".into()),
            cwd: None,
            tool: Some("Bash".into()),
            summary: "cargo test --all".into(),
            success: Some(true),
        };
        append_event(&spool, &ev).unwrap();
        let mut ev2 = ev.clone();
        ev2.success = Some(false);
        ev2.ts = "2026-09-05T10:01:00Z".into();
        append_event(&spool, &ev2).unwrap();
        assert!(spool.join("ws-deadbeef.jsonl").is_file());

        let r = drain_once(&spool, &out).unwrap();
        assert_eq!(r.files, 1);
        assert_eq!(r.events, 2);
        assert_eq!(r.malformed, 0);
        assert!(!spool.join("ws-deadbeef.jsonl").exists(), "spool rotated away");
        let m: Value = serde_json::from_str(&fs::read_to_string(out.join(METRICS_FILE)).unwrap()).unwrap();
        let ws = &m["workspaces"]["ws-deadbeef"];
        assert_eq!(ws["events"], 2);
        assert_eq!(ws["post_ok"], 1);
        assert_eq!(ws["post_fail"], 1);
        assert_eq!(ws["commands"]["cargo"], 2);
        assert_eq!(ws["last_seen"], "2026-09-05T10:01:00Z");
        let day = fs::read_to_string(out.join("hook-events-2026-09-05.jsonl")).unwrap();
        assert_eq!(day.lines().count(), 2);

        // A second drain with nothing new is a clean no-op that keeps metrics.
        let r = drain_once(&spool, &out).unwrap();
        assert_eq!(r.events, 0);
        let m: Value = serde_json::from_str(&fs::read_to_string(out.join(METRICS_FILE)).unwrap()).unwrap();
        assert_eq!(m["workspaces"]["ws-deadbeef"]["events"], 2);
    }

    #[test]
    fn drain_counts_malformed_lines_without_stopping() {
        let dir = tmp();
        let spool = dir.path().join("spool");
        fs::create_dir_all(&spool).unwrap();
        fs::write(spool.join("w.jsonl"), "{bad\n{\"ts\":\"t\",\"kind\":\"pre-edit\",\"workspace\":\"w\",\"summary\":\"f\"}\n").unwrap();
        let r = drain_once(&spool, &dir.path().join("out")).unwrap();
        assert_eq!(r.malformed, 1);
        assert_eq!(r.events, 1);
    }

    fn ruflo_template() -> Value {
        json!({
            "hooks": {
                "PreToolUse": [
                    {"matcher": "^Bash$", "hooks": [{"type": "command", "command": "[ -n \"$TOOL_INPUT_command\" ] && ruflo hooks pre-command --command \"$TOOL_INPUT_command\" 2>/dev/null || true", "timeout": 5000}]},
                    {"matcher": "^(Write|Edit|MultiEdit)$", "hooks": [{"type": "command", "command": "[ -n \"$TOOL_INPUT_file_path\" ] && ruflo hooks pre-edit --file \"$TOOL_INPUT_file_path\" 2>/dev/null || true", "timeout": 5000}]}
                ],
                "PostToolUse": [
                    {"matcher": "^Bash$", "hooks": [{"type": "command", "command": "[ -n \"$TOOL_INPUT_command\" ] && ruflo hooks post-command --command \"$TOOL_INPUT_command\" --success \"${TOOL_SUCCESS:-true}\" 2>/dev/null || true", "timeout": 5000}]},
                    {"matcher": "^Task$", "hooks": [{"type": "command", "command": "[ -n \"$TOOL_RESULT_agent_id\" ] && ruflo hooks post-task --task-id \"$TOOL_RESULT_agent_id\" 2>/dev/null || true", "timeout": 5000}]}
                ],
                "UserPromptSubmit": [
                    {"hooks": [{"type": "command", "command": "[ -n \"$PROMPT\" ] && ruflo hooks route --task \"$PROMPT\" || true", "timeout": 5000}]}
                ],
                "SessionStart": [
                    {"hooks": [
                        {"type": "command", "command": "ruflo daemon start --quiet 2>/dev/null || true", "timeout": 5000},
                        {"type": "command", "command": "[ -n \"$SESSION_ID\" ] && ruflo hooks session-restore --session-id \"$SESSION_ID\" 2>/dev/null || true", "timeout": 10000}
                    ]}
                ],
                "Notification": [
                    {"hooks": [{"type": "command", "command": "[ -n \"$NOTIFICATION_MESSAGE\" ] && ruflo memory store --namespace notifications --key \"notify-$(date +%s)\" --value \"$NOTIFICATION_MESSAGE\" 2>/dev/null || true", "timeout": 3000}]}
                ],
                "Stop": [
                    {"hooks": [{"type": "command", "command": "echo '{\"ok\": true}'", "timeout": 1000}]}
                ]
            }
        })
    }

    #[test]
    fn reconcile_rewrites_tool_hooks_drops_route_keeps_lifecycle() {
        let mut doc = ruflo_template();
        let r = reconcile_settings(&mut doc);
        assert_eq!(r.replaced, 5, "pre-command, pre-edit, post-command, post-task, notification");
        assert_eq!(r.removed, 1, "route");
        let h = &doc["hooks"];
        assert!(h.get("UserPromptSubmit").is_none(), "empty event pruned");
        assert_eq!(h["PreToolUse"][0]["hooks"][0]["command"], "agentbox-hook event pre-command || true");
        assert_eq!(h["PreToolUse"][0]["hooks"][0]["timeout"], 3000);
        assert_eq!(h["PreToolUse"][0]["matcher"], "^Bash$", "matcher preserved");
        assert_eq!(h["PostToolUse"][1]["hooks"][0]["command"], "agentbox-hook event post-task || true");
        assert_eq!(h["Notification"][0]["hooks"][0]["command"], "agentbox-hook event notification || true");
        assert!(h["SessionStart"][0]["hooks"][0]["command"].as_str().unwrap().contains("ruflo daemon start"));
        assert!(h["SessionStart"][0]["hooks"][1]["command"].as_str().unwrap().contains("session-restore"));
        assert_eq!(h["Stop"][0]["hooks"][0]["command"], "echo '{\"ok\": true}'");

        // Idempotent.
        let again = reconcile_settings(&mut doc);
        assert_eq!(again, ReconcileReport::default());
    }

    #[test]
    fn reconcile_handles_claude_flow_npx_and_aqe_spellings() {
        let mut doc = json!({"hooks": {"PreToolUse": [{"hooks": [
            {"type": "command", "command": "npx -y claude-flow@alpha hooks pre-command --command \"$X\""},
            {"type": "command", "command": "[ -n \"$C\" ] && npx @claude-flow/cli@latest hooks post-command --command \"$C\" || true"},
            {"type": "command", "command": "aqe hooks pre-command --command \"$TOOL_INPUT_command\" --json"},
            {"type": "command", "command": "[ -n \"$C\" ] && agentic-qe hooks post-edit --file \"$F\" 2>/dev/null || true"},
            {"type": "command", "command": "claude-flow hooks route --task x"},
            {"type": "command", "command": "aqe hooks route --task \"$PROMPT\" --json"}
        ]}]}});
        let r = reconcile_settings(&mut doc);
        assert_eq!((r.replaced, r.removed), (4, 2));
        let cmds: Vec<&str> = doc["hooks"]["PreToolUse"][0]["hooks"].as_array().unwrap().iter().map(|h| h["command"].as_str().unwrap()).collect();
        assert_eq!(cmds, vec![
            "agentbox-hook event pre-command || true",
            "agentbox-hook event post-command || true",
            "agentbox-hook event pre-command || true",
            "agentbox-hook event post-edit || true",
        ]);
    }

    #[test]
    fn reconcile_leaves_unrelated_documents_alone() {
        let mut doc = json!({"permissions": {"allow": ["Bash(ls)"]}});
        let before = doc.clone();
        assert_eq!(reconcile_settings(&mut doc), ReconcileReport::default());
        assert_eq!(doc, before);
    }

    #[test]
    fn reconcile_file_is_atomic_and_preserves_mode() {
        let dir = tmp();
        let root = dir.path().join("proj");
        fs::create_dir_all(root.join(".claude")).unwrap();
        let p = root.join(".claude").join("settings.json");
        fs::write(&p, serde_json::to_string(&ruflo_template()).unwrap()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let dry = reconcile_file(&p, true).unwrap();
        assert!(dry.changed());
        assert!(fs::read_to_string(&p).unwrap().contains("ruflo hooks pre-command"), "dry run wrote nothing");
        let wet = reconcile_file(&p, false).unwrap();
        assert_eq!(wet, dry);
        let text = fs::read_to_string(&p).unwrap();
        assert!(!text.contains("hooks pre-command"));
        assert!(text.contains("agentbox-hook event pre-command"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert!(fs::read_dir(root.join(".claude")).unwrap().count() == 1, "no temp file left");
        assert_eq!(discover_settings(dir.path(), 2), vec![p]);
    }

    #[test]
    fn discover_skips_hidden_and_vendor_dirs() {
        let dir = tmp();
        for rel in ["a/.claude", "node_modules/x/.claude", ".git/.claude", "a/b/c/.claude"] {
            fs::create_dir_all(dir.path().join(rel)).unwrap();
            fs::write(dir.path().join(rel).join("settings.json"), "{}").unwrap();
        }
        let found = discover_settings(dir.path(), 2);
        assert_eq!(found, vec![dir.path().join("a/.claude/settings.json")]);
    }
}
