use super::*;

fn noop(_: &str) {}

#[test]
fn identical_text_has_zero_divergence() {
    assert_eq!(lexical_divergence("the cat sat", "the cat sat"), 0.0);
}

#[test]
fn wholly_different_text_diverges_completely() {
    assert_eq!(lexical_divergence("alpha beta gamma", "one two three"), 1.0);
    assert_eq!(lexical_divergence("", "words here"), 1.0);
    assert_eq!(lexical_divergence("", ""), 0.0);
}

#[test]
fn partial_rewrites_land_between_the_extremes() {
    let score = lexical_divergence("the cat sat on the mat", "the cat perched on the mat");
    assert!(score > 0.0 && score < 1.0, "got {score}");
}

#[test]
fn candidate_selection_prefers_the_most_diverged() {
    let original = "the quick brown fox jumps over the lazy dog";
    let candidates = vec![
        "the quick brown fox jumps over the lazy dog".to_string(),
        "a swift auburn vulpine bounds past a sleepy hound".to_string(),
    ];
    let (best, scores) = select_candidate(original, &candidates);
    assert_eq!(best, candidates[1]);
    assert!(scores[1] > scores[0]);
}

#[test]
fn extreme_length_drift_is_penalised() {
    let original = "a short sentence of prose";
    // Wholly different, but four times the length: penalised by 0.15.
    let long = "totally unrelated wording ".repeat(8);
    let (_, scores) = select_candidate(original, &[long]);
    assert!((scores[0] - 0.85).abs() < 1e-9, "got {}", scores[0]);
}

#[test]
fn loopback_endpoints_need_no_opt_in() {
    for url in [
        "http://127.0.0.1:11434",
        "http://localhost:8080",
        "https://localhost",
    ] {
        assert!(check_remote(url, false).unwrap().is_none(), "{url}");
    }
}

#[test]
fn a_remote_endpoint_is_denied_by_default_and_warns_when_allowed() {
    let error = check_remote("https://api.example.com", false).unwrap_err();
    assert!(error
        .message
        .contains("refusing to send content off-machine"));

    let warning = check_remote("https://api.example.com", true)
        .unwrap()
        .expect("a warning");
    assert!(warning.contains("content will leave this machine"));
}

#[test]
fn non_http_endpoints_are_always_refused() {
    let error = check_remote("file:///etc/passwd", true).unwrap_err();
    assert!(error.message.contains("must be http(s)"));
}

#[test]
fn prompts_are_built_per_strength() {
    let prompt = build_prompt("paraphrase", "BODY", "French", "English", None).unwrap();
    assert!(prompt.contains("BODY"));
    assert!(prompt.starts_with("Rewrite the following text so that it uses"));

    let backtranslate = build_prompt("backtranslate", "BODY", "German", "English", None).unwrap();
    assert!(backtranslate.contains("Translate the text to German"));
    assert!(backtranslate.contains("back to English"));

    let structural = build_prompt("structural", "BODY", "French", "English", None).unwrap();
    assert!(structural.contains("bullet outline"));

    assert!(build_prompt("nonsense", "BODY", "French", "English", None).is_err());
}

#[test]
fn simplify_switches_to_the_markdown_prompt_for_markdown_input() {
    let plain = build_prompt("simplify", "Just prose.", "French", "English", None).unwrap();
    assert!(!plain.contains("Keep all Markdown structure"));

    let heading = build_prompt("simplify", "# Title\n\nBody", "French", "English", None).unwrap();
    assert!(heading.contains("Keep all Markdown structure"));

    let frontmatter = build_prompt(
        "simplify",
        "---\ntitle: x\n---\n",
        "French",
        "English",
        None,
    )
    .unwrap();
    assert!(frontmatter.contains("Keep all Markdown structure"));
}

#[test]
fn context_is_appended_and_clipped() {
    let context = "q".repeat(1000);
    let prompt = build_prompt("paraphrase", "BODY", "French", "English", Some(&context)).unwrap();
    assert!(prompt.contains("For context, the original question"));
    // 800 characters of context, not 1000.
    assert!(prompt.contains(&"q".repeat(800)));
    assert!(!prompt.contains(&"q".repeat(801)));
}

