//! The prose slop rule table, mirroring Section B of the prose-sanitiser
//! SKILL.md (lexical, structural and spelling tells).
//!
//! Severity follows the Tier-1/Tier-2 weighting in the skill, so the report
//! says where to spend effort. These are the MECHANICAL tells only; narrative
//! defaults (Section C) and altitude/voice need a human read.

/// How strongly a tell signals AI authorship.
///
/// Re-exported from `prose-sanitiser-core` so the slop tables, the UK rule and
/// any future scanner all weigh findings on one scale.
pub use prose_sanitiser_core::Severity;

/// One per-line rule.
pub struct Rule {
    pub id: &'static str,
    pub label: &'static str,
    pub severity: Severity,
    pub fix: &'static str,
    pub patterns: &'static [&'static str],
    /// Case-sensitive rules opt out of the default IGNORECASE.
    pub cased: bool,
}

pub const RULES: &[Rule] = &[
    Rule {
        id: "preamble-label",
        label: "Preamble setup label (announcing the explanation)",
        severity: Severity::Medium,
        fix: "Delete the label and let the explanation stand on its own. A heading or opener like 'In plain terms' / 'Put simply' / 'In essence' announces that clarity is coming instead of delivering it - the plain statement should simply be the text. See references/destructive-audit.md B15.",
        patterns: &[
            r"\bin plain (?:terms|english|language)\b",
            r"\bput simply\b",
            r"\bsimply put\b",
            r"\bin essence\b",
            r"\bin a nutshell\b",
            r"\bat a high level\b",
            r"\bin other words\b",
            r"\bto put it (?:another way|simply|plainly)\b",
            r"\bthe idea in brief\b",
            r"\blong story short\b",
        ],
        cased: false,
    },
    Rule {
        id: "insider-voice",
        label: "Insider voice in external document (audience leakage)",
        severity: Severity::Medium,
        fix: "Negotiation stance, critique of the counterparty's drafting, or strategy narration leaking into an externally facing document. Restate neutrally: describe the decision or mechanism, not your read of the other side. Only applies to client/public-facing text; internal memos are exempt - judge by audience. See references/destructive-audit.md B14.",
        patterns: &[
            r"\bthe wording leaves\b",
            r"\breads? as though\b",
            r"\bsilently become\b",
            r"\bdo not silently\b",
            r"\bwe can construct\b",
            r"\bkeeps? that freedom\b",
            r"\bworth being clear-eyed\b",
            r"\bsmuggl(?:e[sd]?|ing)\b",
            r"\bquietly (?:assume[sd]?|become[s]?|expand(?:s|ed)?|reassign(?:s|ed)?)\b",
            r"\bhonest (?:consequence|with each other)\b",
            r"\blandmine[s]?\b",
            r"\bscope[- ]creep\b",
        ],
        cased: false,
    },
    // ---- HIGH: Tier-1 vocabulary and the strongest structural tells ----
    Rule {
        id: "tier1-vocab",
        label: "Tier-1 banned vocabulary",
        severity: Severity::High,
        fix: "Replace with a plain word (delve->look at, leverage->use, robust->solid, seamless->smooth, utilise->use). See SKILL.md B4.",
        patterns: &[
            r"\b(delve|leverage|leverages|leveraging|leveraged|robust|seamless|seamlessly|comprehensive|cutting-edge|transformative|groundbreaking|innovative|holistic|testament|tapestry|vibrant|utilize|utilise|utilizes|utilises|harness(?:es|ing|ed)?|unlock(?:s|ing|ed)?|unleash(?:es|ing|ed)?|streamline(?:s|d)?|streamlining|empower(?:s|ing|ed|ment)?|elevate(?:s|d)?|elevating|paradigm|unprecedented|synergy|synergies|foster(?:s|ing|ed)?|underscore(?:s|d)?|underscoring|game-changing|enterprise-scale|enterprise-grade|extraordinary|honest(?:ly)?|honesty)\b",
        ],
        cased: false,
    },
    Rule {
        id: "the-heading",
        label: "\"The X\" heading",
        severity: Severity::High,
        fix: "Drop the leading 'The' unless it is a proper noun (The Guardian). See SKILL.md B2.",
        patterns: &[
            r"^#{1,6}\s+The\s+\S",
            r"\\(?:sub)*section\*?\{The\s",
            r"\\paragraph\*?\{The\s",
            r"\\caption\{The\s",
        ],
        cased: true,
    },
    Rule {
        id: "the-opener",
        label: "\"The X\" sentence/paragraph opener",
        severity: Severity::High,
        fix: "Don't open with 'The <lowercase noun>'. Recast so the subject leads, or name the thing directly ('The production-node paired study lifts...' -> 'Holding the model constant and varying only the serving path lifts...'). Proper nouns (The Loom) are fine. See SKILL.md B2.",
        // Line-initial "The" + a lowercase word = the definitional/throat-clearing
        // opener; a capitalised follower (The Loom, The Guardian) is a proper
        // noun and is left alone.
        patterns: &[r"^\s*The\s+[a-z]"],
        cased: true,
    },
    Rule {
        id: "negative-parallelism",
        label: "Negative parallelism (not X - Y / not just X but Y)",
        severity: Severity::High,
        fix: "Lead with the positive claim, or delete the negative half. See SKILL.md B3.",
        patterns: &[
            r"\bnot\s+(just|only|merely|simply)\b[^.?!]{1,60}?(,?\s*but\b|\s+—)",
            r"\bit'?s\s+not\b[^.?!]{1,50}?—",
            r"\bisn'?t\s+(just\s+)?about\b[^.?!]{1,60}?\bit'?s\s+about\b",
            r"\bthis\s+isn'?t\b[^.?!]{1,50}?\bit'?s\b",
        ],
        cased: false,
    },
    Rule {
        id: "throat-clearing",
        label: "Throat-clearing opener",
        severity: Severity::High,
        fix: "Delete the warm-up. Lead with the value. See SKILL.md B6.",
        patterns: &[
            r"\bin\s+today'?s\s+(rapidly\s+)?(evolving|changing|fast-paced)\b",
            r"\bin\s+the\s+world\s+of\b",
            r"\bhere'?s\s+the\s+thing\b",
            r"\blet\s+me\s+be\s+clear\b",
            r"\bit\s+turns\s+out\b",
            r"\blet'?s\s+(dive\s+in|explore|unpack)\b",
            r"\bit'?s\s+(worth|important)\s+(noting|to\s+note)\s+that\b",
            r"\bat\s+its\s+core\b",
            r"\bat\s+the\s+end\s+of\s+the\s+day\b",
            r"\bwhen\s+it\s+comes\s+to\b",
        ],
        cased: false,
    },
    Rule {
        id: "sycophantic-filler",
        label: "Sycophantic filler",
        severity: Severity::High,
        fix: "Delete entirely. See SKILL.md B7.",
        patterns: &[
            r"\byou'?re\s+absolutely\s+right\b",
            r"\bgreat\s+question\b",
            r"\bthat'?s\s+a\s+(really\s+)?(interesting|great)\s+(point|question)\b",
            r"\b(certainly|absolutely)!\B",
            r"\bi'?d\s+be\s+happy\s+to\s+help\b",
        ],
        cased: false,
    },
    Rule {
        id: "claudish-filler",
        label: "Claudish filler phrase",
        severity: Severity::High,
        fix: "Cut the filler. Lead with the substance. See SKILL.md B13.",
        patterns: &[
            r"\blet'?s\s+break\s+(this|that|it)\s+down\b",
            r"\bthere\s+are\s+several\s+(key\s+)?(things|aspects|factors|considerations)\b",
            r"\bthis\s+is\s+particularly\s+(important|relevant|noteworthy|interesting)\b",
            r"\bit'?s\s+also\s+worth\s+(mentioning|highlighting|emphasizing|emphasising)\b",
            r"\b(here|this)\s+is\s+where\s+(things|it)\s+(get|gets)\s+(interesting|tricky|complicated)\b",
        ],
        cased: false,
    },
    // ---- MEDIUM: hedge words, copula substitution, US spelling ----
    Rule {
        id: "hedge-words",
        label: "Hedge word",
        severity: Severity::Medium,
        fix: "Cut it, or replace with a specific qualifier (\"in staging\", \"for payloads <10KB\"). See SKILL.md B8.",
        patterns: &[r"\b(basically|actually|essentially|fundamentally|somewhat)\b"],
        cased: false,
    },
    Rule {
        id: "copula-substitution",
        label: "Copula substitution (serves as / marks the)",
        severity: Severity::Medium,
        fix: "Use 'is'. 'serves as a' -> 'is'; 'marks the' -> 'is'. See SKILL.md B9.",
        patterns: &[
            r"\bserves?\s+as\s+a\b",
            r"\bmarks?\s+the\b",
            r"\bstands?\s+as\s+a\b",
            r"\bacts?\s+as\s+a\b",
            r"\brepresents?\s+a\s+(key|major|significant)\b",
        ],
        cased: false,
    },
    // The UK-English rule lives in `prose-sanitiser-uk`, which owns the
    // pattern and its documented limitations. Referencing its constants here
    // keeps the scanner and that crate's `check` API from ever drifting.
    Rule {
        id: prose_sanitiser_uk::US_SPELLING_ID,
        label: prose_sanitiser_uk::US_SPELLING_LABEL,
        severity: prose_sanitiser_uk::US_SPELLING_SEVERITY,
        fix: prose_sanitiser_uk::US_SPELLING_FIX,
        patterns: &[prose_sanitiser_uk::US_SPELLING_PATTERN],
        cased: false,
    },
    Rule {
        id: "passive-tell",
        label: "Passive / agentless construction",
        severity: Severity::Medium,
        fix: "Make it active. 'can be seen that' -> 'this shows'; 'the decision was made to' -> 'we decided to'. See SKILL.md B11.",
        patterns: &[
            r"\bit\s+can\s+be\s+seen\s+that\b",
            r"\bthe\s+decision\s+was\s+made\s+to\b",
            r"\bit\s+(should|must)\s+be\s+noted\b",
            r"\bit\s+is\s+recommended\s+that\b",
            r"\bis\s+designed\s+to\b",
        ],
        cased: false,
    },
    Rule {
        id: "claudish-structure",
        label: "Claudish structural tell",
        severity: Severity::Medium,
        fix: "Simplify. 'Whether X or Y' is often a false dichotomy - pick one. 'Think of it as' is condescending. See SKILL.md B13.",
        patterns: &[
            r"\bwhether\s+you'?re\b[^.?!]{5,60}?\bor\b",
            r"\bthink\s+of\s+(it|this)\s+as\b",
            r"\bin\s+other\s+words\b",
            r"\bput\s+(simply|differently|another\s+way)\b",
            r"\bto\s+put\s+(it|this)\s+(simply|differently|another\s+way|in\s+perspective)\b",
        ],
        cased: false,
    },
    // ---- LOW: bold-label bullets (Tier-2 cluster is handled per file) ----
    Rule {
        id: "bold-label-bullet",
        label: "Bold-label bullet (**Term:** prefix)",
        severity: Severity::Low,
        fix: "Reserve **Bold:** bullet prefixes for reference material; not every bullet needs one. See SKILL.md B9.",
        patterns: &[
            r"^\s*[-*+]\s+\*\*[^*]{1,40}\*\*\s*:",
            r"^\s*[-*+]\s+\*\*[^*]{1,40}:\s*\*\*",
        ],
        cased: true,
    },
];

