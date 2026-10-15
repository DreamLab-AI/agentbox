//! The estate's `dream_core` notifiers.
//!
//! [`InboxNotifier`] turns the notices that need a person into dream-inbox
//! alerts, which the next Claude session and the nightly governance publish
//! already surface. [`JournalNotifier`] records every notice in the night's
//! management-API journal session (ADR-2071). [`Notifiers`] fans one notice
//! out to both.
//!
//! Neither posts anything to the forum: relay, digest and governance publish
//! the whole night's state, not one notice, so they stay night-level drivers
//! in the engine (see the extraction ledger). All notifiers are fail-open: a
//! failing channel never fails a night.

use dream_core::seams::{BoxFut, Notice, Notifier};
use serde_json::json;
use tracing::warn;

use crate::inbox;
use crate::journal::Journal;

/// The notice for a verified candidate whose draft PR never opened.
///
/// `dream_core` renders a recovery command of the form
/// `git -C <repo_dir> push origin <branch>`, run by an operator from the
/// workspace's parent; the engine's nominated repos live under `workspace/`,
/// so `repo_dir` is `workspace/<repo_name>` (the old `lost_pr_alert` wording),
/// not the bare directory name.
pub fn lost_pr(repo_name: &str, repo_slug: &str, branch: &str, pushed: bool) -> Notice {
    Notice::LostPr {
        repo_dir: format!("workspace/{repo_name}"),
        repo_slug: repo_slug.to_string(),
        branch: branch.to_string(),
        pushed,
    }
}

/// Writes the notices that need a human as dream-inbox alerts.
///
/// Only [`Notice::LostPr`] and [`Notice::HarnessStuck`] are alerts; the
/// summary and acceptance notices are information the ledger and the draft
/// pull request already carry, so they are not queued.
#[derive(Debug, Clone)]
pub struct InboxNotifier {
    repo: String,
    night_id: String,
    date: String,
}

impl InboxNotifier {
    /// A notifier filing alerts for `repo` on `night_id` (dated `date`).
    pub fn new(repo: &str, night_id: &str, date: &str) -> Self {
        Self {
            repo: repo.into(),
            night_id: night_id.into(),
            date: date.into(),
        }
    }

    /// The alert text for `notice`, when it is one.
    pub fn alert_text(notice: &Notice) -> Option<String> {
        match notice {
            Notice::LostPr { .. } | Notice::HarnessStuck { .. } => Some(notice.render()),
            _ => None,
        }
    }
}

impl Notifier for InboxNotifier {
    fn notify<'a>(&'a self, notice: &'a Notice) -> BoxFut<'a, ()> {
        Box::pin(async move {
            let Some(text) = Self::alert_text(notice) else {
                return;
            };
            if let Err(e) = inbox::add("alert", &self.repo, &self.night_id, &self.date, &text) {
                warn!(error = %e, "dream inbox write failed (fail-open)");
            }
        })
    }
}

/// Records every notice as a `notice.*` pair in a journal session.
pub struct JournalNotifier<'j> {
    journal: &'j Journal,
}

impl<'j> JournalNotifier<'j> {
    /// A notifier recording into `journal`.
    pub fn new(journal: &'j Journal) -> Self {
        Self { journal }
    }

    /// The stable journal tool class for `notice`.
    pub fn tool_for(notice: &Notice) -> &'static str {
        match notice {
            Notice::NightSummary { .. } => "notice.night-summary",
            Notice::LostPr { .. } => "notice.lost-pr",
            Notice::HarnessStuck { .. } => "notice.harness-stuck",
            Notice::Accepted { .. } => "notice.accepted",
            _ => "notice.other",
        }
    }
}

impl Notifier for JournalNotifier<'_> {
    fn notify<'a>(&'a self, notice: &'a Notice) -> BoxFut<'a, ()> {
        Box::pin(async move {
            let c = self
                .journal
                .called(Self::tool_for(notice), json!({ "text": notice.render() }))
                .await;
            self.journal.completed(c, true, json!({})).await;
        })
    }
}

/// Delivers a notice to each notifier in turn.
pub struct Notifiers<'n>(pub Vec<Box<dyn Notifier + 'n>>);

impl Notifier for Notifiers<'_> {
    fn notify<'a>(&'a self, notice: &'a Notice) -> BoxFut<'a, ()> {
        Box::pin(async move {
            for n in &self.0 {
                n.notify(notice).await;
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lost() -> Notice {
        Notice::LostPr {
            repo_dir: "work/r".into(),
            repo_slug: "o/r".into(),
            branch: "dream/x-2026-10-01".into(),
            pushed: false,
        }
    }

    fn stuck() -> Notice {
        Notice::HarnessStuck {
            repo: "r".into(),
            fingerprints: vec!["ab12".into()],
            night_id: "2026-10-01-r".into(),
        }
    }

    #[test]
    fn only_lost_prs_and_stalled_harnesses_are_inbox_alerts() {
        let t = InboxNotifier::alert_text(&lost()).unwrap();
        assert!(t.contains("dream/x-2026-10-01") && t.contains("gh pr create"));
        assert!(InboxNotifier::alert_text(&stuck())
            .unwrap()
            .contains("harness is stuck"));
        for quiet in [
            Notice::NightSummary {
                repo: "r".into(),
                night_id: "n".into(),
                verdict: "REJECT".into(),
                finding: "f".into(),
            },
            Notice::Accepted {
                repo: "r".into(),
                night_id: "n".into(),
                branch: "b".into(),
                pr_url: None,
            },
        ] {
            assert!(InboxNotifier::alert_text(&quiet).is_none());
        }
    }

    /// The old `lost_pr_alert` text, kept: the operator runs these commands
    /// from the workspace's parent, so the checkout is `workspace/<repo>`.
    #[test]
    fn the_lost_pr_alert_names_the_branch_and_the_recovery() {
        let a = lost_pr("site", "o/site", "dream/ci-2026-10-11", false).render();
        assert!(a.contains("`dream/ci-2026-10-11`"));
        assert!(a.contains("could not push the branch to o/site"));
        assert!(a.contains("git -C workspace/site push origin dream/ci-2026-10-11"));
        let b = lost_pr("site", "o/site", "dream/ci-2026-10-11", true).render();
        assert!(b.contains("could not open the draft pull request"));
    }

    #[test]
    fn journal_tool_classes_are_stable() {
        assert_eq!(JournalNotifier::tool_for(&lost()), "notice.lost-pr");
        assert_eq!(JournalNotifier::tool_for(&stuck()), "notice.harness-stuck");
    }

    /// A disabled journal swallows the notice; the fan-out never fails.
    #[tokio::test]
    async fn fan_out_is_infallible_with_a_disabled_journal() {
        let j = Journal::disabled("test");
        let all = Notifiers(vec![Box::new(JournalNotifier::new(&j))]);
        all.notify(&stuck()).await;
        assert_eq!(j.stats().recorded, 0);
    }
}
