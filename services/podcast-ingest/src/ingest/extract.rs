//! Phase 2: assertion extraction via the Loom — port of `EXTRACTION_PROMPT`,
//! `extract_assertions`, and `phase_extract` from `ingest.py`.

use super::config::Settings;
use super::loom::{call_loom, resolve_loom_url};
use super::pyval::{get_str, Assertion};
use crate::common::assertion_fingerprint;
use crate::common::ingest_status::{get_ingest_status, set_ingest_status};
use crate::common::state::IngestState;
use indexmap::IndexMap;
use regex::Regex;
use serde_json::Value;
use std::path::Path;
use std::sync::OnceLock;

pub const EXTRACTION_PROMPT_TEMPLATE: &str = r#"You are an ontology knowledge extractor. Analyse this podcast transcript
and extract knowledge worth adding to a technology knowledge base.

Extract three tiers of knowledge — aim for 5-15 items per transcript:

TIER 1 — Hard facts (confidence 0.85-1.0):
  Backed by a named study, report, official disclosure, or quantitative data.
  Attributed to a specific source. Contains concrete facts (numbers, dates, named entities).

TIER 2 — Expert analysis and industry insight (confidence 0.6-0.84):
  Informed positions, strategic assessments, or trend analysis from credible voices.
  Product announcements, partnerships, policy shifts, competitive moves.
  Technical evaluations or comparisons with reasoned justification.
  The host's experienced interpretation of developments, where grounded in specifics.

TIER 3 — Notable predictions and emerging signals (confidence 0.4-0.59):
  Forward-looking claims about technology direction, market shifts, or policy.
  Early signals or patterns the host identifies before mainstream coverage.
  Contrarian positions backed by reasoning (not mere speculation).

For each item, return a JSON object with:
- "claim": a clear statement (one sentence). It MUST state the SAME number, metric,
  attributed role, and named entity that its evidence supports — never round, convert,
  paraphrase a figure, or re-attribute to a different person/company. If the evidence is
  itself garbled or ambiguous, keep the claim faithful and add "[sic]" rather than inventing
  a corrected value. (PC-5)
- "tier": 1, 2, or 3
- "source": who reported/said this — the host counts for analysis and predictions
- "source_authority": one of primary | secondary | single-source | rumour | hedged —
  how well-attributed the claim is. A single unconfirmed report or a hedged/speculative
  aside is NOT primary, however confident it sounds. Confidence must not exceed what the
  authority supports. (PC-3)
- "volatility": one of durable | snapshot | speculative. durable = a structural trend or
  insight that outlives the episode; snapshot = a dated figure (price, rank, MAU, launch %,
  funding round, benchmark score) that is stale within weeks; speculative = unshipped,
  future, or opinion. This is independent of confidence — a claim can be well-sourced AND
  fast-decaying. (PC-4)
- "evidence": supporting data points, quotes, reasoning, or context
- "context": 1-2 sentences of surrounding context from the transcript
- "confidence": your confidence this is accurately captured (0.0-1.0)
- "ontology_terms": 2-4 key concepts that would help locate this in an AI/tech ontology.
  Give SPECIFIC named entities or multi-word concepts, never bare generic words or short
  acronyms (not "Model", "Base", "API", "GAN", "State"): a wrong-sense link is worse than
  no link. Prefer fewer, precise terms over more, loose ones. (PC-1)

Transcription and phrasing hygiene (PC-2):
- Transcripts are auto-captioned. Normalise obvious speech-to-text garbles of KNOWN names and
  version numbers in the claim, source, and ontology_terms — e.g. "Opus 48" -> "Opus 4.8",
  "GPT 55" -> "GPT-5.5", "Ilia Sutskaver" -> "Ilya Sutskever", "Ethan Malik" -> "Ethan Mollick".
  Keep the raw garbled form ONLY inside the verbatim evidence quote, never in structured fields.
- Keep claims neutral and checkable: move promotional or hype phrasing ("a marvel", "fabled
  intelligence at half the price") into the evidence quote and state the claim plainly.
- If a named concept is clearly the subject of a durable claim, include it as an ontology_term
  so it can anchor a link — but only if it is specific (PC-1), never to force a generic link.
- The show's regular host is the most-mentioned speaker; normalise host and recurring-guest
  names to their correct spelling rather than an ASR variant. (PC-9)
- State only relationships the evidence supports. Do NOT infer ownership, agency, or partnership
  edges between correctly-named entities that the transcript does not assert (e.g. do not say one
  company owns another's asset merely because their founders are linked). (PC-10)

Return a JSON array. Prefer breadth — capture the full range of useful knowledge
in the episode. If genuinely nothing is extractable, return [].

TRANSCRIPT:
{transcript}"#;

fn re_transcript_section() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)## Transcript\n\n(.+)").unwrap())
}
fn re_think_tags() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)<think>.*?</think>").unwrap())
}
fn re_json_fence() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)```(?:json)?\s*(\[.*?\])\s*```").unwrap())
}
fn re_json_array() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)\[.*\]").unwrap())
}
fn re_trailing_comma_array() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r",\s*\]").unwrap())
}
fn re_trailing_comma_obj() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r",\s*\}").unwrap())
}

