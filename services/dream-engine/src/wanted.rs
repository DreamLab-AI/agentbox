//! Sources the previous night asked for (consumer side of ADR-DE-008).
//!
//! A night that could not write its diff for want of a file lists the file
//! under **Sources wanted next night** in its report. This module turns that
//! list into [`SourceRequest`]s the next night's tree-read honours first, and
//! keeps the small store that makes the loop converge:
//!
//! - a request is keyed on (repo, deep, `path` or `path:a-b`);
//! - it is **active** until it has been inlined once (`source.json` says so)
//!   or has been offered for [`MAX_NIGHTS`] nights without being inlined;
//! - a key requested again *after* it was inlined is not re-armed: it is
//!   returned to the caller as a loop, which raises one operator alert —
//!   the window was wrong or there is a real blocker, and only a human can
//!   tell which.
//!
//! Before this, the same "please supply `src/x.rs`" reached the governance
//! panel three nights running across four repositories, because the planner
//! never saw the previous night's ask and the engine forwarded it to the
//! human instead. Source supply is not a decision; it is plumbing.

use dream_core::source::{SourceRecord, SourceRequest};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Nights a request is offered before it lapses unmet.
pub const MAX_NIGHTS: u32 = 3;
/// The report heading whose list items are requests.
pub const HEADING: &str = "sources wanted next night";

/// One remembered request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wanted {
    pub repo: String,
    pub deep: String,
    /// `path` or `path:start-end`.
    pub key: String,
    /// Night id that first asked.
    pub first_night: String,
    /// Nights it has been offered to the tree-read.
    pub nights_seen: u32,
    /// Night id in which it was inlined, if ever.
    #[serde(default)]
    pub inlined_in: String,
    /// `report` or `operator`.
    #[serde(default = "report")]
    pub source: String,
}

fn report() -> String {
    "report".into()
}

impl Wanted {
    /// Still worth offering: never inlined and not yet lapsed.
    pub fn active(&self) -> bool {
        self.inlined_in.is_empty() && self.nights_seen < MAX_NIGHTS
    }
}

/// Where the store lives: `$DREAM_SOURCE_REQUESTS_PATH`, else beside the
/// inbox.
pub fn store_path() -> PathBuf {
    std::env::var("DREAM_SOURCE_REQUESTS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from("/home/devuser/workspace/.agentbox/dream-source-requests.json")
        })
}

pub fn load() -> Vec<Wanted> {
    let path = store_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    match serde_json::from_str(&text) {
        Ok(items) => items,
        Err(e) => {
            // Fail open, but not silently: the next save would otherwise
            // overwrite every inlined marker. Keep the bad file as evidence.
            let backup = path.with_extension(format!(
                "corrupt-{}.json",
                chrono::Utc::now().format("%Y%m%dT%H%M%S")
            ));
            let _ = std::fs::copy(&path, &backup);
            tracing::warn!(error = %e, backup = %backup.display(), "source-request store unreadable — starting empty");
            Vec::new()
        }
    }
}

fn save(items: &[Wanted]) -> std::io::Result<()> {
    let path = store_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(items).unwrap_or_default())?;
    std::fs::rename(tmp, path)
}

/// The list items under the **Sources wanted next night** heading, as
/// request keys. One item per line: `` `path` `` or `` `path:10-80` ``,
/// optionally followed by a dash and a reason. The first path-like token on
/// the line is the key; the reason is dropped.
pub fn extract_wanted(report: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut in_section = false;
    for line in report.lines() {
        let t = line.trim();
        let lower = t.to_ascii_lowercase(); // byte offsets stay valid in `t`
        if lower.contains(HEADING) {
            in_section = true;
            // Inline form: "- Sources wanted next night: `a.rs`, `b.rs:1-9`".
            if let Some(idx) = lower.find(HEADING) {
                let rest = &t[idx + HEADING.len()..];
                let rest = rest.trim_start_matches([':', '*', ' ']);
                for k in path_tokens(rest) {
                    push_unique(&mut out, k);
                }
            }
            continue;
        }
        if !in_section {
            continue;
        }
        let is_list = t.starts_with('-')
            || t.starts_with('*')
            || t.chars().next().is_some_and(|c| c.is_ascii_digit());
        if is_list {
            let body = t
                .trim_start_matches(['-', '*', ' '])
                .trim_start_matches(|c: char| {
                    c.is_ascii_digit() || c == '.' || c == ')' || c == ' '
                });
            if let Some(k) = path_tokens(body).into_iter().next() {
                push_unique(&mut out, k);
            }
        } else if !t.is_empty() {
            break;
        }
    }
    out.truncate(12);
    out
}

