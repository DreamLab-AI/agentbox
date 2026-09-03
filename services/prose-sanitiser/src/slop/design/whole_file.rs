//! The whole-file design rules.
//!
//! Unlike the per-line checks these need the document as a whole: a typeface
//! census, a colour survey, heading order, and the indentation relationship
//! between two card declarations.

use std::sync::OnceLock;

use regex::Regex;

use super::rules::{
    hex_re, hue_of, is_bluish, is_grayish, is_named_family, is_pure_bw, is_purpleish,
    OVERUSED_FONTS,
};
use super::Severity;

// ---------------------------------------------------------------------------
// Per-file rules
// ---------------------------------------------------------------------------

/// A whole-file finding before suppression: `(rule, severity, line, snippet, message)`.
pub type FileFinding = (&'static str, Severity, usize, String, String);

/// The 1-based line number a byte offset falls on.
fn line_of(text: &str, offset: usize) -> usize {
    text[..offset].matches('\n').count() + 1
}

fn file_rule_overused_font(text: &str) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern = RE.get_or_init(|| {
        Regex::new(r"(?i)font-family\s*:\s*([^;{}]+)").expect("static regex compiles")
    });
    let mut out = Vec::new();
    let mut seen_named: Vec<String> = Vec::new();
    for captures in pattern.captures_iter(text) {
        let raw = &captures[1];
        let names: Vec<String> = raw
            .split(',')
            .map(|name| name.trim().trim_matches(['\'', '"']).to_lowercase())
            .collect();
        for name in &names {
            if is_named_family(name) && !seen_named.contains(name) {
                seen_named.push(name.clone());
            }
        }
        let first = names.first().cloned().unwrap_or_default();
        if OVERUSED_FONTS.contains(&first.as_str()) {
            let start = captures.get(0).expect("group 0").start();
            out.push((
                "overused-font",
                Severity::Warn,
                line_of(text, start),
                raw.trim().chars().take(80).collect(),
                format!("'{first}' as primary face — the #1 AI tell. Pair with a distinctive display face."),
            ));
        }
    }
    // Single-font: only one non-generic family across the whole file.
    if seen_named.len() == 1 {
        out.push((
            "single-font",
            Severity::Info,
            0,
            seen_named[0].clone(),
            "Only one typeface family — no heading/body contrast. Add a display face.".to_string(),
        ));
    }
    out
}

fn file_rule_pure_bw(text: &str) -> Vec<FileFinding> {
    let mut out = Vec::new();
    for found in hex_re().find_iter(text) {
        if is_pure_bw(found.as_str()) {
            out.push((
                "pure-black-white",
                Severity::Info,
                line_of(text, found.start()),
                found.as_str().to_string(),
                "Pure #000/#fff — tint slightly toward the accent for a designed feel.".to_string(),
            ));
            if out.len() >= 6 {
                break;
            }
        }
    }
    out
}

fn file_rule_purple_blue_gradient(text: &str) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern = RE.get_or_init(|| {
        Regex::new(r"(?i)linear-gradient\(([^)]*)\)").expect("static regex compiles")
    });
    let mut out = Vec::new();
    for found in pattern.find_iter(text) {
        let body = found.as_str();
        let colours: Vec<(u8, u8, u8)> = hex_re()
            .find_iter(body)
            .map(|hex| hue_of(hex.as_str()))
            .collect();
        if colours.iter().copied().any(is_bluish) && colours.iter().copied().any(is_purpleish) {
            out.push((
                "purple-blue-gradient",
                Severity::Warn,
                line_of(text, found.start()),
                body.chars().take(80).collect(),
                "Blue→purple gradient — the canonical AI SaaS hero. Use a flat brand color."
                    .to_string(),
            ));
        }
    }
    out
}

