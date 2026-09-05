//! Fair roster scheduling with durable state.
//!
//! The estate review: "Discovery sorts nominated repositories alphabetically
//! and the engine truncates the eligible list at the configured cap. There is
//! no rotating offset: later repositories can starve while the earlier ones
//! remain eligible."
//!
//! With five nominated repos, a cap of five and an alphabetical sort, `vf-*`
//! never dreams. This module replaces the truncation with least-recently-run
//! ordering backed by a durable file, so the cap rotates through the whole
//! roster instead of pinning its head. Fairness survives a restart because the
//! ordering key lives on disk, not in the process.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::manifest::write_atomic;

pub const ROSTER_SCHEMA: u32 = 1;

/// What the roster remembers about one repo.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    /// ISO date of the last night this repo actually ran. Empty ⇒ never.
    #[serde(default)]
    pub last_run_date: String,
    #[serde(default)]
    pub last_verdict: String,
    #[serde(default)]
    pub runs: u64,
    #[serde(default)]
    pub last_completed_at: String,
}

/// The durable roster.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Roster {
    pub schema: u32,
    #[serde(default)]
    pub repos: BTreeMap<String, RepoEntry>,
}

impl Default for Roster {
    fn default() -> Self {
        Self {
            schema: ROSTER_SCHEMA,
            repos: BTreeMap::new(),
        }
    }
}

impl Roster {
    /// Order `eligible` fairest-first and take at most `cap`.
    ///
    /// The key is (never-run before ever-run, then oldest run date, then fewest
    /// total runs, then name). Name is the final tie-break so the result is
    /// deterministic — two engines given the same state pick the same roster.
    pub fn select(&self, eligible: &[String], cap: usize) -> Vec<String> {
        let mut ordered: Vec<&String> = eligible.iter().collect();
        ordered.sort_by(|a, b| {
            let ea = self.repos.get(*a).cloned().unwrap_or_default();
            let eb = self.repos.get(*b).cloned().unwrap_or_default();
            // An empty last_run_date sorts first: "" < any ISO date.
            ea.last_run_date
                .cmp(&eb.last_run_date)
                .then(ea.runs.cmp(&eb.runs))
                .then(a.cmp(b))
        });
        ordered.into_iter().take(cap).cloned().collect()
    }

    /// Record that `repo` ran tonight with `verdict`.
    ///
    /// Operational non-verdicts (`BLOCKED-ENV`, `HANDOFF`, a hard failure) still
    /// count as a turn taken: a repo whose harness is broken must not monopolise
    /// the roster by never registering a run.
    pub fn record(&mut self, repo: &str, date: &str, verdict: &str) {
        let e = self.repos.entry(repo.to_string()).or_default();
        e.last_run_date = date.to_string();
        e.last_verdict = verdict.to_string();
        e.runs += 1;
        e.last_completed_at = chrono::Utc::now().to_rfc3339();
    }

    /// Drop repos that are no longer nominated, so a retired repo cannot skew
    /// the ordering forever.
    pub fn prune(&mut self, nominated: &[String]) {
        self.repos.retain(|k, _| nominated.iter().any(|n| n == k));
    }
}

/// Default location of the durable roster (control-plane state, next to the
/// dream inbox and the pause flag).
pub fn default_path() -> PathBuf {
    PathBuf::from("/home/devuser/workspace/.agentbox/dream-roster.json")
}

/// Load the roster, or a fresh empty one when absent or unreadable.
/// Fail-open by design: a corrupt roster degrades to "everyone is equally
/// overdue", never to a night that refuses to run.
pub fn load(path: &Path) -> Roster {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, roster: &Roster) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(roster)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    write_atomic(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: Vec<String>) -> Vec<String> {
        v
    }

    fn all() -> Vec<String> {
        ["agentbox", "loom", "nostr-rust-forum", "vf-a", "vf-b"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn an_empty_roster_is_alphabetical_and_capped() {
        let r = Roster::default();
        assert_eq!(
            names(r.select(&all(), 2)),
            vec!["agentbox".to_string(), "loom".to_string()]
        );
    }

    /// The starvation bug, directly: under alphabetical truncation `vf-b` never
    /// dreams. Under the roster it comes up as soon as the others have run.
    #[test]
    fn every_repo_gets_a_turn_before_any_repeats() {
        let mut r = Roster::default();
        let cap = 2;
        let mut seen: Vec<String> = Vec::new();
        for day in 0..3 {
            let date = format!("2026-09-{:02}", day + 1);
            let picked = r.select(&all(), cap);
            for p in &picked {
                r.record(p, &date, "REJECT");
                seen.push(p.clone());
            }
        }
        // Six slots over three nights across five repos: every repo has run at
        // least once and no repo has run three times.
        for repo in all() {
            let n = seen.iter().filter(|s| **s == repo).count();
            assert!(n >= 1, "{repo} starved: {seen:?}");
            assert!(n <= 2, "{repo} monopolised the roster: {seen:?}");
        }
    }

    #[test]
    fn the_least_recently_run_repo_leads() {
        let mut r = Roster::default();
        r.record("agentbox", "2026-09-04", "ACCEPT");
        r.record("loom", "2026-09-01", "REJECT");
        r.record("vf-a", "2026-09-03", "INCONCLUSIVE");
        // nostr-rust-forum and vf-b have never run, so they lead, alphabetically
        // between themselves; then loom (oldest date), then vf-a, then agentbox.
        assert_eq!(
            names(r.select(&all(), 5)),
            vec![
                "nostr-rust-forum".to_string(),
                "vf-b".to_string(),
                "loom".to_string(),
                "vf-a".to_string(),
                "agentbox".to_string()
            ]
        );
    }

    #[test]
    fn a_broken_harness_still_costs_a_turn() {
        let mut r = Roster::default();
        r.record("agentbox", "2026-09-04", "BLOCKED-ENV");
        r.record("loom", "2026-09-04", "HANDOFF");
        // Both registered a turn, so neither leads over a never-run repo.
        let picked = r.select(&all(), 1);
        assert_eq!(picked, vec!["nostr-rust-forum".to_string()]);
        assert_eq!(r.repos["agentbox"].runs, 1);
    }

    #[test]
    fn selection_is_deterministic_for_identical_state() {
        let mut r = Roster::default();
        r.record("agentbox", "2026-09-04", "REJECT");
        assert_eq!(r.select(&all(), 3), r.select(&all(), 3));
    }

    #[test]
    fn state_survives_a_round_trip_and_a_missing_file() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("roster.json");
        assert_eq!(load(&p), Roster::default(), "absent file ⇒ empty roster");
        let mut r = Roster::default();
        r.record("agentbox", "2026-09-05", "ACCEPT");
        save(&p, &r).unwrap();
        assert_eq!(load(&p), r);
        // A corrupt file degrades to empty rather than wedging the night.
        std::fs::write(&p, "not json").unwrap();
        assert_eq!(load(&p), Roster::default());
    }

    #[test]
    fn pruning_forgets_retired_repos() {
        let mut r = Roster::default();
        r.record("agentbox", "2026-09-05", "ACCEPT");
        r.record("retired", "2026-08-01", "REJECT");
        r.prune(&["agentbox".to_string()]);
        assert!(r.repos.contains_key("agentbox"));
        assert!(!r.repos.contains_key("retired"));
    }
}
