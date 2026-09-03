//! The test suite, grouped by what it is defending.
//!
//! * [`fixtures`]: the UK prose set from section D3 of the design brief. Zero
//!   auto-fixes is a hard requirement, and these are the sentences that broke
//!   the previous implementation.
//! * [`data`]: invariants the generated table must satisfy, and the
//!   cross-check that the hand-verified overrides and VarCon agree.
//! * [`exclusion`]: the regions no rule may look at.
//! * [`senses`]: part-of-speech and context disambiguation.
//! * [`dialects`]: the `-ise` / Oxford `-ize` split and the `-yse` rule.
//! * [`api`]: the public surface, configuration, and backwards compatibility.
//! * [`properties`]: randomised checks over generated documents.

mod api;
mod data;
mod dialects;
mod exclusion;
mod fixtures;
mod properties;
mod senses;

use prose_sanitiser_core::{Check, Config, Finding};

use crate::UkEnglish;

/// Check `document` with the default checker and configuration.
fn check(document: &str) -> Vec<Finding> {
    UkEnglish::new().check(document, &Config::new())
}

/// Check `document` under `config`.
fn check_with(document: &str, config: &Config) -> Vec<Finding> {
    UkEnglish::new().check(document, config)
}

/// The matched text of every finding, in document order.
fn matches(document: &str) -> Vec<String> {
    check(document)
        .into_iter()
        .map(|finding| finding.matched)
        .collect()
}
