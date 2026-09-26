//! Nightly forum digest — what the dream machine did tonight, in plain English.
//!
//! Posted by JunkieJarvis as a kind-42 topic root in the dreamlab zone's
//! "chat with agents" section. It is **visibility, not approval**: decisions
//! live on the governance panel ([`crate::governance`]); the digest only says
//! how many are waiting and links there.
//!
//! The digest is composed from the engine's own night-health record
//! (`~/workspace/.agentbox/dream-last-night.json`) — one outcome per repo the
//! engine actually scheduled, plus the nominated/standby/deferred roster — and
//! each repo's ledger rows for the date.
//!
//! When the dreamlab zone is end-to-end encrypted ([`crate::zone_crypto`],
//! forum ADR-2016) the digest is encrypted to the zone key; without a key it
//! is not posted, and the status says so (the night record and an inbox alert
//! carry it to the operator). Composing from ledger verdicts alone
//! (the retired `dream-night-digest.mjs`) reported "No dream cycles ran
//! tonight" for twelve nights running while repos were failing dispatch,
//! being refused for want of an evaluator, or were all parked: those outcomes
//! write no ACCEPT/REJECT/INCONCLUSIVE row. Every shape is stated here.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{info, warn};

use crate::config::{self, DreamConfig};
use crate::governance;
use crate::inbox;
use crate::relay::{self, RelaySession, UnsignedEvent};
use crate::zone_crypto::{self, WritePlan};

/// "chat with agents" channel (kind-40 id) in the dreamlab zone.
pub const DEFAULT_CHANNEL: &str =
    "f2f2bd670b66d01b03cc701e16e1c47920406e337aae49c47f5e3af122960e47";
/// Section tag of that channel.
pub const DEFAULT_SECTION: &str = "zone4-chat-with-agents";
/// Where the operator decides.
pub const DEFAULT_GOVERNANCE_URL: &str = "https://dreamlab-ai.com/community/governance";

/// Night-health record path.
pub fn health_path() -> PathBuf {
    PathBuf::from("/home/devuser/workspace/.agentbox/dream-last-night.json")
}

/// One scheduled repo's outcome (`verdict` is ACCEPT / REJECT / INCONCLUSIVE /
/// BLOCKED-ENV / HANDOFF / `FAILED: <reason>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    pub repo: String,
    pub verdict: String,
}

/// A nominated repo that was not eligible tonight.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Standby {
    pub repo: String,
    /// `marker` (a `.dream-standby` file) or `dry-streak`.
    pub reason: String,
    #[serde(default)]
    pub streak: usize,
}

/// The engine's night-health record. Fields beyond `date`/`outcomes` were
/// added with the digest rewrite; older files deserialise with them empty.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NightHealth {
    pub date: String,
    #[serde(default)]
    pub outcomes: Vec<Outcome>,
    #[serde(default)]
    pub nominated: Vec<String>,
    #[serde(default)]
    pub standby: Vec<Standby>,
    #[serde(default)]
    pub deferred: Vec<String>,
    /// How tonight's digest post went (set after it runs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

/// Status prefix when the digest was withheld for want of a zone key.
pub const SKIPPED_NO_ZONE_KEY: &str = "digest: skipped — no zone key";

/// One ledger row, as far as the digest needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerLine {
    pub deep: String,
    pub finding: String,
    pub verdict: String,
    pub witness: String,
}

/// A repo's ledger rows for the date plus its trailing INCONCLUSIVE streak.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RepoLedger {
    pub rows: Vec<LedgerLine>,
    pub streak: usize,
}

/// Rows of a LEDGER.md table dated `date`.
pub fn ledger_rows_for(ledger_text: &str, date: &str) -> Vec<LedgerLine> {
    ledger_text
        .lines()
        .filter(|l| l.trim_start().starts_with('|'))
        .filter_map(|l| {
            let cells: Vec<&str> = l.split('|').map(str::trim).collect();
            (cells.get(1) == Some(&date)).then(|| LedgerLine {
                deep: cells.get(2).unwrap_or(&"").to_string(),
                finding: cells.get(3).unwrap_or(&"").to_string(),
                verdict: cells.get(7).unwrap_or(&"").to_string(),
                witness: cells.get(9).unwrap_or(&"").to_string(),
            })
        })
        .collect()
}

fn number_word(n: usize) -> String {
    const W: [&str; 11] = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    ];
    W.get(n)
        .map(|s| s.to_string())
        .unwrap_or_else(|| n.to_string())
}

