//! Hand-verified overrides that outrank the generated table.
//!
//! The VarCon-derived table in [`crate::table`] already gets every case here
//! right, and the test suite asserts that. These lists exist anyway, for two
//! reasons.
//!
//! 1. **They are a guarantee, not a mechanism.** A future VarCon release, or a
//!    change to the generator, could quietly start proposing *advertize* or
//!    *sulphur*. The overrides make that impossible rather than unlikely, and
//!    the cross-check tests turn any disagreement between list and data into a
//!    build failure instead of a wrong suggestion in someone's prose.
//! 2. **They carry the citation.** VarCon says what the spelling is; these
//!    lists say *why*, which is what an editor reading a report needs.
//!
//! Nothing here is ever reported. A token these lists protect produces no
//! finding at all, in either dialect.

use std::collections::HashSet;
use std::sync::OnceLock;

/// Verb roots that always take `-ise`, with the final `e` trimmed.
///
/// In these words the ending is not the Greek `-izein` suffix at all but part
/// of a longer root: `-cise` (cutting), `-mise` (sending), `-vise` (seeing),
/// `-prise` (taking), `-guise` (form). Oxford spelling changes nothing here,
/// because there is no `-ize` suffix to change.
///
/// Cross-checked against World Wide Words and the Chatham House style guide.
/// A useful confirmation: none of these forms a noun in `-isation`, with
/// *improvisation* the sole exception.
pub const ALWAYS_ISE_ROOTS: &[&str] = &[
    "advertis",
    "advis",
    "appris",
    "aris",
    "chastis",
    "circumcis",
    "compris",
    "compromis",
    "demis",
    "despis",
    "devis",
    "disfranchis",
    "disguis",
    "enfranchis",
    "enterpris",
    "excis",
    "exercis",
    "franchis",
    "guis",
    "improvis",
    "incis",
    "merchandis",
    "premis",
    "pris",
    "promis",
    "repris",
    "revis",
    "supervis",
    "surmis",
    "surpris",
    "televis",
];

/// Verb roots that always take `-yse`, with the final `e` trimmed.
///
/// The root is Greek *lysis*, not `-izein`, so Hart's Rules records that "there
/// is therefore no parallel with -ize- words". This holds in Oxford spelling as
/// firmly as in general British English: there is no `-yze` exception anywhere.
pub const ALWAYS_YSE_ROOTS: &[&str] = &[
    "analys",
    "breathalys",
    "catalys",
    "dialys",
    "electrolys",
    "hydrolys",
    "paralys",
    "psychoanalys",
];

/// Inflections appended to a root to build the protected surface forms.
const ROOT_SUFFIXES: &[&str] = &[
    "e", "es", "ed", "ing", "er", "ers", "ement", "ements", "ation", "ations", "able", "ingly",
];

/// Words that stay exactly as they are, with the authority for each.
///
/// | Word | Why it stays |
/// |---|---|
/// | *sulfur* and family | The Royal Society of Chemistry adopted the `f` spelling in 1992 to match IUPAC, and BSI followed in 1993. "Correcting" it to *sulphur* is wrong in every technical register. |
/// | *fetus* and family | Standard in UK biomedical usage: 92.5 per cent of UK-indexed papers, per the BMJ. *Foetus* survives in lay writing but is not the form to impose. |
/// | *dialog* | Only ever seen in *dialog box*, a user-interface term of art. British English uses *dialogue* for the conversation and leaves the widget alone. |
/// | *disk* | *Disk* and *disc* are both current British English and split by convention, not dialect: magnetic *disk*, optical *disc*. VarCon marks both acceptable in Britain, so there is nothing to correct. |
pub const NEVER_FIX: &[&str] = &[
    "sulfur",
    "sulfurs",
    "sulfur's",
    "sulfide",
    "sulfides",
    "sulfate",
    "sulfates",
    "sulfuric",
    "sulfurous",
    "sulfide's",
    "sulfate's",
    "fetus",
    "fetuses",
    "fetus's",
    "fetal",
    "dialog",
    "dialogs",
    "dialog's",
    "disk",
    "disks",
    "disk's",
];

/// Whether `word` is protected from every rule in this crate.
///
/// The comparison is case-insensitive; pass the token exactly as it appears and
/// the function lowercases it.
///
/// # Examples
///
/// ```
/// use prose_sanitiser_uk::overrides;
///
/// assert!(overrides::is_protected("sulfur"));
/// assert!(overrides::is_protected("Sulfur"));
/// assert!(overrides::is_protected("analysed"));
/// assert!(overrides::is_protected("advertising"));
/// assert!(!overrides::is_protected("color"));
/// ```
pub fn is_protected(word: &str) -> bool {
    protected().contains(word.to_lowercase().as_str())
}

/// The full protected set, expanded once and cached.
fn protected() -> &'static HashSet<String> {
    static SET: OnceLock<HashSet<String>> = OnceLock::new();
    SET.get_or_init(|| {
        let mut set: HashSet<String> = NEVER_FIX.iter().map(|word| word.to_string()).collect();
        for root in ALWAYS_ISE_ROOTS.iter().chain(ALWAYS_YSE_ROOTS) {
            for suffix in ROOT_SUFFIXES {
                set.insert(format!("{root}{suffix}"));
            }
            // The possessive of the bare noun form, e.g. "premise's".
            set.insert(format!("{root}e's"));
        }
        set
    })
}

/// Every protected surface form, sorted, for tests and documentation.
pub fn protected_forms() -> Vec<&'static str> {
    let mut forms: Vec<&'static str> = protected().iter().map(String::as_str).collect();
    forms.sort_unstable();
    forms
}
