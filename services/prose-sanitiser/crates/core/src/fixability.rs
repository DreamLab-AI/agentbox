//! Whether a repair exists, kept separate from whether the rule is right.
//!
//! [`ConfidenceTier`] answers *is this pattern correct?* and
//! [`Severity`](crate::Severity)
//! answers *how much does it matter?*. Neither answers a third question that
//! kept being smuggled into the first: **can this be repaired at all?**
//!
//! The case that forced the split is `media-c2pa-soft-binding`. The detection
//! is certain — a soft-binding assertion is in the manifest or it is not — but
//! no fix exists, because the watermark is in the pixels and out of reach of
//! container surgery. Filing it as [`ConfidenceTier::LowConfidenceJudgement`]
//! to keep it from being auto-fixed made the crate's strongest-evidence finding
//! wear its weakest-evidence label, and `properties.confidence` is exactly the
//! field a reader uses to decide how far to trust a detection.
//!
//! Folding "is it fixable" into "is it right" would repeat the conflation the
//! severity/confidence split exists to prevent. So it is a third axis.
//!
//! # The default mapping
//!
//! Most rules do not need to think about this: [`Fixability::default_for`]
//! derives the obvious answer from the tier, and every constructor in this
//! crate uses it. A rule states a fixability explicitly only when it differs.
//!
//! | Tier | Default fixability |
//! |---|---|
//! | [`ConfidenceTier::CertainMechanical`] | [`Fixability::Mechanical`] |
//! | [`ConfidenceTier::HighConfidenceStylistic`] | [`Fixability::OptIn`] |
//! | [`ConfidenceTier::LowConfidenceJudgement`] | [`Fixability::ReportOnly`] |
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::{ConfidenceTier, Fixability};
//!
//! // The common case: fixability follows the tier.
//! assert_eq!(
//!     Fixability::default_for(ConfidenceTier::CertainMechanical),
//!     Fixability::Mechanical
//! );
//!
//! // The case that needed the axis: certain detection, no possible repair.
//! assert!(!Fixability::NoFixExists.fixable_with_opt_in());
//! assert!(!Fixability::NoFixExists.auto_fixable());
//! ```

use crate::finding::ConfidenceTier;

/// Whether, and under what conditions, a finding can be repaired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum Fixability {
    /// Repairable without asking: the change is verifiable by diff.
    Mechanical,
    /// Repairable, but only when the caller explicitly opts in.
    OptIn,
    /// A repair is possible in principle, but a human must choose it.
    #[default]
    ReportOnly,
    /// **No repair exists.** Not "we decline to", but "it cannot be done":
    /// the thing being reported is out of reach of this tool entirely.
    NoFixExists,
}

impl Fixability {
    /// The fixability a rule of `tier` has unless it says otherwise.
    pub fn default_for(tier: ConfidenceTier) -> Self {
        match tier {
            ConfidenceTier::CertainMechanical => Fixability::Mechanical,
            ConfidenceTier::HighConfidenceStylistic => Fixability::OptIn,
            ConfidenceTier::LowConfidenceJudgement => Fixability::ReportOnly,
        }
    }

    /// The lowercase wire form used in JSON and SARIF.
    pub fn as_str(self) -> &'static str {
        match self {
            Fixability::Mechanical => "mechanical",
            Fixability::OptIn => "opt-in",
            Fixability::ReportOnly => "report-only",
            Fixability::NoFixExists => "no-fix-exists",
        }
    }

    /// Parse the wire form, returning `None` for anything unrecognised.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "mechanical" => Some(Fixability::Mechanical),
            "opt-in" => Some(Fixability::OptIn),
            "report-only" => Some(Fixability::ReportOnly),
            "no-fix-exists" => Some(Fixability::NoFixExists),
            _ => None,
        }
    }

    /// Whether a fix may be applied with no explicit opt-in.
    pub fn auto_fixable(self) -> bool {
        matches!(self, Fixability::Mechanical)
    }

    /// Whether a fix may be applied at all, opt-in included.
    pub fn fixable_with_opt_in(self) -> bool {
        matches!(self, Fixability::Mechanical | Fixability::OptIn)
    }

    /// Whether the tool is saying a repair is impossible rather than unwise.
    ///
    /// Worth surfacing differently in a report: "we will not do this for you"
    /// and "this cannot be done by anyone" are different messages to a reader.
    pub fn is_impossible(self) -> bool {
        matches!(self, Fixability::NoFixExists)
    }
}

#[cfg(test)]
mod tests;
