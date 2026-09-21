//! Golden contract tests: recorded-shape responses from both a hosted
//! typed-decision API and the sovereign façade must parse identically through
//! this client's types, and must satisfy the protocol's hard rules.
//!
//! The fixtures live in the repository at `tests/system-one/golden/` and are
//! shared with the JavaScript consumers, so a divergence between the Rust
//! parser and the JS one shows up as a failure here rather than in production.
//! They are not shipped inside the crate: when the directory is absent — as it
//! is for anyone who installed this crate from a registry — these tests report
//! that and pass, because a fixture that is not present cannot have been
//! checked and saying otherwise would be a lie.

use std::path::PathBuf;

use system_one_client::core::{
    validate::validate_response, Answer, ErrorEnvelope, Question, QuestionKind, Request, Response,
};

/// The shared golden directory, if this checkout has one.
fn golden_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/system-one/golden")
        .canonicalize()
        .ok()?;
    dir.is_dir().then_some(dir)
}

/// Read one fixture, or `None` when the corpus is not in this checkout.
fn fixture(name: &str) -> Option<String> {
    let path = golden_dir()?.join(name);
    match std::fs::read_to_string(&path) {
        Ok(body) => Some(body),
        Err(error) => panic!("golden corpus present but {name} unreadable: {error}"),
    }
}

/// Every 200-shaped fixture parses, whichever backend shape it is.
#[test]
fn every_success_fixture_parses_as_a_response() {
    let Some(dir) = golden_dir() else {
        eprintln!("golden corpus not in this checkout; nothing checked");
        return;
    };

    let mut checked = 0;
    for entry in std::fs::read_dir(&dir).expect("read golden dir") {
        let path = entry.expect("dir entry").path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.ends_with(".json") || name == "manifest.json" || name.contains("-error-") {
            continue;
        }
        let body = std::fs::read_to_string(&path).expect("read fixture");
        let response: Response = serde_json::from_str(&body)
            .unwrap_or_else(|e| panic!("{name} did not parse as a Response: {e}"));

        assert!(!response.model.is_empty(), "{name}: no model");
        assert!(!response.answers.is_empty(), "{name}: no answers");

        for (question, answer) in &response.answers {
            if let Answer::Choice { probabilities, .. } = answer {
                let sum: f64 = probabilities.values().sum();
                assert!(
                    (sum - 1.0).abs() < 1e-6,
                    "{name}/{question}: probabilities sum to {sum}"
                );
            }
        }

        // Re-serialising must not lose a field the fixture carried.
        let round_tripped: Response =
            serde_json::from_str(&serde_json::to_string(&response).unwrap()).unwrap();
        assert_eq!(round_tripped, response, "{name} did not round-trip");

        checked += 1;
    }
    assert!(
        checked >= 2,
        "expected several success fixtures, saw {checked}"
    );
}

/// The two backend shapes differ in what they *report*, never in how they are
/// read. This is the property that makes one client enough for both.
#[test]
fn a_hosted_and_a_facade_response_parse_through_the_same_types() {
    let (Some(hosted), Some(sovereign)) = (
        fixture("typesafe-choice-router.json"),
        fixture("sso-choice-router-shortlisted.json"),
    ) else {
        eprintln!("golden corpus not in this checkout; nothing checked");
        return;
    };

    let hosted: Response = serde_json::from_str(&hosted).expect("hosted fixture parses");
    let sovereign: Response = serde_json::from_str(&sovereign).expect("façade fixture parses");

    // Same question, same answer shape, same option universe.
    let (hosted_choice, hosted_probabilities) =
        hosted.answers["skill"].as_choice().expect("a choice");
    let (_, sovereign_probabilities) = sovereign.answers["skill"].as_choice().expect("a choice");
    assert_eq!(hosted_probabilities.len(), sovereign_probabilities.len());
    assert!(hosted_probabilities.contains_key(hosted_choice));

    // Only the façade reports what it had to do, and it reports it honestly.
    assert!(hosted.sso.is_none(), "a hosted API sends no honesty block");
    let sso = sovereign.sso.expect("the façade sends one");
    let shortlisted = sso.shortlisted["skill"];
    assert_eq!(shortlisted.from, sovereign_probabilities.len());
    assert!(shortlisted.to < shortlisted.from, "it shortlisted");

    // And the engine's true cost is far below what a naive call would have paid.
    assert!(
        sovereign.usage.input_tokens < hosted.usage.input_tokens / 10,
        "façade {} vs hosted {}",
        sovereign.usage.input_tokens,
        hosted.usage.input_tokens
    );
}

