//! The VarCon-derived dialect table.
//!
//! The data is generated at build time by `build.rs` from `data/varcon.txt`
//! (VarCon 2020.12.07, vendored verbatim; provenance and licence in
//! `data/LICENSE-VarCon`). Only the literals are generated: every type, every
//! accessor and all of this documentation is ordinary source.
//!
//! # What an entry means
//!
//! The table is keyed on the **preferred American spelling**, lowercased. A
//! word that is correct in British English under both `-ise` and `-ize` is
//! simply absent, which is why *sulfur*, *fetus*, *disk*, *dialog* and
//! *colorimeter* cannot be flagged: there is nothing to find.
//!
//! Present entries come in two shapes.
//!
//! * **Unconditional** ([`Entry::is_unconditional`]). One spelling, no sense to
//!   weigh: `color` → `colour`, `catalog` → `catalogue`, `fulfill` → `fulfil`.
//!   These carry [`ConfidenceTier::HighConfidenceStylistic`] and may be applied
//!   behind an explicit opt-in.
//! * **Sense-dependent** ([`Entry::senses`] non-empty). VarCon split the cluster
//!   into groups that disagree, so the right spelling depends on part of speech
//!   or on meaning: *license* the verb against *licence* the noun, *meter* the
//!   instrument against *metre* the unit. These are never auto-fixed.
//!
//! [`ConfidenceTier::HighConfidenceStylistic`]: prose_sanitiser_core::ConfidenceTier::HighConfidenceStylistic

/// Which British convention to enforce.
///
/// The distinction is real and is encoded in VarCon itself as two separate
/// categories, `B` and `Z`. Oxford spelling (`en-GB-oxendict`) uses `-ize` for
/// verbs from Greek `-izein` and is house style at Oxford University Press,
/// *Nature* and the TLS; Cambridge University Press, the *Guardian*, the BBC
/// and UK government use `-ise`.
///
/// Neither mode touches the `-yse` set (*analyse*, *paralyse*, *catalyse*):
/// the root there is Greek *lysis*, not `-izein`, so Hart's Rules gives no
/// parallel with `-ize` words. That falls straight out of the data, because
/// those VarCon lines carry no `Z` tag at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Dialect {
    /// British `-ise`: the default, and the majority convention.
    #[default]
    Ise,
    /// British `-ize`, Oxford spelling.
    Oxford,
}

impl Dialect {
    /// The dialect a [`Config`](prose_sanitiser_core::Config) selects.
    pub fn from_config(config: &prose_sanitiser_core::Config) -> Self {
        if config.oxford {
            Dialect::Oxford
        } else {
            Dialect::Ise
        }
    }

    /// A short human label, for advice strings and reports.
    pub fn label(self) -> &'static str {
        match self {
            Dialect::Ise => "British -ise",
            Dialect::Oxford => "Oxford -ize",
        }
    }
}

/// One usage of a word whose British spelling depends on sense.
///
/// The `pos` and `usage` fields are VarCon's own annotations, carried through
/// unaltered so a report can quote the authority rather than paraphrase it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sense {
    pos: Option<&'static str>,
    usage: &'static str,
    ise: Option<&'static str>,
    ize: Option<&'static str>,
}

impl Sense {
    /// VarCon's part-of-speech tag for this sense: `N`, `V`, `Adj`, and so on.
    pub fn part_of_speech(&self) -> Option<&'static str> {
        self.pos
    }

    /// VarCon's usage gloss, such as `measuring device` or `computer program`.
    /// Empty when the sense is distinguished by part of speech alone.
    pub fn usage(&self) -> &'static str {
        self.usage
    }

    /// The British form for this sense, or `None` if the American spelling is
    /// already correct here.
    pub fn target(&self, dialect: Dialect) -> Option<&'static str> {
        match dialect {
            Dialect::Ise => self.ise,
            Dialect::Oxford => self.ize,
        }
    }

    /// Whether the American spelling is correct British English in this sense.
    pub fn is_correct_as_written(&self) -> bool {
        self.ise.is_none() && self.ize.is_none()
    }

    /// A short human description of the sense, for advice text.
    pub fn describe(&self) -> String {
        match (self.pos, self.usage) {
            (Some(pos), "") => format!("as a {}", expand_pos(pos)),
            (Some(pos), usage) => format!("as a {} ({usage})", expand_pos(pos)),
            (None, "") => "in one sense".to_string(),
            (None, usage) => format!("meaning {usage}"),
        }
    }
}

