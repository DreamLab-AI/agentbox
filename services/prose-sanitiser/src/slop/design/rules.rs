//! The per-line design anti-pattern rules.
//!
//! The CLI-detectable layer of the slop catalogue: what can be decided from
//! source statically. The browser- and LLM-only layers stay documented in
//! `references/slop-rules-catalog.md` for the agent to apply by judgment.

use std::sync::OnceLock;

use regex::Regex;

use super::Severity;

/// Ubiquitous typefaces that signal "AI default" when used as the only or
/// display face.
pub const OVERUSED_FONTS: &[&str] = &[
    "inter",
    "roboto",
    "open sans",
    "lato",
    "montserrat",
    "poppins",
    "nunito",
    "space grotesk",
    "source sans pro",
];

/// Generic families that do not count as a named typeface.
const GENERIC_FAMILIES: &[&str] = &[
    "sans-serif",
    "serif",
    "monospace",
    "system-ui",
    "ui-sans-serif",
    "-apple-system",
];

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("static regex compiles")
}

/// The shared hex-colour pattern.
pub fn hex_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| re(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b"))
}

/// `(r,g,b)` 0-255 from a `#rgb` or `#rrggbb` string.
pub fn hue_of(hex: &str) -> (u8, u8, u8) {
    let text = hex.trim_start_matches('#');
    let expanded: String = if text.len() == 3 {
        text.chars().flat_map(|c| [c, c]).collect()
    } else {
        text.to_string()
    };
    let byte = |range: std::ops::Range<usize>| {
        u8::from_str_radix(expanded.get(range).unwrap_or("0"), 16).unwrap_or(0)
    };
    (byte(0..2), byte(2..4), byte(4..6))
}

pub fn is_bluish((r, g, b): (u8, u8, u8)) -> bool {
    b > 150 && b as u16 > r as u16 + 30 && b >= g
}

pub fn is_purpleish((r, g, b): (u8, u8, u8)) -> bool {
    b > 120 && r > 90 && r < b && (g as i16) < r as i16 - 20 && (g as i16) < b as i16 - 20
}

pub fn is_pure_bw(hex: &str) -> bool {
    let text = hex.trim_start_matches('#').to_lowercase();
    let expanded: String = if text.len() == 3 {
        text.chars().flat_map(|c| [c, c]).collect()
    } else {
        text
    };
    expanded == "000000" || expanded == "ffffff"
}

/// Near-neutral: the channels differ by at most 12.
pub fn is_grayish((r, g, b): (u8, u8, u8)) -> bool {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    max - min <= 12
}

/// A per-line check, seeing the raw line.
pub type LineCheck = fn(&str) -> Option<(Severity, String)>;

pub fn rule_gradient_text(line: &str) -> Option<(Severity, String)> {
    let low = line.to_lowercase();
    if (low.contains("background-clip") || low.contains("-webkit-background-clip"))
        && low.contains("text")
    {
        return Some((
            Severity::Warn,
            "Gradient clipped to text — kills scannability and contrast control.".into(),
        ));
    }
    if low.contains("text-fill-color") && low.contains("transparent") {
        return Some((
            Severity::Warn,
            "Transparent text fill (gradient text) — reduces legibility.".into(),
        ));
    }
    None
}

pub fn rule_bounce_easing(line: &str) -> Option<(Severity, String)> {
    static OVERSHOOT: OnceLock<Regex> = OnceLock::new();
    static NAMED: OnceLock<Regex> = OnceLock::new();
    let low = line.to_lowercase();
    // A negative control point means overshoot.
    if OVERSHOOT
        .get_or_init(|| re(r"(cubic-bezier\([^)]*-0?\.[0-9])"))
        .is_match(&low)
    {
        return Some((
            Severity::Warn,
            "Overshoot/elastic cubic-bezier — reads as dated bounce.".into(),
        ));
    }
    if NAMED
        .get_or_init(|| re(r"\b(bounce|elastic|back(in|out|inout)?)\b"))
        .is_match(&low)
        && (low.contains("transition")
            || low.contains("animation")
            || low.contains("ease")
            || low.contains("timing"))
    {
        return Some((
            Severity::Warn,
            "Bounce/elastic easing — dated motion. Prefer 150–300ms ease-out.".into(),
        ));
    }
    None
}