/// A rule block that sets both a coloured background and a grey text colour.
fn file_rule_gray_on_color(text: &str) -> Vec<FileFinding> {
    static BLOCK: OnceLock<Regex> = OnceLock::new();
    static BG: OnceLock<Regex> = OnceLock::new();
    static FG: OnceLock<Regex> = OnceLock::new();
    let block_re = BLOCK.get_or_init(|| Regex::new(r"\{[^{}]*\}").expect("static regex compiles"));
    let bg_re = BG.get_or_init(|| {
        Regex::new(r"(?i)background(?:-color)?\s*:\s*([^;]+)").expect("static regex compiles")
    });
    // The Python used a `(?<!-)` lookbehind to exclude `border-color`,
    // `background-color` and friends. Rust's regex has no lookaround, so the
    // preceding byte is checked directly — same rule, explicit.
    let fg_re =
        FG.get_or_init(|| Regex::new(r"(?i)color\s*:\s*([^;]+)").expect("static regex compiles"));

    let mut out = Vec::new();
    for block_match in block_re.find_iter(text) {
        let block = block_match.as_str();
        let Some(bg) = bg_re.captures(block) else {
            continue;
        };
        let Some(fg) = fg_re.captures_iter(block).find(|captures| {
            let start = captures.get(0).expect("group 0").start();
            start == 0 || block.as_bytes()[start - 1] != b'-'
        }) else {
            continue;
        };
        let (Some(bg_hex), Some(fg_hex)) = (hex_re().find(&bg[1]), hex_re().find(&fg[1])) else {
            continue;
        };
        let bg_rgb = hue_of(bg_hex.as_str());
        if !is_grayish(bg_rgb)
            && is_grayish(hue_of(fg_hex.as_str()))
            && !is_pure_bw(bg_hex.as_str())
            && bg_rgb.0.max(bg_rgb.1).max(bg_rgb.2) > 40
        {
            out.push((
                "gray-on-color",
                Severity::Warn,
                line_of(text, block_match.start()),
                block.chars().take(80).collect::<String>().replace('\n', " "),
                "Gray text on a colored background — muddy contrast. Use a tinted fg from the same hue.".to_string(),
            ));
        }
    }
    out
}

/// HTML/JSX heuristic: a `card` class nested inside another `card`.
fn file_rule_nested_cards(lines: &[&str]) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern = RE.get_or_init(|| {
        Regex::new(r#"class(Name)?\s*=\s*["'][^"']*\bcard\b"#).expect("static regex compiles")
    });
    let card_lines: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| pattern.is_match(line))
        .map(|(index, _)| index + 1)
        .collect();

    let mut out = Vec::new();
    if card_lines.len() >= 2 {
        // Two card declarations within six lines, with increasing indentation,
        // read as a nesting.
        for pair in card_lines.windows(2) {
            let (first, second) = (pair[0], pair[1]);
            if second > first && second - first <= 6 {
                let indent = |line: &str| line.len() - line.trim_start().len();
                if indent(lines[second - 1]) > indent(lines[first - 1]) {
                    out.push((
                        "nested-cards",
                        Severity::Info,
                        second,
                        lines[second - 1].trim().chars().take(80).collect(),
                        "Card nested inside a card — collapse one level; borders-in-borders is clutter.".to_string(),
                    ));
                }
            }
        }
    }
    out
}

fn file_rule_skipped_heading(text: &str) -> Vec<FileFinding> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let pattern = RE.get_or_init(|| Regex::new(r"(?i)<h([1-6])\b").expect("static regex compiles"));
    let mut out = Vec::new();
    let mut previous = 0u32;
    for captures in pattern.captures_iter(text) {
        let level: u32 = captures[1].parse().unwrap_or(0);
        let line = line_of(text, captures.get(0).expect("group 0").start());
        if previous > 0 && level > previous + 1 {
            out.push((
                "skipped-heading",
                Severity::Warn,
                line,
                format!("<h{level}>"),
                format!("Heading jumps h{previous}→h{level} — breaks document outline / a11y."),
            ));
        }
        previous = level;
    }
    out
}

fn file_rule_everything_centered(text: &str) -> Vec<FileFinding> {
    static CSS: OnceLock<Regex> = OnceLock::new();
    static TAILWIND: OnceLock<Regex> = OnceLock::new();
    let count = CSS
        .get_or_init(|| Regex::new(r"(?i)text-align\s*:\s*center").expect("static regex compiles"))
        .find_iter(text)
        .count()
        + TAILWIND
            .get_or_init(|| Regex::new(r"\btext-center\b").expect("static regex compiles"))
            .find_iter(text)
            .count();
    if count >= 5 {
        return vec![(
            "everything-centered",
            Severity::Info,
            0,
            format!("{count} center declarations"),
            format!("{count} center-aligned blocks — default-centering flattens hierarchy. Left-align body, center sparingly."),
        )];
    }
    Vec::new()
}

/// Run every whole-file rule.
pub fn file_rules(text: &str, lines: &[&str]) -> Vec<FileFinding> {
    let mut out = Vec::new();
    out.extend(file_rule_overused_font(text));
    out.extend(file_rule_pure_bw(text));
    out.extend(file_rule_purple_blue_gradient(text));
    out.extend(file_rule_gray_on_color(text));
    out.extend(file_rule_nested_cards(lines));
    out.extend(file_rule_skipped_heading(text));
    out.extend(file_rule_everything_centered(text));
    out
}
