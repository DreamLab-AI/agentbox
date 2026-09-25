//! Governed hook registry — `hooks-reconcile` (the ADR-2092 model applied to hooks).
//!
//! `~/.claude/settings.json` is a host mount that outlives every rebuild, and
//! nothing governed its `hooks` block: the entrypoint seeds agentbox's own hooks
//! there, `ruflo init` / the claude-flow helpers scaffold a dozen more, and AoE
//! adds its own. The scaffolding accreted per-turn cost (a regex "Agent: coder
//! 80%" box injected on every prompt, dead verbs that only echo `[OK] Hook:`,
//! an auto-memory importer that prints an npm warning into every session) and
//! nothing ever took it away again.
//!
//! This reconciler reads `config/registered-hooks.txt` and, per hook entry:
//!
//! * `prune <marker>` — removes it wherever it is registered (vendor scaffolding
//!   and retired registrations);
//! * `keep <marker>` — third-party, left byte-for-byte alone (AoE's own hooks);
//! * `own <marker> <events> <timeout_s|->` — agentbox's own: removed from any
//!   event not listed, de-duplicated, and its `timeout` rewritten to the
//!   canonical value in **seconds** (the registration sites used to write
//!   milliseconds, which Claude Code reads as seconds — `8000` was 2.2 hours);
//! * anything else — preserved and REPORTED, so a hand-added experiment keeps
//!   working and the operator sees it. Its timeout is only corrected when it is
//!   above [`MAX_TIMEOUT_S`], which no hook ever means and is always the
//!   millisecond mistake.
//!
//! It never adds a hook: gating (register when on, retract when off) stays with
//! the entrypoint blocks that own each hook. Fail-open: a missing or corrupt
//! settings file is a no-op.

use std::path::Path;

use serde_json::{Map, Value};

/// Largest timeout (seconds) a registered hook may carry. Anything above it is
/// read as the historical milliseconds mistake and converted.
pub const MAX_TIMEOUT_S: u64 = 600;

/// What the registry says to do with a matching hook entry.
#[derive(Debug, Clone, PartialEq)]
pub enum Rule {
    /// Agentbox-owned: allowed events and canonical timeout (`None` = the
    /// registering block computes it; only the unit is policed).
    Own {
        marker: String,
        events: Vec<String>,
        timeout: Option<u64>,
    },
    /// Third-party entry, preserved untouched.
    Keep { marker: String },
    /// Vendor scaffolding or a retired registration, removed everywhere.
    Prune { marker: String },
}

impl Rule {
    fn marker(&self) -> &str {
        match self {
            Rule::Own { marker, .. } | Rule::Keep { marker } | Rule::Prune { marker } => marker,
        }
    }
}

/// Parse `registered-hooks.txt`. `#` starts a comment at line start or after
/// whitespace; columns are whitespace-separated.
pub fn parse_registry(text: &str) -> Result<Vec<Rule>, String> {
    let mut rules = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = strip_comment(raw);
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.is_empty() {
            continue;
        }
        let at = |what: &str| format!("registered-hooks line {}: {what}", i + 1);
        let rule = match (cols[0], cols.len()) {
            ("prune", 2) => Rule::Prune {
                marker: cols[1].into(),
            },
            ("keep", 2) => Rule::Keep {
                marker: cols[1].into(),
            },
            ("own", 4) => {
                let events: Vec<String> = cols[2]
                    .split(',')
                    .filter(|e| !e.is_empty())
                    .map(String::from)
                    .collect();
                if events.is_empty() {
                    return Err(at("`own` needs at least one event"));
                }
                let timeout = if cols[3] == "-" {
                    None
                } else {
                    let t: u64 = cols[3]
                        .parse()
                        .map_err(|_| at("timeout must be whole seconds or `-`"))?;
                    if t == 0 || t > MAX_TIMEOUT_S {
                        return Err(at(&format!("timeout {t}s outside 1..={MAX_TIMEOUT_S}")));
                    }
                    Some(t)
                };
                Rule::Own {
                    marker: cols[1].into(),
                    events,
                    timeout,
                }
            }
            (kind, n) => return Err(at(&format!("unrecognised `{kind}` with {n} column(s)"))),
        };
        rules.push(rule);
    }
    Ok(rules)
}

fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'#' && (i == 0 || bytes[i - 1].is_ascii_whitespace()) {
            return &line[..i];
        }
    }
    line
}

/// What one reconcile pass changed or noticed.
#[derive(Debug, Default, PartialEq)]
pub struct Report {
    /// `(event, command)` removed by a `prune` rule.
    pub pruned: Vec<(String, String)>,
    /// `(event, command)` owned hooks removed from an event they do not belong
    /// on, or duplicates of one already registered there.
    pub misplaced: Vec<(String, String)>,
    /// `(event, command, from, to)` timeouts rewritten.
    pub retimed: Vec<(String, String, String, u64)>,
    /// `(event, command)` entries the registry does not know — preserved.
    pub unknown: Vec<(String, String)>,
}

