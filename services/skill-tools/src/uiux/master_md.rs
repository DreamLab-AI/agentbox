//! Direct port of `design_system.py`'s `format_master_md`.

use chrono::Local;

use super::design_system::DesignSystem;

/// `format_master_md`: render `MASTER.md` — the hierarchical Master + Overrides
/// global design system file. Every heading, table row, and CSS block is reproduced
/// verbatim from `design_system.py` (only the interpolated values change).
pub fn format_master_md(ds: &DesignSystem) -> String {
    let project = if ds.project_name.is_empty() {
        "PROJECT"
    } else {
        ds.project_name.as_str()
    };
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut lines: Vec<String> = Vec::new();

    lines.push("# Design System Master File".to_string());
    lines.push(String::new());
    lines.push(
        "> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`."
            .to_string(),
    );
    lines.push("> If that file exists, its rules **override** this Master file.".to_string());
    lines.push("> If not, strictly follow the rules below.".to_string());
    lines.push(String::new());
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push(format!("**Project:** {project}"));
    lines.push(format!("**Generated:** {timestamp}"));
    let category = if ds.category.is_empty() {
        "General"
    } else {
        ds.category.as_str()
    };
    lines.push(format!("**Category:** {category}"));
    lines.push(String::new());
    lines.push("---".to_string());
    lines.push(String::new());

    // Global Rules section.
    lines.push("## Global Rules".to_string());
    lines.push(String::new());

    // Color Palette.
    lines.push("### Color Palette".to_string());
    lines.push(String::new());
    lines.push("| Role | Hex | CSS Variable |".to_string());
    lines.push("|------|-----|--------------|".to_string());
    lines.push(format!(
        "| Primary | `{}` | `--color-primary` |",
        default_if_empty(&ds.colors.primary, "#2563EB")
    ));
    lines.push(format!(
        "| Secondary | `{}` | `--color-secondary` |",
        default_if_empty(&ds.colors.secondary, "#3B82F6")
    ));
    lines.push(format!(
        "| CTA/Accent | `{}` | `--color-cta` |",
        default_if_empty(&ds.colors.cta, "#F97316")
    ));
    lines.push(format!(
        "| Background | `{}` | `--color-background` |",
        default_if_empty(&ds.colors.background, "#F8FAFC")
    ));
    lines.push(format!(
        "| Text | `{}` | `--color-text` |",
        default_if_empty(&ds.colors.text, "#1E293B")
    ));
    lines.push(String::new());
    if !ds.colors.notes.is_empty() {
        lines.push(format!("**Color Notes:** {}", ds.colors.notes));
        lines.push(String::new());
    }

    // Typography.
    lines.push("### Typography".to_string());
    lines.push(String::new());
    lines.push(format!(
        "- **Heading Font:** {}",
        default_if_empty(&ds.typography.heading, "Inter")
    ));
    lines.push(format!(
        "- **Body Font:** {}",
        default_if_empty(&ds.typography.body, "Inter")
    ));
    if !ds.typography.mood.is_empty() {
        lines.push(format!("- **Mood:** {}", ds.typography.mood));
    }
    if !ds.typography.google_fonts_url.is_empty() {
        lines.push(format!(
            "- **Google Fonts:** [{} + {}]({})",
            ds.typography.heading, ds.typography.body, ds.typography.google_fonts_url
        ));
    }
    lines.push(String::new());
    if !ds.typography.css_import.is_empty() {
        lines.push("**CSS Import:**".to_string());
        lines.push("```css".to_string());
        lines.push(ds.typography.css_import.clone());
        lines.push("```".to_string());
        lines.push(String::new());
    }

    // Spacing Variables.
    lines.push("### Spacing Variables".to_string());
    lines.push(String::new());
    lines.push("| Token | Value | Usage |".to_string());
    lines.push("|-------|-------|-------|".to_string());
    lines.push("| `--space-xs` | `4px` / `0.25rem` | Tight gaps |".to_string());
    lines.push("| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |".to_string());
    lines.push("| `--space-md` | `16px` / `1rem` | Standard padding |".to_string());
    lines.push("| `--space-lg` | `24px` / `1.5rem` | Section padding |".to_string());
    lines.push("| `--space-xl` | `32px` / `2rem` | Large gaps |".to_string());
    lines.push("| `--space-2xl` | `48px` / `3rem` | Section margins |".to_string());
    lines.push("| `--space-3xl` | `64px` / `4rem` | Hero padding |".to_string());
    lines.push(String::new());

    // Shadow Depths.
    lines.push("### Shadow Depths".to_string());
    lines.push(String::new());
    lines.push("| Level | Value | Usage |".to_string());
    lines.push("|-------|-------|-------|".to_string());
    lines.push("| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |".to_string());
    lines.push("| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |".to_string());
    lines.push("| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |".to_string());
    lines.push(
        "| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |"
            .to_string(),
    );
    lines.push(String::new());

    // Component Specs section.
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push("## Component Specs".to_string());
    lines.push(String::new());

    push_button_css(&mut lines, ds);
    push_card_css(&mut lines, ds);
    push_input_css(&mut lines, ds);
    push_modal_css(&mut lines);

    // Style section.
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push("## Style Guidelines".to_string());
    lines.push(String::new());
    lines.push(format!(
        "**Style:** {}",
        default_if_empty(&ds.style.name, "Minimalism")
    ));
    lines.push(String::new());
    if !ds.style.keywords.is_empty() {
        lines.push(format!("**Keywords:** {}", ds.style.keywords));
        lines.push(String::new());
    }
    if !ds.style.best_for.is_empty() {
        lines.push(format!("**Best For:** {}", ds.style.best_for));
        lines.push(String::new());
    }
    if !ds.key_effects.is_empty() {
        lines.push(format!("**Key Effects:** {}", ds.key_effects));
        lines.push(String::new());
    }

    // Layout Pattern.
    lines.push("### Page Pattern".to_string());
    lines.push(String::new());
    lines.push(format!("**Pattern Name:** {}", ds.pattern.name));
    lines.push(String::new());
    if !ds.pattern.conversion.is_empty() {
        lines.push(format!(
            "- **Conversion Strategy:** {}",
            ds.pattern.conversion
        ));
    }
    if !ds.pattern.cta_placement.is_empty() {
        lines.push(format!("- **CTA Placement:** {}", ds.pattern.cta_placement));
    }
    lines.push(format!("- **Section Order:** {}", ds.pattern.sections));
    lines.push(String::new());

    // Anti-Patterns section.
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push("## Anti-Patterns (Do NOT Use)".to_string());
    lines.push(String::new());
    if !ds.anti_patterns.is_empty() {
        for anti in ds.anti_patterns.split('+') {
            let anti = anti.trim();
            if !anti.is_empty() {
                lines.push(format!("- \u{274c} {anti}"));
            }
        }
    }
    lines.push(String::new());
    lines.push("### Additional Forbidden Patterns".to_string());
    lines.push(String::new());
    lines.push(
        "- \u{274c} **Emojis as icons** \u{2014} Use SVG icons (Heroicons, Lucide, Simple Icons)"
            .to_string(),
    );
    lines.push("- \u{274c} **Missing cursor:pointer** \u{2014} All clickable elements must have cursor:pointer".to_string());
    lines.push(
        "- \u{274c} **Layout-shifting hovers** \u{2014} Avoid scale transforms that shift layout"
            .to_string(),
    );
    lines.push(
        "- \u{274c} **Low contrast text** \u{2014} Maintain 4.5:1 minimum contrast ratio"
            .to_string(),
    );
    lines.push(
        "- \u{274c} **Instant state changes** \u{2014} Always use transitions (150-300ms)"
            .to_string(),
    );
    lines.push(
        "- \u{274c} **Invisible focus states** \u{2014} Focus states must be visible for a11y"
            .to_string(),
    );
    lines.push(String::new());

    // Pre-Delivery Checklist.
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push("## Pre-Delivery Checklist".to_string());
    lines.push(String::new());
    lines.push("Before delivering any UI code, verify:".to_string());
    lines.push(String::new());
    lines.push("- [ ] No emojis used as icons (use SVG instead)".to_string());
    lines.push("- [ ] All icons from consistent icon set (Heroicons/Lucide)".to_string());
    lines.push("- [ ] `cursor-pointer` on all clickable elements".to_string());
    lines.push("- [ ] Hover states with smooth transitions (150-300ms)".to_string());
    lines.push("- [ ] Light mode: text contrast 4.5:1 minimum".to_string());
    lines.push("- [ ] Focus states visible for keyboard navigation".to_string());
    lines.push("- [ ] `prefers-reduced-motion` respected".to_string());
    lines.push("- [ ] Responsive: 375px, 768px, 1024px, 1440px".to_string());
    lines.push("- [ ] No content hidden behind fixed navbars".to_string());
    lines.push("- [ ] No horizontal scroll on mobile".to_string());
    lines.push(String::new());

    lines.join("\n")
}