fn push_unique(out: &mut Vec<String>, k: String) {
    if !out.iter().any(|x| x == &k) {
        out.push(k);
    }
}

/// Path-like tokens in `text`, keeping a `:a-b` / `:n` line suffix. A token
/// counts when it has a `/` or a dot-extension and no spaces. `none`,
/// `n/a` and URLs are not paths.
pub fn path_tokens(text: &str) -> Vec<String> {
    use dream_core::source::{request_key, SourceRequest};
    let mut out = Vec::new();
    for raw in text.split(|c: char| c.is_whitespace() || "\"'`()[]{}<>,;|".contains(c)) {
        let tok = raw.trim_end_matches(['.', ',', ':']);
        let tok = tok.strip_prefix("./").unwrap_or(tok);
        if tok.len() < 3 || tok.contains("://") || tok.starts_with('-') {
            continue;
        }
        let Some(req) = SourceRequest::parse(tok) else {
            continue;
        };
        let path = req.path.as_str();
        // A path has a slash, or a stem and a short alphabetic extension.
        // `0.2.0`, `e.g`, `i.e` and `n/a` are words, not files.
        let has_ext = path.rsplit_once('.').is_some_and(|(stem, ext)| {
            stem.len() > 1
                && stem.chars().any(|c| c.is_ascii_alphabetic())
                && (2..=5).contains(&ext.len())
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
                && ext.chars().any(|c| c.is_ascii_alphabetic())
        });
        if path.eq_ignore_ascii_case("n/a") || !(path.contains('/') || has_ext) {
            continue;
        }
        let key = request_key(path, req.lines);
        if !out.contains(&key) {
            out.push(key);
        }
    }
    out
}

/// Whether an operator question is really a request for source files —
/// the verb is supply/inline/bundle/provide and it names a path. Such a
/// question is not put to the human; its paths become requests.
pub fn is_source_supply(question: &str) -> bool {
    // A question in the four-field shape is a decision by construction,
    // whatever words it uses ("run the supply-chain audit on Cargo.lock").
    if crate::inbox::decision_fields(question).is_some() {
        return false;
    }
    if path_tokens(question).is_empty() {
        return false;
    }
    let words: Vec<String> = question
        .split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_ascii_alphanumeric())
                .to_ascii_lowercase()
        })
        .collect();
    let has = |w: &str| words.iter().any(|x| x == w);
    // These verbs, as whole words, only ever mean "give the engine this file".
    let strong = [
        "supply",
        "re-supply",
        "resupply",
        "inline",
        "inlined",
        "bundle",
        "bundled",
    ];
    if strong.iter().any(|v| has(v)) {
        return true;
    }
    // These need the object to be named as source.
    let weak = ["provide", "include", "request"];
    let object = [
        "source", "sources", "file", "files", "scan", "scans", "span", "spans",
    ];
    weak.iter().any(|v| has(v)) && object.iter().any(|o| has(o))
}

/// Remember `keys` for (repo, deep). Returns the keys that were asked for
/// again after being inlined — these are **not** re-armed.
pub fn record(
    repo: &str,
    deep: &str,
    keys: &[String],
    night_id: &str,
    source: &str,
) -> std::io::Result<Vec<String>> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let mut items = load();
    let mut looped = Vec::new();
    for k in keys {
        match items
            .iter_mut()
            .find(|w| w.repo == repo && w.deep == deep && &w.key == k)
        {
            // Asked again after it was read, or after three nights in which
            // it could not be read: either way the ask is not converging and
            // a person must look. It is not re-armed.
            Some(w) if !w.active() => looped.push(k.clone()),
            // Asked again while still pending: keep counting, never reset,
            // so a path refused every night still lapses on schedule.
            Some(_) => {}
            None => items.push(Wanted {
                repo: repo.into(),
                deep: deep.into(),
                key: k.clone(),
                first_night: night_id.into(),
                nights_seen: 0,
                inlined_in: String::new(),
                source: source.into(),
            }),
        }
    }
    // Bounded: keep the newest 400 entries.
    if items.len() > 400 {
        let excess = items.len() - 400;
        items.drain(..excess);
    }
    save(&items)?;
    Ok(looped)
}

/// Active requests for tonight, oldest first; each is counted as offered.
pub fn take_for(repo: &str, deep: &str) -> Vec<SourceRequest> {
    let mut items = load();
    let mut out = Vec::new();
    for w in items
        .iter_mut()
        .filter(|w| w.repo == repo && w.deep == deep && w.active())
    {
        if let Some(r) = SourceRequest::parse(&w.key) {
            w.nights_seen += 1;
            out.push(r);
        }
    }
    if !out.is_empty() {
        let _ = save(&items);
    }
    out
}

