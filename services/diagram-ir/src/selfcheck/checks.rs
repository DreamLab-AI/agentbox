//! The packaged checks: the accessible-SVG contract, the script rules, and the
//! structural motion contract.
//!
//! Reference and URL vetting lives in [`crate::selfcheck::refs`] and is
//! re-exported here.

use std::collections::{BTreeSet, HashMap};

use crate::pyfmt::{repr_dict_int_int, repr_list_int, repr_list_str, repr_str};
use crate::selfcheck::html::{parse, DiagramParser};
pub use crate::selfcheck::refs::{is_approved_google_fonts_stylesheet, reference_error};

pub const MODES: &[&str] = &["none", "reveal", "step", "loop"];
pub const ACTIONS: &[&str] = &["play", "pause", "replay", "prev", "next"];

/// `normalized_controller`.
pub fn normalised_controller(body: &str) -> String {
    body.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

fn ascii_decimal(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// `canonical_controller`.
pub fn canonical_controller(template: &str, template_display: &str) -> Result<String, String> {
    let source = std::fs::read_to_string(template).map_err(|_| {
        format!(
            "cannot find the canonical controller at {template_display}; \
pass --motion-template or set DIAGRAM_DESIGN_SKILL_DIR to the diagram-design skill"
        )
    })?;
    let source = source.replace("\r\n", "\n").replace('\r', "\n");
    let parser = parse(&source);
    if parser.scripts.len() != 1 || !parser.scripts[0].closed {
        return Err("template-motion.html must contain one closed controller".to_string());
    }
    Ok(normalised_controller(&parser.scripts[0].body))
}

/// `check_svgs`.
pub fn check_svgs(parser: &DiagramParser, errors: &mut Vec<String>) {
    let checkable: Vec<&crate::selfcheck::html::Svg> = parser
        .svgs
        .iter()
        .filter(|svg| {
            svg.attrs
                .get("aria-hidden")
                .map(|value| value.to_lowercase() != "true")
                .unwrap_or(true)
        })
        .collect();
    if checkable.is_empty() {
        errors.push("diagram file needs at least one accessible (non-aria-hidden) SVG".to_string());
    }
    for (offset, svg) in checkable.iter().enumerate() {
        let number = offset + 1;
        if svg.attrs.get("role").map(String::as_str) != Some("img") {
            errors.push(format!("svg {number} needs role=img"));
        }
        let labelled: Vec<&str> = svg
            .attrs
            .get("aria-labelledby")
            .map(|value| value.split_whitespace().collect())
            .unwrap_or_default();
        let title_text = svg
            .title
            .as_ref()
            .map(|node| node.text.clone())
            .unwrap_or_default();
        let desc_text = svg
            .desc
            .as_ref()
            .map(|node| node.text.clone())
            .unwrap_or_default();
        let title_id = svg
            .title
            .as_ref()
            .and_then(|node| node.attrs.get("id").cloned())
            .unwrap_or_default();
        let desc_id = svg
            .desc
            .as_ref()
            .and_then(|node| node.attrs.get("id").cloned())
            .unwrap_or_default();
        if svg.first.as_deref() != Some("title") {
            errors.push(format!("svg {number} title must be its first child"));
        }
        if title_text.trim().is_empty() || desc_text.trim().is_empty() {
            errors.push(format!("svg {number} needs non-empty title and desc"));
        }
        if matches!(title_id.as_str(), "" | "title") || matches!(desc_id.as_str(), "" | "desc") {
            errors.push(format!(
                "svg {number} title/desc IDs must be diagram-prefixed, never bare"
            ));
        }
        if labelled != vec![title_id.as_str(), desc_id.as_str()] {
            errors.push(format!(
                "svg {number} aria-labelledby must name title then desc"
            ));
        }
    }
}

/// `check_scripts`.
pub fn check_scripts(
    parser: &DiagramParser,
    template: &str,
    template_display: &str,
    errors: &mut Vec<String>,
) {
    if parser.scripts.is_empty() {
        return;
    }
    if parser.scripts.len() > 1 {
        errors.push(format!(
            "at most one script is allowed; found {}",
            parser.scripts.len()
        ));
    }
    let mut canonical: Option<Result<String, String>> = None;
    for (offset, script) in parser.scripts.iter().enumerate() {
        let number = offset + 1;
        if !script.closed {
            errors.push(format!("script {number} must have a closing script tag"));
        }
        if script.attr_names != vec!["data-diagram-controls".to_string()]
            || script
                .attrs
                .get("data-diagram-controls")
                .map(String::as_str)
                != Some("")
        {
            errors.push(format!(
                "script {number} must carry only the canonical data-diagram-controls attribute"
            ));
            continue;
        }
        let canonical =
            canonical.get_or_insert_with(|| canonical_controller(template, template_display));
        match canonical {
            Ok(expected) => {
                if normalised_controller(&script.body) != *expected {
                    errors.push(format!(
                        "script {number} must exactly match the controller in template-motion.html"
                    ));
                }
            }
            Err(message) => errors.push(message.clone()),
        }
    }
}

/// `check_motion`.
pub fn check_motion(parser: &DiagramParser, source: &str, errors: &mut Vec<String>) {
    let has_motion_markup =
        !parser.roots.is_empty() || !parser.items.is_empty() || !parser.scripts.is_empty();
    if !has_motion_markup {
        return;
    }
    if parser.roots.len() != 1 {
        errors.push(format!(
            "expected exactly one data-motion-root; found {}",
            parser.roots.len()
        ));
        return;
    }
    let root = &parser.roots[0];
    let mode = root.get("data-motion-mode").cloned().unwrap_or_default();
    if !MODES.contains(&mode.as_str()) {
        let mut sorted: Vec<String> = MODES.iter().map(|item| (*item).to_string()).collect();
        sorted.sort();
        errors.push(format!(
            "data-motion-mode must be one of {}; got {}",
            repr_list_str(&sorted),
            repr_str(&mode)
        ));
    }
    let raw_count = root.get("data-step-count").cloned().unwrap_or_default();
    let count: i64 = if ascii_decimal(&raw_count) {
        raw_count.parse().unwrap_or(-1)
    } else {
        errors.push("data-step-count must be an ASCII decimal integer".to_string());
        -1
    };
    let minimum_count = if mode == "none" { 0 } else { 1 };
    if count < minimum_count || count > 8 {
        errors.push(format!(
            "semantic step count must be {minimum_count}..8; got {count}"
        ));
    }

    if parser.items.len() > 12 {
        errors.push(format!(
            "motion item budget is 12; found {}",
            parser.items.len()
        ));
    }
    let mut semantic_steps: Vec<i64> = Vec::new();
    for (offset, item) in parser.items.iter().enumerate() {
        let index = offset + 1;
        let raw_step = item.get("data-step").cloned().unwrap_or_default();
        if !ascii_decimal(&raw_step) {
            errors.push(format!(
                "motion item {index} has a non-ASCII-decimal data-step"
            ));
            continue;
        }
        let step: i64 = raw_step.parse().unwrap_or(-1);
        let decorative = item.contains_key("data-motion-decorative");
        if !decorative {
            semantic_steps.push(step);
            if item
                .get("aria-label")
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
            {
                errors.push(format!(
                    "semantic motion item {index} needs a non-color aria-label"
                ));
            }
        } else if item.get("aria-hidden").map(String::as_str) != Some("true")
            || item.get("focusable").map(String::as_str) != Some("false")
        {
            errors.push(format!(
                "decorative motion item {index} needs aria-hidden=true and focusable=false"
            ));
        }
        let inline = item
            .get("style")
            .cloned()
            .unwrap_or_default()
            .replace(' ', "")
            .to_lowercase();
        if ["display:none", "visibility:hidden", "opacity:0"]
            .iter()
            .any(|token| inline.contains(token))
        {
            errors.push(format!(
                "motion item {index} is hidden in source; the fallback must be visible"
            ));
        }
    }

    let expected: BTreeSet<i64> = if count > 0 {
        (1..=count).collect()
    } else {
        BTreeSet::new()
    };
    let found: BTreeSet<i64> = semantic_steps.iter().copied().collect();
    if found != expected {
        let sorted: Vec<i64> = found.iter().copied().collect();
        errors.push(format!(
            "semantic steps must be contiguous 1..{count}; found {}",
            repr_list_int(&sorted)
        ));
    }
    let mut counts: Vec<(i64, i64)> = Vec::new();
    let mut seen: HashMap<i64, usize> = HashMap::new();
    for step in &semantic_steps {
        match seen.get(step) {
            Some(index) => counts[*index].1 += 1,
            None => {
                seen.insert(*step, counts.len());
                counts.push((*step, 1));
            }
        }
    }
    let crowded: Vec<(i64, i64)> = counts.into_iter().filter(|(_, n)| *n > 2).collect();
    if !crowded.is_empty() {
        errors.push(format!(
            "no more than two semantic items may share a step; found {}",
            repr_dict_int_int(&crowded)
        ));
    }

    let script_free_mode = mode == "none" || mode == "loop";
    if script_free_mode && !parser.scripts.is_empty() {
        errors.push(format!("{mode} mode must be script-free"));
    }
    if script_free_mode
        && (parser.controls != 0 || !parser.actions.is_empty() || !parser.statuses.is_empty())
    {
        errors.push(format!(
            "{mode} mode must not expose playback controls or live status"
        ));
    }
    let controlled = mode == "step" || (mode == "reveal" && !parser.scripts.is_empty());
    if controlled {
        if parser.controls != 1 {
            errors.push(format!(
                "controlled mode needs one in-root control group; found {}",
                parser.controls
            ));
        }
        let mut missing: Vec<&str> = ACTIONS
            .iter()
            .filter(|action| !parser.actions.contains(**action))
            .copied()
            .collect();
        missing.sort_unstable();
        if !missing.is_empty() {
            errors.push(format!(
                "controlled mode is missing actions: {}",
                missing.join(", ")
            ));
        }
        if parser.statuses.is_empty() {
            errors.push("controlled mode needs data-motion-status".to_string());
        } else {
            let status = &parser.statuses[0];
            if status.get("role").map(String::as_str) != Some("status")
                || status.get("aria-live").map(String::as_str) != Some("polite")
                || status.get("aria-atomic").map(String::as_str) != Some("true")
            {
                errors.push(
                    "motion status needs role=status, aria-live=polite, aria-atomic=true"
                        .to_string(),
                );
            }
            if parser.statuses_in_controls != 0 {
                errors.push("motion status must sit outside data-motion-controls".to_string());
            }
        }
        if parser.scripts.is_empty() {
            errors.push("controlled mode needs the scoped control script".to_string());
        }
    }

    let style_source = parser.styles.join("");
    if !parser.scripts.is_empty() {
        if !reduced_motion_re().is_match(&style_source) {
            errors.push("missing reduced-motion CSS fallback (prefers-reduced-motion)".to_string());
        }
        if !print_media_re().is_match(&style_source) {
            errors.push("missing print CSS fallback (@media print)".to_string());
        }
        if !source.to_lowercase().contains("<noscript") {
            errors.push(
                "motion file needs a <noscript> explanation of the complete static frame"
                    .to_string(),
            );
        }
    }
}

fn reduced_motion_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)prefers-reduced-motion\s*:\s*reduce").unwrap())
}

fn print_media_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)@media\s+print\b").unwrap())
}

/// `verify`.
pub fn verify(source: &str, template: &str, template_display: &str) -> Vec<String> {
    let parser = parse(source);
    let mut errors: Vec<String> = Vec::new();
    errors.extend(parser.unsafe_findings.iter().cloned());
    for (tag, rel, value) in &parser.references {
        if let Some(finding) = reference_error(tag, rel, value) {
            errors.push(finding);
        }
    }
    check_svgs(&parser, &mut errors);
    check_scripts(&parser, template, template_display, &mut errors);
    check_motion(&parser, source, &mut errors);
    errors
}
