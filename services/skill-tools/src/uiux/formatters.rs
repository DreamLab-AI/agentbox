//! Direct port of `design_system.py`'s output formatters: `format_ascii_box`,
//! `format_markdown`, and the `wrap_text` helper nested inside `format_ascii_box`.

use super::design_system::DesignSystem;

/// Fixed box width used by `format_ascii_box` (`BOX_WIDTH = 90` in `design_system.py`).
pub const BOX_WIDTH: usize = 90;

/// `wrap_text` (nested function inside `format_ascii_box` in the Python source):
/// greedily wrap `text` into lines starting with `prefix`, each line capped at
/// `width - 2` characters (matching `len(current_line) + len(word) + 1 <= width - 2`).
/// Uses `chars().count()` for length, matching Python's code-point-based `len()`.
fn wrap_text(text: &str, prefix: &str, width: usize) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut lines = Vec::new();
    let mut current_line = prefix.to_string();
    for word in text.split_whitespace() {
        let projected_len = current_line.chars().count() + word.chars().count() + 1;
        if projected_len <= width.saturating_sub(2) {
            if current_line != prefix {
                current_line.push(' ');
            }
            current_line.push_str(word);
        } else {
            if current_line != prefix {
                lines.push(current_line.clone());
            }
            current_line = format!("{prefix}{word}");
        }
    }
    if current_line != prefix {
        lines.push(current_line);
    }
    lines
}

/// `str.ljust(width)`: pad `s` on the right with spaces to `width` **characters**
/// (not bytes), leaving it unchanged if already that long or longer.
fn ljust(s: &str, width: usize) -> String {
    let len = s.chars().count();
    if len >= width {
        s.to_string()
    } else {
        let mut out = String::with_capacity(s.len() + (width - len));
        out.push_str(s);
        out.extend(std::iter::repeat_n(' ', width - len));
        out
    }
}

/// A normal box row: `content` does **not** include the leading `|` — this builds
/// `f"|{content}".ljust(BOX_WIDTH) + "|"` exactly as `core.py` does (the leading pipe
/// is padded *as part of* the ljust'd string, not appended after padding).
fn content_line(content: &str) -> String {
    format!("{}|", ljust(&format!("|{content}"), BOX_WIDTH))
}

/// A line already produced by `wrap_text` (which bakes the leading `|` into its
/// `prefix`): `line.ljust(BOX_WIDTH) + "|"`.
fn wrapped_line(line: &str) -> String {
    format!("{}|", ljust(line, BOX_WIDTH))
}

/// The blank spacer row. Preserved verbatim from `core.py`'s
/// `"|" + " " * BOX_WIDTH + "|"`, which is built *without* going through `ljust` —
/// unlike every other row, so it comes out **`BOX_WIDTH + 2`** characters wide, one
/// character wider than a `content_line`/`wrapped_line` row (`BOX_WIDTH + 1`). This
/// is a genuine off-by-one quirk in the original Python (confirmed by running it:
/// border/content rows are 91 chars at `BOX_WIDTH = 90`, blank rows are 92) — kept
/// exactly as-is for byte-for-byte output fidelity rather than "fixed".
fn blank_line() -> String {
    format!("|{}|", " ".repeat(BOX_WIDTH))
}

fn border_line() -> String {
    format!("+{}+", "-".repeat(BOX_WIDTH - 1))
}

