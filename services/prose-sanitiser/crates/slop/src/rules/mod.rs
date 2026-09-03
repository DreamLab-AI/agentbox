//! The slop rule tables: versioned, date-stamped and tiered.
//!
//! Lexical markers decay. A word that carried a 6,697 per cent excess frequency
//! in 2024 output may be trained out by 2027, and a table frozen at the moment
//! it was written rots silently: it keeps reporting, the reports keep looking
//! authoritative, and nobody can tell from the output that the evidence has
//! moved. Three pieces of machinery answer that.
//!
//! 1. [`RULESET_VERSION`] stamps every report, so a finding can be traced to the
//!    table that produced it.
//! 2. Each [`Rule`] carries `since` and `reviewed` dates and its `sources`, so a
//!    stale rule is visible as data rather than as folklore.
//! 3. [`CHANGELOG`] records what changed between ruleset versions and why.
//!
//! # Tiers
//!
//! Nothing here is [`ConfidenceTier::CertainMechanical`]. Stylistic tells are
//! population-level signals, never forensic ones, so no slop rule may ever
//! auto-fix. The split within the crate is:
//!
//! | Tier | Contents | Basis |
//! |---|---|---|
//! | [`ConfidenceTier::HighConfidenceStylistic`] | Structural tells with a published per-10,000-word measurement: em-dash density, Oxford-comma density, negative parallelism | Pew Research Center Data Labs, 20 August 2026, roughly 490,000 Common Crawl pages |
//! | [`ConfidenceTier::LowConfidenceJudgement`] | Every lexical marker list, and the structural heuristics with no measurement study behind them: tricolon, sentence-length variance, uniform paragraph length | Excess-vocabulary studies are population-level; the remaining structural tells are practitioner heuristics |
//!
//! High-confidence-stylistic gates an opt-in fix, not an automatic one. In
//! practice no rule in this crate emits a `replacement` at all, so the tier
//! records how much to trust the pattern rather than licensing a rewrite.
//!
//! # Evidence
//!
//! The tables are sourced, and the sources disagree in a way worth stating.
//! Pangram reports *delve* declining; the Pew tracking of a fixed 27-word list
//! found the category more than doubled between January 2023 and January 2026.
//! The table therefore keeps the flagship words and treats the class, not any
//! single word, as the signal. See [`CHANGELOG`].

use prose_sanitiser_core::{ConfidenceTier, RuleMeta};

mod lexicon;
mod table;
pub mod uk;

pub use lexicon::{
    EMDASH, EMDASH_PER_WINDOW, EXTS, IGNORE_MARK, SKIP_DIRS, TIER2, TRANSITIONS, TRANS_PER_WINDOW,
    WORDS_PER_PAGE,
};
pub use table::RULES;

/// How strongly a tell signals AI authorship.
///
/// Re-exported from `prose-sanitiser-core` so the slop tables, the UK rule and
/// any future scanner all weigh findings on one scale.
pub use prose_sanitiser_core::Severity;

/// The version of the rule tables in this build.
///
/// Date-shaped rather than semantic, because the thing that changes is
/// evidence, not an API. Bump it in the same commit as any change to [`RULES`],
/// [`TIER2`], [`TRANSITIONS`] or the structural thresholds, and add a
/// [`CHANGELOG`] entry saying what moved and on what evidence.
pub const RULESET_VERSION: &str = "2026.09.03";

/// The date the tables were last checked against their sources in full.
pub const RULESET_REVIEWED: &str = "2026-09-03";

/// One entry in the ruleset history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChangelogEntry {
    /// The ruleset version this entry describes.
    pub version: &'static str,
    /// ISO-8601 release date.
    pub date: &'static str,
    /// What changed, and on what evidence.
    pub notes: &'static [&'static str],
}

