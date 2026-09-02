//! Direct port of `design_system.py`'s `format_page_override_md`,
//! `_generate_intelligent_overrides`, and `_detect_page_type`.

use chrono::Local;

use super::design_system::DesignSystem;
use super::outcome::{OrderedRow, SearchOutcome};
use super::search_core::search;

/// `_generate_intelligent_overrides`'s return shape: everything needed to render a
/// page override file. Keys use `Vec<(String, String)>` rather than `HashMap` for
/// `layout`/`spacing`/`typography`/`colors` so insertion order (the order search
/// results were discovered in) is preserved in the rendered Markdown, matching
/// Python `dict`'s insertion-ordered iteration in `format_page_override_md`'s
/// `for key, value in layout.items()` loops.
#[derive(Debug, Clone, Default)]
pub struct PageOverrides {
    pub page_type: String,
    pub layout: Vec<(String, String)>,
    pub spacing: Vec<(String, String)>,
    pub typography: Vec<(String, String)>,
    pub colors: Vec<(String, String)>,
    pub components: Vec<String>,
    pub unique_components: Vec<String>,
    pub recommendations: Vec<String>,
}

/// Ordered key-set helper: set `key` to `value` if not already present (Python
/// dict-item-assignment `d[key] = value` overwrites unconditionally; every site that
/// writes into `layout`/`spacing`/`colors` here only writes each key once per call,
/// so plain "insert or overwrite, preserving first-seen position" matches Python's
/// dict semantics exactly).
fn set_ordered(pairs: &mut Vec<(String, String)>, key: &str, value: String) {
    if let Some(entry) = pairs.iter_mut().find(|(k, _)| k == key) {
        entry.1 = value;
    } else {
        pairs.push((key.to_string(), value));
    }
}

/// `_detect_page_type`: ordered pattern-list matching — the first pattern list whose
/// any keyword matches wins (order matters for ties, so this is a plain ordered
/// slice, not a `HashMap`).
pub fn detect_page_type(context: &str, style_results: &[OrderedRow]) -> String {
    const PAGE_PATTERNS: &[(&[&str], &str)] = &[
        (
            &[
                "dashboard",
                "admin",
                "analytics",
                "data",
                "metrics",
                "stats",
                "monitor",
                "overview",
            ],
            "Dashboard / Data View",
        ),
        (
            &[
                "checkout", "payment", "cart", "purchase", "order", "billing",
            ],
            "Checkout / Payment",
        ),
        (
            &["settings", "profile", "account", "preferences", "config"],
            "Settings / Profile",
        ),
        (
            &["landing", "marketing", "homepage", "hero", "home", "promo"],
            "Landing / Marketing",
        ),
        (
            &["login", "signin", "signup", "register", "auth", "password"],
            "Authentication",
        ),
        (
            &["pricing", "plans", "subscription", "tiers", "packages"],
            "Pricing / Plans",
        ),
        (
            &["blog", "article", "post", "news", "content", "story"],
            "Blog / Article",
        ),
        (
            &["product", "item", "detail", "pdp", "shop", "store"],
            "Product Detail",
        ),
        (
            &["search", "results", "browse", "filter", "catalog", "list"],
            "Search Results",
        ),
        (
            &["empty", "404", "error", "not found", "zero"],
            "Empty State",
        ),
    ];

    let context_lower = context.to_lowercase();

    for (keywords, page_type) in PAGE_PATTERNS {
        if keywords.iter().any(|kw| context_lower.contains(kw)) {
            return (*page_type).to_string();
        }
    }

    if let Some(style) = style_results.first() {
        let best_for = style.get("Best For").unwrap_or("").to_lowercase();
        if best_for.contains("dashboard") || best_for.contains("data") {
            return "Dashboard / Data View".to_string();
        } else if best_for.contains("landing") || best_for.contains("marketing") {
            return "Landing / Marketing".to_string();
        }
    }

    "General".to_string()
}

fn extract_results(outcome: &SearchOutcome) -> Vec<OrderedRow> {
    match outcome {
        SearchOutcome::Domain { results, .. } => results.clone(),
        SearchOutcome::Stack { results, .. } => results.clone(),
        _ => Vec::new(),
    }
}

