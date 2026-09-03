//! Derive the UK-English lookup table from vendored VarCon data.
//!
//! This is the generator referred to in `README.md` and in the crate-level
//! documentation. It reads `data/varcon.txt` (vendored verbatim, provenance and
//! licence in `data/LICENSE-VarCon`) and writes a sorted, binary-searchable
//! table to `$OUT_DIR/varcon_table.rs`. The data file is never opened at run
//! time, and the generated file contains only data literals: the types, the
//! lookup and every piece of documentation live in `src/table.rs`.
//!
//! # Why generate rather than hand-write
//!
//! VarCon already encodes everything the hard cases need, so deriving beats
//! curating:
//!
//! * **The Oxford split.** Category `B` is British `-ise`, category `Z` is
//!   British `-ize` (Oxford). `A Z: organize / B: organise` therefore says
//!   Oxford keeps *organize*, while `A C: analyze / B Cv: analyse` carries no
//!   `Z` tag at all, and the format's rule "if there are no `Z` tags on the
//!   line then `B` implies `Z`" makes *analyse* correct in **both** British
//!   modes. That is the `-yse` rule (Greek *lysis*, not `-izein`) falling out
//!   of the data rather than out of a hand-written exception list.
//! * **The sense-dependent pairs.** VarCon splits a cluster into groups when
//!   spelling depends on usage, tagging them `<N>`/`<V>` or with a usage gloss.
//!   `A B C: practice | <N>` versus `A Cv: practice / AV B C: practise | <V>`
//!   means *practice* is correct British as a noun and wrong as a verb. A word
//!   whose groups disagree is marked ambiguous here and can never be auto-fixed
//!   downstream. licence/practise, program/programme, meter/metre, check/cheque,
//!   tyre/tire, storey/story and kerb/curb are all derived this way.
//! * **The technical-register traps.** `A Bv: sulfur / B: sulphur` marks
//!   *sulfur* an accepted British variant (RSC/IUPAC, 1992), and `A B C Z:
//!   fetus` marks *fetus* plainly correct. Neither produces a table entry, so
//!   neither can be "corrected".
//!
//! # Rules applied
//!
//! 1. Only a **preferred** American spelling is ever a lookup key: the word
//!    must carry an `A` tag with no variant indicator, or with `.` (equal). A
//!    word tagged `AV` (seldom-used American variant) is skipped, which is what
//!    keeps *dialog* out of the table entirely.
//! 2. A word is acceptable in a British mode if it carries a tag in that
//!    category with any variant indicator except `x` (improper). Being generous
//!    here biases towards silence, and a linter's false-positive rate is the
//!    number that matters.
//! 3. A replacement target must be a solid form: variant indicator `.`, `v` or
//!    `V`, never `-` (possible, generally not used) or `x`. Targets are matched
//!    within the same VarCon column where the line uses column numbers.
//! 4. Entries whose American form contains an uppercase letter are dropped.
//!    Those are proper nouns and taxonomic names (*Acer* / *Acre*), and nothing
//!    good comes of "correcting" one.
//! 5. A word must appear at SCOWL level 70 or below ("can be found in the
//!    dictionary") in at least one cluster to be emitted, but ambiguity is
//!    computed across **all** levels, so a rare alternative sense can still
//!    demote a common word to report-only.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::PathBuf;

/// SCOWL level above which a cluster is not worth a table entry.
///
/// Level 70 is "can be found in the dictionary". Above it VarCon's own README
/// says an entry "may not even be a legal word", and no verification was
/// attempted, so those clusters buy nothing but risk.
const MAX_LEVEL: u32 = 70;

/// Length at or below which a word must clear [`SHORT_WORD_MAX_LEVEL`].
const SHORT_WORD_LEN: usize = 4;

/// SCOWL level a short word must reach to earn a table entry.
///
/// The level-70 tail contains unverified morpheme fragments dressed as
/// clusters: `A: et / B: aet`, `A: cer / B: cre`, `A: eq / B: aeq`. Left in,
/// they fire on "et al.", on "Eq. 3" and on any three-letter abbreviation,
/// which is a far worse outcome than missing an obscure word. Every genuinely
/// useful short pair (gray/grey, mold/mould, plow/plough, ax/axe, math/maths,
/// cozy/cosy, molt/moult, odor/odour, calk/caulk) sits at level 35 or below,
/// so the cut is clean rather than a compromise.
const SHORT_WORD_MAX_LEVEL: u32 = 35;

