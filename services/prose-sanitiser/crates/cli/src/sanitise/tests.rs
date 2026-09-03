use super::*;
use prose_sanitiser_core::Fixability;

fn finding(rule: &str, tier: ConfidenceTier, start: usize, end: usize) -> Finding {
    Finding {
        rule_id: rule.to_string(),
        label: "test".to_string(),
        span: Span::new(start, end),
        matched: String::new(),
        severity: Severity::High,
        confidence: tier,
        advice: String::new(),
        replacement: Some(String::new()),
    }
}

fn outcome(findings: Vec<Finding>, text: Option<&str>) -> FileOutcome {
    FileOutcome {
        path: PathBuf::from("post.md"),
        kind: Kind::Text,
        findings,
        text: text.map(str::to_string),
    }
}

#[test]
fn line_and_column_are_one_based() {
    let text = "one\ntwo three\n";
    assert_eq!(line_and_column(text, 0), (1, 1));
    assert_eq!(line_and_column(text, 4), (2, 1));
    assert_eq!(line_and_column(text, 8), (2, 5));
    // Past the end clamps rather than panicking.
    assert_eq!(line_and_column(text, 9_999), (3, 1));
}

#[test]
fn line_and_column_count_characters_not_bytes() {
    let text = "naïve — word";
    let offset = text.find("word").unwrap();
    assert_eq!(line_and_column(text, offset), (1, 9));
}

#[test]
fn prose_layers_run_on_text_and_on_markdown_containers() {
    assert!(is_prose(Path::new("a.txt"), Kind::Text));
    assert!(is_prose(Path::new("a.md"), Kind::Container));
    assert!(is_prose(Path::new("a.HTML"), Kind::Container));
    assert!(!is_prose(Path::new("a.pdf"), Kind::Container));
    assert!(!is_prose(Path::new("a.docx"), Kind::Container));
    assert!(!is_prose(Path::new("a.png"), Kind::Image));
}

#[test]
fn a_named_media_rule_keeps_the_media_crates_own_identity() {
    // The media crate owns the id, the tier and the severity; this crate must
    // not paraphrase any of them.
    let note = "PNG chunk caBX (possible C2PA container)";
    let expected = prose_sanitiser_media::rule_for_finding(note).expect("a named rule");
    let finding = media_finding(note);
    assert_eq!(finding.rule_id, expected.id);
    assert_eq!(finding.confidence, expected.confidence);
    assert_eq!(finding.severity, expected.severity);
    assert_ne!(finding.rule_id, RULE_MEDIA_PROVENANCE);
    assert!(finding.replacement.is_none());
}

#[test]
fn an_unnamed_observation_falls_back_and_stays_report_only() {
    let finding = media_finding("format not fully inspected");
    assert_eq!(finding.rule_id, RULE_MEDIA_PROVENANCE);
    assert_eq!(finding.confidence, ConfidenceTier::LowConfidenceJudgement);
    assert_eq!(finding.severity, Severity::Low);
}

#[test]
fn no_media_finding_ever_carries_a_replacement() {
    // Container surgery belongs to clean-image and clean-file. Whatever tier
    // the media crate assigns, this pass must never offer to rewrite bytes.
    for note in [
        "PNG chunk caBX (possible C2PA container)",
        "JPEG APP11 segment (JUMBF/C2PA common)",
        "byte-scan C2PA markers: c2pa",
        "format not fully inspected",
    ] {
        assert!(media_finding(note).replacement.is_none(), "{note}");
    }
}

#[test]
fn the_driver_table_covers_every_layer() {
    let ids: Vec<&str> = all_rule_meta().iter().map(|meta| meta.id).collect();
    // One rule from each crate that owns any, plus the local fallback.
    assert!(ids.contains(&"tier1-vocab"), "slop missing");
    assert!(ids.contains(&"unicode-invisible"), "unicode missing");
    assert!(ids.contains(&"us-spelling"), "uk missing");
    assert!(
        ids.iter().any(|id| id.starts_with("media-")),
        "media missing"
    );
    assert!(ids.contains(&RULE_MEDIA_PROVENANCE), "fallback missing");
}

#[test]
fn the_driver_table_has_no_duplicate_ids() {
    let mut ids: Vec<&str> = all_rule_meta().iter().map(|meta| meta.id).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), before, "a rule id is documented twice");
}

