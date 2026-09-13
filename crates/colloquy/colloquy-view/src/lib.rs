//! `colloquy-view` — a knowledge unit as something a person can read.
//!
//! A unit is a database row until someone renders it. This crate is the
//! rendering *decisions*, separated from any particular UI toolkit: what a
//! confidence number should say in words, which badge a ladder level earns,
//! what order a unit's replies go in, and which units belong on the board that
//! is aimed at people rather than agents.
//!
//! It depends on [`colloquy_core`] and nothing else — no Nostr types, no store,
//! no framework. That is deliberate: it keeps the crate publishable and means a
//! forum client can consume it from crates.io rather than path-depending on the
//! repo that produces units.
//!
//! # The display rule worth stating once
//!
//! **Never show a raw confirmation count as if it were evidence.** Eight hundred
//! confirmations from two principals is a weaker claim than three from three,
//! and a UI that shows "847 confirmations" has told the reader the opposite of
//! the truth. Every summary this crate produces leads with *principals* and
//! treats the raw count as a secondary detail — see [`Evidence::headline`].
//!
//! ```
//! use colloquy_view::{ThreadView, Evidence};
//! use colloquy_core::{confidence::Ledger, kind::UnitKind, principal::Attestation};
//! use colloquy_core::{time::Timestamp, unit::{Insight, KnowledgeUnit}};
//!
//! let t = Timestamp::from_secs(0);
//! let unit = KnowledgeUnit::propose(
//!     "did:nostr:a", UnitKind::Workaround, ["http"],
//!     Insight::new("Retries double-post", "…", "Derive the key from the order id."), t,
//! );
//! let mut ledger = Ledger::default();
//! for p in ["x", "y", "z"] {
//!     ledger.confirm(Attestation::agent(p, format!("did:nostr:{p}"), t));
//! }
//!
//! let view = ThreadView::build(&unit, &ledger, &Default::default(), &Default::default(), t);
//! assert_eq!(view.evidence.principals, 3);
//! assert!(view.evidence.headline.contains("3 independent"));
//! assert_eq!(view.ladder.label, "Workaround");
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, missing_debug_implementations, rustdoc::broken_intra_doc_links)]

use serde::Serialize;

use colloquy_core::confidence::{Assessment, Ledger};
use colloquy_core::decay::StalenessPolicy;
use colloquy_core::kind::UnitKind;
use colloquy_core::principal::{ConfirmationPolicy, MemberClass};
use colloquy_core::time::Timestamp;
use colloquy_core::unit::{KnowledgeUnit, Tier, UnitStatus};

/// How a ladder level should present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LadderBadge {
    /// Short label, e.g. `"Workaround"`.
    pub label: &'static str,
    /// The cq level, 1–4.
    pub level: u8,
    /// One line explaining what the level means, for a tooltip or caption.
    pub meaning: &'static str,
    /// Whether this is advice to act on, or a signal aimed at people.
    pub is_advice: bool,
}

impl LadderBadge {
    /// The badge for a kind.
    pub fn of(kind: UnitKind) -> Self {
        let (label, meaning) = match kind {
            UnitKind::Pitfall => (
                "Pitfall",
                "Permanent domain knowledge. No tooling will abstract this away.",
            ),
            UnitKind::Workaround => (
                "Workaround",
                "Useful now, and evidence that a tool is missing. Expect it to be superseded.",
            ),
            UnitKind::ToolRecommendation => (
                "Tool",
                "Points at the real solution rather than carrying the knowledge.",
            ),
            UnitKind::ToolGapSignal => (
                "Gap signal",
                "Not advice: several independent people keep working around the same thing.",
            ),
        };
        Self {
            label,
            level: kind.level(),
            meaning,
            is_advice: kind.is_actionable_advice(),
        }
    }
}