/// What changed between ruleset versions, newest first.
pub const CHANGELOG: &[ChangelogEntry] = &[
    ChangelogEntry {
        version: "2026.09.03",
        date: "2026-09-03",
        notes: &[
            "Versioned and date-stamped the tables; every rule now carries since, reviewed, a confidence tier and its sources.",
            "Added inflections the flat alternations missed: delves/delved/delving, showcase family, boast family. The 2026.01.14 pattern matched only the bare stem, so the most-cited marker of all was being missed in its commonest form.",
            "Added markers with a published excess-frequency measurement and no prior entry: pivotal, garner, encompass, commendable, invaluable, adept, bolster, unravel, navigate, spearhead, myriad, tackle.",
            "Dropped nothing. Pangram reports delve declining; Pew tracking of a fixed 27-word list over roughly 490,000 Common Crawl pages found the category more than doubled between January 2023 and January 2026. The class is the signal, not any single word, so a vendor's claim about one word is not grounds to remove it.",
            "The UK-English rule is no longer implemented here at all. `us-spelling` is a positional marker in the table and the check is delegated to prose-sanitiser-uk's VarCon-backed checker, which adds the sense-dependent `uk-sense` rule alongside it. The old flat alternation flagged `meter`, `licence`, `program`, `dialog` and `World Health Organization`; none of them now produce a mechanical replacement.",
            "Added the structural measures with a published per-10,000-word rate (em-dash density, Oxford-comma density, negative-parallelism density) at high-confidence-stylistic, and the ones without (tricolon, sentence-length variance, uniform paragraph length) at low-confidence-judgement. The research brief marks the latter three as practitioner heuristics with no measurement study, so they are reported at the tier the evidence supports.",
            "Every structural measure is opt-in behind --structural, so the default report is unchanged in shape and in which rules can fire.",
            "Measured every rule against 3,500 human and 3,500 machine documents from RAID and MAGE. Two calibrations changed as a result. `the-opener` fires on 41.1 per cent of human documents and 38.0 per cent of machine ones, so it points very slightly the wrong way as an authorship signal: demoted from high-confidence-stylistic to low-confidence-judgement and kept as a house-style rule only.",
            "The sentence-length variance floor was 0.35, which flagged 36.7 per cent of human documents. Retuned to 0.20: 6.9 per cent of human documents against 14.8 per cent of machine ones. The tricolon budget went from 6 to 40 per 10,000 words, and is now documented as non-discriminating: at every threshold tested it flagged more human documents than machine ones, so it is a style budget and not an AI tell.",
        ],
    },
    ChangelogEntry {
        version: "2026.01.14",
        date: "2026-01-14",
        notes: &[
            "Initial table, ported from the Python skill: 15 per-line rules, the Tier-2 cluster list and the transition-word density check.",
            "Unversioned and undated; no per-rule confidence tier and no recorded sources.",
        ],
    },
];

/// One per-line rule.
///
/// The metadata half of the struct is what makes the table auditable: `since`
/// and `reviewed` date it, `sources` say what it rests on, and `confidence`
/// says how far to trust it.
pub struct Rule {
    /// Stable machine identifier, emitted in every report.
    pub id: &'static str,
    /// One-line human label.
    pub label: &'static str,
    /// How strongly the tell signals AI authorship.
    pub severity: Severity,
    /// Whether a human must read the finding before acting: always, here.
    pub confidence: ConfidenceTier,
    /// Editorial advice.
    pub fix: &'static str,
    /// The alternations, matched case-insensitively unless `cased`.
    ///
    /// Empty for a rule the scanner delegates rather than matches. One rule is
    /// like that: `us-spelling` is a positional marker for the UK-English
    /// check, which `prose-sanitiser-uk` owns in full. See [`uk`].
    pub patterns: &'static [&'static str],
    /// A pattern set built at first use rather than written in the table.
    ///
    /// Unused today. It exists because a rule whose data lives in another crate
    /// should not have to be transcribed into this one to be matchable.
    pub dynamic: Option<fn() -> &'static [String]>,
    /// Case-sensitive rules opt out of the default IGNORECASE.
    pub cased: bool,
    /// ISO-8601 date the rule entered the table.
    pub since: &'static str,
    /// ISO-8601 date the rule was last re-checked against its sources.
    pub reviewed: &'static str,
    /// What the rule rests on: papers, corpora, or the house style guide.
    pub sources: &'static [&'static str],
}

