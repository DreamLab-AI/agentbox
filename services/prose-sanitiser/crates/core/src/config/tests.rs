use super::*;

#[test]
fn an_empty_file_changes_nothing() {
    let file = ConfigFile::from_toml_str("").unwrap();
    assert_eq!(file, ConfigFile::default());
    assert_eq!(file.merge_into(Config::new()), Config::new());
}

#[test]
fn every_field_round_trips() {
    let file = ConfigFile::from_toml_str(
        r#"
        write = true
        min_severity = "medium"
        oxford = true
        language_filter = false
        suppressions = false
        disabled_rules = ["us-spelling", "hedge-words"]
        "#,
    )
    .unwrap();
    let config = file.merge_into(Config::new());
    assert!(config.write);
    assert_eq!(config.min_severity, Severity::Medium);
    assert!(config.oxford);
    assert!(!config.language.is_enabled());
    assert!(!config.suppressions);
    assert!(!config.rule_enabled("us-spelling"));
    assert!(!config.rule_enabled("hedge-words"));
    assert!(config.rule_enabled("tier1-vocab"));
}

#[test]
fn unset_keys_keep_the_base_values() {
    let base = Config::new().with_write(true).with_oxford(true);
    let file = ConfigFile::from_toml_str(r#"min_severity = "high""#).unwrap();
    let config = file.merge_into(base);
    assert!(config.write);
    assert!(config.oxford);
    assert_eq!(config.min_severity, Severity::High);
}

#[test]
fn a_disabled_rule_list_replaces_rather_than_extends() {
    let base = Config::new().without_rule("the-opener");
    let file = ConfigFile::from_toml_str(r#"disabled_rules = ["us-spelling"]"#).unwrap();
    let config = file.merge_into(base);
    assert!(config.rule_enabled("the-opener"));
    assert!(!config.rule_enabled("us-spelling"));
}

#[test]
fn an_unknown_key_is_an_error_rather_than_a_silent_no_op() {
    let error = ConfigFile::from_toml_str("wrte = true").unwrap_err();
    assert!(matches!(error, ConfigError::Parse(_)));
    assert!(error.to_string().contains("cannot parse configuration"));
}

#[test]
fn a_bad_severity_is_reported_against_the_file() {
    let error = ConfigFile::from_toml_str(r#"min_severity = "critical""#).unwrap_err();
    assert!(matches!(error, ConfigError::Value(_)));
    assert!(error.to_string().contains("high, medium or low"));
}

#[test]
fn malformed_toml_is_an_error() {
    assert!(ConfigFile::from_toml_str("write = ").is_err());
}

#[test]
fn the_searched_file_names_are_stable() {
    assert_eq!(
        CONFIG_FILE_NAMES,
        [".prose-sanitiser.toml", "prose-sanitiser.toml"]
    );
}