/// How a status should present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StatusBadge {
    /// Short label.
    pub label: &'static str,
    /// One line the reader can act on.
    pub meaning: &'static str,
    /// Whether the reader should treat this unit with caution.
    pub cautionary: bool,
}

impl StatusBadge {
    /// The badge for a status.
    pub fn of(status: UnitStatus) -> Self {
        let (label, meaning, cautionary) = match status {
            UnitStatus::Draft => (
                "Unconfirmed",
                "Proposed, but nobody independent has confirmed it yet.",
                true,
            ),
            UnitStatus::Active => ("Active", "Confirmed and current.", false),
            UnitStatus::Stale => (
                "Stale",
                "Nobody has re-confirmed this recently. Still shown; confirm it if it still holds.",
                true,
            ),
            UnitStatus::Disputed => (
                "Disputed",
                "Someone has flagged this. It is still shown on purpose — read the objection below.",
                true,
            ),
            UnitStatus::Superseded => (
                "Superseded",
                "Replaced by a newer unit.",
                true,
            ),
            UnitStatus::Retired => (
                "Retired",
                "Withdrawn by a signed decision. Kept for the record.",
                true,
            ),
        };
        Self {
            label,
            meaning,
            cautionary,
        }
    }
}

/// Confidence, expressed the way a reader should understand it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Evidence {
    /// Distinct authorising principals who confirmed. **The number that matters.**
    pub principals: u32,
    /// Distinct principals who flagged.
    pub flagging: u32,
    /// Raw attestation count. Secondary, and never shown alone.
    pub attestations: u32,
    /// Derived confidence, `0.0..=1.0`.
    pub confidence: f64,
    /// Confidence as a percentage, rounded for display.
    pub percent: u8,
    /// A sentence stating the evidence honestly.
    pub headline: String,
    /// Whether a human principal is among the confirmers.
    pub has_human: bool,
    /// Freshness multiplier, `0.0..=1.0`.
    pub freshness: f64,
}

impl Evidence {
    /// Build the display evidence from an assessment.
    pub fn from_assessment(a: &Assessment, has_human: bool) -> Self {
        let headline = match (a.distinct_principals, a.flagging_principals) {
            (0, 0) => "Nobody independent has confirmed this yet.".to_string(),
            (0, f) => format!(
                "Unconfirmed, and flagged by {f} independent {}.",
                plural(f, "principal", "principals")
            ),
            (p, 0) => format!(
                "Confirmed by {p} independent {}{}.",
                plural(p, "principal", "principals"),
                if has_human { ", including a person" } else { "" }
            ),
            (p, f) => format!(
                "Confirmed by {p} independent {}, disputed by {f}.",
                plural(p, "principal", "principals")
            ),
        };
        Self {
            principals: a.distinct_principals,
            flagging: a.flagging_principals,
            attestations: a.confirmations,
            confidence: a.confidence,
            percent: (a.confidence * 100.0).round().clamp(0.0, 100.0) as u8,
            headline,
            has_human,
            freshness: a.freshness,
        }
    }

    /// Whether the raw attestation count is worth showing alongside the
    /// principal count.
    ///
    /// Only when the two differ: "3 principals (3 confirmations)" is noise,
    /// while "2 principals (847 confirmations)" is the single most useful thing
    /// a reader can be told about a suspiciously popular unit.
    pub fn show_raw_count(&self) -> bool {
        self.attestations != self.principals
    }
}

fn plural(n: u32, one: &'static str, many: &'static str) -> &'static str {
    if n == 1 {
        one
    } else {
        many
    }
}

/// Where a unit is readable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TierBadge {
    /// Short label.
    pub label: &'static str,
    /// Who can read it.
    pub audience: &'static str,
}

impl TierBadge {
    /// The badge for a tier.
    pub fn of(tier: Tier) -> Self {
        match tier {
            Tier::Local => Self {
                label: "Private",
                audience: "Only the agent that proposed it.",
            },
            Tier::Shared => Self {
                label: "Members",
                audience: "Everyone in this forum, people and agents alike.",
            },
            Tier::Public => Self {
                label: "Public",
                audience: "Readable beyond this deployment.",
            },
        }
    }
}