#[test]
fn every_unicode_rule_reaches_the_driver_table() {
    // The Layer A rules are the only certain-mechanical ones in the pass, so a
    // missing entry silently drops a SARIF `fixes[]` a consumer would offer.
    for rule in prose_sanitiser_unicode::RULES {
        assert!(
            all_rule_meta().iter().any(|meta| meta.id == rule.id),
            "{} missing from the driver table",
            rule.id
        );
    }
}

#[test]
fn the_driver_table_is_built_once() {
    assert_eq!(all_rule_meta().as_ptr(), all_rule_meta().as_ptr());
}

#[test]
fn media_findings_never_produce_an_edit() {
    let outcome = outcome(vec![media_finding("PNG chunk caBX")], None);
    assert!(outcome.patch(&Config::new()).is_empty());
    assert!(outcome.patch(&Config::new().with_write(true)).is_empty());
}

#[test]
fn a_binary_file_is_never_patched_however_the_tiers_fall() {
    let outcome = outcome(
        vec![finding(
            "unicode-invisible",
            ConfidenceTier::CertainMechanical,
            0,
            1,
        )],
        None,
    );
    assert!(outcome.patch(&Config::new()).is_empty());
}

#[test]
fn mechanical_findings_patch_without_an_opt_in() {
    let outcome = outcome(
        vec![finding(
            "unicode-invisible",
            ConfidenceTier::CertainMechanical,
            1,
            2,
        )],
        Some("a\u{200b}b"),
    );
    assert_eq!(outcome.patch(&Config::new()).len(), 1);
}

#[test]
fn stylistic_findings_need_the_write_opt_in() {
    let outcome = outcome(
        vec![finding(
            "us-spelling",
            ConfidenceTier::HighConfidenceStylistic,
            0,
            5,
        )],
        Some("color word"),
    );
    assert!(outcome.patch(&Config::new()).is_empty());
    assert_eq!(outcome.patch(&Config::new().with_write(true)).len(), 1);
}

#[test]
fn judgement_findings_are_never_patched() {
    let outcome = outcome(
        vec![finding(
            "tier1-vocab",
            ConfidenceTier::LowConfidenceJudgement,
            0,
            5,
        )],
        Some("delve here"),
    );
    assert!(outcome.patch(&Config::new()).is_empty());
    assert!(outcome.patch(&Config::new().with_write(true)).is_empty());
}

#[test]
fn the_severity_floor_filters_the_report_and_the_counts() {
    let mut low = finding("tier1-vocab", ConfidenceTier::LowConfidenceJudgement, 0, 1);
    low.severity = Severity::Low;
    let outcome = outcome(
        vec![
            finding("unicode-invisible", ConfidenceTier::CertainMechanical, 2, 3),
            low,
        ],
        Some("abcd"),
    );
    assert_eq!(outcome.reportable(&Config::new()).len(), 2);
    let high_only = Config::new().with_min_severity(Severity::High);
    assert_eq!(outcome.reportable(&high_only).len(), 1);
    assert_eq!(outcome.tier_counts(&high_only), [1, 0, 0]);
    assert_eq!(outcome.tier_counts(&Config::new()), [1, 0, 1]);
}

#[test]
fn entries_locate_findings_in_the_source_text() {
    let text = "one\ntwo delve three\n";
    let start = text.find("delve").unwrap();
    let outcome = outcome(
        vec![finding(
            "tier1-vocab",
            ConfidenceTier::LowConfidenceJudgement,
            start,
            start + 5,
        )],
        Some(text),
    );
    let entries = outcome.entries(&Config::new());
    assert_eq!(entries[0].line, 2);
    assert_eq!(entries[0].column, 5);
    assert_eq!(entries[0].path, "post.md");
}

#[test]
fn entries_for_a_binary_file_carry_no_line() {
    let outcome = outcome(vec![media_finding("PNG chunk caBX")], None);
    assert_eq!(outcome.entries(&Config::new())[0].line, 0);
}

#[test]
fn reading_a_missing_file_is_a_tool_error() {
    let error = read_text(Path::new("/nonexistent/file.md")).unwrap_err();
    assert_eq!(error.code, exit::ERROR);
    let error = kind_of(Path::new("/nonexistent/file.md")).unwrap_err();
    assert_eq!(error.code, exit::ERROR);
}

// ---- fixability -------------------------------------------------------