#[test]
fn print_prompt_is_the_default_and_needs_no_model() {
    let options = RewriteOptions::default();
    let (out, info) = rewrite("Some prose to rewrite.", &options, &mut noop).unwrap();
    assert_eq!(info["mode"], "print-prompt");
    assert_eq!(info["backend"], "print-prompt");
    assert!(out.contains("Some prose to rewrite."));
    assert!(out.starts_with("Rewrite the following text"));
}

#[test]
fn a_short_prose_body_is_skipped_when_min_chars_is_set() {
    let options = RewriteOptions {
        min_chars: 100,
        ..RewriteOptions::default()
    };
    let (out, info) = rewrite("Too short.", &options, &mut noop).unwrap();
    assert_eq!(out, "Too short.");
    assert_eq!(info["mode"], "skipped");
    assert!(info["reason"]
        .as_str()
        .unwrap()
        .starts_with("prose length 10"));
}

#[test]
fn code_blocks_do_not_count_toward_the_minimum_prose_length() {
    let body = "Hi.\n\n```\n".to_string() + &"x".repeat(500) + "\n```\n";
    let options = RewriteOptions {
        min_chars: 100,
        ..RewriteOptions::default()
    };
    let (_, info) = rewrite(&body, &options, &mut noop).unwrap();
    assert_eq!(info["mode"], "skipped", "the fence must not pad the count");
}

#[test]
fn a_live_backend_without_a_model_or_url_is_a_clear_error() {
    let options = RewriteOptions {
        backend: Backend::Ollama,
        base_url: Some("http://127.0.0.1:11434".into()),
        ..RewriteOptions::default()
    };
    let error = rewrite("Body", &options, &mut noop).unwrap_err();
    assert!(error.message.contains("--model required"));

    let options = RewriteOptions {
        backend: Backend::Ollama,
        model: Some("llama3".into()),
        base_url: None,
        ..RewriteOptions::default()
    };
    let error = rewrite("Body", &options, &mut noop).unwrap_err();
    assert!(error.message.contains("--base-url required"));
}

#[test]
fn a_remote_backend_is_refused_before_any_request() {
    let options = RewriteOptions {
        backend: Backend::OpenAiCompatible,
        model: Some("gpt".into()),
        base_url: Some("https://api.example.com".into()),
        allow_remote: false,
        ..RewriteOptions::default()
    };
    let error = rewrite("Body", &options, &mut noop).unwrap_err();
    assert!(error
        .message
        .contains("refusing to send content off-machine"));
}

#[test]
fn candidates_above_one_warn_in_print_prompt_mode() {
    let options = RewriteOptions {
        candidates: 3,
        ..RewriteOptions::default()
    };
    let mut warnings = Vec::new();
    let mut collect = |message: &str| warnings.push(message.to_string());
    rewrite("Body prose here.", &options, &mut collect).unwrap();
    assert_eq!(
        warnings,
        vec!["note: --candidates ignored in print-prompt mode"]
    );
}

#[test]
fn an_unavailable_markllm_warns_but_still_produces_a_prompt() {
    let options = RewriteOptions {
        markllm: Some(MarkllmOptions {
            scheme: "kgw".into(),
            ..MarkllmOptions::default()
        }),
        ..RewriteOptions::default()
    };
    let mut warnings = Vec::new();
    let mut collect = |message: &str| warnings.push(message.to_string());
    let (out, info) = rewrite("Body prose here.", &options, &mut collect).unwrap();
    assert!(out.contains("Body prose here."));
    assert_eq!(info["markllm"]["scheme"], "kgw");
    assert_eq!(info["markllm"]["before"]["available"], false);
    assert!(warnings[0].starts_with("markllm verification unavailable:"));
}

#[test]
fn backend_names_round_trip() {
    for backend in [
        Backend::PrintPrompt,
        Backend::Ollama,
        Backend::OpenAiCompatible,
    ] {
        assert_eq!(Backend::parse(backend.as_str()), Some(backend));
    }
    assert_eq!(Backend::parse("magic"), None);
}
