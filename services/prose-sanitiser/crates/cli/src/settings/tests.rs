use super::*;

#[test]
fn no_file_anywhere_yields_the_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let settings = Settings::discover(dir.path()).unwrap();
    assert_eq!(settings.config, Config::new());
    assert!(settings.source.is_none());
    assert_eq!(settings.describe_source(), "built-in defaults");
}

#[test]
fn the_nearest_file_wins() {
    let dir = tempfile::tempdir().unwrap();
    let nested = dir.path().join("docs").join("posts");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(
        dir.path().join(".prose-sanitiser.toml"),
        "min_severity = \"low\"\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("docs").join(".prose-sanitiser.toml"),
        "min_severity = \"high\"\n",
    )
    .unwrap();

    let settings = Settings::discover(&nested).unwrap();
    assert_eq!(settings.config.min_severity, Severity::High);
    assert!(settings
        .describe_source()
        .ends_with("docs/.prose-sanitiser.toml"));
}

#[test]
fn discovery_starts_at_a_files_directory() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("prose-sanitiser.toml"), "oxford = true\n").unwrap();
    let file = dir.path().join("post.md");
    std::fs::write(&file, "text\n").unwrap();
    assert!(Settings::discover(&file).unwrap().config.oxford);
}

#[test]
fn the_dotted_name_is_searched_before_the_bare_one() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(".prose-sanitiser.toml"), "oxford = true\n").unwrap();
    std::fs::write(dir.path().join("prose-sanitiser.toml"), "oxford = false\n").unwrap();
    assert!(Settings::discover(dir.path()).unwrap().config.oxford);
}

#[test]
fn an_explicit_path_skips_discovery() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(".prose-sanitiser.toml"), "oxford = true\n").unwrap();
    let explicit = dir.path().join("other.toml");
    std::fs::write(&explicit, "oxford = false\nwrite = true\n").unwrap();

    let settings = Settings::resolve(Some(&explicit), dir.path()).unwrap();
    assert!(!settings.config.oxford);
    assert!(settings.config.write);
}

#[test]
fn a_missing_explicit_file_is_a_tool_error() {
    let error = Settings::load(Path::new("/nonexistent/prose-sanitiser.toml")).unwrap_err();
    assert_eq!(error.code, exit::ERROR);
    assert!(error.message.contains("cannot read"));
}

#[test]
fn a_malformed_file_stops_the_run_rather_than_being_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".prose-sanitiser.toml");
    std::fs::write(&path, "min_severity = \"critical\"\n").unwrap();
    let error = Settings::discover(dir.path()).unwrap_err();
    assert_eq!(error.code, exit::ERROR);
    assert!(error.message.contains("high, medium or low"));
}

#[test]
fn an_unpassed_flag_does_not_overwrite_the_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(".prose-sanitiser.toml"),
        "write = true\noxford = true\nmin_severity = \"medium\"\n",
    )
    .unwrap();
    let settings =
        Settings::discover(dir.path())
            .unwrap()
            .apply_flags(None, None, None, None, None, &[]);
    assert!(settings.config.write);
    assert!(settings.config.oxford);
    assert_eq!(settings.config.min_severity, Severity::Medium);
}

#[test]
fn a_passed_flag_beats_the_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(".prose-sanitiser.toml"),
        "write = true\nmin_severity = \"low\"\n",
    )
    .unwrap();
    let settings = Settings::discover(dir.path()).unwrap().apply_flags(
        Some(false),
        Some(Severity::High),
        None,
        Some(false),
        Some(false),
        &["us-spelling".to_string()],
    );
    assert!(!settings.config.write);
    assert_eq!(settings.config.min_severity, Severity::High);
    assert!(!settings.config.language.is_enabled());
    assert!(!settings.config.suppressions);
    assert!(!settings.config.rule_enabled("us-spelling"));
}

#[test]
fn disabled_rules_from_flags_extend_the_file_without_duplicating() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(".prose-sanitiser.toml"),
        "disabled_rules = [\"us-spelling\"]\n",
    )
    .unwrap();
    let settings = Settings::discover(dir.path()).unwrap().apply_flags(
        None,
        None,
        None,
        None,
        None,
        &["us-spelling".to_string(), "hedge-words".to_string()],
    );
    assert_eq!(settings.config.disabled_rules.len(), 2);
    assert!(!settings.config.rule_enabled("hedge-words"));
}