impl Report {
    pub fn changed(&self) -> bool {
        !(self.pruned.is_empty() && self.misplaced.is_empty() && self.retimed.is_empty())
    }
}

fn classify<'a>(rules: &'a [Rule], cmd: &str) -> Option<&'a Rule> {
    // prune beats keep beats own, whatever the file order: a third-party
    // wrapper around vendor scaffolding is still scaffolding.
    let hit = |want: fn(&Rule) -> bool| rules.iter().find(|r| want(r) && cmd.contains(r.marker()));
    hit(|r| matches!(r, Rule::Prune { .. }))
        .or_else(|| hit(|r| matches!(r, Rule::Keep { .. })))
        .or_else(|| hit(|r| matches!(r, Rule::Own { .. })))
}

fn ms_to_s(t: f64) -> u64 {
    ((t / 1000.0).ceil() as u64).max(1)
}

/// Short, single-line form of a command for the boot log.
fn short(cmd: &str) -> String {
    let one = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > 96 {
        format!("{}…", one.chars().take(95).collect::<String>())
    } else {
        one
    }
}

/// Reconcile the `hooks` block of a parsed settings document in place.
pub fn reconcile(settings: &mut Value, rules: &[Rule]) -> Report {
    let mut report = Report::default();
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else {
        return report;
    };

    let events: Vec<String> = hooks.keys().cloned().collect();
    for event in events {
        let Some(groups) = hooks.get_mut(&event).and_then(Value::as_array_mut) else {
            continue;
        };
        let mut seen: Vec<(String, String)> = Vec::new(); // (marker, matcher)
        let mut touched = false;
        for group in groups.iter_mut() {
            let matcher = group
                .get("matcher")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                continue;
            };
            let before = list.len();
            list.retain_mut(|h| {
                let cmd = h
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let rule = classify(rules, &cmd);
                let canonical = match rule {
                    Some(Rule::Prune { .. }) => {
                        report.pruned.push((event.clone(), short(&cmd)));
                        return false;
                    }
                    Some(Rule::Keep { .. }) => return true,
                    Some(Rule::Own {
                        marker,
                        events,
                        timeout,
                    }) => {
                        let key = (marker.clone(), matcher.clone());
                        if !events.iter().any(|e| e == &event) || seen.contains(&key) {
                            report.misplaced.push((event.clone(), short(&cmd)));
                            return false;
                        }
                        seen.push(key);
                        *timeout
                    }
                    None => {
                        report.unknown.push((event.clone(), short(&cmd)));
                        None
                    }
                };
                if let Some(obj) = h.as_object_mut() {
                    let cur = obj.get("timeout").and_then(Value::as_f64);
                    let want = match (canonical, cur) {
                        (Some(t), Some(c)) if c != t as f64 => Some(t),
                        (Some(t), None) => Some(t),
                        (None, Some(c)) if c > MAX_TIMEOUT_S as f64 => Some(ms_to_s(c)),
                        _ => None,
                    };
                    if let Some(t) = want {
                        let from = obj
                            .get("timeout")
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "unset".into());
                        obj.insert("timeout".into(), Value::from(t));
                        report.retimed.push((event.clone(), short(&cmd), from, t));
                    }
                }
                true
            });
            if list.len() != before {
                touched = true;
            }
        }
        if touched {
            groups.retain(|g| {
                g.get("hooks")
                    .and_then(Value::as_array)
                    .map(|l| !l.is_empty())
                    .unwrap_or(true)
            });
            if groups.is_empty() {
                // shift_remove keeps the other events in document order (remove swaps).
                hooks.shift_remove(&event);
            }
        }
    }
    report
}

/// Every hook timeout in a hooks object, as `(event, command, timeout)`.
/// Used by the tests that pin the seconds unit on the projected profiles.
#[cfg(test)]
pub fn all_timeouts(hooks: &Value) -> Vec<(String, String, f64)> {
    let mut out = Vec::new();
    if let Some(map) = hooks.as_object() {
        for (event, groups) in map {
            for g in groups.as_array().into_iter().flatten() {
                for h in g
                    .get("hooks")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    if let Some(t) = h.get("timeout").and_then(Value::as_f64) {
                        let cmd = h.get("command").and_then(Value::as_str).unwrap_or("");
                        out.push((event.clone(), cmd.to_string(), t));
                    }
                }
            }
        }
    }
    out
}

