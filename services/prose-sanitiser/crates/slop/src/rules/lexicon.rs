//! The word lists and density constants the prose scanner works from.
//!
//! Split out of the rule table so the vocabulary can be refreshed without
//! touching the rule structure around it: these are the parts that decay.
//! Every change here needs a [`super::CHANGELOG`] entry and a
//! [`super::RULESET_VERSION`] bump.

/// Tier-2 cluster words: not flagged singly, only when three or more distinct
/// ones appear in a single file.
///
/// Reviewed 2026-09-03 against the excess-vocabulary studies. The list is
/// deliberately unchanged: every entry still appears in the published excess
/// sets, and each is an ordinary English word whose signal is the *stacking*,
/// not the occurrence. Flagging any of them singly would be a false-positive
/// generator on human prose.
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

/// Transition words for the per-page density check.
///
/// Reviewed 2026-09-03; unchanged. These are legitimate connectives, so the
/// rule is a density budget rather than a ban.
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

/// The Unicode em-dash.
pub const EMDASH: char = '—';
/// Density window for the em-dash and transition budgets.
pub const WORDS_PER_PAGE: f64 = 500.0;
/// Em-dashes permitted per [`WORDS_PER_PAGE`].
///
/// Two per 500 words is 40 per 10,000, well above both the January 2023 rate of
/// 5.79 and the January 2026 rate of 11.19 that the Pew tracking measured. The
/// budget is a house-style ceiling on a stylistic tic, not a detection
/// threshold; [`crate::structural`] carries the measured rate for comparison.
pub const EMDASH_PER_WINDOW: f64 = 2.0;
/// Transition words permitted per [`WORDS_PER_PAGE`].
pub const TRANS_PER_WINDOW: f64 = 2.0;
/// Any line containing this marker is skipped, so a deliberate stylistic
/// choice does not nag the audit.
///
/// The workspace-wide directives in [`prose_sanitiser_core::Suppressions`] are
/// the general mechanism; this one predates them and stays for compatibility.
pub const IGNORE_MARK: &str = "slop-ignore";
