//! The per-line rule table.
//!
//! Mirrors Section B of the prose-sanitiser SKILL.md (lexical, structural and
//! spelling tells). These are the MECHANICAL tells only; narrative defaults
//! (Section C) and altitude/voice need a human read.
//!
//! Every rule carries its dates, its tier and its sources. See
//! [`super::CHANGELOG`] for what changed and why.

use prose_sanitiser_core::ConfidenceTier;

use super::sources::{HOUSE_STYLE, JUZEK, KOBAK, PEW, WIKIPEDIA};
use super::{uk, Rule, Severity};

/// When the table was first written, ported from the Python skill.
const V1: &str = "2026-01-14";
/// When the tables were last checked against their sources in full.
const REVIEWED: &str = "2026-09-03";

/// Report only: no lexical marker is ever safe to act on unread.
const JUDGEMENT: ConfidenceTier = ConfidenceTier::LowConfidenceJudgement;
/// A structural tell strong enough to gate an opt-in fix, never an automatic one.
const STYLISTIC: ConfidenceTier = ConfidenceTier::HighConfidenceStylistic;

pub const RULES: &[Rule] = &[
    Rule {
        id: "preamble-label",
        label: "Preamble setup label (announcing the explanation)",
        severity: Severity::Medium,
        confidence: JUDGEMENT,
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
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE, WIKIPEDIA],
    },
    Rule {
        id: "insider-voice",
        label: "Insider voice in external document (audience leakage)",
        severity: Severity::Medium,
        confidence: JUDGEMENT,
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
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    // ---- HIGH: Tier-1 vocabulary and the strongest structural tells ----
    Rule {
        id: "tier1-vocab",
        label: "Tier-1 banned vocabulary",
        severity: Severity::High,
        confidence: JUDGEMENT,
        fix: "Replace with a plain word (delve->look at, leverage->use, robust->solid, seamless->smooth, utilise->use). See SKILL.md B4.",
        // Refreshed 2026-09-03. The 2026-01-14 alternation matched bare stems
        // only, so `delves` - the single most-cited marker in its commonest
        // inflection - went unreported. Additions are limited to markers with a
        // published excess-frequency measurement; ordinary high-frequency verbs
        // such as `navigate` and `tackle` appear in the excess sets but are left
        // out, because their false-positive cost on human prose outweighs the
        // signal.
        patterns: &[
            r"\b(delve(?:s|d)?|delving|leverage|leverages|leveraging|leveraged|robust|seamless|seamlessly|comprehensive|cutting-edge|transformative|groundbreaking|innovative|holistic|testament|tapestry|vibrant|showcase(?:s|d)?|showcasing|boast(?:s|ed)?|boasting|pivotal|garner(?:s|ed)?|garnering|encompass(?:es|ed)?|encompassing|commendable|invaluable|adept|bolster(?:s|ed)?|bolstering|unravel(?:s|led|ed)?|unravelling|spearhead(?:s|ed|ing)?|utilize|utilise|utilizes|utilises|harness(?:es|ing|ed)?|unlock(?:s|ing|ed)?|unleash(?:es|ing|ed)?|streamline(?:s|d)?|streamlining|empower(?:s|ing|ed|ment)?|elevate(?:s|d)?|elevating|paradigm|unprecedented|synergy|synergies|foster(?:s|ing|ed)?|underscore(?:s|d)?|underscoring|game-changing|enterprise-scale|enterprise-grade|extraordinary|honest(?:ly)?|honesty)\b",
        ],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[KOBAK, JUZEK, PEW],
    },
    Rule {
        id: "the-heading",
        label: "\"The X\" heading",
        severity: Severity::High,
        confidence: STYLISTIC,
        fix: "Drop the leading 'The' unless it is a proper noun (The Guardian). See SKILL.md B2.",
        patterns: &[
            r"^#{1,6}\s+The\s+\S",
            r"\\(?:sub)*section\*?\{The\s",
            r"\\paragraph\*?\{The\s",
            r"\\caption\{The\s",
        ],
        dynamic: None,
        cased: true,
        since: V1,
        reviewed: REVIEWED,
        sources: &[WIKIPEDIA, HOUSE_STYLE],
    },
    // Measured 2026-09-03 on RAID: fires on 41.1 per cent of human documents
    // and 38.0 per cent of machine ones, so as an authorship signal it points
    // very slightly the wrong way. It stays as a house-style rule, demoted to
    // report-only, because that is what the measurement supports.
    Rule {
        id: "the-opener",
        label: "\"The X\" sentence/paragraph opener",
        severity: Severity::High,
        confidence: JUDGEMENT,
        fix: "Don't open with 'The <lowercase noun>'. Recast so the subject leads, or name the thing directly ('The production-node paired study lifts...' -> 'Holding the model constant and varying only the serving path lifts...'). Proper nouns (The Loom) are fine. See SKILL.md B2.",
        // Line-initial "The" + a lowercase word = the definitional/throat-clearing
        // opener; a capitalised follower (The Loom, The Guardian) is a proper
        // noun and is left alone.
        patterns: &[r"^\s*The\s+[a-z]"],
        dynamic: None,
        cased: true,
        since: V1,
        reviewed: REVIEWED,
        sources: &[WIKIPEDIA, HOUSE_STYLE],
    },
    Rule {
        id: "negative-parallelism",
        label: "Negative parallelism (not X - Y / not just X but Y)",
        severity: Severity::High,
        confidence: STYLISTIC,
        fix: "Lead with the positive claim, or delete the negative half. See SKILL.md B3.",
        patterns: &[
            r"\bnot\s+(just|only|merely|simply)\b[^.?!]{1,60}?(,?\s*but\b|\s+—)",
            r"\bit'?s\s+not\b[^.?!]{1,50}?—",
            r"\bisn'?t\s+(just\s+)?about\b[^.?!]{1,60}?\bit'?s\s+about\b",
            r"\bthis\s+isn'?t\b[^.?!]{1,50}?\bit'?s\b",
        ],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[PEW, WIKIPEDIA],
    },
    Rule {
        id: "throat-clearing",
        label: "Throat-clearing opener",
        severity: Severity::High,
        confidence: JUDGEMENT,
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
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[WIKIPEDIA, HOUSE_STYLE],
    },
    Rule {
        id: "sycophantic-filler",
        label: "Sycophantic filler",
        severity: Severity::High,
        confidence: JUDGEMENT,
        fix: "Delete entirely. See SKILL.md B7.",
        patterns: &[
            r"\byou'?re\s+absolutely\s+right\b",
            r"\bgreat\s+question\b",
            r"\bthat'?s\s+a\s+(really\s+)?(interesting|great)\s+(point|question)\b",
            r"\b(certainly|absolutely)!\B",
            r"\bi'?d\s+be\s+happy\s+to\s+help\b",
        ],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    Rule {
        id: "claudish-filler",
        label: "Claudish filler phrase",
        severity: Severity::High,
        confidence: JUDGEMENT,
        fix: "Cut the filler. Lead with the substance. See SKILL.md B13.",
        patterns: &[
            r"\blet'?s\s+break\s+(this|that|it)\s+down\b",
            r"\bthere\s+are\s+several\s+(key\s+)?(things|aspects|factors|considerations)\b",
            r"\bthis\s+is\s+particularly\s+(important|relevant|noteworthy|interesting)\b",
            r"\bit'?s\s+also\s+worth\s+(mentioning|highlighting|emphasizing|emphasising)\b",
            r"\b(here|this)\s+is\s+where\s+(things|it)\s+(get|gets)\s+(interesting|tricky|complicated)\b",
        ],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    // ---- MEDIUM: hedge words, copula substitution, US spelling ----
    Rule {
        id: "hedge-words",
        label: "Hedge word",
        severity: Severity::Medium,
        confidence: JUDGEMENT,
        fix: "Cut it, or replace with a specific qualifier (\"in staging\", \"for payloads <10KB\"). See SKILL.md B8.",
        patterns: &[r"\b(basically|actually|essentially|fundamentally|somewhat)\b"],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    Rule {
        id: "copula-substitution",
        label: "Copula substitution (serves as / marks the)",
        severity: Severity::Medium,
        confidence: JUDGEMENT,
        fix: "Use 'is'. 'serves as a' -> 'is'; 'marks the' -> 'is'. See SKILL.md B9.",
        patterns: &[
            r"\bserves?\s+as\s+a\b",
            r"\bmarks?\s+the\b",
            r"\bstands?\s+as\s+a\b",
            r"\bacts?\s+as\s+a\b",
            r"\brepresents?\s+a\s+(key|major|significant)\b",
        ],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    // A positional marker, not a pattern rule. The UK-English check is owned
    // entirely by `prose-sanitiser-uk`; the entry exists so the report lists
    // rules in the order it always has, and the scanner consults that crate's
    // checker when it reaches this position. See `super::uk`.
    Rule {
        id: uk::US_SPELLING_ID,
        label: uk::US_SPELLING_LABEL,
        severity: uk::US_SPELLING_SEVERITY,
        confidence: uk::US_SPELLING_CONFIDENCE,
        fix: uk::US_SPELLING_FIX,
        patterns: &[],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    Rule {
        id: "passive-tell",
        label: "Passive / agentless construction",
        severity: Severity::Medium,
        confidence: JUDGEMENT,
        fix: "Make it active. 'can be seen that' -> 'this shows'; 'the decision was made to' -> 'we decided to'. See SKILL.md B11.",
        patterns: &[
            r"\bit\s+can\s+be\s+seen\s+that\b",
            r"\bthe\s+decision\s+was\s+made\s+to\b",
            r"\bit\s+(should|must)\s+be\s+noted\b",
            r"\bit\s+is\s+recommended\s+that\b",
            r"\bis\s+designed\s+to\b",
        ],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    Rule {
        id: "claudish-structure",
        label: "Claudish structural tell",
        severity: Severity::Medium,
        confidence: JUDGEMENT,
        fix: "Simplify. 'Whether X or Y' is often a false dichotomy - pick one. 'Think of it as' is condescending. See SKILL.md B13.",
        patterns: &[
            r"\bwhether\s+you'?re\b[^.?!]{5,60}?\bor\b",
            r"\bthink\s+of\s+(it|this)\s+as\b",
            r"\bin\s+other\s+words\b",
            r"\bput\s+(simply|differently|another\s+way)\b",
            r"\bto\s+put\s+(it|this)\s+(simply|differently|another\s+way|in\s+perspective)\b",
        ],
        dynamic: None,
        cased: false,
        since: V1,
        reviewed: REVIEWED,
        sources: &[HOUSE_STYLE],
    },
    // ---- LOW: bold-label bullets (Tier-2 cluster is handled per file) ----
    Rule {
        id: "bold-label-bullet",
        label: "Bold-label bullet (**Term:** prefix)",
        severity: Severity::Low,
        confidence: STYLISTIC,
        fix: "Reserve **Bold:** bullet prefixes for reference material; not every bullet needs one. See SKILL.md B9.",
        patterns: &[
            r"^\s*[-*+]\s+\*\*[^*]{1,40}\*\*\s*:",
            r"^\s*[-*+]\s+\*\*[^*]{1,40}:\s*\*\*",
        ],
        dynamic: None,
        cased: true,
        since: V1,
        reviewed: REVIEWED,
        sources: &[WIKIPEDIA, HOUSE_STYLE],
    },
];
