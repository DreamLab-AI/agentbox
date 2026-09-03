//! Golden parity for the Layer A character decision.
//!
//! `tests/fixtures/layer_a_decisions.json` carries a SHA-256 over every
//! `(codepoint, context, mode)` verdict across the enumerated ranges, so any
//! drift — a dropped table entry, a reordered guard, a changed `keep`/`strip`
//! boundary — fails here rather than silently weakening detection. The
//! spelled-out `sample` rows keep the load-bearing cases readable for a human
//! reviewer, and they are the half that must never move.
//!
//! # Rebaselining
//!
//! The digest was first generated from the Python `text_unicode._decide` this
//! crate replaces. It was rebaselined once, on 2026-09-03, when the 40-entry
//! hand-written confusables table was replaced by the UTS #39 data. That drift
//! was measured before it was accepted: 2,499 of 1,361,157 verdicts changed
//! (0.184 per cent), across 357 codepoints, **all of them `keep` becoming
//! `replace` with kind `confusable`, and all of them in aggressive mode only**.
//! Default and paranoid modes are byte-identical to the Python. Detection
//! widened and nothing was lost, which is the only shape of drift that may be
//! accepted here. The prior digest and the full measurement are recorded in the
//! fixture's `superseded` array.
//!
//! Any future rebaseline needs the same treatment: regenerate both surfaces,
//! diff them row by row, and record what moved. A digest updated without a
//! recorded diff is a gate that has been switched off.

use std::collections::BTreeMap;

use prose_sanitiser::common::Unit;
use prose_sanitiser::text::decide::{decide, Action, Decision};
use serde_json::Value;

fn fixture() -> Value {
    let raw = include_str!("fixtures/layer_a_decisions.json");
    serde_json::from_str(raw).expect("fixture is valid JSON")
}

/// Render one verdict exactly as the generator's digest line did.
fn verdict_line(codepoint: u32, context: &str, mode: &str, decision: Decision) -> String {
    let action = match decision.action {
        Action::Keep => "keep",
        Action::Strip => "strip",
        Action::Replace => "replace",
    };
    // Python emitted the surviving character (empty string for a strip) and the
    // kind, formatted by f-string; `None` renders as "None".
    let output = match decision.action {
        Action::Strip => String::new(),
        _ => decision
            .output
            .and_then(Unit::as_char)
            .map(String::from)
            .unwrap_or_default(),
    };
    let kind = decision
        .kind
        .map(String::from)
        .unwrap_or_else(|| "None".into());
    format!("{codepoint}|{context}|{mode}|{action}|{output}|{kind}\n")
}

fn contexts(fixture: &Value) -> Vec<(String, Option<char>)> {
    fixture["contexts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            let name = entry[0].as_str().unwrap().to_string();
            let previous = entry[1].as_u64().and_then(|cp| char::from_u32(cp as u32));
            (name, previous)
        })
        .collect()
}

fn modes(fixture: &Value) -> Vec<(String, bool, bool)> {
    fixture["modes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry[0].as_str().unwrap().to_string(),
                entry[1].as_bool().unwrap(),
                entry[2].as_bool().unwrap(),
            )
        })
        .collect()
}

fn codepoints(fixture: &Value) -> Vec<u32> {
    let skip_surrogates = fixture["skip_surrogates"].as_bool().unwrap();
    let mut out = Vec::new();
    for range in fixture["ranges"].as_array().unwrap() {
        let start = range[0].as_u64().unwrap() as u32;
        let end = range[1].as_u64().unwrap() as u32;
        for codepoint in start..end {
            if skip_surrogates && (0xD800..=0xDFFF).contains(&codepoint) {
                continue;
            }
            out.push(codepoint);
        }
    }
    out
}

#[test]
fn every_codepoint_verdict_matches_the_python() {
    use sha2::{Digest, Sha256};

    let fixture = fixture();
    let contexts = contexts(&fixture);
    let modes = modes(&fixture);
    let mut hasher = Sha256::new();

    for codepoint in codepoints(&fixture) {
        let Some(character) = char::from_u32(codepoint) else {
            continue;
        };
        for (context_name, previous) in &contexts {
            for (mode_name, aggressive, strip_glue) in &modes {
                let decision = decide(
                    Unit::Char(character),
                    previous.map(Unit::Char),
                    true,
                    *aggressive,
                    *strip_glue,
                );
                hasher.update(verdict_line(codepoint, context_name, mode_name, decision));
            }
        }
    }

    let digest = format!("{:x}", hasher.finalize());
    assert_eq!(
        digest,
        fixture["digest"].as_str().unwrap(),
        "Layer A decision surface drifted from the recorded baseline. Do not update the \
         digest without measuring the diff: see the module docs, and the fixture's \
         `superseded` array for the shape a rebaseline has to have."
    );
}

#[test]
fn the_load_bearing_sample_rows_match_one_by_one() {
    let fixture = fixture();
    let context_by_name: BTreeMap<String, Option<char>> = contexts(&fixture).into_iter().collect();
    let mode_by_name: BTreeMap<String, (bool, bool)> = modes(&fixture)
        .into_iter()
        .map(|(name, aggressive, glue)| (name, (aggressive, glue)))
        .collect();

    let rows = fixture["sample"].as_array().unwrap();
    assert!(
        rows.len() > 100,
        "sample should cover the interesting cases"
    );

    for row in rows {
        let codepoint = row[0].as_u64().unwrap() as u32;
        let context_name = row[1].as_str().unwrap();
        let mode_name = row[2].as_str().unwrap();
        let expected_action = row[3].as_str().unwrap();
        let expected_kind = row[5].as_str();

        let (aggressive, strip_glue) = mode_by_name[mode_name];
        let decision = decide(
            Unit::Char(char::from_u32(codepoint).unwrap()),
            context_by_name[context_name].map(Unit::Char),
            true,
            aggressive,
            strip_glue,
        );
        let action = match decision.action {
            Action::Keep => "keep",
            Action::Strip => "strip",
            Action::Replace => "replace",
        };
        assert_eq!(
            action, expected_action,
            "U+{codepoint:04X} in context {context_name} mode {mode_name}"
        );
        assert_eq!(
            decision.kind, expected_kind,
            "U+{codepoint:04X} in context {context_name} mode {mode_name}"
        );
    }
}