#[test]
fn the_soft_binding_rule_declares_that_no_fix_exists() {
    let declared = fixability_table()
        .iter()
        .find(|(id, _)| *id == "media-c2pa-soft-binding")
        .map(|(_, fixability)| *fixability);
    assert_eq!(declared, Some(Fixability::NoFixExists));
}

#[test]
fn configure_applies_every_declared_override() {
    let config = configure(Config::new());
    for (rule_id, fixability) in fixability_table() {
        assert_eq!(
            config.fixability_for(rule_id),
            Some(*fixability),
            "{rule_id}"
        );
    }
}

#[test]
fn a_no_fix_finding_is_never_patched_even_with_a_replacement_and_write() {
    // The hazard the axis exists to close: certain detection would otherwise
    // make this auto-fixable straight through `to_edit`.
    let mut finding = finding(
        "media-c2pa-soft-binding",
        ConfidenceTier::CertainMechanical,
        0,
        4,
    );
    finding.replacement = Some(String::new());
    let outcome = FileOutcome {
        path: PathBuf::from("a.md"),
        kind: Kind::Text,
        findings: vec![finding],
        text: Some("abcd".to_string()),
    };

    // Unconfigured, the tier alone would allow it.
    assert_eq!(outcome.patch(&Config::new()).len(), 1);
    // Configured, it never applies, with or without --write.
    let config = configure(Config::new());
    assert!(outcome.patch(&config).is_empty());
    assert!(outcome.patch(&config.clone().with_write(true)).is_empty());
}

#[test]
fn entries_resolve_fixability_against_the_configuration() {
    let outcome = FileOutcome {
        path: PathBuf::from("a.png"),
        kind: Kind::Image,
        findings: vec![finding(
            "media-c2pa-soft-binding",
            ConfidenceTier::CertainMechanical,
            0,
            0,
        )],
        text: None,
    };
    let entries = outcome.entries(&configure(Config::new()));
    assert_eq!(entries[0].fixability, Fixability::NoFixExists);
    // The tier still tells the truth about the detection.
    assert_eq!(
        entries[0].finding.confidence,
        ConfidenceTier::CertainMechanical
    );
}

#[test]
fn an_ordinary_finding_still_takes_its_tiers_default() {
    let outcome = FileOutcome {
        path: PathBuf::from("a.md"),
        kind: Kind::Text,
        findings: vec![finding(
            "unicode-invisible",
            ConfidenceTier::CertainMechanical,
            0,
            1,
        )],
        text: Some("ab".to_string()),
    };
    let entries = outcome.entries(&configure(Config::new()));
    assert_eq!(entries[0].fixability, Fixability::Mechanical);
}

// ---- the write-eligibility invariant --------------------------------------
//
// One rule, stated once and checked over every rule table in the workspace:
// **a rule a caller may act on must be able to hand them something to act
// with.** `Fixability::Mechanical` and `Fixability::OptIn` are promises that a
// repair exists; `ReportOnly` and `NoFixExists` are promises that it does not.
// A rule that carries the first pair and never produces a `replacement` is
// telling a write-enabled caller it may rewrite text it has no rewrite for.
//
// That was not hypothetical. Measured on 2,000 documents of British human
// prose, 683 findings across `agg`, `negative-parallelism` and `us-spelling`
// were marked opt-in; every `agg` and `negative-parallelism` one carried
// `replacement: null` and could not have been applied by anything. The labels
// have been corrected in the tables; this test is what keeps them corrected.

/// Filler that carries no tell, for padding a document to a measurable length.
///
/// The structural measures report rates per 10,000 words and refuse to speak
/// below 250, so a fixture for one of them has to be a document rather than a
/// sentence. Sentence lengths vary here on purpose, so that padding alone does
/// not trip the burstiness floor in every fixture that uses it.
fn filler(words: usize) -> String {
    const SENTENCES: &[&str] = &[
        "The team met on Tuesday to review the deployment log and agreed on three changes.",
        "Latency fell.",
        "A second reader checked the figures against the source and found no discrepancy.",
        "The build was red for an hour, then green, and nobody could say why it recovered.",
        "It held.",
    ];
    let mut out = String::new();
    let mut count = 0usize;
    let mut index = 0usize;
    while count < words {
        let sentence = SENTENCES[index % SENTENCES.len()];
        out.push_str(sentence);
        out.push(' ');
        count += sentence.split_whitespace().count();
        index += 1;
    }
    out
}