fn count_by_event(settings: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(map) = settings.get("hooks").and_then(Value::as_object) {
        for (event, groups) in map {
            let n: usize = groups
                .as_array()
                .into_iter()
                .flatten()
                .map(|g| g.get("hooks").and_then(Value::as_array).map_or(0, Vec::len))
                .sum();
            out.insert(event.clone(), Value::from(n));
        }
    }
    out
}

/// CLI entry: reconcile `settings` against `registry`, writing only on change.
pub fn run(settings: &Path, registry: &Path, dry_run: bool) -> Result<(), String> {
    let reg_text =
        std::fs::read_to_string(registry).map_err(|e| format!("{}: {e}", registry.display()))?;
    let rules = parse_registry(&reg_text)?;

    let Ok(text) = std::fs::read_to_string(settings) else {
        println!(
            "  [hooks] {} absent — nothing to reconcile",
            settings.display()
        );
        return Ok(());
    };
    let Ok(mut doc) = serde_json::from_str::<Value>(&text) else {
        println!(
            "  [hooks] {} unparseable — left untouched",
            settings.display()
        );
        return Ok(());
    };
    let before = count_by_event(&doc);
    let report = reconcile(&mut doc, &rules);
    let after = count_by_event(&doc);

    for (e, c) in &report.pruned {
        println!("  [hooks] pruned {e}: {c}");
    }
    for (e, c) in &report.misplaced {
        println!("  [hooks] removed misplaced/duplicate {e}: {c}");
    }
    for (e, c, from, to) in &report.retimed {
        println!("  [hooks] timeout {from} -> {to}s on {e}: {c}");
    }
    for (e, c) in &report.unknown {
        println!("  [hooks] unregistered (kept, add to registered-hooks.txt or remove): {e}: {c}");
    }

    if !report.changed() {
        println!("  [hooks] settings hooks already reconciled");
        return Ok(());
    }
    println!(
        "  [hooks] per-event hook counts {} -> {}",
        Value::Object(before),
        Value::Object(after)
    );
    if dry_run {
        println!("  [hooks] dry run — {} not written", settings.display());
        return Ok(());
    }
    // Recoverable: the previous document sits beside the live one.
    let backup = settings.with_extension("json.pre-hooks-reconcile");
    std::fs::write(&backup, &text).map_err(|e| format!("{}: {e}", backup.display()))?;
    // Same shape as the node seeders (JSON.stringify(s, null, 2)): raw UTF-8,
    // no trailing newline, written in place so owner and mode survive.
    let out = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(settings, out).map_err(|e| format!("{}: {e}", settings.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const REPO_REGISTRY: &str = include_str!("../../../config/registered-hooks.txt");

    fn hook(cmd: &str, t: Option<u64>) -> Value {
        match t {
            Some(t) => json!({"type": "command", "command": cmd, "timeout": t}),
            None => json!({"type": "command", "command": cmd}),
        }
    }

    fn rules() -> Vec<Rule> {
        parse_registry(
            "# comment\n\
             prune hook-handler.cjs\n\
             keep aoe-hooks   # AoE\n\
             own nostr-live-mirror.cjs SessionStart,Stop 8\n\
             own skill-route.cjs UserPromptSubmit -\n\
             prune trust-seed.cjs\n",
        )
        .unwrap()
    }

    #[test]
    fn the_shipped_registry_parses_and_every_owned_timeout_is_seconds() {
        let rules = parse_registry(REPO_REGISTRY).unwrap();
        assert!(rules.len() >= 10);
        for r in &rules {
            if let Rule::Own {
                timeout: Some(t), ..
            } = r
            {
                assert!(*t >= 1 && *t <= MAX_TIMEOUT_S);
            }
        }
        // The vendor scaffolding the audit named is on the prune list.
        for m in [
            "hook-handler.cjs",
            "claude-flow-hook-adapter.cjs",
            "auto-memory-hook.mjs",
            "trust-seed.cjs",
        ] {
            assert!(
                rules
                    .iter()
                    .any(|r| matches!(r, Rule::Prune { marker } if marker.contains(m))),
                "{m} not pruned"
            );
        }
        assert!(rules
            .iter()
            .any(|r| matches!(r, Rule::Keep { marker } if marker == "aoe-hooks")));
    }

    #[test]
    fn registry_rejects_millisecond_timeouts_and_unknown_kinds() {
        assert!(parse_registry("own x.cjs Stop 8000\n").is_err());
        assert!(parse_registry("own x.cjs Stop 0\n").is_err());
        assert!(parse_registry("own x.cjs  8\n").is_err());
        assert!(parse_registry("delete x.cjs\n").is_err());
        assert!(parse_registry("# only\n\n").unwrap().is_empty());
    }

    #[test]
    fn prunes_vendor_hooks_keeps_third_party_and_reports_unknown() {
        let mut s = json!({"hooks": {
            "UserPromptSubmit": [
                {"hooks": [hook("node /h/.claude/helpers/hook-handler.cjs route || true", Some(10000)),
                           hook("node skill-route.cjs || true", Some(8000))]},
            ],
            "SubagentStart": [{"hooks": [hook("node /h/.claude/helpers/hook-handler.cjs status", Some(3000))]}],
            "SessionStart": [
                {"hooks": [hook("sh -c 'aoe x; exit 0 # aoe-hooks'", None)]},
                {"hooks": [hook("sh -c 'hermes-scheduler start; true'", Some(10000))]},
                {"hooks": [hook("node /opt/agentbox/config/hooks/trust-seed.cjs || true", Some(8000))]},
            ],
        }, "theme": "dark"});
        let r = reconcile(&mut s, &rules());
        assert_eq!(r.pruned.len(), 3);
        assert!(
            s["hooks"].get("SubagentStart").is_none(),
            "emptied event dropped"
        );
        let ups = s["hooks"]["UserPromptSubmit"].as_array().unwrap();
        assert_eq!(ups.len(), 1);
        assert_eq!(ups[0]["hooks"].as_array().unwrap().len(), 1);
        // `-` timeout: only the unit is policed (8000 ms → 8 s).
        assert_eq!(ups[0]["hooks"][0]["timeout"], 8);
        let ss = s["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(ss.len(), 2, "trust-seed group removed, AoE + hermes kept");
        assert!(
            ss[0]["hooks"][0].get("timeout").is_none(),
            "keep is untouched"
        );
        assert_eq!(
            ss[1]["hooks"][0]["timeout"], 10,
            "unknown ms timeout converted"
        );
        assert_eq!(r.unknown.len(), 1);
        assert_eq!(s["theme"], "dark", "non-hook settings untouched");
    }

    #[test]
    fn owned_hooks_are_retimed_moved_off_foreign_events_and_deduplicated() {
        let mut s = json!({"hooks": {
            "Stop": [
                {"hooks": [hook("node /a/nostr-live-mirror.cjs Stop || true", Some(8000))]},
                {"hooks": [hook("node /b/nostr-live-mirror.cjs Stop || true", Some(8))]},
            ],
            "SessionEnd": [{"hooks": [hook("node nostr-live-mirror.cjs SessionEnd || true", Some(8))]}],
        }});
        let r = reconcile(&mut s, &rules());
        assert_eq!(s["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][0]["timeout"], 8);
        assert!(
            s["hooks"].get("SessionEnd").is_none(),
            "not a registered event"
        );
        assert_eq!(r.misplaced.len(), 2);
        assert_eq!(r.retimed.len(), 1);
    }

    #[test]
    fn reconcile_is_idempotent() {
        let mut s = json!({"hooks": {
            "Stop": [{"hooks": [hook("node nostr-live-mirror.cjs Stop", Some(8000)),
                                hook("node hook-handler.cjs post-task", Some(5000))]}],
        }});
        assert!(reconcile(&mut s, &rules()).changed());
        let once = s.clone();
        assert!(!reconcile(&mut s, &rules()).changed());
        assert_eq!(s, once);
    }

    #[test]
    fn emptied_events_are_dropped_without_reordering_the_rest() {
        let mut s = json!({"hooks": {
            "A": [{"hooks": [hook("keep-a", Some(1))]}],
            "B": [{"hooks": [hook("node hook-handler.cjs x", Some(1))]}],
            "C": [{"hooks": [hook("keep-c", Some(1))]}],
            "D": [{"hooks": [hook("keep-d", Some(1))]}],
        }});
        reconcile(&mut s, &rules());
        let keys: Vec<&String> = s["hooks"].as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["A", "C", "D"]);
    }

    #[test]
    fn documents_without_hooks_are_left_alone() {
        let mut s = json!({"permissions": {"defaultMode": "auto"}});
        assert!(!reconcile(&mut s, &rules()).changed());
        let mut weird = json!({"hooks": {"Stop": "not-an-array"}});
        assert!(!reconcile(&mut weird, &rules()).changed());
    }

    #[test]
    fn run_writes_only_on_change_and_keeps_a_backup() {
        let dir = std::env::temp_dir().join(format!("abm-hooks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let reg = dir.join("reg.txt");
        std::fs::write(&reg, "prune hook-handler.cjs\n").unwrap();
        let f = dir.join("settings.json");
        std::fs::write(
            &f,
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node hook-handler.cjs x"}]}]},"a":1}"#,
        )
        .unwrap();
        run(&f, &reg, false).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(v["hooks"].as_object().unwrap().is_empty());
        assert!(f.with_extension("json.pre-hooks-reconcile").exists());
        let text = std::fs::read_to_string(&f).unwrap();
        run(&f, &reg, false).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), text);
        // Missing settings is a fail-open no-op.
        run(&dir.join("absent.json"), &reg, false).unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }
}
