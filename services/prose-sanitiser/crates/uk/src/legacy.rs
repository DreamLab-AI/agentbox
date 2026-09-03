//! The original flat alternation, kept for the slop rule table.
//!
//! `prose-sanitiser-slop` embeds [`US_SPELLING_PATTERN`] in its own rule table
//! so its regex scanner has a UK entry alongside the other AI-tell patterns.
//! That table is a list of patterns, not a place a sense-aware lookup can live,
//! so the pattern stays exactly as it was, byte for byte, and these constants
//! keep their original names, types and values.
//!
//! # This is not the engine
//!
//! The real checker is [`UkEnglish`](crate::UkEnglish), which uses the
//! VarCon-derived table, span exclusion and sense disambiguation. The
//! alternation below has none of that: it matches `license` as readily as
//! `licence`'s verb, `meter` in *gas meter*, `catalog` in a file path and
//! `Organization` in *World Health Organization*. Its findings are therefore
//! [`ConfidenceTier::LowConfidenceJudgement`] and carry no replacement, which
//! is what keeps the defect non-destructive wherever it is still consumed.
//!
//! New code should call [`crate::check()`] or build a [`UkEnglish`](crate::UkEnglish).

use prose_sanitiser_core::{ConfidenceTier, Severity};

/// Stable machine identifier for the UK-spelling rule.
pub const US_SPELLING_ID: &str = "us-spelling";

/// One-line human label for the UK-spelling rule.
pub const US_SPELLING_LABEL: &str = "US spelling (enforce UK)";

/// Editorial advice attached to a UK-spelling finding.
pub const US_SPELLING_FIX: &str =
    "Use UK spelling: -ize->-ise, -or->-our, -er->-re, etc. See SKILL.md B12.";

/// How strongly a US-spelling hit signals AI authorship.
pub const US_SPELLING_SEVERITY: Severity = Severity::Medium;

/// Whether a hit from the legacy alternation may be acted on without a human
/// reading it: never, because the pattern has no sense disambiguation.
pub const US_SPELLING_CONFIDENCE: ConfidenceTier = ConfidenceTier::LowConfidenceJudgement;

/// The legacy US-spelling alternation, matched case-insensitively.
///
/// Retained verbatim as the single source of truth for the slop rule table.
/// Do not extend it: add to the VarCon data or the generator instead.
pub const US_SPELLING_PATTERN: &str = r"\b(optimiz(e|es|ed|ing|ation)|organiz(e|es|ed|ing|ation)|recogniz(e|es|ed|ing)|analyz(e|es|ed|ing)|categoriz(e|es|ed|ing|ation)|customiz(e|es|ed|ing|ation)|prioritiz(e|es|ed|ing|ation)|emphasiz(e|es|ed|ing)|realiz(e|es|ed|ing)|color|colors|behavior|behaviors|favor|favors|honor|honors|labor|center|centers|fiber|fibers|liter|meter|theater|defense|offense|license[ds]?|catalog|catalogs|fulfill(s|ed|ing)?|traveler|traveled|traveling|canceled|canceling|modeling|modeled)\b";