/// Expand a VarCon part-of-speech tag into a word a reader knows.
fn expand_pos(pos: &str) -> &str {
    match pos {
        "N" => "noun",
        "V" => "verb",
        "Adj" => "adjective",
        "Adv" => "adverb",
        "A" => "adjective or adverb",
        "Inj" => "interjection",
        "Prep" => "preposition",
        "abbr" => "abbreviation",
        other => other,
    }
}

/// One American spelling and what British English does with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    american: &'static str,
    ise: Option<&'static str>,
    ize: Option<&'static str>,
    senses: &'static [Sense],
}

impl Entry {
    /// The American spelling this entry is keyed on, lowercased.
    pub fn american(&self) -> &'static str {
        self.american
    }

    /// Whether the correction holds regardless of sense.
    ///
    /// Only unconditional entries may ever be applied mechanically, and even
    /// then only behind [`Config::write`](prose_sanitiser_core::Config::write).
    pub fn is_unconditional(&self) -> bool {
        self.senses.is_empty()
    }

    /// The senses VarCon distinguishes, empty for an unconditional entry.
    pub fn senses(&self) -> &'static [Sense] {
        self.senses
    }

    /// The unconditional British form under `dialect`.
    ///
    /// Returns `None` for a sense-dependent entry (ask [`Entry::senses`]) and
    /// for a word that is already correct in that dialect. The latter is how
    /// Oxford mode keeps *organize*: the entry exists for `-ise`, and Oxford
    /// asks for nothing.
    pub fn target(&self, dialect: Dialect) -> Option<&'static str> {
        if !self.is_unconditional() {
            return None;
        }
        match dialect {
            Dialect::Ise => self.ise,
            Dialect::Oxford => self.ize,
        }
    }
}

// The generated literals. `Entry` and `Sense` above are the types it names, and
// `include!` is textual, so the private fields are constructible here and
// nowhere else.
include!(concat!(env!("OUT_DIR"), "/varcon_table.rs"));

/// Look up an American spelling, which need not be lowercased.
///
/// Returns `None` for any word British English is happy with, which is the
/// overwhelming majority of them.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_uk::{Dialect, table};
///
/// // Unconditional: one answer in both modes.
/// let colour = table::lookup("color").expect("color is in the table");
/// assert_eq!(colour.target(Dialect::Ise), Some("colour"));
/// assert_eq!(colour.target(Dialect::Oxford), Some("colour"));
///
/// // The Oxford split: -ise corrects it, Oxford keeps it.
/// let organise = table::lookup("organize").expect("organize is in the table");
/// assert_eq!(organise.target(Dialect::Ise), Some("organise"));
/// assert_eq!(organise.target(Dialect::Oxford), None);
///
/// // Correct British English in both modes: absent entirely.
/// assert!(table::lookup("sulfur").is_none());
/// assert!(table::lookup("fetus").is_none());
/// assert!(table::lookup("dialog").is_none());
/// ```
pub fn lookup(word: &str) -> Option<&'static Entry> {
    let needle = word.to_lowercase();
    ENTRIES
        .binary_search_by_key(&needle.as_str(), |entry| entry.american)
        .ok()
        .map(|index| &ENTRIES[index])
}

/// How many American spellings the table knows about.
pub fn len() -> usize {
    ENTRIES.len()
}

/// Whether the table is empty, which would mean the build went wrong.
pub fn is_empty() -> bool {
    ENTRIES.is_empty()
}

/// Every entry, in ascending order of [`Entry::american`].
pub fn entries() -> &'static [Entry] {
    ENTRIES
}
