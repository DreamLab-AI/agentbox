//! Per-checker options, distinct from the shared
//! [`Config`](prose_sanitiser_core::Config).
//!
//! [`Config`](prose_sanitiser_core::Config) is workspace vocabulary: which
//! rules run, which severities report, whether fixes may be applied, and which
//! British convention to enforce. `UkOptions` is what only this crate needs
//! (the house organisation list and the exclusion switches), so the shared type
//! stays free of dialect-specific fields.
//!
//! Both are passed to a check: `Config` says what to do with findings,
//! `UkOptions` says where the rules are allowed to look.

use std::collections::HashSet;

use crate::gazetteer::Gazetteer;

/// Where the UK rules may look, and what counts as a name.
///
/// Every default is the conservative one. Exclusions are on, because each was
/// added to stop a specific class of wrong finding, and turning one off will
/// make the checker noisier rather than sharper. They exist for callers who
/// have already stripped the relevant structure themselves.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_uk::{UkEnglish, UkOptions};
/// use prose_sanitiser_core::{Check, Config};
///
/// let options = UkOptions::new().with_organisations(["Center for Ants"]);
/// let checker = UkEnglish::with_options(options);
/// let findings = checker.check("The Center for Ants met.", &Config::new());
/// assert!(findings.is_empty());
/// ```
#[derive(Debug, Clone)]
pub struct UkOptions {
    organisations: Vec<String>,
    gazetteer: Gazetteer,
    allowed_words: HashSet<String>,
    /// Skip text inside code fences and inline code spans.
    pub exclude_code: bool,
    /// Skip URLs, `mailto:` targets and e-mail addresses.
    pub exclude_links: bool,
    /// Skip YAML (`---`) and TOML (`+++`) front matter.
    pub exclude_front_matter: bool,
    /// Skip quoted text: paired double quotes, curly quotes, blockquote lines.
    pub exclude_quotations: bool,
    /// Skip capitalised words that are not at the start of a sentence.
    pub exclude_proper_nouns: bool,
    /// Skip paragraphs a language detector confidently reads as non-English.
    pub language_filter: bool,
}

impl Default for UkOptions {
    fn default() -> Self {
        Self {
            organisations: Vec::new(),
            gazetteer: Gazetteer::default(),
            allowed_words: HashSet::new(),
            exclude_code: true,
            exclude_links: true,
            exclude_front_matter: true,
            exclude_quotations: true,
            exclude_proper_nouns: true,
            language_filter: true,
        }
    }
}

impl UkOptions {
    /// Default options: every exclusion on.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add organisation names to the built-in gazetteer.
    ///
    /// Names are matched case-sensitively and whole, so `"Acme Color Labs"`
    /// protects that phrase without protecting a bare `color` elsewhere.
    pub fn with_organisations<I, S>(mut self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.organisations
            .extend(names.into_iter().map(Into::into).filter(|n| !n.is_empty()));
        self.gazetteer = Gazetteer::new(&self.organisations);
        self
    }

    /// Accept these words as house style, whatever the dialect data says.
    ///
    /// Every technical field has vocabulary that is not really a dialect
    /// choice. Measured over 414,000 words of British technical prose, two
    /// thirds of the spelling findings were three such terms: *artifact* (a
    /// build output), *rumor* (the unsealed inner event in Nostr NIP-59) and
    /// *distill* (a named pipeline stage). None is a mistake, and none belongs
    /// in the gazetteer, which is for names.
    ///
    /// Matching is case-insensitive and applies to both rules, so an allowed
    /// word is never reported at all.
    ///
    /// # Examples
    ///
    /// ```
    /// use prose_sanitiser_core::{Check, Config};
    /// use prose_sanitiser_uk::{UkEnglish, UkOptions};
    ///
    /// let plain = UkEnglish::new();
    /// assert_eq!(plain.check("The build artifact was signed.", &Config::new()).len(), 1);
    ///
    /// let house = UkEnglish::with_options(UkOptions::new().with_allowed_words(["artifact"]));
    /// assert!(house.check("The build artifact was signed.", &Config::new()).is_empty());
    /// ```
    pub fn with_allowed_words<I, S>(mut self, words: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        self.allowed_words.extend(
            words
                .into_iter()
                .map(|word| word.as_ref().to_lowercase())
                .filter(|word| !word.is_empty()),
        );
        self
    }

    /// Whether `word` is on the house allowlist.
    pub fn allows(&self, word: &str) -> bool {
        !self.allowed_words.is_empty() && self.allowed_words.contains(&word.to_lowercase())
    }

    /// The house allowlist, sorted.
    pub fn allowed_words(&self) -> Vec<&str> {
        let mut words: Vec<&str> = self.allowed_words.iter().map(String::as_str).collect();
        words.sort_unstable();
        words
    }

    /// Turn the language pre-filter on or off.
    pub fn with_language_filter(mut self, enabled: bool) -> Self {
        self.language_filter = enabled;
        self
    }

    /// Turn quotation exclusion on or off.
    pub fn with_quotation_exclusion(mut self, enabled: bool) -> Self {
        self.exclude_quotations = enabled;
        self
    }

    /// Turn proper-noun exclusion on or off.
    pub fn with_proper_noun_exclusion(mut self, enabled: bool) -> Self {
        self.exclude_proper_nouns = enabled;
        self
    }

    /// The resolved gazetteer, built-in names included.
    pub fn gazetteer(&self) -> &Gazetteer {
        &self.gazetteer
    }

    /// The organisation names this caller added, in insertion order.
    pub fn extra_organisations(&self) -> &[String] {
        &self.organisations
    }
}
