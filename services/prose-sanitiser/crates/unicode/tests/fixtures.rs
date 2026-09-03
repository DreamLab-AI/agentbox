//! The adversarial and legitimate-content fixture suite (design brief D3).
//!
//! Each fixture is a directory holding an `input.*` and an `expected.json`
//! declaring one of two contracts:
//!
//! - `must-strip`: every listed codepoint is contraband and must be gone from
//!   the cleaned output.
//! - `must-preserve`: every listed codepoint is load-bearing and must survive
//!   byte for byte. **A single strip here is a hard failure**, not a tuning
//!   question: these are real emoji, Devanagari, Persian, Hebrew-Latin and BOM
//!   documents, and corrupting them is worse than missing an attack.
//!
//! The homoglyph fixtures additionally carry the SilverSpeak substitution rates
//! (5, 10 and 20 per cent), which the suite scores for precision and recall.

use std::path::{Path, PathBuf};

use prose_sanitiser_core::surrogate;
use prose_sanitiser_unicode::bidi::BidiContext;
use prose_sanitiser_unicode::{clean_text, stego, CleanOptions};
use serde_json::Value;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

struct Fixture {
    id: String,
    input: Vec<u8>,
    /// `must-strip` or `must-preserve`.
    kind: String,
    codepoints: Vec<u32>,
    payload: Option<String>,
    /// Source code, inferred from the input file's extension.
    is_code: bool,
    aggressive: bool,
}

fn load_all() -> Vec<Fixture> {
    let mut fixtures = Vec::new();
    let root = fixtures_dir();
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&root)
        .expect("fixtures directory must exist")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    entries.sort();

    for dir in entries {
        let expected: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("expected.json")).expect("expected.json"),
        )
        .expect("expected.json must parse");
        let input_name = expected["input"].as_str().expect("input name");
        let input = std::fs::read(dir.join(input_name)).expect("input file");
        let expect = &expected["expect"];
        // Source-code contexts take the Trojan Source policy; prose does not.
        let is_code = matches!(
            Path::new(input_name).extension().and_then(|e| e.to_str()),
            Some("rs" | "py" | "js" | "c" | "go" | "sh")
        );
        let aggressive = expected["args"]
            .as_array()
            .map(|args| {
                args.iter()
                    .any(|arg| arg.as_str() == Some("--aggressive-homoglyphs"))
            })
            .unwrap_or(false);
        fixtures.push(Fixture {
            id: expected["id"].as_str().expect("id").to_string(),
            input,
            kind: expect["kind"].as_str().expect("kind").to_string(),
            codepoints: expect["codepoints"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(Value::as_u64)
                        .map(|n| n as u32)
                        .collect()
                })
                .unwrap_or_default(),
            payload: expect["payload"].as_str().map(str::to_string),
            is_code,
            aggressive,
        });
    }
    assert!(!fixtures.is_empty(), "fixture suite must not be empty");
    fixtures
}

fn clean(fixture: &Fixture) -> String {
    let units = surrogate::decode(&fixture.input);
    let options = CleanOptions {
        aggressive_homoglyphs: fixture.aggressive,
        bidi_context: if fixture.is_code {
            BidiContext::Code
        } else {
            BidiContext::Prose
        },
        ..CleanOptions::default()
    };
    let (output, _) = clean_text(&units, options);
    String::from_utf8_lossy(&surrogate::encode(&output)).into_owned()
}

#[test]
fn every_must_strip_fixture_loses_all_its_contraband() {
    for fixture in load_all().iter().filter(|f| f.kind == "must-strip") {
        let cleaned = clean(fixture);
        for codepoint in &fixture.codepoints {
            let character = char::from_u32(*codepoint).expect("assigned codepoint");
            assert!(
                !cleaned.contains(character),
                "{}: U+{codepoint:04X} survived a clean",
                fixture.id
            );
        }
    }
}

#[test]
fn every_must_preserve_fixture_keeps_all_its_load_bearing_characters() {
    // A strip here corrupts a genuine document. Zero tolerance.
    for fixture in load_all().iter().filter(|f| f.kind == "must-preserve") {
        let cleaned = clean(fixture);
        for codepoint in &fixture.codepoints {
            let character = char::from_u32(*codepoint).expect("assigned codepoint");
            assert!(
                cleaned.contains(character),
                "{}: U+{codepoint:04X} was stripped from legitimate content",
                fixture.id
            );
        }
    }
}

#[test]
fn legitimate_documents_come_through_a_clean_byte_identical() {
    // Stronger than the per-codepoint check: nothing at all may change.
    for fixture in load_all().iter().filter(|f| {
        f.id.starts_with("legit-")
            || f.id.starts_with("tag-flag-")
            || f.id.starts_with("roundtrip-")
    }) {
        let original = String::from_utf8_lossy(&fixture.input).into_owned();
        assert_eq!(
            clean(fixture),
            original,
            "{}: legitimate content must round-trip byte-identical",
            fixture.id
        );
    }
}

