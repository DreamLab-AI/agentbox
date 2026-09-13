//! The ladder: what kind of knowledge a unit is, and what that implies.
//!
//! cq classifies knowledge on a four-level spectrum from permanent insight to
//! emergent tooling signal. The level is not decoration — it decides how long a
//! unit lives, what may replace it, and whether the unit is knowledge at all or
//! a message to whoever decides what gets built.
//!
//! | Level | Kind | Behaviour |
//! |---|---|---|
//! | 1 | [`UnitKind::Pitfall`] | Permanent domain knowledge no tooling can abstract away. |
//! | 2 | [`UnitKind::Workaround`] | Useful now, symptomatic of a missing tool. Expected to be superseded. |
//! | 3 | [`UnitKind::ToolRecommendation`] | Points at the solution instead of carrying the knowledge. |
//! | 4 | [`UnitKind::ToolGapSignal`] | Emergent from clustering level-2 units. Drives what to build. |
//!
//! ```
//! use colloquy_core::kind::UnitKind;
//!
//! // Tooling arriving is the normal death of a workaround.
//! assert!(UnitKind::ToolRecommendation.can_supersede(UnitKind::Workaround));
//! // A pitfall is permanent: only a correction replaces it, never a tool.
//! assert!(!UnitKind::ToolRecommendation.can_supersede(UnitKind::Pitfall));
//! assert!(UnitKind::Pitfall.can_supersede(UnitKind::Pitfall));
//! ```

use serde::{Deserialize, Serialize};
use std::fmt;

/// Where a unit sits on the ladder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitKind {
    /// Level 1. Permanent domain knowledge; no tooling can abstract it away.
    /// A stable resident of the store.
    Pitfall,
    /// Level 2. Useful now, but its existence is evidence of a missing tool.
    /// Expected to be superseded once that tool exists.
    Workaround,
    /// Level 3. Points at the right solution rather than carrying the knowledge.
    /// Emerges when a workaround's underlying gap is filled.
    ToolRecommendation,
    /// Level 4. Not advice to an agent but a signal to the estate: a cluster of
    /// level-2 workarounds that keep recurring around one subject.
    ToolGapSignal,
}

impl UnitKind {
    /// Every kind, in ladder order. Useful for exhaustive configuration such as
    /// [`crate::decay::StalenessPolicy`].
    pub const ALL: [UnitKind; 4] = [
        UnitKind::Pitfall,
        UnitKind::Workaround,
        UnitKind::ToolRecommendation,
        UnitKind::ToolGapSignal,
    ];

    /// The cq level, 1 through 4.
    pub const fn level(self) -> u8 {
        match self {
            UnitKind::Pitfall => 1,
            UnitKind::Workaround => 2,
            UnitKind::ToolRecommendation => 3,
            UnitKind::ToolGapSignal => 4,
        }
    }

    /// The wire token, matching the serde representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            UnitKind::Pitfall => "pitfall",
            UnitKind::Workaround => "workaround",
            UnitKind::ToolRecommendation => "tool_recommendation",
            UnitKind::ToolGapSignal => "tool_gap_signal",
        }
    }

    /// Whether a unit of this kind may supersede a unit of `other`.
    ///
    /// Two rules, and they are the ladder's whole dynamics:
    ///
    /// - A unit is always replaceable by a better unit of the same kind — that
    ///   is a correction, and every kind admits corrections.
    /// - A [`UnitKind::ToolRecommendation`] may replace a
    ///   [`UnitKind::Workaround`]: the tool now exists, so the workaround's
    ///   knowledge is obsolete rather than wrong.
    ///
    /// Everything else is refused. In particular a pitfall is never superseded
    /// by tooling — if tooling could abstract it away it was never a pitfall —
    /// and a gap signal aggregates workarounds rather than replacing them, so
    /// the workarounds stay readable while the gap is open.
    pub const fn can_supersede(self, other: UnitKind) -> bool {
        matches!(
            (self, other),
            (UnitKind::Pitfall, UnitKind::Pitfall)
                | (UnitKind::Workaround, UnitKind::Workaround)
                | (UnitKind::ToolRecommendation, UnitKind::ToolRecommendation)
                | (UnitKind::ToolGapSignal, UnitKind::ToolGapSignal)
                | (UnitKind::ToolRecommendation, UnitKind::Workaround)
        )
    }

    /// Whether this kind is advice an agent acts on, as opposed to a signal to
    /// the people deciding what to build.
    ///
    /// A [`UnitKind::ToolGapSignal`] is the only kind that is not advice; a
    /// retrieval surface serving agents should exclude it, and the board that
    /// shows it has a different audience.
    pub const fn is_actionable_advice(self) -> bool {
        !matches!(self, UnitKind::ToolGapSignal)
    }
}

impl fmt::Display for UnitKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_are_the_cq_levels() {
        assert_eq!(
            UnitKind::ALL.map(UnitKind::level),
            [1, 2, 3, 4],
            "ALL must stay in ladder order"
        );
    }

    #[test]
    fn every_kind_admits_a_correction_from_its_own_kind() {
        for k in UnitKind::ALL {
            assert!(k.can_supersede(k), "{k} must admit corrections");
        }
    }

    #[test]
    fn only_tooling_replaces_a_workaround_across_kinds() {
        let mut cross = Vec::new();
        for a in UnitKind::ALL {
            for b in UnitKind::ALL {
                if a != b && a.can_supersede(b) {
                    cross.push((a, b));
                }
            }
        }
        assert_eq!(
            cross,
            vec![(UnitKind::ToolRecommendation, UnitKind::Workaround)],
            "exactly one cross-kind supersession is legal"
        );
    }

    #[test]
    fn a_gap_signal_is_not_advice() {
        assert!(!UnitKind::ToolGapSignal.is_actionable_advice());
        for k in [
            UnitKind::Pitfall,
            UnitKind::Workaround,
            UnitKind::ToolRecommendation,
        ] {
            assert!(k.is_actionable_advice());
        }
    }

    #[test]
    fn wire_tokens_round_trip() {
        for k in UnitKind::ALL {
            let j = serde_json::to_string(&k).unwrap();
            assert_eq!(j, format!("\"{}\"", k.as_str()));
            assert_eq!(serde_json::from_str::<UnitKind>(&j).unwrap(), k);
        }
    }
}