/// `_generate_intelligent_overrides`: layered search across style/ux/landing to
/// build page-specific overrides instead of hardcoded page types.
pub fn generate_intelligent_overrides(page_name: &str, page_query: Option<&str>) -> PageOverrides {
    let page_lower = page_name.to_lowercase();
    let query_lower = page_query.unwrap_or("").to_lowercase();
    let combined_context = format!("{page_lower} {query_lower}");

    let style_results = extract_results(&search(&combined_context, Some("style"), 1));
    let ux_results = extract_results(&search(&combined_context, Some("ux"), 3));
    let landing_results = extract_results(&search(&combined_context, Some("landing"), 1));

    let page_type = detect_page_type(&combined_context, &style_results);

    let mut layout: Vec<(String, String)> = Vec::new();
    let mut spacing: Vec<(String, String)> = Vec::new();
    let typography: Vec<(String, String)> = Vec::new();
    let mut colors: Vec<(String, String)> = Vec::new();
    let mut components: Vec<String> = Vec::new();
    let unique_components: Vec<String> = Vec::new();
    let mut recommendations: Vec<String> = Vec::new();

    if let Some(style) = style_results.first() {
        let keywords = style.get("Keywords").unwrap_or("").to_lowercase();
        let effects = style.get("Effects & Animation").unwrap_or("");

        if ["data", "dense", "dashboard", "grid"]
            .iter()
            .any(|kw| keywords.contains(kw))
        {
            set_ordered(&mut layout, "Max Width", "1400px or full-width".to_string());
            set_ordered(
                &mut layout,
                "Grid",
                "12-column grid for data flexibility".to_string(),
            );
            set_ordered(
                &mut spacing,
                "Content Density",
                "High — optimize for information display".to_string(),
            );
        } else if ["minimal", "simple", "clean", "single"]
            .iter()
            .any(|kw| keywords.contains(kw))
        {
            set_ordered(
                &mut layout,
                "Max Width",
                "800px (narrow, focused)".to_string(),
            );
            set_ordered(&mut layout, "Layout", "Single column, centered".to_string());
            set_ordered(
                &mut spacing,
                "Content Density",
                "Low — focus on clarity".to_string(),
            );
        } else {
            set_ordered(&mut layout, "Max Width", "1200px (standard)".to_string());
            set_ordered(
                &mut layout,
                "Layout",
                "Full-width sections, centered content".to_string(),
            );
        }

        if !effects.is_empty() {
            recommendations.push(format!("Effects: {effects}"));
        }
    }

    for ux in &ux_results {
        let category = ux.get("Category").unwrap_or("");
        let do_text = ux.get("Do").unwrap_or("");
        let dont_text = ux.get("Don't").unwrap_or("");
        if !do_text.is_empty() {
            recommendations.push(format!("{category}: {do_text}"));
        }
        if !dont_text.is_empty() {
            components.push(format!("Avoid: {dont_text}"));
        }
    }

    if let Some(landing) = landing_results.first() {
        let sections = landing.get("Section Order").unwrap_or("");
        let cta_placement = landing.get("Primary CTA Placement").unwrap_or("");
        let color_strategy = landing.get("Color Strategy").unwrap_or("");

        if !sections.is_empty() {
            set_ordered(&mut layout, "Sections", sections.to_string());
        }
        if !cta_placement.is_empty() {
            recommendations.push(format!("CTA Placement: {cta_placement}"));
        }
        if !color_strategy.is_empty() {
            set_ordered(&mut colors, "Strategy", color_strategy.to_string());
        }
    }

    if layout.is_empty() {
        set_ordered(&mut layout, "Max Width", "1200px".to_string());
        set_ordered(&mut layout, "Layout", "Responsive grid".to_string());
    }

    if recommendations.is_empty() {
        recommendations = vec![
            "Refer to MASTER.md for all design rules".to_string(),
            "Add specific overrides as needed for this page".to_string(),
        ];
    }

    PageOverrides {
        page_type,
        layout,
        spacing,
        typography,
        colors,
        components,
        unique_components,
        recommendations,
    }
}