pub fn rule_layout_transition(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let low = line.to_lowercase();
    if RE
        .get_or_init(|| {
            re(r"transition\s*:\s*[^;{}]*\b(width|height|top|left|right|bottom|margin)\b")
        })
        .is_match(&low)
    {
        return Some((
            Severity::Warn,
            "Animating layout properties (width/height/top/left/margin) — causes reflow jank. Animate transform/opacity.".into(),
        ));
    }
    None
}

pub fn rule_tiny_text(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let low = line.to_lowercase();
    let captures = RE
        .get_or_init(|| re(r"font-size\s*:\s*(\d+(?:\.\d+)?)px"))
        .captures(&low)?;
    let value: f64 = captures[1].parse().ok()?;
    (value < 11.0).then(|| {
        (
            Severity::Warn,
            format!(
                "font-size {}px is below the 11px legibility floor.",
                &captures[1]
            ),
        )
    })
}

pub fn rule_tight_leading(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let low = line.to_lowercase();
    let captures = RE
        .get_or_init(|| re(r"line-height\s*:\s*(\d?\.\d+|\d)\s*;"))
        .captures(&low)?;
    let value: f64 = captures[1].parse().ok()?;
    (value > 0.0 && value < 1.3).then(|| {
        (
            Severity::Info,
            format!("line-height {value} is tight for body copy (aim 1.5–1.75)."),
        )
    })
}

pub fn rule_wide_tracking(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let low = line.to_lowercase();
    let captures = RE
        .get_or_init(|| re(r"letter-spacing\s*:\s*(\d*\.?\d+)em"))
        .captures(&low)?;
    let value: f64 = captures[1].parse().ok()?;
    (value > 0.15).then(|| {
        (
            Severity::Info,
            format!(
                "letter-spacing {}em exceeds 0.15em — only for short display, never body.",
                &captures[1]
            ),
        )
    })
}

pub fn rule_justified_text(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| re(r"text-align\s*:\s*justify"))
        .is_match(&line.to_lowercase())
        .then(|| {
            (
                Severity::Info,
                "Justified text on screen creates whitespace rivers — use left-align.".into(),
            )
        })
}

pub fn rule_allcaps_body(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| re(r"text-transform\s*:\s*uppercase"))
        .is_match(&line.to_lowercase())
        .then(|| {
            (
                Severity::Info,
                "Uppercase — fine for short labels, never for body passages (review context)."
                    .into(),
            )
        })
}

pub fn rule_pill_button(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| re(r"border-radius\s*:\s*(9999px|999px|50rem|100vmax)"))
        .is_match(&line.to_lowercase())
        .then(|| {
            (
                Severity::Info,
                "Fully-rounded pill radius — only if the brand thesis calls for it.".into(),
            )
        })
}

pub fn rule_dark_glow(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let low = line.to_lowercase();
    let captures = RE
        .get_or_init(|| re(r"text-shadow\s*:\s*[^;{}]*?(\d+)px\s+\d*\.?\d*px\s+(\d+)px"))
        .captures(&low)?;
    let blur: u32 = captures[2].parse().ok()?;
    (blur >= 8).then(|| {
        (
            Severity::Info,
            "Large text-shadow blur (neon glow) — dated unless the thesis is synthwave/Y2K.".into(),
        )
    })
}

pub fn rule_generic_drop_shadow(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| re(r"box-shadow\s*:\s*0\s+1px\s+3px\s+rgba\(0\s*,\s*0\s*,\s*0"))
        .is_match(&line.to_lowercase())
        .then(|| {
            (
                Severity::Info,
                "Default `0 1px 3px rgba(0,0,0,…)` shadow — generic. Tint the shadow to the surface.".into(),
            )
        })
}

pub fn rule_side_tab(line: &str) -> Option<(Severity, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let low = line.to_lowercase();
    let captures = RE
        .get_or_init(|| re(r"border-(left|right|top)\s*:\s*(\d+)px"))
        .captures(&low)?;
    let width: u32 = captures[2].parse().ok()?;
    (width >= 3).then(|| {
        (
            Severity::Info,
            "Thick one-sided border (side-tab stripe) — a tell when paired with rounded cards."
                .into(),
        )
    })
}