/// `format_ascii_box`: render the design system as a fixed-width (90-col) ASCII box.
pub fn format_ascii_box(ds: &DesignSystem) -> String {
    let project = if ds.project_name.is_empty() {
        "PROJECT"
    } else {
        ds.project_name.as_str()
    };

    let sections: Vec<&str> = ds
        .pattern
        .sections
        .split('>')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut lines: Vec<String> = Vec::new();

    lines.push(border_line());
    lines.push(content_line(&format!(
        "  TARGET: {project} - RECOMMENDED DESIGN SYSTEM"
    )));
    lines.push(border_line());
    lines.push(blank_line());

    // Pattern section.
    lines.push(content_line(&format!("  PATTERN: {}", ds.pattern.name)));
    if !ds.pattern.conversion.is_empty() {
        lines.push(content_line(&format!(
            "     Conversion: {}",
            ds.pattern.conversion
        )));
    }
    if !ds.pattern.cta_placement.is_empty() {
        lines.push(content_line(&format!(
            "     CTA: {}",
            ds.pattern.cta_placement
        )));
    }
    lines.push(content_line("     Sections:"));
    for (i, section) in sections.iter().enumerate() {
        lines.push(content_line(&format!("       {}. {}", i + 1, section)));
    }
    lines.push(blank_line());

    // Style section.
    lines.push(content_line(&format!("  STYLE: {}", ds.style.name)));
    if !ds.style.keywords.is_empty() {
        for line in wrap_text(
            &format!("Keywords: {}", ds.style.keywords),
            "|     ",
            BOX_WIDTH,
        ) {
            lines.push(wrapped_line(&line));
        }
    }
    if !ds.style.best_for.is_empty() {
        for line in wrap_text(
            &format!("Best For: {}", ds.style.best_for),
            "|     ",
            BOX_WIDTH,
        ) {
            lines.push(wrapped_line(&line));
        }
    }
    if !ds.style.performance.is_empty() || !ds.style.accessibility.is_empty() {
        let perf_a11y = format!(
            "Performance: {} | Accessibility: {}",
            ds.style.performance, ds.style.accessibility
        );
        lines.push(content_line(&format!("     {perf_a11y}")));
    }
    lines.push(blank_line());

    // Colors section.
    lines.push(content_line("  COLORS:"));
    lines.push(content_line(&format!(
        "     Primary:    {}",
        ds.colors.primary
    )));
    lines.push(content_line(&format!(
        "     Secondary:  {}",
        ds.colors.secondary
    )));
    lines.push(content_line(&format!("     CTA:        {}", ds.colors.cta)));
    lines.push(content_line(&format!(
        "     Background: {}",
        ds.colors.background
    )));
    lines.push(content_line(&format!(
        "     Text:       {}",
        ds.colors.text
    )));
    if !ds.colors.notes.is_empty() {
        for line in wrap_text(&format!("Notes: {}", ds.colors.notes), "|     ", BOX_WIDTH) {
            lines.push(wrapped_line(&line));
        }
    }
    lines.push(blank_line());

    // Typography section.
    lines.push(content_line(&format!(
        "  TYPOGRAPHY: {} / {}",
        ds.typography.heading, ds.typography.body
    )));
    if !ds.typography.mood.is_empty() {
        for line in wrap_text(
            &format!("Mood: {}", ds.typography.mood),
            "|     ",
            BOX_WIDTH,
        ) {
            lines.push(wrapped_line(&line));
        }
    }
    if !ds.typography.best_for.is_empty() {
        for line in wrap_text(
            &format!("Best For: {}", ds.typography.best_for),
            "|     ",
            BOX_WIDTH,
        ) {
            lines.push(wrapped_line(&line));
        }
    }
    if !ds.typography.google_fonts_url.is_empty() {
        lines.push(content_line(&format!(
            "     Google Fonts: {}",
            ds.typography.google_fonts_url
        )));
    }
    if !ds.typography.css_import.is_empty() {
        let truncated: String = ds.typography.css_import.chars().take(70).collect();
        lines.push(content_line(&format!("     CSS Import: {truncated}...")));
    }
    lines.push(blank_line());

    // Key Effects section.
    if !ds.key_effects.is_empty() {
        lines.push(content_line("  KEY EFFECTS:"));
        for line in wrap_text(&ds.key_effects, "|     ", BOX_WIDTH) {
            lines.push(wrapped_line(&line));
        }
        lines.push(blank_line());
    }

    // Anti-patterns section.
    if !ds.anti_patterns.is_empty() {
        lines.push(content_line("  AVOID (Anti-patterns):"));
        for line in wrap_text(&ds.anti_patterns, "|     ", BOX_WIDTH) {
            lines.push(wrapped_line(&line));
        }
        lines.push(blank_line());
    }

    // Pre-Delivery Checklist section.
    lines.push(content_line("  PRE-DELIVERY CHECKLIST:"));
    for item in checklist_items() {
        lines.push(content_line(&format!("     {item}")));
    }
    lines.push(blank_line());

    lines.push(border_line());

    lines.join("\n")
}