/// `format_page_override_md`: render a page-specific override file with
/// intelligently generated content.
pub fn format_page_override_md(
    ds: &DesignSystem,
    page_name: &str,
    page_query: Option<&str>,
) -> String {
    let project = if ds.project_name.is_empty() {
        "PROJECT"
    } else {
        ds.project_name.as_str()
    };
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let page_title = title_case(&page_name.replace(['-', '_'], " "));

    let overrides = generate_intelligent_overrides(page_name, page_query);

    let mut lines: Vec<String> = Vec::new();

    lines.push(format!("# {page_title} Page Overrides"));
    lines.push(String::new());
    lines.push(format!("> **PROJECT:** {project}"));
    lines.push(format!("> **Generated:** {timestamp}"));
    lines.push(format!("> **Page Type:** {}", overrides.page_type));
    lines.push(String::new());
    lines.push(
        "> \u{26a0}\u{fe0f} **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`)."
            .to_string(),
    );
    lines.push(
        "> Only deviations from the Master are documented here. For all other rules, refer to the Master."
            .to_string(),
    );
    lines.push(String::new());
    lines.push("---".to_string());
    lines.push(String::new());

    lines.push("## Page-Specific Rules".to_string());
    lines.push(String::new());

    push_kv_section(
        &mut lines,
        "Layout Overrides",
        &overrides.layout,
        "Master layout",
    );
    push_kv_section(
        &mut lines,
        "Spacing Overrides",
        &overrides.spacing,
        "Master spacing",
    );
    push_kv_section(
        &mut lines,
        "Typography Overrides",
        &overrides.typography,
        "Master typography",
    );
    push_kv_section(
        &mut lines,
        "Color Overrides",
        &overrides.colors,
        "Master colors",
    );

    lines.push("### Component Overrides".to_string());
    lines.push(String::new());
    if overrides.components.is_empty() {
        lines.push("- No overrides — use Master component specs".to_string());
    } else {
        for comp in &overrides.components {
            lines.push(format!("- {comp}"));
        }
    }
    lines.push(String::new());

    lines.push("---".to_string());
    lines.push(String::new());
    lines.push("## Page-Specific Components".to_string());
    lines.push(String::new());
    if overrides.unique_components.is_empty() {
        lines.push("- No unique components for this page".to_string());
    } else {
        for comp in &overrides.unique_components {
            lines.push(format!("- {comp}"));
        }
    }
    lines.push(String::new());

    lines.push("---".to_string());
    lines.push(String::new());
    lines.push("## Recommendations".to_string());
    lines.push(String::new());
    for rec in &overrides.recommendations {
        lines.push(format!("- {rec}"));
    }
    lines.push(String::new());

    lines.join("\n")
}

fn push_kv_section(
    lines: &mut Vec<String>,
    heading: &str,
    pairs: &[(String, String)],
    no_override_of: &str,
) {
    lines.push(format!("### {heading}"));
    lines.push(String::new());
    if pairs.is_empty() {
        lines.push(format!("- No overrides — use {no_override_of}"));
    } else {
        for (key, value) in pairs {
            lines.push(format!("- **{key}:** {value}"));
        }
    }
    lines.push(String::new());
}

/// `str.title()`: uppercase the first letter of each whitespace-separated word,
/// lowercase the rest. Python's `.title()` is more aggressive (it also treats
/// apostrophes as word boundaries), but `format_page_override_md` only ever calls it
/// on a page name already split on `-`/`_` into plain space-separated words, so a
/// simple word-boundary title-case matches Python's observable behaviour here.
fn title_case(s: &str) -> String {
    s.split(' ')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_page_type_matches_first_pattern_in_order() {
        // "dashboard" and "settings" both appear; Dashboard/Data View is first in
        // PAGE_PATTERNS so it must win.
        assert_eq!(
            detect_page_type("settings dashboard", &[]),
            "Dashboard / Data View"
        );
    }

    #[test]
    fn detect_page_type_falls_back_to_general() {
        assert_eq!(detect_page_type("zzzz totally unmatched", &[]), "General");
    }

    #[test]
    fn detect_page_type_checkout() {
        assert_eq!(detect_page_type("checkout flow", &[]), "Checkout / Payment");
    }

    #[test]
    fn title_case_handles_hyphenated_page_names() {
        assert_eq!(
            title_case(&"dashboard-overview".replace('-', " ")),
            "Dashboard Overview"
        );
    }

    #[test]
    fn format_page_override_md_dashboard_page_end_to_end() {
        let ds = DesignSystem {
            project_name: "Test".to_string(),
            ..Default::default()
        };
        let out = format_page_override_md(&ds, "dashboard", Some("SaaS dashboard"));
        assert!(out.starts_with("# Dashboard Page Overrides"));
        assert!(out.contains("> **PROJECT:** Test"));
        assert!(out.contains("> **Page Type:** Dashboard / Data View"));
        assert!(out.contains("## Layout Overrides"));
        assert!(out.contains("## Recommendations"));
    }

    #[test]
    fn empty_layout_falls_back_to_default_max_width() {
        // A page/query combination unlikely to hit any style/landing search result
        // should still get the "no results" defaults.
        let overrides = generate_intelligent_overrides("zzzzzzzzzz", Some("zzzzzzzzzz"));
        let has_max_width = overrides.layout.iter().any(|(k, _)| k == "Max Width");
        assert!(has_max_width);
    }
}