/// The protocol's hard rule, checked against the fixture built to exercise it:
/// every original option is present, the shortlisted-away ones at exactly zero,
/// and the chosen key is one of them.
#[test]
fn shortlisted_away_options_come_back_at_zero() {
    let Some(body) = fixture("sso-choice-router-shortlisted.json") else {
        eprintln!("golden corpus not in this checkout; nothing checked");
        return;
    };
    let response: Response = serde_json::from_str(&body).unwrap();
    let (choice, probabilities) = response.answers["skill"].as_choice().unwrap();

    let zeros = probabilities.values().filter(|p| **p == 0.0).count();
    let nonzeros = probabilities.len() - zeros;
    assert!(zeros > 0, "nothing was shortlisted away");
    assert!(nonzeros >= 2, "a shortlist of one is not a choice");
    assert!(
        probabilities[choice] > 0.0,
        "the chosen option has zero mass"
    );

    // Reconstruct the caller's question from the fixture's own key set and prove
    // the response satisfies validation against it.
    let criteria: Vec<(String, String)> = probabilities
        .keys()
        .map(|k| (k.clone(), format!("the {k} skill")))
        .collect();
    let request = Request::new(&response.model, "a user turn")
        .with_question("skill", Question::choice("which skill?", criteria));
    validate_response(&request, &response).expect("the fixture obeys the hard rules");
}

/// All three primitives, including a score with both a keyed and a positional
/// distribution — the shape most likely to be read only half of.
#[test]
fn every_primitive_round_trips() {
    let Some(body) = fixture("typesafe-mixed-primitives.json") else {
        eprintln!("golden corpus not in this checkout; nothing checked");
        return;
    };
    let response: Response = serde_json::from_str(&body).unwrap();

    let kinds: Vec<QuestionKind> = response.answers.values().map(Answer::kind).collect();
    assert!(kinds.contains(&QuestionKind::Choice));
    assert!(kinds.contains(&QuestionKind::Score));
    assert!(kinds.contains(&QuestionKind::Noul));

    match &response.answers["severity"] {
        Answer::Score {
            score,
            distribution,
            legend,
            probabilities,
            ..
        } => {
            assert!(score.is_finite());
            assert_eq!(distribution.len(), legend.len());
            assert_eq!(distribution.len(), probabilities.len());
            // The keyed and positional forms carry the same numbers.
            for (index, value) in distribution.iter().enumerate() {
                let keyed = probabilities[&index.to_string()];
                assert!((keyed - value).abs() < 1e-9);
            }
        }
        other => panic!("expected a score, got {other:?}"),
    }

    let round_tripped: Response =
        serde_json::from_str(&serde_json::to_string(&response).unwrap()).unwrap();
    assert_eq!(round_tripped, response);
}

/// Error bodies are one shape whatever the backend, and the code survives.
#[test]
fn error_fixtures_parse_as_envelopes() {
    let Some(dir) = golden_dir() else {
        eprintln!("golden corpus not in this checkout; nothing checked");
        return;
    };

    let mut checked = 0;
    for entry in std::fs::read_dir(&dir).expect("read golden dir") {
        let path = entry.expect("dir entry").path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.contains("-error-") {
            continue;
        }
        let body = std::fs::read_to_string(&path).unwrap();
        let envelope: ErrorEnvelope = serde_json::from_str(&body)
            .unwrap_or_else(|e| panic!("{name} is not an error envelope: {e}"));
        assert!(!envelope.error.code.is_empty(), "{name}: empty code");
        assert!(!envelope.error.message.is_empty(), "{name}: empty message");
        // An error body must NOT parse as a success: that is what lets a client
        // tell them apart without consulting the status code twice.
        assert!(serde_json::from_str::<Response>(&body).is_err());
        checked += 1;
    }
    assert!(
        checked >= 2,
        "expected several error fixtures, saw {checked}"
    );
}