/// A document per rule, written to make exactly that rule fire.
///
/// The coverage assertion below fails if a rule in any table is not exercised
/// here, so a new rule cannot join a table without stating which side of the
/// invariant it is on.
fn rule_fixtures() -> Vec<(&'static str, String)> {
    let mut fixtures: Vec<(&'static str, String)> = [
        ("preamble-label", "Put simply, the deployment failed.\n"),
        ("insider-voice", "The wording leaves us room to move later.\n"),
        ("tier1-vocab", "We delve into the robust and seamless design.\n"),
        ("the-heading", "# The deployment pipeline\n"),
        ("the-opener", "The pipeline failed twice this week.\n"),
        (
            "negative-parallelism",
            "This is not just a change of tooling, but a change of habit.\n",
        ),
        ("throat-clearing", "In the world of deployment, timing matters.\n"),
        ("sycophantic-filler", "Great question, and the answer is no.\n"),
        ("claudish-filler", "Let's break this down into its parts.\n"),
        ("hedge-words", "It is basically a rounding error.\n"),
        ("copula-substitution", "The release marks the end of the migration.\n"),
        ("passive-tell", "It should be noted that the build was red.\n"),
        ("claudish-structure", "Think of it as a queue with one reader.\n"),
        ("bold-label-bullet", "- **Latency**: the number that moved.\n"),
        ("us-spelling", "The color of the panel was wrong.\n"),
        ("us-spelling-sense", "We must practice restraint here.\n"),
    ]
    .into_iter()
    .map(|(rule, body)| (rule, body.to_string()))
    .collect();

    // The whole-file measures need length and density rather than a phrase.
    let pad = filler(300);
    fixtures.push((
        "agg",
        format!("{pad}\nOne thought — then another — and a third — and a fourth.\n"),
    ));
    fixtures.push((
        "structural-emdash-density",
        format!("{pad}\nOne thought — then another — and a third — and a fourth.\n"),
    ));
    fixtures.push((
        "structural-oxford-comma-density",
        format!("{pad}\nWe shipped logs, metrics, and traces. We kept red, green, and amber. We read one, two, and three.\n"),
    ));
    fixtures.push((
        "structural-negative-parallelism-density",
        format!("{pad}\nIt is not just faster, but cheaper. It is not only smaller, but simpler.\n"),
    ));
    fixtures.push((
        "structural-tricolon-density",
        format!("{pad}\nIt was fast, cheap, and small. It was red, green, and amber. It was one, two, and three. It was here, there, and everywhere.\n"),
    ));
    fixtures.push((
        "structural-sentence-variance",
        // Every sentence the same length: the burstiness floor is a measure of
        // how little sentence length moves.
        "The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log. \
         The team met on Tuesday to review the log. The team met on Tuesday to review the log.\n"
            .to_string(),
    ));
    fixtures.push((
        "structural-paragraph-uniformity",
        // Five paragraphs of identical length, which is what the measure wants
        // and what real documents almost never have.
        std::iter::repeat_n(filler(60), 6).collect::<Vec<_>>().join("\n\n"),
    ));
    fixtures
}

/// Text findings the Unicode layer produces, which the slop scanner never sees.
const UNICODE_FIXTURES: &[&str] = &[
    // A zero-width space, a Cyrillic homoglyph, a soft hyphen and a stray
    // isolate: one fixture per rule the layer can report.
    "the zero\u{200B}width carrier",
    "the p\u{0430}yment page",
    "a soft\u{00AD}hyphen inside a word",
    "an isolate \u{2066}without a closer",
];

/// Rules repaired by rewriting a whole file rather than by substituting a span.
///
/// These emit no `Finding` at all, so the invariant cannot be tested on them
/// and does not apply: the repair is the cleaned file, and a `replacement` is
/// the wrong shape for it. Every media rule is in this class, and so are the
/// three Unicode payload rules, which are catalogue entries for the stego
/// report rather than per-span findings.
///
/// The list is asserted to be exactly the set of rules that produced nothing,
/// so a rule cannot drift into it by quietly ceasing to fire.
fn whole_file_repair() -> Vec<&'static str> {
    let mut ids: Vec<&'static str> = prose_sanitiser_media::RULES
        .iter()
        .map(|rule| rule.id)
        .collect();
    ids.extend([
        "unicode-vs-payload",
        "unicode-tag-payload",
        "unicode-zw-payload",
        RULE_MEDIA_PROVENANCE,
    ]);
    ids
}