/// Tier-2 cluster words: not flagged singly, only when three or more distinct
/// ones appear in a single file (B5).
pub const TIER2: &[&str] = &[
    "crucial",
    "notable",
    "noteworthy",
    "remarkable",
    "fascinating",
    "profound",
    "compelling",
    "intriguing",
    "elegant",
    "meticulous",
    "intricate",
    "deliberate",
    "thoughtful",
    "sophisticated",
    "sprawling",
    "bustling",
    "evocative",
    "poignant",
    "cornerstone",
    "linchpin",
    "bedrock",
    "nexus",
    "interplay",
    "realm",
    "arena",
    "sphere",
    "endeavour",
    "myriad",
    "plethora",
];

/// Transition words for the per-page density check (B10).
pub const TRANSITIONS: &[&str] = &[
    "furthermore",
    "moreover",
    "additionally",
    "consequently",
    "notably",
    "crucially",
    "importantly",
    "ultimately",
    "fundamentally",
    "indeed",
    "significantly",
    "subsequently",
    "accordingly",
];

/// File extensions the prose scanner reads.
pub const EXTS: &[&str] = &["md", "markdown", "mdx", "txt", "rst", "text", "tex"];

/// Directories the prose scanner never descends into.
pub const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "out",
    "vendor",
    "coverage",
    ".svelte-kit",
    ".astro",
    ".turbo",
    ".cache",
    "__pycache__",
    "site-packages",
];