/// The per-line rule table, in the Python's order.
pub const LINE_RULES: &[(&str, LineCheck)] = &[
    ("gradient-text", rule_gradient_text),
    ("bounce-easing", rule_bounce_easing),
    ("layout-transition", rule_layout_transition),
    ("tiny-text", rule_tiny_text),
    ("tight-leading", rule_tight_leading),
    ("wide-tracking", rule_wide_tracking),
    ("justified-text", rule_justified_text),
    ("all-caps-body", rule_allcaps_body),
    ("pill-button", rule_pill_button),
    ("dark-glow", rule_dark_glow),
    ("generic-drop-shadow", rule_generic_drop_shadow),
    ("side-tab", rule_side_tab),
];

/// Is this font-family name a real named face rather than a generic keyword?
pub fn is_named_family(name: &str) -> bool {
    !name.is_empty() && !GENERIC_FAMILIES.contains(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colour_helpers_classify_the_canonical_cases() {
        assert_eq!(hue_of("#fff"), (255, 255, 255));
        assert_eq!(hue_of("#1a2b3c"), (0x1a, 0x2b, 0x3c));
        assert!(is_pure_bw("#000"));
        assert!(is_pure_bw("#FFFFFF"));
        assert!(!is_pure_bw("#010101"));
        assert!(is_grayish((100, 105, 108)));
        assert!(!is_grayish((200, 100, 50)));
        assert!(is_bluish(hue_of("#3b82f6")));
        assert!(is_purpleish(hue_of("#8b5cf6")));
    }

    #[test]
    fn gradient_text_is_caught_both_ways() {
        assert!(rule_gradient_text("  -webkit-background-clip: text;").is_some());
        assert!(rule_gradient_text("  -webkit-text-fill-color: transparent;").is_some());
        assert!(rule_gradient_text("  background: red;").is_none());
    }

    #[test]
    fn tiny_text_uses_an_eleven_pixel_floor() {
        assert!(rule_tiny_text("font-size: 10px;").is_some());
        assert!(rule_tiny_text("font-size: 10.5px;").is_some());
        assert!(rule_tiny_text("font-size: 11px;").is_none());
        assert!(rule_tiny_text("font-size: 1rem;").is_none());
    }

    #[test]
    fn leading_and_tracking_thresholds_match_the_python() {
        assert!(rule_tight_leading("line-height: 1.2;").is_some());
        assert!(rule_tight_leading("line-height: 1.5;").is_none());
        assert!(rule_wide_tracking("letter-spacing: 0.2em;").is_some());
        assert!(rule_wide_tracking("letter-spacing: 0.1em;").is_none());
    }

    #[test]
    fn layout_transitions_and_bounce_easing_are_warnings() {
        let (severity, _) = rule_layout_transition("transition: width 200ms ease;").unwrap();
        assert_eq!(severity, Severity::Warn);
        assert!(rule_layout_transition("transition: transform 200ms ease;").is_none());
        assert!(
            rule_bounce_easing("transition-timing-function: cubic-bezier(.34,-0.4,.2,1);").is_some()
        );
        assert!(rule_bounce_easing("animation: bounce 1s;").is_some());
        assert!(rule_bounce_easing("transition: opacity 200ms ease-out;").is_none());
    }

    #[test]
    fn the_side_tab_and_glow_rules_need_their_thresholds() {
        assert!(rule_side_tab("border-left: 4px solid red;").is_some());
        assert!(rule_side_tab("border-left: 2px solid red;").is_none());
        assert!(rule_dark_glow("text-shadow: 0px 0px 12px #0ff;").is_some());
        assert!(rule_dark_glow("text-shadow: 0px 1px 2px #333;").is_none());
    }

    #[test]
    fn generic_families_are_not_named_faces() {
        assert!(is_named_family("inter"));
        assert!(!is_named_family("sans-serif"));
        assert!(!is_named_family(""));
    }
}