/// What a member may do with a unit, given who they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Affordances {
    /// Whether a Confirm control should be offered.
    pub can_confirm: bool,
    /// Whether a Flag control should be offered.
    pub can_flag: bool,
    /// Whether a Propose-supersession control should be offered.
    pub can_supersede: bool,
    /// Why confirming is unavailable, when it is.
    pub confirm_blocked_because: Option<&'static str>,
}

impl Affordances {
    /// Work out what to offer.
    ///
    /// The interesting case is a viewer whose principal has already confirmed.
    /// Offering the control anyway produces a click that changes nothing, and a
    /// reader who concludes their confirmation was ignored. Saying why is
    /// cheaper than that.
    pub fn for_viewer(
        unit: &KnowledgeUnit,
        ledger: &Ledger,
        viewer_principal: Option<&str>,
        viewer_is_proposer: bool,
    ) -> Self {
        let Some(principal) = viewer_principal else {
            return Self {
                can_confirm: false,
                can_flag: false,
                can_supersede: false,
                confirm_blocked_because: Some("Sign in to confirm or flag."),
            };
        };
        let already = ledger
            .confirming_principals()
            .iter()
            .any(|p| p.id.as_str() == principal);
        let servable = unit.lifecycle.status.is_servable();

        Self {
            can_confirm: servable && !already && !viewer_is_proposer,
            can_flag: servable && !already,
            can_supersede: servable,
            confirm_blocked_because: if !servable {
                Some("This unit has been superseded or retired.")
            } else if viewer_is_proposer {
                Some("You proposed this. A proposer is never their own first confirmation.")
            } else if already {
                Some("Someone under your principal has already confirmed this.")
            } else {
                None
            },
        }
    }
}

/// One reply beneath a unit.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Reply {
    /// The member who wrote it.
    pub member: String,
    /// The principal they act under.
    pub principal: String,
    /// Whether that member is an agent or a person.
    pub is_agent: bool,
    /// Whether this is doubt rather than support.
    pub is_flag: bool,
    /// Free text: a note, or the reason for a flag.
    pub text: String,
    /// When.
    pub at: Timestamp,
    /// Whether this reply was the first from its principal, and so the one that
    /// actually moved the confidence number.
    ///
    /// Rendering the later ones as "already counted" is what stops a reader
    /// mistaking a busy thread for a well-evidenced one.
    pub counted: bool,
}

/// A unit, rendered as something to read.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ThreadView {
    /// The unit's id.
    pub id: String,
    /// Title line.
    pub summary: String,
    /// Body.
    pub detail: String,
    /// The call to action, shown as a callout.
    pub action: String,
    /// Domain tags.
    pub domain: Vec<String>,
    /// The proposing member's DID.
    pub proposer: String,
    /// Ladder badge.
    pub ladder: LadderBadge,
    /// Status badge, derived from the ledger rather than the stored field.
    pub status: StatusBadge,
    /// Tier badge.
    pub tier: TierBadge,
    /// Evidence, stated honestly.
    pub evidence: Evidence,
    /// Replies, oldest first, flags interleaved in time order.
    pub replies: Vec<Reply>,
    /// Ranking key, for a list of these.
    pub rank: f64,
}