/// Mark requests the tree-read honoured tonight as met.
pub fn settle(repo: &str, deep: &str, night_id: &str, record: &SourceRecord) {
    if record.requested_honoured.is_empty() {
        return;
    }
    let mut items = load();
    let mut changed = false;
    for w in items
        .iter_mut()
        .filter(|w| w.repo == repo && w.deep == deep)
    {
        let met = record
            .requested_honoured
            .iter()
            .any(|h| key_satisfies(&w.key, h));
        if met && w.inlined_in.is_empty() {
            w.inlined_in = night_id.into();
            changed = true;
        }
    }
    if changed {
        let _ = save(&items);
    }
}

/// Whether an honoured entry (`path` or `path:a-b`, as `source.json`
/// records it) meets a stored request key.
///
/// Any read of a path meets every request for that path, ranged or not:
/// the tree-read keeps one request per path, so a second range for the
/// same file could never be honoured while the first is pending, and a
/// request that can never be met is exactly the loop this store exists to
/// end. A directory key (`crates/x/` or `crates/x`) is met by any file
/// under it.
pub fn key_satisfies(key: &str, honoured: &str) -> bool {
    if key == honoured {
        return true;
    }
    let key_path = key.split(':').next().unwrap_or(key);
    let h_path = honoured.split(':').next().unwrap_or(honoured);
    if h_path == key_path {
        return true;
    }
    let dir = key_path.trim_end_matches('/');
    !dir.is_empty() && h_path.starts_with(&format!("{dir}/"))
}