impl Rule {
    /// Every pattern source this rule matches on, static or built at first use.
    ///
    /// Empty means the scanner delegates this rule rather than matching it.
    pub fn pattern_sources(&self) -> Vec<&str> {
        match self.dynamic {
            Some(build) => build().iter().map(String::as_str).collect(),
            None => self.patterns.to_vec(),
        }
    }

    /// Whether the scanner delegates this rule to another crate's checker.
    pub fn is_delegated(&self) -> bool {
        self.patterns.is_empty() && self.dynamic.is_none()
    }

    /// Render as the SARIF-ready [`RuleMeta`].
    pub fn to_meta(&self) -> RuleMeta {
        RuleMeta {
            id: self.id,
            name: self.label,
            description: self.fix,
            severity: self.severity,
            confidence: self.confidence,
            since: self.since,
            reviewed: self.reviewed,
            help_uri: None,
            sources: self.sources,
        }
    }
}

/// The published sources the tables cite, so a rule's `sources` entries are
/// keys into one list rather than free text repeated per rule.
pub mod sources {
    /// Kobak et al., excess vocabulary in biomedical abstracts.
    pub const KOBAK: &str = "https://doi.org/10.1126/sciadv.adt3813";
    /// Juzek and Ward, "Why Does ChatGPT 'Delve' So Much?", COLING 2025.
    pub const JUZEK: &str = "https://arxiv.org/html/2412.11385v1";
    /// Pew Research Center Data Labs, structural rates per 10,000 words.
    pub const PEW: &str =
        "https://www.pewresearch.org/data-labs/2026/08/20/how-much-of-the-internet-is-written-with-ai/";
    /// Wikipedia WikiProject AI Cleanup, "Signs of AI writing".
    pub const WIKIPEDIA: &str = "https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing";
    /// The prose-sanitiser house style guide; a preference, not a measurement.
    pub const HOUSE_STYLE: &str = "prose-sanitiser SKILL.md";
}

/// Every rule in the table, as SARIF rule metadata.
///
/// Built once and leaked, because a SARIF driver table is `&'static` by the
/// time it reaches [`prose_sanitiser_core::Report`] and the table is fixed for
/// the life of the process. One leak per process, of a table the process needs
/// until it exits.
pub fn rule_meta() -> &'static [RuleMeta] {
    use std::sync::OnceLock;
    static META: OnceLock<Vec<RuleMeta>> = OnceLock::new();
    META.get_or_init(|| {
        // The UK rules are documented by the crate that owns them, so its
        // entries replace the slop table's positional marker.
        let mut meta: Vec<RuleMeta> = RULES
            .iter()
            .filter(|rule| !rule.is_delegated())
            .map(Rule::to_meta)
            .collect();
        meta.extend(uk::rule_meta().iter().copied());
        meta.extend(crate::structural::STRUCTURAL_RULES.iter().copied());
        meta.extend(AGGREGATE_RULES.iter().copied());
        meta
    })
}

/// The whole-file aggregate checks the default scan performs.
///
/// They report under the rule id `agg`, which predates the versioned table and
/// stays that way so the default output is unchanged. The metadata is recorded
/// here so a SARIF consumer still sees a tier and a date for them.
pub const AGGREGATE_RULES: &[RuleMeta] = &[RuleMeta {
    id: "agg",
    name: "Whole-file aggregate density check",
    description: "Em-dash density, em-dashes inside list items, transition-word density and the Tier-2 cluster check, measured over the whole file rather than per line.",
    severity: Severity::High,
    confidence: ConfidenceTier::HighConfidenceStylistic,
    since: "2026-01-14",
    reviewed: "2026-09-03",
    help_uri: None,
    sources: &[sources::PEW, sources::HOUSE_STYLE],
}];

#[cfg(test)]
mod tests;