/// Salvage complete top-level `{...}` objects from a truncated JSON array
/// response (`finish_reason=length`), matching `extract_assertions`'s
/// brace-depth scan verbatim.
pub fn salvage_top_level_objects(response: &str) -> Vec<Assertion> {
    let mut objs = Vec::new();
    let mut depth = 0i32;
    let mut start: Option<usize> = None;
    let chars: Vec<(usize, char)> = response.char_indices().collect();
    for &(byte_idx, ch) in &chars {
        if ch == '{' {
            if depth == 0 {
                start = Some(byte_idx);
            }
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                if let Some(s) = start {
                    let end = byte_idx + ch.len_utf8();
                    if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&response[s..end])
                    {
                        objs.push(obj);
                    }
                }
                start = None;
            }
        }
    }
    objs
}

/// Port of `extract_assertions`. `settings` supplies `loom_url`,
/// `loom_fallback_urls`, `loom_model`, `min_confidence`,
/// `max_assertions_per_episode`.
pub async fn extract_assertions(md_path: &Path, settings: &Settings) -> Vec<Assertion> {
    let content = match std::fs::read_to_string(md_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let transcript = match re_transcript_section().captures(&content) {
        Some(caps) => caps[1].to_string(),
        None => return Vec::new(),
    };
    if transcript.starts_with("_Transcript not available") {
        return Vec::new();
    }

    let prompt = EXTRACTION_PROMPT_TEMPLATE.replace("{transcript}", &transcript);
    let loom_url = resolve_loom_url(&settings.loom_url, &settings.loom_fallback_urls).await;
    let response = match call_loom(&prompt, &loom_url, &settings.loom_model).await {
        Some(r) => r,
        None => return Vec::new(),
    };

    let response = re_think_tags()
        .replace_all(&response, "")
        .trim()
        .to_string();

    let response = if let Some(caps) = re_json_fence().captures(&response) {
        caps[1].to_string()
    } else if let Some(m) = re_json_array().find(&response) {
        m.as_str().to_string()
    } else {
        response
    };

    let response = re_trailing_comma_array()
        .replace_all(&response, "]")
        .to_string();
    let response = re_trailing_comma_obj()
        .replace_all(&response, "}")
        .to_string();

    let mut assertions: Vec<Assertion> = match serde_json::from_str::<Value>(&response) {
        Ok(Value::Array(arr)) => arr
            .into_iter()
            .filter_map(|v| match v {
                Value::Object(obj) => Some(obj),
                _ => None,
            })
            .collect(),
        Ok(_) => return Vec::new(),
        Err(_) => {
            let objs = salvage_top_level_objects(&response);
            if !objs.is_empty() {
                println!(
                    "  Loom response truncated; salvaged {} complete assertions",
                    objs.len()
                );
                objs
            } else {
                println!("  Failed to parse Loom response as JSON");
                return Vec::new();
            }
        }
    };

    let min_conf = settings.min_confidence;
    let max_n = settings.max_assertions_per_episode;
    assertions.retain(|a| super::pyval::get_f64(a, "confidence", 0.0) >= min_conf);
    assertions.sort_by(|a, b| {
        let ca = super::pyval::get_f64(a, "confidence", 0.0);
        let cb = super::pyval::get_f64(b, "confidence", 0.0);
        cb.partial_cmp(&ca).unwrap_or(std::cmp::Ordering::Equal)
    });
    assertions.truncate(max_n);
    assertions
}

/// Port of `phase_extract`. Mutates `state.assertions` exactly as the Python
/// original mutates `state["assertions"]` through the `known` alias.
pub async fn phase_extract(
    files: &[std::path::PathBuf],
    settings: &Settings,
    state: &mut IngestState,
) -> IndexMap<String, Vec<Assertion>> {
    let mut results: IndexMap<String, Vec<Assertion>> = IndexMap::new();

    for md_path in files {
        let content = std::fs::read_to_string(md_path).unwrap_or_default();
        if let Some(status) = get_ingest_status(&content) {
            if status.starts_with("processed") {
                continue;
            }
        }

        let file_name = md_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        println!("  Extracting: {file_name}");

        let assertions = extract_assertions(md_path, settings).await;
        if !assertions.is_empty() {
            let mut novel: Vec<Assertion> = Vec::new();
            for mut a in assertions.clone() {
                let source = get_str(&a, "source", "");
                let claim = get_str(&a, "claim", "");
                let fp = assertion_fingerprint(&source, &claim);
                if !state.assertions.contains_key(&fp) {
                    a.insert("fingerprint".to_string(), Value::String(fp.clone()));
                    novel.push(a);
                    state.assertions.insert(
                        fp,
                        serde_json::json!({
                            "claim": claim,
                            "source": source,
                            "file": file_name,
                            "date": crate::ingest::iso_now(),
                        }),
                    );
                }
            }

            if !novel.is_empty() {
                println!(
                    "    {} novel assertions (of {} extracted)",
                    novel.len(),
                    assertions.len()
                );
                results.insert(file_name.clone(), novel);
            } else {
                println!("    All {} assertions already known", assertions.len());
            }
        } else {
            println!("    No assertions met threshold");
        }

        let _ = set_ingest_status(md_path, "pending");
    }

    results
}
