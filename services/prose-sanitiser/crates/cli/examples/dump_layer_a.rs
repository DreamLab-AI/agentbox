//! Dump every Layer A verdict, in the format `tests/fixtures/layer_a_decisions.json`
//! digests, so a drift can be diffed line by line against the ported Python.
//!
//! Run as `cargo run -p prose-sanitiser --example dump_layer_a > verdicts.txt`.
//! It is a diagnostic, not a test: the test is `tests/layer_a_parity.rs`.

use std::io::{BufWriter, Write};

use prose_sanitiser::common::Unit;
use prose_sanitiser::text::decide::{decide, Action, Decision};
use serde_json::Value;

fn verdict_line(codepoint: u32, context: &str, mode: &str, decision: Decision) -> String {
    let action = match decision.action {
        Action::Keep => "keep",
        Action::Strip => "strip",
        Action::Replace => "replace",
    };
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

fn main() {
    let fixture: Value =
        serde_json::from_str(include_str!("../tests/fixtures/layer_a_decisions.json"))
            .expect("fixture is valid JSON");
    let contexts: Vec<(String, Option<char>)> = fixture["contexts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry[0].as_str().unwrap().to_string(),
                entry[1].as_u64().and_then(|cp| char::from_u32(cp as u32)),
            )
        })
        .collect();
    let modes: Vec<(String, bool, bool)> = fixture["modes"]
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
        .collect();
    let skip_surrogates = fixture["skip_surrogates"].as_bool().unwrap_or(true);

    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    for range in fixture["ranges"].as_array().unwrap() {
        let low = range[0].as_u64().unwrap() as u32;
        let high = range[1].as_u64().unwrap() as u32;
        for codepoint in low..high {
            if skip_surrogates && (0xD800..=0xDFFF).contains(&codepoint) {
                continue;
            }
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
                    out.write_all(
                        verdict_line(codepoint, context_name, mode_name, decision).as_bytes(),
                    )
                    .expect("stdout accepts the dump");
                }
            }
        }
    }
}