pub const EMDASH: char = '—';
/// Density window for the em-dash and transition budgets (B1, B10).
pub const WORDS_PER_PAGE: f64 = 500.0;
pub const EMDASH_PER_WINDOW: f64 = 2.0;
pub const TRANS_PER_WINDOW: f64 = 2.0;
/// Any line containing this marker is skipped, so a deliberate stylistic
/// choice does not nag the audit.
pub const IGNORE_MARK: &str = "slop-ignore";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_rule_pattern_compiles() {
        for rule in RULES {
            for pattern in rule.patterns {
                let source = if rule.cased {
                    (*pattern).to_string()
                } else {
                    format!("(?i){pattern}")
                };
                regex::Regex::new(&source)
                    .unwrap_or_else(|error| panic!("{}: {pattern}: {error}", rule.id));
            }
        }
    }

    #[test]
    fn rule_ids_are_unique() {
        let mut ids: Vec<&str> = RULES.iter().map(|rule| rule.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), before);
    }

    #[test]
    fn the_table_keeps_its_shape() {
        assert_eq!(RULES.len(), 15);
        assert_eq!(
            RULES
                .iter()
                .filter(|r| r.severity == Severity::High)
                .count(),
            7
        );
        assert_eq!(TIER2.len(), 29);
        assert_eq!(TRANSITIONS.len(), 13);
    }

    #[test]
    fn severity_ordering_and_weights_match_the_python() {
        assert!(Severity::High < Severity::Medium);
        assert_eq!(Severity::High.rank(), 0);
        assert_eq!(Severity::Low.rank(), 2);
        assert_eq!(Severity::High.weight(), 3);
        assert_eq!(Severity::Medium.weight(), 2);
        assert_eq!(Severity::Low.weight(), 1);
        assert_eq!(Severity::parse("medium"), Some(Severity::Medium));
        assert_eq!(Severity::parse("critical"), None);
    }
}