fn cap(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

fn count(n: usize, one: &str, many: &str) -> String {
    if n == 1 {
        format!("One {one}")
    } else {
        format!("{} {many}", cap(&number_word(n)))
    }
}

/// A ledger finding as a sentence (findings are truncated at 80 characters).
fn sentence(finding: &str) -> String {
    let s = finding.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() {
        return "(no summary captured — see the full report).".into();
    }
    let ends = s.ends_with(['.', '!', '?']);
    if s.chars().count() >= 78 && !ends {
        format!("{s}… (summary truncated — full detail in the report).")
    } else if !ends {
        format!("{s}.")
    } else {
        s
    }
}

/// Compose the digest text. Pure: every input is passed in.
pub fn compose(
    date: &str,
    health: Option<&NightHealth>,
    ledgers: &HashMap<String, RepoLedger>,
    open_decisions: usize,
    governance_url: &str,
) -> String {
    let mut body = vec![
        format!("Dream machine — overnight report for {date}, in plain English."),
        String::new(),
    ];

    match health.filter(|h| h.date == date) {
        None => {
            body.push(format!(
                "The engine recorded no night for {date}: it was paused, down, or never reached its window. Nothing was tested."
            ));
            body.push(String::new());
        }
        Some(h) if h.outcomes.is_empty() => {
            if h.nominated.is_empty() {
                body.push("No repository was eligible to dream tonight — every nominated repo is on standby or parked, so nothing ran.".into());
            } else {
                body.push(format!(
                    "No repository was eligible to dream tonight, so nothing ran. {} nominated; none could be scheduled:",
                    count(h.nominated.len(), "repository is", "repositories are")
                ));
                for s in &h.standby {
                    let why = if s.reason == "marker" {
                        "on standby (a manual standby marker)".to_string()
                    } else {
                        format!(
                            "parked after {} inconclusive nights in a row",
                            number_word(s.streak)
                        )
                    };
                    body.push(format!("- {}: {why}", s.repo));
                }
            }
            body.push(String::new());
            body.push("To restart, revive a repo with /dream revive <repo>, or fix what keeps it inconclusive and run /dream run.".into());
            body.push(String::new());
        }
        Some(h) => compose_outcomes(&mut body, h, ledgers),
    }

    if open_decisions == 0 {
        body.push("No decisions are waiting for you.".into());
    } else {
        body.push(format!(
            "{} waiting for you on the governance panel: {governance_url}",
            count(open_decisions, "decision is", "decisions are")
        ));
    }
    body.push(String::new());
    body.push("Full reports are on the agentbox host under workspace/.tmp/dream-annexe-artefacts, one folder per repo per night. Nothing is ever merged automatically — staged changes wait for human review.".into());
    body.join("\n")
}

fn compose_outcomes(
    body: &mut Vec<String>,
    h: &NightHealth,
    ledgers: &HashMap<String, RepoLedger>,
) {
    let last = |repo: &str| ledgers.get(repo).and_then(|l| l.rows.last().cloned());
    let firm: Vec<&Outcome> = h
        .outcomes
        .iter()
        .filter(|o| o.verdict == "ACCEPT" || o.verdict == "REJECT")
        .collect();
    let open: Vec<&Outcome> = h
        .outcomes
        .iter()
        .filter(|o| o.verdict == "INCONCLUSIVE")
        .collect();
    let broken: Vec<&Outcome> = h
        .outcomes
        .iter()
        .filter(|o| !matches!(o.verdict.as_str(), "ACCEPT" | "REJECT" | "INCONCLUSIVE"))
        .collect();

    if !firm.is_empty() {
        body.push(format!(
            "{} reached a firm conclusion tonight.",
            count(firm.len(), "repository", "repositories")
        ));
        body.push(String::new());
        for o in firm {
            let row = last(&o.repo);
            let deep = row.as_ref().map(|r| r.deep.clone()).unwrap_or_default();
            let finding = sentence(row.as_ref().map(|r| r.finding.as_str()).unwrap_or(""));
            if o.verdict == "ACCEPT" {
                body.push(format!(
                    "{}: the night's hypothesis was CONFIRMED with solid evidence (the \"{deep}\" investigation). In short: {finding} A branch with the proposed change and full report has been staged — it will not be merged until a human reviews it.",
                    o.repo
                ));
            } else {
                body.push(format!(
                    "{}: the night's hypothesis was tested and DISPROVED (the \"{deep}\" investigation) — a useful negative result, recorded so future nights don't repeat it. In short: {finding}",
                    o.repo
                ));
            }
            if let Some(w) = row
                .as_ref()
                .map(|r| r.witness.as_str())
                .filter(|w| !w.is_empty() && *w != "BLOCKED")
            {
                body.push(format!("(Evidence fingerprint: {w}.)"));
            }
            body.push(String::new());
        }
    }

    if !open.is_empty() {
        body.push(format!(
            "{} ended without a firm conclusion — each for a stated reason, not silence.",
            count(open.len(), "night", "nights")
        ));
        body.push(String::new());
        for o in open {
            let row = last(&o.repo);
            let deep = row.as_ref().map(|r| r.deep.clone()).unwrap_or_default();
            body.push(format!(
                "{} (\"{deep}\"): {}",
                o.repo,
                sentence(row.as_ref().map(|r| r.finding.as_str()).unwrap_or(""))
            ));
            let streak = ledgers.get(&o.repo).map(|l| l.streak).unwrap_or(0);
            if streak >= 4 {
                body.push(format!(
                    "Heads-up: this repo has now had {} inconclusive nights in a row. At five it is parked automatically until a night produces a firm answer.",
                    number_word(streak)
                ));
            }
            body.push(String::new());
        }
    }

    if !broken.is_empty() {
        body.push(format!(
            "{} could not be evaluated tonight — the harness, not the code, is what needs attention:",
            count(broken.len(), "repository", "repositories")
        ));
        body.push(String::new());
        for o in broken {
            let row = last(&o.repo);
            let line = match o.verdict.as_str() {
                "BLOCKED-ENV" => format!(
                    "{}: the hypothesis was never tested — the environment failed ({})",
                    o.repo,
                    sentence(row.as_ref().map(|r| r.finding.as_str()).unwrap_or(""))
                ),
                "HANDOFF" => format!(
                    "{}: refused before it started — no evaluator can decide tonight's \"{}\" investigation. The question of which evaluator should is on the governance panel.",
                    o.repo,
                    row.as_ref().map(|r| r.deep.as_str()).unwrap_or("")
                ),
                v => match v.strip_prefix("FAILED: ") {
                    Some(reason) => format!("{}: the run failed before producing a verdict — {reason}", o.repo),
                    None => format!("{}: ended as {v}.", o.repo),
                },
            };
            body.push(line);
            body.push(String::new());
        }
    }

    let degraded: usize = h
        .outcomes
        .iter()
        .filter_map(|o| ledgers.get(&o.repo))
        .map(|l| l.rows.len().saturating_sub(1))
        .sum();
    if degraded > 0 {
        body.push(format!(
            "Note on reliability: {} earlier attempt{} disrupted today; the results above are from the attempts that completed.",
            number_word(degraded),
            if degraded == 1 { " was" } else { "s were" }
        ));
        body.push(String::new());
    }
    if !h.deferred.is_empty() {
        body.push(format!(
            "Deferred by tonight's cap (first in line tomorrow): {}.",
            h.deferred.join(", ")
        ));
        body.push(String::new());
    }
}

/// Ledgers of every nominated repo under `workspace`, rows for `date`.
fn collect_ledgers(workspace: &Path, date: &str) -> HashMap<String, RepoLedger> {
    let mut out = HashMap::new();
    for (name, path) in config::discover_repos(workspace) {
        let Ok(cfg) = DreamConfig::load(&path.join("dream.config.json")) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(path.join(&cfg.ledger_path)) else {
            continue;
        };
        out.insert(
            name,
            RepoLedger {
                rows: ledger_rows_for(&text, date),
                streak: crate::engine::dry_streak(&text),
            },
        );
    }
    out
}

/// Compose tonight's digest from disk and (unless `dry_run`) post it.
/// Returns a one-line status for the log.
pub async fn run(workspace: &Path, date: &str, dry_run: bool) -> String {
    let health: Option<NightHealth> = std::fs::read_to_string(health_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok());
    let ledgers = collect_ledgers(workspace, date);
    let open = inbox::open_items().len();
    let url =
        std::env::var("DREAM_GOVERNANCE_URL").unwrap_or_else(|_| DEFAULT_GOVERNANCE_URL.into());
    let content = compose(date, health.as_ref(), &ledgers, open, &url);
    if dry_run {
        println!("--- digest ---\n{content}\n--------------");
        return "digest: dry run".into();
    }
    publish(content).await
}

async fn publish(content: String) -> String {
    let key = match relay::load_signing_key(governance::KEY_VAR, &governance::env_file()) {
        Ok(k) => k,
        Err(e) => return format!("digest: key unavailable ({e}) — skipped (fail-open)"),
    };
    let url = relay::relay_url();
    let channel = std::env::var("DREAM_DIGEST_CHANNEL").unwrap_or_else(|_| DEFAULT_CHANNEL.into());
    let section = std::env::var("DREAM_DIGEST_SECTION").unwrap_or_else(|_| DEFAULT_SECTION.into());
    let tags = vec![
        vec!["e".into(), channel, url.clone(), "root".into()],
        vec!["section".into(), section.clone()],
        vec!["t".into(), "dream-cycle".into()],
    ];
    // Encrypted zone (ADR-2016): encrypt to the zone key, or do not post.
    let env_file = governance::env_file();
    let gate = zone_crypto::gate_value_enabled(
        zone_crypto::read_setting("ENCRYPTION_ENABLED", &env_file).as_deref(),
    );
    let zones =
        zone_crypto::parse_zones(zone_crypto::read_setting("ZONE_CONFIG", &env_file).as_deref());
    let zone = zone_crypto::section_to_zone(&section, &zones).unwrap_or_default();
    let author = relay::pubkey_hex(&key);
    let keys = zone_crypto::load_keys(&zone_crypto::key_file_path(), &author);
    let plan = zone_crypto::write_plan(&zone, gate, &zones, &keys);
    if let WritePlan::Refuse(reason) = &plan {
        return format!("{SKIPPED_NO_ZONE_KEY} ({reason}; not posted in plaintext)");
    }
    let author_sk: [u8; 32] = key.to_bytes().into();
    let (content, tags) = match zone_crypto::apply(&plan, &author_sk, content, tags) {
        Ok(v) => v,
        Err(e) => return format!("digest: encryption failed ({e}) — skipped"),
    };
    let event = match relay::sign(
        UnsignedEvent {
            pubkey: author,
            created_at: relay::now_secs(),
            kind: 42,
            tags,
            content,
        },
        &key,
    ) {
        Ok(ev) => ev,
        Err(e) => return format!("digest: signing failed ({e}) — skipped"),
    };
    let mut session = match RelaySession::connect(&url, &key).await {
        Ok(s) => s,
        Err(e) => return format!("digest: relay unreachable ({e}) — skipped (fail-open)"),
    };
    // The worker relay has OK'd events it then failed to persist; read the
    // event back and republish once when it is missing.
    let mut status = "digest: NOT VERIFIED after 2 attempts".to_string();
    for attempt in 1..=2 {
        match session.publish(&event).await {
            Ok(r) if !r.accepted => {
                status = format!("digest: REJECTED {}", r.message);
                break;
            }
            Ok(_) => {}
            Err(e) => {
                status = format!("digest: publish failed ({e})");
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(2500)).await;
        let found = session
            .query(json!({"ids": [event.id]}), Duration::from_secs(8))
            .await
            .unwrap_or_default();
        if found.iter().any(|e| e.id == event.id) {
            status = format!(
                "digest: published+verified {}… (attempt {attempt})",
                &event.id[..12]
            );
            break;
        }
        warn!(attempt, "digest: OK'd but not readable — republishing");
    }
    session.close().await;
    info!(%status, "night digest");
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://example.test/governance";

    fn health(outcomes: &[(&str, &str)]) -> NightHealth {
        NightHealth {
            date: "2026-09-25".into(),
            outcomes: outcomes
                .iter()
                .map(|(r, v)| Outcome {
                    repo: r.to_string(),
                    verdict: v.to_string(),
                })
                .collect(),
            ..Default::default()
        }
    }

    fn ledger(deep: &str, finding: &str, verdict: &str, streak: usize) -> RepoLedger {
        RepoLedger {
            rows: vec![LedgerLine {
                deep: deep.into(),
                finding: finding.into(),
                verdict: verdict.into(),
                witness: "abc123".into(),
            }],
            streak,
        }
    }

    #[test]
    fn parses_ledger_rows_for_the_date() {
        let text =
            "| date | deep | finding | issue | PR | evaluated? | verdict | effect | witness |\n\
                    | 2026-09-24 | a | old | NONE | NONE | yes | ACCEPT |  | w1 |\n\
                    | 2026-09-25 | ops | pins clean | NONE | NONE | yes | REJECT |  | w2 |";
        let rows = ledger_rows_for(text, "2026-09-25");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].deep, "ops");
        assert_eq!(rows[0].verdict, "REJECT");
        assert_eq!(rows[0].witness, "w2");
    }

    #[test]
    fn normal_night_reports_verdicts_and_decisions() {
        let h = health(&[("site", "ACCEPT"), ("forum", "INCONCLUSIVE")]);
        let ledgers = HashMap::from([
            (
                "site".to_string(),
                ledger("build", "lint warnings fixed", "ACCEPT", 0),
            ),
            (
                "forum".to_string(),
                ledger("perf", "no evaluator output", "INCONCLUSIVE", 4),
            ),
        ]);
        let text = compose("2026-09-25", Some(&h), &ledgers, 3, URL);
        assert!(text.contains("One repository reached a firm conclusion"));
        assert!(text.contains("site: the night's hypothesis was CONFIRMED"));
        assert!(text.contains("(Evidence fingerprint: abc123.)"));
        assert!(text.contains("One night ended without a firm conclusion"));
        assert!(text.contains("four inconclusive nights in a row"));
        assert!(text.contains(&format!(
            "Three decisions are waiting for you on the governance panel: {URL}"
        )));
        assert!(!text.contains("No dream cycles ran"));
    }

    #[test]
    fn harness_failures_are_named_not_swallowed() {
        let h = health(&[
            ("a", "BLOCKED-ENV"),
            ("b", "HANDOFF"),
            ("c", "FAILED: dispatch: SSH command failed: exit 255"),
        ]);
        let ledgers = HashMap::from([
            (
                "a".to_string(),
                ledger("ci", "patch did not apply", "BLOCKED-ENV", 0),
            ),
            (
                "b".to_string(),
                ledger("perf", "no evaluator", "HANDOFF", 0),
            ),
        ]);
        let text = compose("2026-09-25", Some(&h), &ledgers, 0, URL);
        assert!(text.contains("Three repositories could not be evaluated tonight"));
        assert!(text.contains(
            "a: the hypothesis was never tested — the environment failed (patch did not apply.)"
        ));
        assert!(text
            .contains("b: refused before it started — no evaluator can decide tonight's \"perf\""));
        assert!(text.contains(
            "c: the run failed before producing a verdict — dispatch: SSH command failed: exit 255"
        ));
        assert!(text.contains("No decisions are waiting for you."));
    }

    #[test]
    fn zero_eligible_night_lists_the_parked_roster() {
        let h = NightHealth {
            date: "2026-09-25".into(),
            nominated: vec!["site".into(), "forum".into()],
            standby: vec![
                Standby {
                    repo: "site".into(),
                    reason: "marker".into(),
                    streak: 0,
                },
                Standby {
                    repo: "forum".into(),
                    reason: "dry-streak".into(),
                    streak: 5,
                },
            ],
            ..Default::default()
        };
        let text = compose("2026-09-25", Some(&h), &HashMap::new(), 59, URL);
        assert!(text.contains("No repository was eligible to dream tonight, so nothing ran. Two repositories are nominated"));
        assert!(text.contains("- site: on standby (a manual standby marker)"));
        assert!(text.contains("- forum: parked after five inconclusive nights in a row"));
        assert!(text.contains("/dream revive <repo>"));
        assert!(text.contains("59 decisions are waiting"));
    }

    #[test]
    fn legacy_zero_eligible_record_still_says_why() {
        let h: NightHealth =
            serde_json::from_str(r#"{"date":"2026-09-25","outcomes":[]}"#).unwrap();
        let text = compose("2026-09-25", Some(&h), &HashMap::new(), 0, URL);
        assert!(text.contains("every nominated repo is on standby or parked"));
    }

    #[test]
    fn missing_or_stale_health_is_stated() {
        let stale = health(&[("site", "ACCEPT")]);
        let text = compose("2026-09-26", Some(&stale), &HashMap::new(), 0, URL);
        assert!(text.contains("The engine recorded no night for 2026-09-26"));
        assert!(compose("2026-09-26", None, &HashMap::new(), 0, URL).contains("recorded no night"));
    }

    #[test]
    fn truncated_findings_are_marked() {
        let long = "x".repeat(80);
        assert!(sentence(&long).ends_with("(summary truncated — full detail in the report)."));
        assert_eq!(sentence("done"), "done.");
        assert_eq!(sentence(""), "(no summary captured — see the full report).");
    }
}