/// One `TAGS: word` variant on a VarCon line.
struct Variant {
    word: String,
    /// `(category, indicator)` pairs, e.g. `('A', "")` or `('B', "v")`.
    tags: Vec<(char, String)>,
    /// The VarCon column number, when the line uses them to pair forms.
    column: Option<u32>,
}

impl Variant {
    /// Whether `category` appears with an indicator other than `x` (improper).
    fn accepts(&self, category: char) -> bool {
        self.tags
            .iter()
            .any(|(cat, indicator)| *cat == category && indicator != "x")
    }

    /// Whether this is the preferred American spelling, not a US variant form.
    fn is_preferred_american(&self) -> bool {
        self.tags
            .iter()
            .any(|(cat, indicator)| *cat == 'A' && (indicator.is_empty() || indicator == "."))
    }

    /// Rank of this word as a replacement target for `category`; lower is
    /// better, and `None` means it must never be offered as a fix.
    fn target_rank(&self, category: char) -> Option<u8> {
        self.tags
            .iter()
            .filter(|(cat, _)| *cat == category)
            .filter_map(|(_, indicator)| match indicator.as_str() {
                "" | "." => Some(0),
                "v" => Some(1),
                "V" => Some(2),
                _ => None,
            })
            .min()
    }
}

/// What one VarCon group says about one American word.
#[derive(PartialEq, Eq, PartialOrd, Ord, Clone)]
struct GroupRecord {
    pos: Option<String>,
    usage: String,
    /// Replacement under British `-ise`; `None` means already correct.
    ise: Option<String>,
    /// Replacement under British `-ize` (Oxford); `None` means already correct.
    ize: Option<String>,
}

/// Everything the parse learned about one American surface form.
struct WordInfo {
    groups: Vec<GroupRecord>,
    min_level: u32,
    /// A group wanted a change but named no usable target. The word cannot be
    /// treated as unconditional after that, because the group is real evidence
    /// that the spelling depends on sense even though it cannot be acted on.
    forced_ambiguous: bool,
}

