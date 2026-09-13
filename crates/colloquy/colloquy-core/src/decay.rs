//! Per-kind staleness: knowledge that is not re-confirmed goes quiet.
//!
//! cq attaches a `staleness_policy` to each unit — its example is
//! `confirm_or_decay_after_90d`. One global period is the wrong shape for a
//! mixed estate: a wire format's pitfalls stay true for years while a
//! workaround for this month's endpoint layout is worthless by the next
//! quarter. So the period is **per [`UnitKind`]**, with defaults that follow
//! the ladder's own logic — the more permanent the kind, the longer it lives
//! unattended.
//!
//! Decay never deletes. It marks: a unit past its period becomes
//! [`crate::unit::UnitStatus::Stale`] and sinks in ranking, and any single
//! confirmation brings it back. Deletion is a governed act, not a timer.
//!
//! ```
//! use colloquy_core::{decay::StalenessPolicy, kind::UnitKind, time::Timestamp};
//!
//! let policy = StalenessPolicy::default();
//! let confirmed = Timestamp::parse_rfc3339("2026-01-01T00:00:00Z").unwrap();
//! let ninety_days_later = confirmed.plus_secs(90 * 86_400);
//!
//! // A workaround has gone stale by then; a pitfall has not.
//! assert!(policy.is_stale(UnitKind::Workaround, confirmed, ninety_days_later));
//! assert!(!policy.is_stale(UnitKind::Pitfall, confirmed, ninety_days_later));
//! ```

use serde::{Deserialize, Serialize};

use crate::kind::UnitKind;
use crate::time::Timestamp;

/// Seconds in a day.
const DAY: u64 = 86_400;

/// How long each kind of unit survives without re-confirmation.
///
/// Periods are in days, which is how the policy is written down and discussed;
/// the arithmetic converts once, at the boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct StalenessPolicy {
    /// Days a [`UnitKind::Pitfall`] survives unattended. Permanent knowledge
    /// still needs an occasional signature, but a year is long enough that a
    /// true pitfall is not churned for the sake of it.
    pub pitfall_days: u32,
    /// Days a [`UnitKind::Workaround`] survives. Short by design: a workaround
    /// nobody has re-confirmed in two months is usually one whose underlying
    /// gap has quietly been filled.
    pub workaround_days: u32,
    /// Days a [`UnitKind::ToolRecommendation`] survives. Tools move slower than
    /// the workarounds they retire, and faster than domain pitfalls.
    pub tool_recommendation_days: u32,
    /// Days a [`UnitKind::ToolGapSignal`] survives. cq's own default, and the
    /// right one here: a gap nobody has hit in a quarter is not a live gap.
    pub tool_gap_signal_days: u32,
}

impl Default for StalenessPolicy {
    fn default() -> Self {
        Self {
            pitfall_days: 365,
            workaround_days: 60,
            tool_recommendation_days: 180,
            tool_gap_signal_days: 90,
        }
    }
}

impl StalenessPolicy {
    /// A single global period, for a deployment that wants cq's flat default
    /// rather than per-kind behaviour.
    pub const fn uniform(days: u32) -> Self {
        Self {
            pitfall_days: days,
            workaround_days: days,
            tool_recommendation_days: days,
            tool_gap_signal_days: days,
        }
    }

    /// The period for one kind, in days.
    pub const fn days_for(&self, kind: UnitKind) -> u32 {
        match kind {
            UnitKind::Pitfall => self.pitfall_days,
            UnitKind::Workaround => self.workaround_days,
            UnitKind::ToolRecommendation => self.tool_recommendation_days,
            UnitKind::ToolGapSignal => self.tool_gap_signal_days,
        }
    }

    /// The cq-style policy token for one kind, e.g. `confirm_or_decay_after_90d`.
    ///
    /// Emitted into the unit's `lifecycle.staleness_policy` field so a cq
    /// consumer reads the same string it would have written itself.
    pub fn token_for(&self, kind: UnitKind) -> String {
        format!("confirm_or_decay_after_{}d", self.days_for(kind))
    }

    /// Whether a unit last confirmed at `last_confirmed` is stale at `now`.
    ///
    /// A period of zero days means "never decays", which is how a deployment
    /// switches decay off for a kind without a second flag.
    pub const fn is_stale(&self, kind: UnitKind, last_confirmed: Timestamp, now: Timestamp) -> bool {
        let days = self.days_for(kind);
        if days == 0 {
            return false;
        }
        last_confirmed.elapsed_to(now) > days as u64 * DAY
    }

    /// Freshness in `0.0..=1.0`: a ranking multiplier, not a truth value.
    ///
    /// Decays linearly from `1.0` at the moment of confirmation to `0.0` at
    /// twice the period, passing through `0.5` exactly at the period — so a
    /// unit that has just gone stale is halved rather than hidden, and a unit
    /// nobody has touched in two periods stops competing for retrieval slots
    /// altogether. Ranking degrades continuously; status flips at the period.
    pub fn freshness(&self, kind: UnitKind, last_confirmed: Timestamp, now: Timestamp) -> f64 {
        let days = self.days_for(kind);
        if days == 0 {
            return 1.0;
        }
        let span = (days as u64 * DAY * 2) as f64;
        let age = last_confirmed.elapsed_to(now) as f64;
        (1.0 - age / span).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(days: i64) -> Timestamp {
        Timestamp::from_secs(days * DAY as i64)
    }

    #[test]
    fn defaults_follow_the_ladder() {
        let p = StalenessPolicy::default();
        let periods: Vec<u32> = UnitKind::ALL.iter().map(|k| p.days_for(*k)).collect();
        assert_eq!(periods, vec![365, 60, 180, 90]);
        assert!(
            p.days_for(UnitKind::Pitfall) > p.days_for(UnitKind::ToolRecommendation)
                && p.days_for(UnitKind::ToolRecommendation) > p.days_for(UnitKind::Workaround),
            "permanence must buy a longer unattended life"
        );
    }

    #[test]
    fn staleness_flips_exactly_after_the_period() {
        let p = StalenessPolicy::default();
        let c = at(0);
        assert!(!p.is_stale(UnitKind::Workaround, c, at(60)), "not yet at the boundary");
        assert!(p.is_stale(UnitKind::Workaround, c, at(61)));
        assert!(!p.is_stale(UnitKind::Pitfall, c, at(61)));
    }

    #[test]
    fn freshness_is_half_at_the_period_and_zero_at_twice_it() {
        let p = StalenessPolicy::default();
        let c = at(0);
        let f = p.freshness(UnitKind::ToolGapSignal, c, at(90));
        assert!((f - 0.5).abs() < 1e-9, "expected 0.5, got {f}");
        assert_eq!(p.freshness(UnitKind::ToolGapSignal, c, at(180)), 0.0);
        assert_eq!(p.freshness(UnitKind::ToolGapSignal, c, at(500)), 0.0);
        assert_eq!(p.freshness(UnitKind::ToolGapSignal, c, at(0)), 1.0);
    }

    #[test]
    fn zero_days_switches_decay_off() {
        let p = StalenessPolicy::uniform(0);
        assert!(!p.is_stale(UnitKind::Workaround, at(0), at(100_000)));
        assert_eq!(p.freshness(UnitKind::Workaround, at(0), at(100_000)), 1.0);
    }

    #[test]
    fn tokens_match_the_cq_spelling() {
        let p = StalenessPolicy::uniform(90);
        assert_eq!(
            p.token_for(UnitKind::Workaround),
            "confirm_or_decay_after_90d"
        );
    }
}
