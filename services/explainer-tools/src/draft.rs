//! Drafting explainer sections on a LAN model through the Ontology Loom façade.
//!
//! The subject is a codebase, which the ontology does not cover, so every
//! request declines the scaffold (ADR-139) and the façade acts as a plain
//! proxy. Without that, a packet about `pnpm verify` was answered with the
//! blockchain sense of "Node" (2026-09-09).
//!
//! The model returns one JSON object. A truncated answer is never accepted:
//! `loom-client` retries it on a doubled budget, and if it still truncates the
//! call fails rather than handing back half a section.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What the model is allowed to say about a section.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraftStatus {
    /// The packet lacks the evidence needed to write the section.
    NeedsEvidence,
    /// A section was drafted.
    Draft,
    /// The section cannot be written as specified.
    Blocked,
}

/// The parsed model answer for one section.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DraftResult {
    /// Whether the model drafted, asked for evidence, or refused.
    pub status: DraftStatus,
    /// The prose for the reader.
    pub reader_text: String,
    /// Claims the section makes, each to be ledgered against evidence.
    pub claims: Vec<Value>,
    /// Anything the model wants before it can go further.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requests: Vec<Value>,
}

/// Why a response could not be turned into a [`DraftResult`].
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    /// No `{…}` span in the text at all.
    #[error("no JSON object in response")]
    NoObject,
    /// There was a JSON span, but it did not parse.
    #[error("response JSON did not parse: {0}")]
    Invalid(#[from] serde_json::Error),
    /// It parsed, but a required field was missing or wrong.
    #[error("response lacks {0}")]
    Missing(&'static str),
}

/// Pull the model's JSON object out of whatever it wrapped it in.
///
/// Models fence JSON in ```` ```json ```` blocks, prepend a sentence of
/// preamble, or both, and refusing those would throw away good answers. The
/// span from the first `{` to the last `}` is the object.
///
/// ```
/// # use explainer_tools::draft::parse_draft;
/// let out = parse_draft("```json\n{\"status\":\"draft\",\"reader_text\":\"hi\",\"claims\":[]}\n```").unwrap();
/// assert_eq!(out.reader_text, "hi");
/// ```
///
/// # Errors
///
/// [`ParseError`] when there is no JSON object, it does not parse, or a
/// required field is absent.
pub fn parse_draft(text: &str) -> Result<DraftResult, ParseError> {
    let trimmed = text.trim();
    let start = trimmed.find('{').ok_or(ParseError::NoObject)?;
    let end = trimmed.rfind('}').ok_or(ParseError::NoObject)?;
    if end < start {
        return Err(ParseError::NoObject);
    }
    let value: Value = serde_json::from_str(&trimmed[start..=end])?;

    // Name the missing field rather than letting serde report a type error
    // several layers down — this message goes to whoever is fixing the prompt.
    for field in ["status", "reader_text", "claims"] {
        if value.get(field).is_none() {
            return Err(ParseError::Missing(match field {
                "status" => "status",
                "reader_text" => "reader_text",
                _ => "claims",
            }));
        }
    }
    serde_json::from_value(value).map_err(ParseError::Invalid)
}

/// Substitute a packet (and optionally a prior draft) into a prompt template.
///
/// # Errors
///
/// Returns the first `{{placeholder}}` left unresolved, which means the
/// template and the packet have drifted apart.
pub fn fill_template(
    template: &str,
    packet: &Value,
    draft: Option<&Value>,
) -> Result<String, String> {
    let pretty = |v: &Value| serde_json::to_string_pretty(v).unwrap_or_default();
    let filled = template
        .replace("{{evidence_packet}}", &pretty(packet))
        .replace("{{draft_json}}", &draft.map(pretty).unwrap_or_default())
        .replace(
            "{{review_notes}}",
            &packet
                .get("review_notes")
                .map_or_else(|| "none".to_owned(), pretty),
        );

    if let Some(leftover) = unresolved_placeholder(&filled) {
        return Err(leftover);
    }
    Ok(filled)
}

/// The first `{{lower_snake}}` placeholder still in `text`, if any.
fn unresolved_placeholder(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while let Some(rel) = text[i..].find("{{") {
        let open = i + rel;
        let close = open + 2 + text[open + 2..].find("}}")?;
        let name = &text[open + 2..close];
        if !name.is_empty()
            && name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b == b'_')
        {
            return Some(format!("{{{{{name}}}}}"));
        }
        i = close + 2;
        if i >= bytes.len() {
            break;
        }
    }
    None
}

