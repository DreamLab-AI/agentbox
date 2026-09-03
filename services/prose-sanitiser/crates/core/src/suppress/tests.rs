use super::*;
use crate::finding::{ConfidenceTier, Severity};

fn finding(rule_id: &str, start: usize, end: usize) -> Finding {
    Finding {
        rule_id: rule_id.to_string(),
        label: "test".to_string(),
        span: Span::new(start, end),
        matched: String::new(),
        severity: Severity::Low,
        confidence: ConfidenceTier::LowConfidenceJudgement,
        advice: String::new(),
        replacement: None,
    }
}

#[test]
fn a_bare_block_suppresses_every_rule_until_enable() {
    let document = "a\n<!-- prose-sanitiser-disable -->\nb\n<!-- prose-sanitiser-enable -->\nc\n";
    let suppressions = Suppressions::parse(document);
    let inside = document.find("\nb\n").unwrap() + 1;
    let after = document.rfind('c').unwrap();
    assert!(suppressions.is_suppressed("any-rule", inside));
    assert!(!suppressions.is_suppressed("any-rule", 0));
    assert!(!suppressions.is_suppressed("any-rule", after));
}

#[test]
fn a_named_block_leaves_other_rules_alone() {
    let document = "<!-- prose-sanitiser-disable tier1-vocab -->\ntext\n";
    let suppressions = Suppressions::parse(document);
    let offset = document.find("text").unwrap();
    assert!(suppressions.is_suppressed("tier1-vocab", offset));
    assert!(!suppressions.is_suppressed("hedge-words", offset));
}

#[test]
fn several_rules_may_share_one_directive() {
    let document = "<!-- prose-sanitiser-disable tier1-vocab, hedge-words -->\ntext\n";
    let suppressions = Suppressions::parse(document);
    let offset = document.find("text").unwrap();
    assert!(suppressions.is_suppressed("tier1-vocab", offset));
    assert!(suppressions.is_suppressed("hedge-words", offset));
    assert!(!suppressions.is_suppressed("the-opener", offset));
}

#[test]
fn a_named_enable_cannot_reopen_a_blanket_block() {
    let document =
        "<!-- prose-sanitiser-disable -->\na\n<!-- prose-sanitiser-enable tier1-vocab -->\nb\n";
    let suppressions = Suppressions::parse(document);
    let after = document.rfind('b').unwrap();
    assert!(suppressions.is_suppressed("hedge-words", after));
}

#[test]
fn disable_line_covers_only_its_own_line() {
    let document = "one\ntwo <!-- prose-sanitiser-disable-line tier1-vocab -->\nthree\n";
    let suppressions = Suppressions::parse(document);
    assert!(suppressions.is_suppressed("tier1-vocab", document.find("two").unwrap()));
    assert!(!suppressions.is_suppressed("tier1-vocab", document.find("one").unwrap()));
    assert!(!suppressions.is_suppressed("tier1-vocab", document.find("three").unwrap()));
}

#[test]
fn disable_next_line_covers_the_line_after() {
    let document = "<!-- prose-sanitiser-disable-next-line tier1-vocab -->\ntarget\nafter\n";
    let suppressions = Suppressions::parse(document);
    assert!(suppressions.is_suppressed("tier1-vocab", document.find("target").unwrap()));
    assert!(!suppressions.is_suppressed("tier1-vocab", document.find("after").unwrap()));
}

#[test]
fn the_vale_spellings_are_accepted() {
    let document = "<!-- prose-sanitiser off -->\nx\n<!-- prose-sanitiser on -->\ny\n";
    let suppressions = Suppressions::parse(document);
    assert!(suppressions.is_suppressed("anything", document.find('x').unwrap()));
    assert!(!suppressions.is_suppressed("anything", document.rfind('y').unwrap()));

    let ignore = "line <!-- prose-sanitiser:ignore tier1-vocab -->\nnext\n";
    let parsed = Suppressions::parse(ignore);
    assert!(parsed.is_suppressed("tier1-vocab", 0));
    assert!(!parsed.is_suppressed("tier1-vocab", ignore.find("next").unwrap()));
}

#[test]
fn an_unterminated_block_runs_to_the_end() {
    let document = "<!-- prose-sanitiser-disable -->\ntail";
    let suppressions = Suppressions::parse(document);
    assert!(suppressions.is_suppressed("anything", document.len() - 1));
}

#[test]
fn a_plain_comment_is_not_a_directive() {
    let suppressions = Suppressions::parse("<!-- just a note -->\ntext\n");
    assert!(suppressions.is_empty());
    let unknown = Suppressions::parse("<!-- prose-sanitiser-frobnicate -->\ntext\n");
    assert!(unknown.is_empty());
}

#[test]
fn filter_drops_only_the_suppressed_findings() {
    let document = "aaaa\n<!-- prose-sanitiser-disable tier1-vocab -->\nbbbb\n";
    let suppressions = Suppressions::parse(document);
    let inside = document.find("bbbb").unwrap();
    let kept = suppressions.filter(vec![
        finding("tier1-vocab", 0, 4),
        finding("tier1-vocab", inside, inside + 4),
        finding("hedge-words", inside, inside + 4),
    ]);
    assert_eq!(kept.len(), 2);
    assert_eq!(kept[0].span, Span::new(0, 4));
    assert_eq!(kept[1].rule_id, "hedge-words");
}

#[test]
fn an_empty_set_returns_the_findings_untouched() {
    let suppressions = Suppressions::new();
    let kept = suppressions.filter(vec![finding("tier1-vocab", 0, 4)]);
    assert_eq!(kept.len(), 1);
}

#[test]
fn an_unclosed_comment_does_not_loop_or_panic() {
    let suppressions = Suppressions::parse("text <!-- prose-sanitiser-disable ");
    assert!(suppressions.is_empty());
}