fn checklist_items() -> [&'static str; 7] {
    [
        "[ ] No emojis as icons (use SVG: Heroicons/Lucide)",
        "[ ] cursor-pointer on all clickable elements",
        "[ ] Hover states with smooth transitions (150-300ms)",
        "[ ] Light mode: text contrast 4.5:1 minimum",
        "[ ] Focus states visible for keyboard nav",
        "[ ] prefers-reduced-motion respected",
        "[ ] Responsive: 375px, 768px, 1024px, 1440px",
    ]
}

/// `format_markdown`: render the design system as markdown.
pub fn format_markdown(ds: &DesignSystem) -> String {
    let project = if ds.project_name.is_empty() {
        "PROJECT"
    } else {
        ds.project_name.as_str()
    };

    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("## Design System: {project}"));
    lines.push(String::new());

    // Pattern section.
    lines.push("### Pattern".to_string());
    lines.push(format!("- **Name:** {}", ds.pattern.name));
    if !ds.pattern.conversion.is_empty() {
        lines.push(format!("- **Conversion Focus:** {}", ds.pattern.conversion));
    }
    if !ds.pattern.cta_placement.is_empty() {
        lines.push(format!("- **CTA Placement:** {}", ds.pattern.cta_placement));
    }
    if !ds.pattern.color_strategy.is_empty() {
        lines.push(format!(
            "- **Color Strategy:** {}",
            ds.pattern.color_strategy
        ));
    }
    lines.push(format!("- **Sections:** {}", ds.pattern.sections));
    lines.push(String::new());

    // Style section.
    lines.push("### Style".to_string());
    lines.push(format!("- **Name:** {}", ds.style.name));
    if !ds.style.keywords.is_empty() {
        lines.push(format!("- **Keywords:** {}", ds.style.keywords));
    }
    if !ds.style.best_for.is_empty() {
        lines.push(format!("- **Best For:** {}", ds.style.best_for));
    }
    if !ds.style.performance.is_empty() || !ds.style.accessibility.is_empty() {
        lines.push(format!(
            "- **Performance:** {} | **Accessibility:** {}",
            ds.style.performance, ds.style.accessibility
        ));
    }
    lines.push(String::new());

    // Colors section.
    lines.push("### Colors".to_string());
    lines.push("| Role | Hex |".to_string());
    lines.push("|------|-----|".to_string());
    lines.push(format!("| Primary | {} |", ds.colors.primary));
    lines.push(format!("| Secondary | {} |", ds.colors.secondary));
    lines.push(format!("| CTA | {} |", ds.colors.cta));
    lines.push(format!("| Background | {} |", ds.colors.background));
    lines.push(format!("| Text | {} |", ds.colors.text));
    if !ds.colors.notes.is_empty() {
        lines.push(format!("\n*Notes: {}*", ds.colors.notes));
    }
    lines.push(String::new());

    // Typography section.
    lines.push("### Typography".to_string());
    lines.push(format!("- **Heading:** {}", ds.typography.heading));
    lines.push(format!("- **Body:** {}", ds.typography.body));
    if !ds.typography.mood.is_empty() {
        lines.push(format!("- **Mood:** {}", ds.typography.mood));
    }
    if !ds.typography.best_for.is_empty() {
        lines.push(format!("- **Best For:** {}", ds.typography.best_for));
    }
    if !ds.typography.google_fonts_url.is_empty() {
        lines.push(format!(
            "- **Google Fonts:** {}",
            ds.typography.google_fonts_url
        ));
    }
    if !ds.typography.css_import.is_empty() {
        lines.push("- **CSS Import:**".to_string());
        lines.push("```css".to_string());
        lines.push(ds.typography.css_import.clone());
        lines.push("```".to_string());
    }
    lines.push(String::new());

    // Key Effects section.
    if !ds.key_effects.is_empty() {
        lines.push("### Key Effects".to_string());
        lines.push(ds.key_effects.clone());
        lines.push(String::new());
    }

    // Anti-patterns section.
    if !ds.anti_patterns.is_empty() {
        lines.push("### Avoid (Anti-patterns)".to_string());
        lines.push(format!("- {}", ds.anti_patterns.replace(" + ", "\n- ")));
        lines.push(String::new());
    }

    // Pre-Delivery Checklist section.
    lines.push("### Pre-Delivery Checklist".to_string());
    lines.push("- [ ] No emojis as icons (use SVG: Heroicons/Lucide)".to_string());
    lines.push("- [ ] cursor-pointer on all clickable elements".to_string());
    lines.push("- [ ] Hover states with smooth transitions (150-300ms)".to_string());
    lines.push("- [ ] Light mode: text contrast 4.5:1 minimum".to_string());
    lines.push("- [ ] Focus states visible for keyboard nav".to_string());
    lines.push("- [ ] prefers-reduced-motion respected".to_string());
    lines.push("- [ ] Responsive: 375px, 768px, 1024px, 1440px".to_string());
    lines.push(String::new());

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_text_empty_returns_no_lines() {
        assert!(wrap_text("", "|     ", BOX_WIDTH).is_empty());
    }

    #[test]
    fn wrap_text_wraps_long_lines_under_width_minus_2() {
        let long = "word ".repeat(40);
        let lines = wrap_text(&long, "|     ", BOX_WIDTH);
        assert!(lines.len() > 1);
        for line in &lines {
            assert!(line.chars().count() <= BOX_WIDTH - 2);
        }
    }

    #[test]
    fn wrap_text_single_short_line() {
        let lines = wrap_text("short text", "|     ", BOX_WIDTH);
        assert_eq!(lines, vec!["|     short text".to_string()]);
    }

    #[test]
    fn ljust_pads_to_width() {
        assert_eq!(ljust("abc", 6), "abc   ");
        assert_eq!(ljust("abcdef", 3), "abcdef");
    }

    #[test]
    fn format_ascii_box_omits_empty_optional_sections() {
        let ds = DesignSystem {
            project_name: "Test".to_string(),
            ..Default::default()
        };
        let out = format_ascii_box(&ds);
        assert!(!out.contains("KEY EFFECTS"));
        assert!(!out.contains("AVOID (Anti-patterns)"));
        assert!(out.contains("PRE-DELIVERY CHECKLIST"));
        // Border/content/wrapped rows are BOX_WIDTH+1 chars; blank spacer rows are
        // BOX_WIDTH+2 (a genuine quirk of core.py's blank-line construction — see
        // `blank_line()`'s doc comment). Every line must be one or the other.
        for line in out.lines() {
            let len = line.chars().count();
            assert!(
                len == BOX_WIDTH + 1 || len == BOX_WIDTH + 2,
                "unexpected line width {len}: {line:?}"
            );
        }
    }

    #[test]
    fn blank_line_is_one_char_wider_than_content_line_bug_preserved() {
        assert_eq!(blank_line().chars().count(), BOX_WIDTH + 2);
        assert_eq!(content_line("x").chars().count(), BOX_WIDTH + 1);
        assert_eq!(border_line().chars().count(), BOX_WIDTH + 1);
    }

    #[test]
    fn format_markdown_includes_effects_and_anti_patterns_when_present() {
        let mut ds = DesignSystem {
            project_name: "Test".to_string(),
            ..Default::default()
        };
        ds.key_effects = "Subtle hover".to_string();
        ds.anti_patterns = "Bad thing A + Bad thing B".to_string();
        let out = format_markdown(&ds);
        assert!(out.contains("### Key Effects"));
        assert!(out.contains("Subtle hover"));
        assert!(out.contains("### Avoid (Anti-patterns)"));
        assert!(out.contains("- Bad thing A"));
        assert!(out.contains("- Bad thing B"));
    }
}