/// The output path for a packet's draft: `p.json` becomes `p.out.json`.
#[must_use]
pub fn output_path(packet: &Path) -> std::path::PathBuf {
    let stem = packet
        .file_stem()
        .map_or_else(|| "packet".to_owned(), |s| s.to_string_lossy().into_owned());
    packet.with_file_name(format!("{stem}.out.json"))
}

/// Resolve the façade base URL from the explainer's precedence chain:
/// `--base`, then `EXPLAINER_MODEL_BASE`, then `LOOM_BASE_URL`, then the
/// sidecar default.
#[must_use]
pub fn resolve_base_url(flag: Option<&str>) -> String {
    let from_env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    flag.map(ToOwned::to_owned)
        .or_else(|| from_env("EXPLAINER_MODEL_BASE"))
        .or_else(|| from_env("LOOM_BASE_URL"))
        .unwrap_or_else(|| "http://loom:8080/v1".to_owned())
        .trim_end_matches('/')
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_fenced_object_parses() {
        let out = parse_draft("```json\n{\"status\":\"draft\",\"reader_text\":\"t\",\"claims\":[]}\n```")
            .unwrap();
        assert_eq!(out.status, DraftStatus::Draft);
    }

    #[test]
    fn preamble_before_the_object_is_tolerated() {
        let out = parse_draft(
            "Here is the section:\n{\"status\":\"blocked\",\"reader_text\":\"\",\"claims\":[]}",
        )
        .unwrap();
        assert_eq!(out.status, DraftStatus::Blocked);
    }

    #[test]
    fn a_missing_required_field_is_named() {
        let err = parse_draft("{\"status\":\"draft\",\"claims\":[]}").unwrap_err();
        assert!(matches!(err, ParseError::Missing("reader_text")), "got {err:?}");
    }

    #[test]
    fn an_unknown_status_is_refused() {
        let err = parse_draft("{\"status\":\"maybe\",\"reader_text\":\"\",\"claims\":[]}")
            .unwrap_err();
        assert!(matches!(err, ParseError::Invalid(_)), "got {err:?}");
    }

    #[test]
    fn text_with_no_object_is_refused() {
        assert!(matches!(parse_draft("no json here"), Err(ParseError::NoObject)));
    }

    #[test]
    fn template_placeholders_are_substituted() {
        let out = fill_template("P: {{evidence_packet}} R: {{review_notes}}", &json!({"a":1}), None)
            .unwrap();
        assert!(out.contains("\"a\": 1"));
        assert!(out.contains("R: none"));
    }

    #[test]
    fn an_unresolved_placeholder_is_reported_rather_than_sent() {
        // Sending a prompt with a literal {{chapter_title}} in it wastes a
        // multi-minute call to get back a section about a placeholder.
        let err = fill_template("{{evidence_packet}} {{chapter_title}}", &json!({}), None)
            .unwrap_err();
        assert_eq!(err, "{{chapter_title}}");
    }

    #[test]
    fn json_braces_are_not_mistaken_for_placeholders() {
        let out =
            fill_template("{{evidence_packet}}", &json!({"nested": {"k": "v"}}), None).unwrap();
        assert!(out.contains("\"nested\""));
    }

    #[test]
    fn review_notes_come_from_the_packet_when_present() {
        let packet = json!({ "review_notes": ["tighten the opening"] });
        let out = fill_template("{{review_notes}}", &packet, None).unwrap();
        assert!(out.contains("tighten the opening"));
    }

    #[test]
    fn output_path_swaps_the_extension() {
        assert_eq!(output_path(Path::new("a/b/p.json")), Path::new("a/b/p.out.json"));
    }

    #[test]
    fn base_url_precedence_prefers_the_flag() {
        assert_eq!(resolve_base_url(Some("http://x/v1/")), "http://x/v1");
    }
}
