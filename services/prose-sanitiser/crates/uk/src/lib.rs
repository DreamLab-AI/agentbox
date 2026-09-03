//! Sense-aware UK-English spelling enforcement.
//!
//! British English is not American English with a lookup table applied. Half
//! the interesting cases are not dialect questions at all:
//!
//! * *a driving **licence*** but *to **license** a doctor*: a noun/verb split
//!   inside British English, not a dialect swap.
//! * *the gas **meter*** but *twelve **metres***: the instrument keeps `-er`
//!   in Britain; only the SI unit takes `-re`.
//! * *the computer **program*** but *the television **programme***.
//! * ***sulfur*** stays, because the Royal Society of Chemistry adopted the
//!   IUPAC spelling in 1992 and BSI followed in 1993.
//! * *the **dialog** box* stays, because it is a widget, not a conversation.
//! * *World Health **Organization*** stays, because that is its name.
//!
//! A single find-and-replace gets every one of those wrong. This crate is built
//! so it cannot.
//!
//! # How it works
//!
//! ```text
//! document
//!    -> span exclusion      code, links, front matter, quotations, names
//!    -> language filter     Config::language, shared with every other checker
//!    -> VarCon lookup       is this really an American spelling?
//!    -> sense resolution    which meaning, and is it already correct?
//!    -> suppressions        Config::suppressions, Vale-style HTML comments
//!    -> Finding             with a confidence tier that gates any fix
//! ```
//!
//! The dialect data is [VarCon](https://wordlist.aspell.net/varcon-readme/)
//! 2020.12.07 (Kevin Atkinson, SCOWL), vendored verbatim under a permissive
//! MIT/BSD-equivalent notice and compiled into a lookup table at build time.
//! See `data/LICENSE-VarCon` for the provenance and checksum, and `build.rs`
//! for the generator. VarCon encodes the American / British-`ise` /
//! British-`ize` split as three separate categories, which is what makes
//! [`Dialect::Oxford`] a first-class mode rather than a bolted-on flag, and it
//! splits clusters by part of speech and usage, which is where the
//! sense-dependent set comes from. Neither is hand-curated.
//!
//! Both the language pre-filter and the suppression directives live on the
//! shared [`Config`] rather than here, so one
//! setting governs every checker in the workspace and a document is judged
//! English exactly once. The filter fails open: text too short, too unreliable
//! or too ambiguous to classify counts as English, because a false negative
//! costs a dismissible finding while a false positive silently drops real ones.
//!
//! # Confidence, and what may be changed automatically
//!
//! | Finding | Tier | Auto-fix |
//! |---|---|---|
//! | Unconditional pair (`color` -> `colour`) | [`ConfidenceTier::HighConfidenceStylistic`] | Only behind [`Config::write`] |
//! | Sense-dependent pair (`license`, `meter`, `program`) | [`ConfidenceTier::LowConfidenceJudgement`] | **Never** |
//!
//! No finding this crate produces is [`ConfidenceTier::CertainMechanical`].
//! Spelling is a style question, and a style question is never certain.
//!
//! # Honest scope
//!
//! From the capability matrix, UK spelling is **detect and report**. This crate
//! enforces a house style; it does not detect authorship, and a document that
//! passes it is not thereby proved to be anything. It also does not attempt
//! grammar: [`harper-core`](https://lib.rs/crates/harper-core) already does
//! that well, and duplicating it would be worse for everyone.
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::{Check, Config};
//! use prose_sanitiser_uk::UkEnglish;
//!
//! let checker = UkEnglish::new();
//! let config = Config::new();
//!
//! // Unconditional pairs are found and given a replacement.
//! let findings = checker.check("We optimize the color scheme.", &config);
//! let fixes: Vec<_> = findings.iter().filter_map(|f| f.replacement.as_deref()).collect();
//! assert_eq!(fixes, ["optimise", "colour"]);
//!
//! // Oxford spelling keeps -ize, but never -yze.
//! let oxford = Config::new().with_oxford(true);
//! assert!(checker.check("We optimize it.", &oxford).is_empty());
//! assert_eq!(checker.check("We analyze it.", &oxford).len(), 1);
//!
//! // None of this fires.
//! for safe in [
//!     "The World Health Organization met.",
//!     "You need a permit to license a doctor.",
//!     "The gas meter read 12 metres of cable.",
//!     "The computer program compiled.",
//!     "We measured sulfur dioxide.",
//!     "Close the dialog box.",
//!     "Set `color: red` in the stylesheet.",
//! ] {
//!     assert!(checker.check(safe, &config).is_empty(), "fired on {safe:?}");
//! }
//! ```
//!
//! [`ConfidenceTier::HighConfidenceStylistic`]: prose_sanitiser_core::ConfidenceTier::HighConfidenceStylistic
//! [`ConfidenceTier::LowConfidenceJudgement`]: prose_sanitiser_core::ConfidenceTier::LowConfidenceJudgement
//! [`ConfidenceTier::CertainMechanical`]: prose_sanitiser_core::ConfidenceTier::CertainMechanical
//! [`Config::write`]: prose_sanitiser_core::Config::write