/// Text of the one alert raised when a path is asked for again after it was
/// inlined.
pub fn loop_alert(repo: &str, deep: &str, looped: &[String]) -> String {
    let items = load();
    let when = |k: &str| {
        items
            .iter()
            .find(|w| w.repo == repo && w.deep == deep && w.key == k)
            .map(|w| w.inlined_in.clone())
            .unwrap_or_default()
    };
    let list = looped
        .iter()
        .map(|k| format!("{k} (read in {})", when(k)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "The \u{201c}{deep}\u{201d} night asked again for source the engine had already read for it: {list}. \
         It was not re-sent. Either the night needs a different line range (amend with the range) \
         or something else blocks it; the report's blocker line says what."
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV: Mutex<()> = Mutex::new(());

    fn with_store<T>(f: impl FnOnce() -> T) -> T {
        let _g = ENV.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("DREAM_SOURCE_REQUESTS_PATH", dir.path().join("req.json"));
        let out = f();
        std::env::remove_var("DREAM_SOURCE_REQUESTS_PATH");
        out
    }

    #[test]
    fn extracts_keys_under_the_heading_and_stops_at_prose() {
        let report = "## FINAL REPORT\n- Finding: x\n- Sources wanted next night\n  - `crates/a/src/lib.rs:10-80` — the matcher\n  - crates/a/Cargo.toml — feature list\n  - none\n\nMain lesson: y\n- Human action recommended\n  - Decision: z\n";
        assert_eq!(
            extract_wanted(report),
            vec![
                "crates/a/src/lib.rs:10-80".to_string(),
                "crates/a/Cargo.toml".into()
            ]
        );
        let inline = "- Sources wanted next night: `src/x.rs`, `src/y.rs:1-9`";
        assert_eq!(
            extract_wanted(inline),
            vec!["src/x.rs".to_string(), "src/y.rs:1-9".into()]
        );
        assert!(extract_wanted("no such heading\n- src/x.rs").is_empty());
    }

    #[test]
    fn path_tokens_keep_ranges_and_skip_urls_and_words() {
        let t = path_tokens(
            "inline `crates/factrail-eval/Cargo.toml` and taint.rs:12 (see https://x.y/z) n/a done.",
        );
        assert_eq!(
            t,
            vec![
                "crates/factrail-eval/Cargo.toml".to_string(),
                "taint.rs:12-12".into()
            ]
        );
    }

    #[test]
    fn source_supply_questions_are_recognised() {
        assert!(is_source_supply(
            "Engine: the next night **must** inline `crates/factrail-eval/Cargo.toml` (approved 10-09)"
        ));
        assert!(is_source_supply(
            "Re-supply (third ask): include one red repo's entry from `website/static/data/estate-health.json` in the source"
        ));
        assert!(!is_source_supply(
            "Decision: merge the draft PR · Why: gates green · If approved: next night builds on it · If not: it lapses"
        ));
        assert!(!is_source_supply(
            "Amend ADR-0008 to record the structural form"
        ));
    }

    #[test]
    fn requests_are_offered_then_met_then_looped() {
        with_store(|| {
            let keys = vec!["src/a.rs".to_string(), "src/b.rs:1-9".into()];
            assert!(record("r", "d", &keys, "n1", "report").unwrap().is_empty());
            let offered = take_for("r", "d");
            assert_eq!(offered.len(), 2);
            assert_eq!(offered[0].path, "src/a.rs");
            assert_eq!(offered[1].lines.unwrap().end, 9);
            // Other deeps see nothing.
            assert!(take_for("r", "other").is_empty());
            // Night 2 inlines a.rs with a range: the whole-file request is met.
            let rec = SourceRecord {
                requested_honoured: vec!["src/a.rs:1-40".into()],
                ..SourceRecord::default()
            };
            settle("r", "d", "n2", &rec);
            let left = take_for("r", "d");
            assert_eq!(left.len(), 1, "{left:?}");
            assert_eq!(left[0].path, "src/b.rs");
            // Asking for a.rs again is a loop, not a re-arm.
            let looped = record("r", "d", &["src/a.rs".to_string()], "n3", "report").unwrap();
            assert_eq!(looped, vec!["src/a.rs".to_string()]);
            assert!(loop_alert("r", "d", &looped).contains("read in n2"));
        });
    }

    #[test]
    fn unmet_requests_lapse_after_three_nights() {
        with_store(|| {
            record("r", "d", &["src/z.rs".to_string()], "n1", "report").unwrap();
            for _ in 0..MAX_NIGHTS {
                assert_eq!(take_for("r", "d").len(), 1);
            }
            assert!(take_for("r", "d").is_empty());
            // Asked again while lapsed: that is a loop for a person, not a re-arm.
            let looped = record("r", "d", &["src/z.rs".to_string()], "n5", "report").unwrap();
            assert_eq!(looped, vec!["src/z.rs".to_string()]);
            assert!(take_for("r", "d").is_empty());
        });
    }

    #[test]
    fn a_re_ask_while_pending_keeps_counting() {
        with_store(|| {
            record("r", "d", &["src/p.rs".to_string()], "n1", "report").unwrap();
            take_for("r", "d");
            take_for("r", "d");
            assert!(record("r", "d", &["src/p.rs".to_string()], "n3", "report")
                .unwrap()
                .is_empty());
            assert_eq!(take_for("r", "d").len(), 1, "third and last offer");
            assert!(take_for("r", "d").is_empty(), "not reset by the re-ask");
        });
    }

    #[test]
    fn directory_and_ranged_keys_settle_against_what_was_read() {
        assert!(key_satisfies("crates/x/", "crates/x/src/lib.rs"));
        assert!(key_satisfies("crates/x", "crates/x/Cargo.toml"));
        assert!(!key_satisfies("crates/x/", "crates/xy/lib.rs"));
        assert!(
            key_satisfies("a.rs:10-80", "a.rs"),
            "whole file covers the range"
        );
        assert!(
            key_satisfies("a.rs", "a.rs:10-80"),
            "any read of the path settles it"
        );
        assert!(
            key_satisfies("a.rs:10-80", "a.rs:1-9"),
            "one request per path, so yes"
        );
        assert!(!key_satisfies("a.rs", "b.rs"));
    }

    #[test]
    fn a_corrupt_store_is_backed_up_not_overwritten() {
        with_store(|| {
            std::fs::write(store_path(), "{not json").unwrap();
            assert!(load().is_empty());
            let dir = store_path().parent().unwrap().to_path_buf();
            let backups = std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().contains("corrupt-"))
                .count();
            assert_eq!(backups, 1);
        });
    }

    #[test]
    fn four_field_questions_and_prose_with_versions_are_not_supply_asks() {
        assert!(!is_source_supply(
            "Decision: run the supply-chain audit on Cargo.lock · Why: x · If approved: y · If not: z"
        ));
        assert!(!is_source_supply(
            "merge the pull request touching config/profile.toml"
        ));
        assert!(!is_source_supply("should we bundle dream-core 0.2.0"));
        assert!(path_tokens("bump to 0.2.0, e.g. Cargo.lock i.e. the lock")
            .contains(&"Cargo.lock".to_string()));
        assert!(!path_tokens("bump to 0.2.0 e.g. now")
            .iter()
            .any(|t| t == "0.2.0" || t == "e.g"));
    }
}
