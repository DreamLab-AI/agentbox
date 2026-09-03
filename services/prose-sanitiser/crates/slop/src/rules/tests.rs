use super::*;

#[test]
fn every_rule_pattern_compiles() {
    for rule in RULES {
        for pattern in rule.pattern_sources() {
            let source = if rule.cased {
                pattern.to_string()
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

#[test]
fn no_slop_rule_claims_mechanical_certainty() {
    for rule in RULES {
        assert_ne!(
            rule.confidence,
            ConfidenceTier::CertainMechanical,
            "{} claims mechanical certainty; nothing in slop may",
            rule.id
        );
    }
    for meta in rule_meta() {
        assert_ne!(
            meta.confidence,
            ConfidenceTier::CertainMechanical,
            "{} claims mechanical certainty",
            meta.id
        );
    }
}

#[test]
fn every_lexical_rule_is_report_only() {
    // The structural tells are the only rules allowed above judgement level,
    // and `the-opener` was demoted out of that set on 2026-09-03 after it
    // measured as anti-discriminating on RAID.
    const STRUCTURAL: &[&str] = &["the-heading", "negative-parallelism", "bold-label-bullet"];
    for rule in RULES {
        let expected = if STRUCTURAL.contains(&rule.id) {
            ConfidenceTier::HighConfidenceStylistic
        } else {
            ConfidenceTier::LowConfidenceJudgement
        };
        assert_eq!(rule.confidence, expected, "{}", rule.id);
    }
}

#[test]
fn every_rule_is_dated_and_sourced() {
    for rule in RULES {
        assert_eq!(rule.since.len(), 10, "{} since is not ISO-8601", rule.id);
        assert_eq!(
            rule.reviewed.len(),
            10,
            "{} reviewed is not ISO-8601",
            rule.id
        );
        assert!(
            rule.reviewed >= rule.since,
            "{} reviewed precedes since",
            rule.id
        );
        assert!(!rule.sources.is_empty(), "{} cites nothing", rule.id);
    }
}

#[test]
fn the_whole_table_was_reviewed_at_the_ruleset_date() {
    for rule in RULES {
        assert_eq!(rule.reviewed, RULESET_REVIEWED, "{}", rule.id);
    }
}

#[test]
fn the_changelog_leads_with_the_current_version() {
    assert_eq!(CHANGELOG[0].version, RULESET_VERSION);
    assert_eq!(CHANGELOG[0].date, RULESET_REVIEWED);
    for entry in CHANGELOG {
        assert!(!entry.notes.is_empty(), "{} has no notes", entry.version);
    }
    // Newest first.
    for pair in CHANGELOG.windows(2) {
        assert!(pair[0].date > pair[1].date);
    }
}

#[test]
fn rule_meta_covers_every_rule_the_scanner_can_emit() {
    let meta = rule_meta();
    for rule in RULES {
        assert!(
            meta.iter().any(|entry| entry.id == rule.id),
            "{} missing from rule_meta()",
            rule.id
        );
    }
    assert!(meta.iter().any(|entry| entry.id == "agg"));
    for structural in crate::structural::STRUCTURAL_RULES {
        assert!(meta.iter().any(|entry| entry.id == structural.id));
    }
    // Built once, leaked once.
    assert_eq!(rule_meta().as_ptr(), meta.as_ptr());
}

#[test]
fn rule_meta_ids_are_unique() {
    let mut ids: Vec<&str> = rule_meta().iter().map(|entry| entry.id).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), before);
}

#[test]
fn the_refreshed_lexicon_catches_the_inflections_the_old_table_missed() {
    let rule = RULES
        .iter()
        .find(|rule| rule.id == "tier1-vocab")
        .expect("tier1-vocab is in the table");
    let pattern = regex::Regex::new(&format!("(?i){}", rule.pattern_sources()[0])).unwrap();
    // The 2026.01.14 alternation matched the bare stem only.
    for word in ["delve", "delves", "delved", "delving"] {
        assert!(pattern.is_match(word), "{word} should match");
    }
    for word in ["showcasing", "boasts", "pivotal", "garnered", "encompasses"] {
        assert!(pattern.is_match(word), "{word} should match");
    }
    // Ordinary English left out on purpose: the false-positive cost outweighs
    // the published signal.
    for word in ["navigate", "tackle", "align", "delegate"] {
        assert!(!pattern.is_match(word), "{word} should not match");
    }
}

#[test]
fn the_opener_is_report_only_because_it_measured_badly() {
    let rule = RULES
        .iter()
        .find(|rule| rule.id == "the-opener")
        .expect("the-opener is in the table");
    assert_eq!(rule.confidence, ConfidenceTier::LowConfidenceJudgement);
}

#[test]
fn the_ruleset_version_is_date_shaped() {
    let parts: Vec<&str> = RULESET_VERSION.split('.').collect();
    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0].len(), 4);
    assert!(RULESET_VERSION
        .replace('.', "")
        .chars()
        .all(|c| c.is_ascii_digit()));
}