#![deny(missing_docs)]

pub mod checker;
pub mod cues;
pub mod exclude;
pub mod gazetteer;
pub mod legacy;
pub mod options;
pub mod overrides;
pub mod report;
pub mod sense;
pub mod table;

pub use checker::{
    UkEnglish, UK_SENSE_ID, UK_SENSE_LABEL, UK_SENSE_SEVERITY, UK_SPELLING_SEVERITY,
};
pub use exclude::Exclusions;
pub use gazetteer::Gazetteer;
pub use legacy::{
    US_SPELLING_CONFIDENCE, US_SPELLING_FIX, US_SPELLING_ID, US_SPELLING_LABEL,
    US_SPELLING_PATTERN, US_SPELLING_SEVERITY,
};
pub use options::UkOptions;
pub use report::Summary;
pub use table::{Dialect, Entry, Sense, VARCON_VERSION};

use prose_sanitiser_core::{Check, Config, Finding, Fix, Patch};

/// Report every US spelling in `document`, using the default configuration.
///
/// Equivalent to `UkEnglish::new().check(document, &Config::new())`.
///
/// # Examples
///
/// ```
/// let findings = prose_sanitiser_uk::check("We optimize the color scheme.");
/// let matched: Vec<&str> = findings.iter().map(|f| f.matched.as_str()).collect();
/// assert_eq!(matched, ["optimize", "color"]);
/// ```
pub fn check(document: &str) -> Vec<Finding> {
    check_with(document, &Config::new())
}

/// Report every US spelling in `document` under `config`.
///
/// Honours [`Config::rule_enabled`], [`Config::severity_reportable`] and
/// [`Config::oxford`].
///
/// # Examples
///
/// ```
/// use prose_sanitiser_core::Config;
///
/// let config = Config::new().without_rule("us-spelling");
/// assert!(prose_sanitiser_uk::check_with("We optimize it.", &config).is_empty());
/// ```
pub fn check_with(document: &str, config: &Config) -> Vec<Finding> {
    UkEnglish::new().check(document, config)
}

/// Check `document` and build the patch its findings allow.
///
/// The patch carries only [`ConfidenceTier::HighConfidenceStylistic`] edits,
/// and only when [`Config::write`] is set. Sense-dependent findings never reach
/// it, so applying the result cannot change a meaning.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_core::Config;
///
/// let document = "The color of the gas meter.";
/// let config = Config::new().with_write(true);
/// let (findings, patch) = prose_sanitiser_uk::check_and_fix(document, &config);
///
/// assert_eq!(patch.apply(document).as_deref(), Some("The colour of the gas meter."));
/// assert_eq!(patch.len(), 1);
/// assert_eq!(findings.len(), 1);
///
/// // Without the opt-in, nothing is applied.
/// let (_, patch) = prose_sanitiser_uk::check_and_fix(document, &Config::new());
/// assert!(patch.is_empty());
/// ```
///
/// [`ConfidenceTier::HighConfidenceStylistic`]: prose_sanitiser_core::ConfidenceTier::HighConfidenceStylistic
/// [`Config::write`]: prose_sanitiser_core::Config::write
pub fn check_and_fix(document: &str, config: &Config) -> (Vec<Finding>, Patch) {
    UkEnglish::new().check_and_fix(document, config)
}

#[cfg(test)]
mod tests;