impl Default for WordInfo {
    fn default() -> Self {
        Self {
            groups: Vec::new(),
            min_level: u32::MAX,
            forced_ambiguous: false,
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=data/varcon.txt");
    println!("cargo:rerun-if-changed=build.rs");

    let bytes =
        std::fs::read("data/varcon.txt").expect("data/varcon.txt is vendored alongside build.rs");
    // VarCon is Latin-1, not UTF-8: four bytes in the whole file are high
    // (the umlauts in "führer" and "Köln"), all in the `_` "Other" category
    // this generator ignores. Decoding here rather than re-encoding the vendored
    // file keeps it byte-identical to upstream, so the recorded SHA-256 in
    // data/LICENSE-VarCon stays verifiable.
    let source: String = bytes.iter().map(|&byte| byte as char).collect();
    let words = parse(&source);
    let rendered = render(&words);

    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"))
        .join("varcon_table.rs");
    std::fs::write(&out, rendered).expect("the generated table is writable");
}

/// Parse the whole file into per-American-word group records.
fn parse(source: &str) -> BTreeMap<String, WordInfo> {
    let mut words: BTreeMap<String, WordInfo> = BTreeMap::new();
    let mut level = u32::MAX;

    for raw in source.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("##") {
            let _ = rest; // Cluster-wide editorial comment; carries no data.
            continue;
        }
        if let Some(header) = line.strip_prefix('#') {
            level = parse_level(header);
            continue;
        }
        parse_data_line(line, level, &mut words);
    }
    words
}

/// Pull `(level N)` out of a cluster header, defaulting to "unusable".
fn parse_level(header: &str) -> u32 {
    header
        .rsplit_once("(level ")
        .and_then(|(_, tail)| tail.split(')').next())
        .and_then(|digits| digits.trim().parse().ok())
        .unwrap_or(u32::MAX)
}

/// Fold one data line into `words`.
fn parse_data_line(line: &str, level: u32, words: &mut BTreeMap<String, WordInfo>) {
    // A `#` after the data is an editorial comment about that line.
    let line = line.split(" #").next().unwrap_or(line).trim();
    let (variants_part, usage_part) = match line.split_once(" | ") {
        Some((left, right)) => (left, Some(right)),
        None => (line, None),
    };

    let (pos, usage, rare) = parse_usage(usage_part);
    if rare {
        // "(-)" marks a rarely used or archaic form. It is real data, but too
        // thin to base either a fix or an ambiguity judgement on.
        return;
    }

    let variants: Vec<Variant> = variants_part
        .split(" / ")
        .filter_map(parse_variant)
        .collect();
    if variants.is_empty() {
        return;
    }
    // Format rule: with no `Z` tag anywhere on the line, `B` implies `Z`.
    let line_has_z = variants
        .iter()
        .any(|v| v.tags.iter().any(|(c, _)| *c == 'Z'));

    for variant in &variants {
        if !variant.is_preferred_american() {
            continue;
        }
        let ise_ok = variant.accepts('B');
        let ize_ok = if line_has_z {
            variant.accepts('Z')
        } else {
            ise_ok
        };

        let ise_target = if ise_ok {
            None
        } else {
            pick_target(&variants, variant, 'B')
        };
        let ize_target = if ize_ok {
            None
        } else if line_has_z {
            pick_target(&variants, variant, 'Z')
        } else {
            ise_target.clone()
        };

        let entry = words.entry(variant.word.to_lowercase()).or_default();
        entry.min_level = entry.min_level.min(level);
        // A group that demands a change but names no target cannot be acted on,
        // yet it still proves the spelling is sense-dependent.
        if (!ise_ok && ise_target.is_none()) || (!ize_ok && ize_target.is_none()) {
            entry.forced_ambiguous = true;
            continue;
        }
        let record = GroupRecord {
            pos: pos.clone(),
            usage: usage.clone(),
            ise: ise_target,
            ize: ize_target,
        };
        if !entry.groups.contains(&record) {
            entry.groups.push(record);
        }
    }
}

/// Split `TAGS: word` into a [`Variant`].
fn parse_variant(chunk: &str) -> Option<Variant> {
    let (tags_str, word) = chunk.trim().split_once(':')?;
    let word = word.trim();
    if word.is_empty() || word.contains(' ') {
        return None;
    }

    let mut tags = Vec::new();
    let mut column = None;
    for token in tags_str.split_whitespace() {
        push_tag(token, &mut tags, &mut column);
    }
    // `_1: yak` packs the category and the column into one token.
    if tags_str.starts_with('_') && tags.is_empty() {
        tags.push(('_', String::new()));
    }
    if tags.is_empty() {
        return None;
    }
    Some(Variant {
        word: word.to_string(),
        tags,
        column,
    })
}

/// Classify one whitespace-separated tag token.
fn push_tag(token: &str, tags: &mut Vec<(char, String)>, column: &mut Option<u32>) {
    if let Ok(number) = token.parse::<u32>() {
        *column = Some(number);
        return;
    }
    let mut chars = token.chars();
    let Some(category) = chars.next() else {
        return;
    };
    let rest: String = chars.collect();
    // A trailing digit run is a column number glued to the category, as in `_1`.
    let split = rest
        .find(|c: char| c.is_ascii_digit())
        .unwrap_or(rest.len());
    if let Ok(number) = rest[split..].parse::<u32>() {
        *column = Some(number);
    }
    tags.push((category, rest[..split].to_string()));
}

/// Choose the best replacement for `source` in `category` on this line.
///
/// Where the line uses column numbers, a target in the same column wins: the
/// columns are exactly how VarCon pairs forms when one line carries two
/// independent relations.
fn pick_target(variants: &[Variant], source: &Variant, category: char) -> Option<String> {
    variants
        .iter()
        .filter(|candidate| !candidate.word.eq_ignore_ascii_case(&source.word))
        .filter_map(|candidate| {
            let rank = candidate.target_rank(category)?;
            let column_penalty = match (source.column, candidate.column) {
                (Some(a), Some(b)) if a == b => 0u8,
                (Some(_), Some(_)) => 2,
                _ => 1,
            };
            Some((column_penalty, rank, candidate.word.clone()))
        })
        .min()
        .map(|(_, _, word)| word)
}

/// Parse the usage suffix into `(pos, usage, rare)`.
fn parse_usage(usage_part: Option<&str>) -> (Option<String>, String, bool) {
    let Some(raw) = usage_part else {
        return (None, String::new(), false);
    };
    let mut pos = None;
    let mut usage = String::new();
    let mut rare = false;

    for part in raw.split(" | ") {
        let part = part.trim();
        if part.starts_with("--") || part.is_empty() {
            // A note, not a group discriminator.
            continue;
        }
        let part = match part.strip_prefix("(-)") {
            Some(rest) => {
                rare = true;
                rest.trim()
            }
            None => part,
        };
        let text = match part.strip_prefix('<').and_then(|p| p.split_once('>')) {
            Some((tag, rest)) => {
                pos = Some(tag.to_string());
                rest.trim()
            }
            None => part,
        };
        if !text.is_empty() {
            if !usage.is_empty() {
                usage.push_str("; ");
            }
            usage.push_str(text);
        }
    }
    (pos, usage, rare)
}

/// Render the table as Rust source.
fn render(words: &BTreeMap<String, WordInfo>) -> String {
    let mut entries = String::new();
    let (mut unconditional, mut ambiguous) = (0usize, 0usize);

    for (word, info) in words {
        let ceiling = if word.chars().count() <= SHORT_WORD_LEN {
            SHORT_WORD_MAX_LEVEL
        } else {
            MAX_LEVEL
        };
        if info.min_level > ceiling || word.chars().any(|c| c.is_uppercase()) {
            continue;
        }
        // A capitalised target is a proper noun (`ier` -> `Ire`), never a fix.
        if info
            .groups
            .iter()
            .flat_map(|group| [group.ise.as_deref(), group.ize.as_deref()])
            .flatten()
            .any(|target| target.chars().any(|c| c.is_uppercase()))
        {
            continue;
        }
        // Every group agrees the word is already correct: nothing to say.
        if info
            .groups
            .iter()
            .all(|g| g.ise.is_none() && g.ize.is_none())
        {
            continue;
        }
        let first = &info.groups[0];
        let agreed = !info.forced_ambiguous
            && info
                .groups
                .iter()
                .all(|g| g.ise == first.ise && g.ize == first.ize);

        if agreed {
            unconditional += 1;
            let _ = writeln!(
                entries,
                "    Entry {{ american: {:?}, ise: {}, ize: {}, senses: &[] }},",
                word,
                render_option(&first.ise),
                render_option(&first.ize),
            );
        } else {
            ambiguous += 1;
            let mut senses = String::new();
            for group in &info.groups {
                let _ = write!(
                    senses,
                    "Sense {{ pos: {}, usage: {:?}, ise: {}, ize: {} }}, ",
                    render_option(&group.pos),
                    group.usage,
                    render_option(&group.ise),
                    render_option(&group.ize),
                );
            }
            let _ = writeln!(
                entries,
                "    Entry {{ american: {word:?}, ise: None, ize: None, senses: &[{senses}] }},",
            );
        }
    }

    format!(
        "// @generated by build.rs from data/varcon.txt (VarCon 2020.12.07).\n\
         // Do not edit: change the generator or the vendored data instead.\n\
         // {unconditional} unconditional entries, {ambiguous} sense-dependent entries.\n\
         \n\
         /// The VarCon release the table was derived from.\n\
         pub const VARCON_VERSION: &str = \"2020.12.07\";\n\
         \n\
         /// Entries sorted by [`Entry::american`] for binary search.\n\
         pub(crate) static ENTRIES: &[Entry] = &[\n{entries}];\n"
    )
}

/// Render an `Option<String>` as an `Option<&'static str>` literal.
fn render_option(value: &Option<String>) -> String {
    match value {
        Some(text) => format!("Some({text:?})"),
        None => "None".to_string(),
    }
}