#[test]
fn declared_payloads_decode_to_the_expected_bytes() {
    let mut checked = 0;
    for fixture in load_all().iter().filter(|f| f.payload.is_some()) {
        let expected = fixture.payload.as_deref().expect("filtered above");
        let units = surrogate::decode(&fixture.input);
        // A payload may be split across several carriers; concatenating the
        // decoded runs in order is what recovers the original byte string.
        let recovered: String = stego::scan(&units)
            .iter()
            .filter_map(|payload| payload.as_text())
            .collect();
        assert!(
            recovered.contains(expected),
            "{}: expected payload {expected:?}, decoded {recovered:?}",
            fixture.id
        );
        checked += 1;
    }
    assert!(checked > 0, "no payload fixtures were exercised");
}

#[test]
fn trojan_source_is_rejected_in_code_and_rtl_prose_is_preserved() {
    let fixtures = load_all();
    let trojan: Vec<&Fixture> = fixtures
        .iter()
        .filter(|f| f.id.starts_with("trojan-source-"))
        .collect();
    assert_eq!(
        trojan.len(),
        3,
        "expected Rust, Python and Markdown samples"
    );
    for fixture in trojan {
        let cleaned = clean(fixture);
        for codepoint in &fixture.codepoints {
            let character = char::from_u32(*codepoint).expect("assigned codepoint");
            assert!(
                !cleaned.contains(character),
                "{}: bidi control U+{codepoint:04X} survived",
                fixture.id
            );
        }
    }
    // The mirror image: genuine RTL prose keeps its controls.
    let hebrew = fixtures
        .iter()
        .find(|f| f.id == "legit-hebrew-latin-mixed")
        .expect("Hebrew-Latin fixture");
    assert_eq!(
        clean(hebrew),
        String::from_utf8_lossy(&hebrew.input),
        "RTL prose must be preserved"
    );
}

#[test]
fn homoglyph_precision_and_recall_meet_the_target() {
    // Ground truth: a substituted character is one the clean folded back to
    // ASCII. Recall counts declared contraband actually removed; precision
    // counts changes that were genuinely contraband.
    let fixtures = load_all();
    let homoglyph: Vec<&Fixture> = fixtures
        .iter()
        .filter(|f| f.id.starts_with("homoglyph-"))
        .collect();
    // The three SilverSpeak substitution rates must all be present; other
    // homoglyph fixtures (single-codepoint regressions) also score.
    for rate in ["homoglyph-5pct", "homoglyph-10pct", "homoglyph-20pct"] {
        assert!(
            homoglyph.iter().any(|f| f.id == rate),
            "{rate} missing from the fixture suite"
        );
    }

    let mut true_positives = 0usize;
    let mut false_negatives = 0usize;
    let mut false_positives = 0usize;

    for fixture in homoglyph {
        let original = String::from_utf8_lossy(&fixture.input).into_owned();
        let cleaned = clean(fixture);
        let declared: Vec<char> = fixture
            .codepoints
            .iter()
            .filter_map(|cp| char::from_u32(*cp))
            .collect();

        // Recall: every declared confusable must be gone.
        for character in &declared {
            if cleaned.contains(*character) {
                false_negatives += 1;
            } else {
                true_positives += 1;
            }
        }
        // Precision: every character the clean changed must have been one of
        // the declared confusables, never honest text.
        for (before, after) in original.chars().zip(cleaned.chars()) {
            if before != after && !declared.contains(&before) {
                false_positives += 1;
            }
        }
    }

    let precision = true_positives as f64 / (true_positives + false_positives) as f64;
    let recall = true_positives as f64 / (true_positives + false_negatives) as f64;
    println!(
        "homoglyph precision {precision:.4} recall {recall:.4} \
         (tp {true_positives}, fp {false_positives}, fn {false_negatives})"
    );
    assert!(precision > 0.99, "precision {precision} below target");
    assert!(recall > 0.99, "recall {recall} below target");
}

#[test]
fn the_suite_covers_every_declared_carrier_class() {
    let ids: Vec<String> = load_all().into_iter().map(|f| f.id).collect();
    for required in [
        "vs-payload-emoji-base",
        "vs-payload-non-emoji-base",
        "vs-payload-split-chains",
        "tag-smuggled-ascii",
        "tag-flag-england",
        "trojan-source-rust",
        "bidi-unbalanced-isolates",
        "homoglyph-20pct",
        "legit-devanagari",
        "legit-persian",
        "legit-emoji-zwj-document",
        "legit-bom-at-offset-zero",
    ] {
        assert!(ids.iter().any(|id| id == required), "{required} missing");
    }
}