fn default_if_empty<'a>(value: &'a str, default: &'a str) -> &'a str {
    if value.is_empty() {
        default
    } else {
        value
    }
}

fn push_button_css(lines: &mut Vec<String>, ds: &DesignSystem) {
    let cta = default_if_empty(&ds.colors.cta, "#F97316");
    let primary = default_if_empty(&ds.colors.primary, "#2563EB");
    lines.push("### Buttons".to_string());
    lines.push(String::new());
    lines.push("```css".to_string());
    lines.push("/* Primary Button */".to_string());
    lines.push(".btn-primary {".to_string());
    lines.push(format!("  background: {cta};"));
    lines.push("  color: white;".to_string());
    lines.push("  padding: 12px 24px;".to_string());
    lines.push("  border-radius: 8px;".to_string());
    lines.push("  font-weight: 600;".to_string());
    lines.push("  transition: all 200ms ease;".to_string());
    lines.push("  cursor: pointer;".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push(".btn-primary:hover {".to_string());
    lines.push("  opacity: 0.9;".to_string());
    lines.push("  transform: translateY(-1px);".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push("/* Secondary Button */".to_string());
    lines.push(".btn-secondary {".to_string());
    lines.push("  background: transparent;".to_string());
    lines.push(format!("  color: {primary};"));
    lines.push(format!("  border: 2px solid {primary};"));
    lines.push("  padding: 12px 24px;".to_string());
    lines.push("  border-radius: 8px;".to_string());
    lines.push("  font-weight: 600;".to_string());
    lines.push("  transition: all 200ms ease;".to_string());
    lines.push("  cursor: pointer;".to_string());
    lines.push("}".to_string());
    lines.push("```".to_string());
    lines.push(String::new());
}

fn push_card_css(lines: &mut Vec<String>, ds: &DesignSystem) {
    // Note: `format_master_md`'s card background uses a different fallback
    // (`#FFFFFF`) than the rest of the file's `background` fallback (`#F8FAFC`) —
    // `best_color.get('Background (Hex)', '#FFFFFF')` in `design_system.py`'s
    // `format_master_md`, vs. `'#F8FAFC'` in `generate()`/`format_ascii_box`. Since
    // `ds.colors.background` is never actually empty by the time it reaches a
    // formatter (it always carries `generate()`'s `#F8FAFC` fallback already), this
    // second fallback is unreachable in practice — reproduced anyway for fidelity.
    let background = default_if_empty(&ds.colors.background, "#FFFFFF");
    lines.push("### Cards".to_string());
    lines.push(String::new());
    lines.push("```css".to_string());
    lines.push(".card {".to_string());
    lines.push(format!("  background: {background};"));
    lines.push("  border-radius: 12px;".to_string());
    lines.push("  padding: 24px;".to_string());
    lines.push("  box-shadow: var(--shadow-md);".to_string());
    lines.push("  transition: all 200ms ease;".to_string());
    lines.push("  cursor: pointer;".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push(".card:hover {".to_string());
    lines.push("  box-shadow: var(--shadow-lg);".to_string());
    lines.push("  transform: translateY(-2px);".to_string());
    lines.push("}".to_string());
    lines.push("```".to_string());
    lines.push(String::new());
}

fn push_input_css(lines: &mut Vec<String>, ds: &DesignSystem) {
    let primary = default_if_empty(&ds.colors.primary, "#2563EB");
    lines.push("### Inputs".to_string());
    lines.push(String::new());
    lines.push("```css".to_string());
    lines.push(".input {".to_string());
    lines.push("  padding: 12px 16px;".to_string());
    lines.push("  border: 1px solid #E2E8F0;".to_string());
    lines.push("  border-radius: 8px;".to_string());
    lines.push("  font-size: 16px;".to_string());
    lines.push("  transition: border-color 200ms ease;".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push(".input:focus {".to_string());
    lines.push(format!("  border-color: {primary};"));
    lines.push("  outline: none;".to_string());
    lines.push(format!("  box-shadow: 0 0 0 3px {primary}20;"));
    lines.push("}".to_string());
    lines.push("```".to_string());
    lines.push(String::new());
}

fn push_modal_css(lines: &mut Vec<String>) {
    lines.push("### Modals".to_string());
    lines.push(String::new());
    lines.push("```css".to_string());
    lines.push(".modal-overlay {".to_string());
    lines.push("  background: rgba(0, 0, 0, 0.5);".to_string());
    lines.push("  backdrop-filter: blur(4px);".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push(".modal {".to_string());
    lines.push("  background: white;".to_string());
    lines.push("  border-radius: 16px;".to_string());
    lines.push("  padding: 32px;".to_string());
    lines.push("  box-shadow: var(--shadow-xl);".to_string());
    lines.push("  max-width: 500px;".to_string());
    lines.push("  width: 90%;".to_string());
    lines.push("}".to_string());
    lines.push("```".to_string());
    lines.push(String::new());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_master_md_contains_project_and_headings() {
        let ds = DesignSystem {
            project_name: "Test".to_string(),
            ..Default::default()
        };
        let out = format_master_md(&ds);
        assert!(out.starts_with("# Design System Master File"));
        assert!(out.contains("**Project:** Test"));
        assert!(out.contains("## Global Rules"));
        assert!(out.contains("### Color Palette"));
        assert!(out.contains("--color-primary"));
        assert!(out.contains("## Component Specs"));
        assert!(out.contains(".btn-primary {"));
        assert!(out.contains("## Anti-Patterns (Do NOT Use)"));
        assert!(out.contains("## Pre-Delivery Checklist"));
    }

    #[test]
    fn format_master_md_lists_each_anti_pattern_bulleted() {
        let mut ds = DesignSystem {
            project_name: "Test".to_string(),
            ..Default::default()
        };
        ds.anti_patterns = "Complex onboarding flow + Cluttered layout".to_string();
        let out = format_master_md(&ds);
        assert!(out.contains("- \u{274c} Complex onboarding flow"));
        assert!(out.contains("- \u{274c} Cluttered layout"));
    }
}
