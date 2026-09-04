//! Flat TUI state JSON → canonical `agentbox.toml` (port of `tui-write-manifest.py`).
//!
//! The wizard rebuilds the manifest from the state document, then deep-merges
//! it over the *existing* manifest so sections the wizard does not manage
//! (`[llm_marketplace]`, `[mesh]`, `[plugins]`, `[networking]`, …) round-trip
//! untouched. That merge is ADR-022 D5 and is the reason this cannot simply be
//! a `serde` serialisation: wizard keys must win key-by-key, not section-by-
//! section.
//!
//! Note there is **no comment preservation** to reproduce. The Python parsed
//! with `tomllib` (comments discarded) and re-emitted from a plain dict, so
//! `toml_edit` would change today's output rather than match it.

use serde_json::Value;

use crate::tomlval;
use crate::tui_sections::render;

/// CLI entry: `<state.json> <output.toml> [<existing.toml>]`.
pub fn run(
    state_path: &std::path::Path,
    output_path: &std::path::Path,
    existing_path: Option<&std::path::Path>,
) -> Result<(), String> {
    let state_text = std::fs::read_to_string(state_path)
        .map_err(|e| format!("{}: {e}", state_path.display()))?;
    let mut state: Value = serde_json::from_str(&state_text)
        .map_err(|e| format!("{}: invalid JSON state: {e}", state_path.display()))?;

    let existing = existing_path
        .filter(|p| p.exists())
        .map(tomlval::parse_file_lenient)
        .filter(|v| v.as_object().map(|o| !o.is_empty()).unwrap_or(false));

    // This model is not exposed by the current wizard. Preserve an operator's
    // choice unless a caller explicitly supplies it in the flat state.
    if state.get("consultants.antigravity.model").is_none() {
        if let Some(model) = existing
            .as_ref()
            .and_then(|v| tomlval::get(v, "consultants.antigravity.model"))
            .and_then(Value::as_str)
        {
            if let Some(fields) = state.as_object_mut() {
                fields.insert(
                    "consultants.antigravity.model".into(),
                    Value::String(model.into()),
                );
            }
        }
    }
    let wizard_text = render(&state);

    let out = match existing {
        Some(existing) => {
            let wizard = tomlval::parse(&wizard_text)
                .map_err(|e| format!("wizard output is not valid TOML: {e}"))?;
            tomlval::dump(&tomlval::deep_merge(&existing, &wizard), "") + "\n"
        }
        // No existing file — write the wizard text verbatim, preserving the
        // hand-crafted spacing for fresh installs.
        None => wizard_text,
    };
    std::fs::write(output_path, out).map_err(|e| format!("{}: {e}", output_path.display()))
}
