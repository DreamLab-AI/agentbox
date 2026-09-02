//! Direct port of `core.py`'s `detect_domain`.

/// `detect_domain`: ordered keyword scoring with first-max-wins tie-break, matching
/// Python's `max(scores, key=scores.get)` on an insertion-ordered `dict` (Python
/// 3.7+ dicts preserve insertion order, and `max` keeps the *first* item that
/// achieves the maximum when iterating in that order). A plain `HashMap` would not
/// give this guarantee in Rust, so domain/keyword pairs are walked as an ordered
/// slice of tuples instead.
pub fn detect_domain(query: &str) -> &'static str {
    const DOMAIN_KEYWORDS: &[(&str, &[&str])] = &[
        ("color", &["color", "palette", "hex", "#", "rgb"]),
        (
            "chart",
            &[
                "chart",
                "graph",
                "visualization",
                "trend",
                "bar",
                "pie",
                "scatter",
                "heatmap",
                "funnel",
            ],
        ),
        (
            "landing",
            &[
                "landing",
                "page",
                "cta",
                "conversion",
                "hero",
                "testimonial",
                "pricing",
                "section",
            ],
        ),
        (
            "product",
            &[
                "saas",
                "ecommerce",
                "e-commerce",
                "fintech",
                "healthcare",
                "gaming",
                "portfolio",
                "crypto",
                "dashboard",
            ],
        ),
        (
            "style",
            &[
                "style",
                "design",
                "ui",
                "minimalism",
                "glassmorphism",
                "neumorphism",
                "brutalism",
                "dark mode",
                "flat",
                "aurora",
                "prompt",
                "css",
                "implementation",
                "variable",
                "checklist",
                "tailwind",
            ],
        ),
        (
            "ux",
            &[
                "ux",
                "usability",
                "accessibility",
                "wcag",
                "touch",
                "scroll",
                "animation",
                "keyboard",
                "navigation",
                "mobile",
            ],
        ),
        (
            "typography",
            &["font", "typography", "heading", "serif", "sans"],
        ),
        (
            "icons",
            &[
                "icon",
                "icons",
                "lucide",
                "heroicons",
                "symbol",
                "glyph",
                "pictogram",
                "svg icon",
            ],
        ),
        (
            "react",
            &[
                "react",
                "next.js",
                "nextjs",
                "suspense",
                "memo",
                "usecallback",
                "useeffect",
                "rerender",
                "bundle",
                "waterfall",
                "barrel",
                "dynamic import",
                "rsc",
                "server component",
            ],
        ),
        (
            "web",
            &[
                "aria",
                "focus",
                "outline",
                "semantic",
                "virtualize",
                "autocomplete",
                "form",
                "input type",
                "preconnect",
            ],
        ),
    ];

    let query_lower = query.to_lowercase();
    let mut best_domain = DOMAIN_KEYWORDS[0].0;
    let mut best_score = 0i32;
    let mut have_best = false;

    for (domain, keywords) in DOMAIN_KEYWORDS {
        let score = keywords
            .iter()
            .filter(|kw| query_lower.contains(**kw))
            .count() as i32;
        if !have_best || score > best_score {
            best_score = score;
            best_domain = domain;
            have_best = true;
        }
    }

    if best_score > 0 {
        best_domain
    } else {
        "style"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_domain_prefers_first_max_on_tie() {
        // "chart" scores 1 (from "chart"), "product" scores 1 (from "dashboard");
        // chart is earlier in DOMAIN_KEYWORDS, so it must win the tie.
        assert_eq!(detect_domain("chart dashboard"), "chart");
    }

    #[test]
    fn detect_domain_matches_python_cross_check() {
        // Cross-checked against the real Python core.py detect_domain().
        assert_eq!(detect_domain("font heading"), "typography");
        assert_eq!(detect_domain("glassmorphism ui"), "style");
        assert_eq!(detect_domain("random unrelated text"), "style");
        assert_eq!(detect_domain("aria focus"), "web");
        assert_eq!(detect_domain("SaaS dashboard"), "product");
        assert_eq!(detect_domain("color palette hex"), "color");
    }

    #[test]
    fn detect_domain_defaults_to_style_when_nothing_matches() {
        assert_eq!(detect_domain("zzzzz qqqqq"), "style");
    }
}