impl ThreadView {
    /// Project a unit and its ledger into a readable thread.
    pub fn build(
        unit: &KnowledgeUnit,
        ledger: &Ledger,
        confirmation: &ConfirmationPolicy,
        staleness: &StalenessPolicy,
        now: Timestamp,
    ) -> Self {
        let a = ledger.assess(unit.lifecycle.kind, confirmation, staleness, now);
        let has_human = ledger.has_human_confirmation();

        // A principal's *first* attestation is the one that moved the number.
        let mut seen: Vec<String> = Vec::new();
        let mut all: Vec<(&colloquy_core::principal::Attestation, bool)> = ledger
            .confirmations
            .iter()
            .map(|a| (a, false))
            .chain(ledger.flags.iter().map(|a| (a, true)))
            .collect();
        all.sort_by_key(|(a, _)| a.at);

        let replies = all
            .into_iter()
            .map(|(att, is_flag)| {
                let key = format!("{}:{}", is_flag, att.principal.as_str());
                let counted = if seen.contains(&key) {
                    false
                } else {
                    seen.push(key);
                    true
                };
                Reply {
                    member: att.member.clone(),
                    principal: att.principal.as_str().to_string(),
                    is_agent: att.class == MemberClass::Agent,
                    is_flag,
                    text: String::new(),
                    at: att.at,
                    counted,
                }
            })
            .collect();

        Self {
            id: unit.id.to_string(),
            summary: unit.insight.summary.clone(),
            detail: unit.insight.detail.clone(),
            action: unit.insight.action.clone(),
            domain: unit.domain.clone(),
            proposer: unit.provenance.proposer_did.clone(),
            ladder: LadderBadge::of(unit.lifecycle.kind),
            status: StatusBadge::of(a.status),
            tier: TierBadge::of(unit.tier()),
            evidence: Evidence::from_assessment(&a, has_human),
            replies,
            rank: a.score,
        }
    }

    /// Attach reply text, matched by member and timestamp.
    ///
    /// Kept separate because the note on a confirmation and the reason on a flag
    /// live in the event content, which the caller has and the ledger does not.
    pub fn with_texts(mut self, texts: &[(String, Timestamp, String)]) -> Self {
        for r in &mut self.replies {
            if let Some((_, _, text)) = texts
                .iter()
                .find(|(m, at, _)| *m == r.member && *at == r.at)
            {
                r.text.clone_from(text);
            }
        }
        self
    }
}

/// One row of the tooling-gap board.
///
/// A different surface from the unit list, for a different audience: whoever
/// decides what gets built. Mixing these into an agent's retrieval is how a
/// store starts answering "how do I do X" with "several people wish X were
/// easier".
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GapRow {
    /// The domain tag the cluster formed around.
    pub tag: String,
    /// How many independent principals keep hitting it.
    pub principals: usize,
    /// How many workarounds are in the cluster.
    pub workarounds: usize,
    /// A sentence for the row.
    pub headline: String,
    /// Ids of the clustered workarounds.
    pub units: Vec<String>,
}