/// Every finding the text layers produce over [`rule_fixtures`].
fn fixture_findings() -> Vec<Finding> {
    let directory = tempfile::tempdir().expect("a temporary directory");
    for (index, (rule, body)) in rule_fixtures().iter().enumerate() {
        let name = format!("{index:02}-{rule}.md");
        std::fs::write(directory.path().join(name), body).expect("the fixture writes");
    }

    // The file scanner rather than the in-memory checker, because the
    // whole-file aggregates under `agg` are only produced by a file pass.
    let mut findings: Vec<Finding> = prose_sanitiser_slop::prose::scan_with(
        directory.path(),
        prose_sanitiser_slop::rules::Severity::Low,
        true,
    )
    .findings
    .iter()
    .map(|finding| finding.to_report_entry().finding)
    .collect();

    // Folding on, so a homoglyph finding carries the replacement it can offer;
    // off, the rule reports without one by design and the invariant would read
    // that as a rule with no repair.
    let policy = prose_sanitiser_unicode::check::TextPolicy {
        fold_homoglyphs: true,
        normalize_spaces: true,
        ..Default::default()
    };
    for fixture in UNICODE_FIXTURES {
        findings.extend(prose_sanitiser_unicode::check_text(fixture, &policy));
    }
    findings
}

#[test]
fn a_write_eligible_rule_offers_a_replacement_and_a_report_only_rule_never_does() {
    let config = configure(Config::new());
    let findings = fixture_findings();
    assert!(!findings.is_empty(), "the fixtures produced no findings");

    for rule in all_rule_meta() {
        let mine: Vec<&Finding> = findings
            .iter()
            .filter(|finding| finding.rule_id == rule.id)
            .collect();
        if mine.is_empty() {
            continue;
        }
        let fixability = mine[0].fixability(&config);
        let offered = mine.iter().filter(|f| f.replacement.is_some()).count();

        if fixability.fixable_with_opt_in() {
            assert!(
                offered > 0,
                "{} is {} but offered no replacement on any of its {} findings",
                rule.id,
                fixability.as_str(),
                mine.len()
            );
        } else {
            assert_eq!(
                offered,
                0,
                "{} is {} yet offered {offered} replacements",
                rule.id,
                fixability.as_str()
            );
        }
    }
}

#[test]
fn every_rule_is_either_exercised_or_declared_whole_file() {
    let findings = fixture_findings();
    let fired: Vec<&str> = findings
        .iter()
        .map(|finding| finding.rule_id.as_str())
        .collect();
    let exempt = whole_file_repair();

    let missing: Vec<&str> = all_rule_meta()
        .iter()
        .map(|rule| rule.id)
        .filter(|id| !fired.contains(id) && !exempt.contains(id))
        .collect();
    assert!(
        missing.is_empty(),
        "no fixture exercises these rules, and none is declared whole-file: {missing:?}"
    );
}

#[test]
fn no_rule_that_fires_is_listed_as_whole_file_repair() {
    // The other half of the coverage claim: the exemption list must be the set
    // of rules that genuinely produce no finding, not a place to park one.
    let findings = fixture_findings();
    for id in whole_file_repair() {
        assert!(
            !findings.iter().any(|finding| finding.rule_id == id),
            "{id} is listed as whole-file repair but produced a finding"
        );
    }
}

#[test]
fn every_declared_fixability_names_a_real_rule() {
    for (rule_id, _) in fixability_table() {
        assert!(
            all_rule_meta().iter().any(|rule| rule.id == *rule_id),
            "{rule_id} is declared but is in no rule table"
        );
    }
}

#[test]
fn no_slop_rule_is_write_eligible() {
    // The crate emits no replacement anywhere, so nothing it owns may claim a
    // repair exists. Stated separately from the fixture test because it holds
    // for rules the fixtures happen not to reach.
    let config = configure(Config::new());
    for (rule_id, _) in prose_sanitiser_slop::FIXABILITY {
        assert!(
            !config
                .fixability_for(rule_id)
                .expect("declared rules resolve")
                .fixable_with_opt_in(),
            "{rule_id} is still write-eligible"
        );
    }
}

