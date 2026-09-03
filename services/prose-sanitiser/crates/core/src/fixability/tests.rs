use super::*;

#[test]
fn the_default_mapping_follows_the_tier() {
    assert_eq!(
        Fixability::default_for(ConfidenceTier::CertainMechanical),
        Fixability::Mechanical
    );
    assert_eq!(
        Fixability::default_for(ConfidenceTier::HighConfidenceStylistic),
        Fixability::OptIn
    );
    assert_eq!(
        Fixability::default_for(ConfidenceTier::LowConfidenceJudgement),
        Fixability::ReportOnly
    );
}

#[test]
fn the_default_mapping_preserves_the_tiers_fix_permissions() {
    // The axis must not quietly widen what a tier already allowed.
    for tier in [
        ConfidenceTier::CertainMechanical,
        ConfidenceTier::HighConfidenceStylistic,
        ConfidenceTier::LowConfidenceJudgement,
    ] {
        let derived = Fixability::default_for(tier);
        assert_eq!(derived.auto_fixable(), tier.auto_fixable(), "{tier:?}");
        assert_eq!(
            derived.fixable_with_opt_in(),
            tier.fixable_with_opt_in(),
            "{tier:?}"
        );
    }
}

#[test]
fn the_bare_default_is_the_safe_one() {
    // A field that gains a value by `#[serde(default)]` or `..Default::default()`
    // must never become fixable by accident.
    assert_eq!(Fixability::default(), Fixability::ReportOnly);
    assert!(!Fixability::default().auto_fixable());
}

#[test]
fn no_fix_exists_is_never_applied_under_any_setting() {
    assert!(!Fixability::NoFixExists.auto_fixable());
    assert!(!Fixability::NoFixExists.fixable_with_opt_in());
    assert!(Fixability::NoFixExists.is_impossible());
}

#[test]
fn only_no_fix_exists_claims_impossibility() {
    for other in [
        Fixability::Mechanical,
        Fixability::OptIn,
        Fixability::ReportOnly,
    ] {
        assert!(!other.is_impossible(), "{other:?}");
    }
}

#[test]
fn every_variant_round_trips_through_its_wire_form() {
    for value in [
        Fixability::Mechanical,
        Fixability::OptIn,
        Fixability::ReportOnly,
        Fixability::NoFixExists,
    ] {
        assert_eq!(Fixability::parse(value.as_str()), Some(value));
    }
    assert_eq!(Fixability::parse("sometimes"), None);
}

#[test]
fn opt_in_needs_the_opt_in() {
    assert!(!Fixability::OptIn.auto_fixable());
    assert!(Fixability::OptIn.fixable_with_opt_in());
}