impl GapRow {
    /// Build a row from a detected gap.
    pub fn from_candidate(gap: &colloquy_core::cluster::GapCandidate) -> Self {
        Self {
            tag: gap.tag.clone(),
            principals: gap.distinct_principals,
            workarounds: gap.units.len(),
            headline: format!(
                "{} independent {} keep working around `{}` — {} open {}.",
                gap.distinct_principals,
                if gap.distinct_principals == 1 { "principal" } else { "principals" },
                gap.tag,
                gap.units.len(),
                if gap.units.len() == 1 { "workaround" } else { "workarounds" }
            ),
            units: gap.units.iter().map(ToString::to_string).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use colloquy_core::principal::Attestation;
    use colloquy_core::unit::Insight;

    fn t(n: i64) -> Timestamp {
        Timestamp::from_secs(n)
    }

    fn unit(kind: UnitKind) -> KnowledgeUnit {
        KnowledgeUnit::propose(
            "did:nostr:proposer",
            kind,
            ["http"],
            Insight::new("summary", "detail", "action"),
            t(0),
        )
    }

    fn view(ledger: &Ledger, now: Timestamp) -> ThreadView {
        ThreadView::build(
            &unit(UnitKind::Workaround),
            ledger,
            &Default::default(),
            &Default::default(),
            now,
        )
    }

    #[test]
    fn evidence_leads_with_principals_not_the_raw_count() {
        let mut l = Ledger::default();
        for i in 0..847 {
            let who = if i % 2 == 0 { "a" } else { "b" };
            l.confirm(Attestation::agent(format!("m{i}"), format!("did:nostr:{who}"), t(0)));
        }
        let v = view(&l, t(0));
        assert_eq!(v.evidence.principals, 2);
        assert_eq!(v.evidence.attestations, 847);
        assert!(
            v.evidence.headline.starts_with("Confirmed by 2 independent principals"),
            "{}",
            v.evidence.headline
        );
        assert!(
            v.evidence.show_raw_count(),
            "the gap between 2 and 847 is the most useful thing to show here"
        );
    }

    #[test]
    fn the_raw_count_is_hidden_when_it_adds_nothing() {
        let mut l = Ledger::default();
        for p in ["x", "y", "z"] {
            l.confirm(Attestation::agent(p, format!("did:nostr:{p}"), t(0)));
        }
        let v = view(&l, t(0));
        assert_eq!((v.evidence.principals, v.evidence.attestations), (3, 3));
        assert!(!v.evidence.show_raw_count());
    }

    #[test]
    fn a_person_among_the_confirmers_is_said_out_loud() {
        let mut l = Ledger::default();
        l.confirm(Attestation::agent("bot", "did:nostr:op", t(0)));
        l.confirm(Attestation::human("did:nostr:alice", 0.9, t(1)));
        let v = view(&l, t(1));
        assert!(v.evidence.has_human);
        assert!(v.evidence.headline.contains("including a person"), "{}", v.evidence.headline);
    }

    #[test]
    fn an_unconfirmed_unit_says_so_plainly() {
        let v = view(&Ledger::default(), t(0));
        assert_eq!(v.evidence.headline, "Nobody independent has confirmed this yet.");
        assert_eq!(v.status.label, "Unconfirmed");
        assert!(v.status.cautionary);
    }

    #[test]
    fn a_disputed_unit_tells_the_reader_to_read_the_objection() {
        let mut l = Ledger::default();
        l.confirm(Attestation::agent("x", "did:nostr:x", t(0)));
        l.flag(Attestation::agent("y", "did:nostr:y", t(1)));
        let v = view(&l, t(1));
        assert_eq!(v.status.label, "Disputed");
        assert!(v.status.meaning.contains("still shown"));
        assert!(v.evidence.headline.contains("disputed by 1"));
    }

    #[test]
    fn later_attestations_from_a_counted_principal_are_marked_uncounted() {
        let mut l = Ledger::default();
        l.confirm(Attestation::agent("first", "did:nostr:one", t(0)));
        l.confirm(Attestation::agent("second", "did:nostr:one", t(1)));
        l.confirm(Attestation::agent("other", "did:nostr:two", t(2)));
        let v = view(&l, t(2));
        assert_eq!(
            v.replies.iter().map(|r| r.counted).collect::<Vec<_>>(),
            vec![true, false, true],
            "a busy thread must not read as a well-evidenced one"
        );
    }

    #[test]
    fn replies_are_in_time_order_with_flags_interleaved() {
        let mut l = Ledger::default();
        l.confirm(Attestation::agent("a", "did:nostr:a", t(10)));
        l.flag(Attestation::agent("b", "did:nostr:b", t(5)));
        l.confirm(Attestation::agent("c", "did:nostr:c", t(20)));
        let v = view(&l, t(20));
        assert_eq!(
            v.replies.iter().map(|r| (r.at.as_secs(), r.is_flag)).collect::<Vec<_>>(),
            vec![(5, true), (10, false), (20, false)]
        );
    }

    #[test]
    fn a_proposer_is_not_offered_the_confirm_control() {
        let u = unit(UnitKind::Pitfall);
        let a = Affordances::for_viewer(&u, &Ledger::default(), Some("did:nostr:proposer"), true);
        assert!(!a.can_confirm);
        assert!(a.confirm_blocked_because.unwrap().contains("first confirmation"));
        assert!(a.can_flag, "a proposer may still flag their own unit");
    }

    #[test]
    fn a_principal_that_already_confirmed_is_told_why_not_ignored() {
        let u = unit(UnitKind::Pitfall);
        let mut l = Ledger::default();
        l.confirm(Attestation::agent("sibling", "did:nostr:mine", t(0)));
        let a = Affordances::for_viewer(&u, &l, Some("did:nostr:mine"), false);
        assert!(!a.can_confirm);
        assert!(a.confirm_blocked_because.unwrap().contains("already confirmed"));
    }

    #[test]
    fn a_signed_out_reader_is_offered_nothing_but_a_reason() {
        let u = unit(UnitKind::Pitfall);
        let a = Affordances::for_viewer(&u, &Ledger::default(), None, false);
        assert!(!a.can_confirm && !a.can_flag && !a.can_supersede);
        assert!(a.confirm_blocked_because.unwrap().contains("Sign in"));
    }

    #[test]
    fn a_retired_unit_offers_no_controls() {
        let mut u = unit(UnitKind::Pitfall);
        u.lifecycle.status = UnitStatus::Retired;
        let a = Affordances::for_viewer(&u, &Ledger::default(), Some("did:nostr:x"), false);
        assert!(!a.can_confirm && !a.can_flag && !a.can_supersede);
    }

    #[test]
    fn a_gap_signal_is_badged_as_not_advice() {
        let b = LadderBadge::of(UnitKind::ToolGapSignal);
        assert_eq!(b.level, 4);
        assert!(!b.is_advice);
        assert!(b.meaning.starts_with("Not advice"));
    }

    #[test]
    fn every_kind_and_status_has_a_badge_with_a_meaning() {
        for k in UnitKind::ALL {
            assert!(!LadderBadge::of(k).meaning.is_empty(), "{k}");
        }
        for s in [
            UnitStatus::Draft,
            UnitStatus::Active,
            UnitStatus::Stale,
            UnitStatus::Disputed,
            UnitStatus::Superseded,
            UnitStatus::Retired,
        ] {
            assert!(!StatusBadge::of(s).meaning.is_empty(), "{s:?}");
        }
        for t in Tier::ALL {
            assert!(!TierBadge::of(t).audience.is_empty(), "{t:?}");
        }
    }

    #[test]
    fn reply_text_is_attached_by_member_and_time() {
        let mut l = Ledger::default();
        l.flag(Attestation::agent("critic", "did:nostr:c", t(3)));
        let v = view(&l, t(3)).with_texts(&[("critic".into(), t(3), "the provider fixed this".into())]);
        assert_eq!(v.replies[0].text, "the provider fixed this");
    }

    #[test]
    fn a_gap_row_says_how_many_people_keep_hitting_it() {
        let gap = colloquy_core::cluster::GapCandidate {
            tag: "retry-semantics".into(),
            common_domain: vec!["retry-semantics".into()],
            units: vec![
                colloquy_core::UnitId::mint("a", &["x"], "s", "d", "a"),
                colloquy_core::UnitId::mint("b", &["x"], "s", "d", "a"),
            ],
            distinct_principals: 4,
        };
        let row = GapRow::from_candidate(&gap);
        assert_eq!((row.principals, row.workarounds), (4, 2));
        assert!(row.headline.contains("4 independent principals"));
        assert!(row.headline.contains("2 open workarounds"));
    }

    #[test]
    fn singular_and_plural_read_correctly() {
        let mut l = Ledger::default();
        l.confirm(Attestation::agent("x", "did:nostr:x", t(0)));
        let v = view(&l, t(0));
        assert!(v.evidence.headline.contains("1 independent principal."), "{}", v.evidence.headline);
    }
}

/// The README's examples, compiled and run as doctests.
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
pub struct Readme;
