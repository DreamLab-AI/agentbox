//! Static configuration mirroring `core.py`'s `CSV_CONFIG` / `STACK_CONFIG` / `_STACK_COLS`.
//!
//! Kept as plain `const` data (no `Lazy`/`OnceCell` needed — every field is a
//! `'static` string or slice) so lookups are zero-cost and order-preserving, which
//! matters for `detect_domain`'s first-max-wins tie-break (see `search_core::detect_domain`).

/// One entry of `CSV_CONFIG`: the CSV file, the columns BM25 searches over, and the
/// columns copied into each result row (in output order).
#[derive(Debug, Clone, Copy)]
pub struct DomainConfig {
    pub file: &'static str,
    pub search_cols: &'static [&'static str],
    pub output_cols: &'static [&'static str],
}

/// `CSV_CONFIG` from `core.py`, as an ordered list of `(domain, config)` pairs.
/// Order matches the Python dict's insertion order exactly.
pub const CSV_CONFIG: &[(&str, DomainConfig)] = &[
    (
        "style",
        DomainConfig {
            file: "styles.csv",
            search_cols: &[
                "Style Category",
                "Keywords",
                "Best For",
                "Type",
                "AI Prompt Keywords",
            ],
            output_cols: &[
                "Style Category",
                "Type",
                "Keywords",
                "Primary Colors",
                "Effects & Animation",
                "Best For",
                "Performance",
                "Accessibility",
                "Framework Compatibility",
                "Complexity",
                "AI Prompt Keywords",
                "CSS/Technical Keywords",
                "Implementation Checklist",
                "Design System Variables",
            ],
        },
    ),
    (
        "color",
        DomainConfig {
            file: "colors.csv",
            search_cols: &["Product Type", "Notes"],
            output_cols: &[
                "Product Type",
                "Primary (Hex)",
                "Secondary (Hex)",
                "CTA (Hex)",
                "Background (Hex)",
                "Text (Hex)",
                "Notes",
            ],
        },
    ),
    (
        "chart",
        DomainConfig {
            file: "charts.csv",
            search_cols: &[
                "Data Type",
                "Keywords",
                "Best Chart Type",
                "Accessibility Notes",
            ],
            output_cols: &[
                "Data Type",
                "Keywords",
                "Best Chart Type",
                "Secondary Options",
                "Color Guidance",
                "Accessibility Notes",
                "Library Recommendation",
                "Interactive Level",
            ],
        },
    ),
    (
        "landing",
        DomainConfig {
            file: "landing.csv",
            search_cols: &[
                "Pattern Name",
                "Keywords",
                "Conversion Optimization",
                "Section Order",
            ],
            output_cols: &[
                "Pattern Name",
                "Keywords",
                "Section Order",
                "Primary CTA Placement",
                "Color Strategy",
                "Conversion Optimization",
            ],
        },
    ),
    (
        "product",
        DomainConfig {
            file: "products.csv",
            search_cols: &[
                "Product Type",
                "Keywords",
                "Primary Style Recommendation",
                "Key Considerations",
            ],
            output_cols: &[
                "Product Type",
                "Keywords",
                "Primary Style Recommendation",
                "Secondary Styles",
                "Landing Page Pattern",
                "Dashboard Style (if applicable)",
                "Color Palette Focus",
            ],
        },
    ),
    (
        "ux",
        DomainConfig {
            file: "ux-guidelines.csv",
            search_cols: &["Category", "Issue", "Description", "Platform"],
            output_cols: &[
                "Category",
                "Issue",
                "Platform",
                "Description",
                "Do",
                "Don't",
                "Code Example Good",
                "Code Example Bad",
                "Severity",
            ],
        },
    ),
    (
        "typography",
        DomainConfig {
            file: "typography.csv",
            search_cols: &[
                "Font Pairing Name",
                "Category",
                "Mood/Style Keywords",
                "Best For",
                "Heading Font",
                "Body Font",
            ],
            output_cols: &[
                "Font Pairing Name",
                "Category",
                "Heading Font",
                "Body Font",
                "Mood/Style Keywords",
                "Best For",
                "Google Fonts URL",
                "CSS Import",
                "Tailwind Config",
                "Notes",
            ],
        },
    ),
    (
        "icons",
        DomainConfig {
            file: "icons.csv",
            search_cols: &["Category", "Icon Name", "Keywords", "Best For"],
            output_cols: &[
                "Category",
                "Icon Name",
                "Keywords",
                "Library",
                "Import Code",
                "Usage",
                "Best For",
                "Style",
            ],
        },
    ),
    (
        "react",
        DomainConfig {
            file: "react-performance.csv",
            search_cols: &["Category", "Issue", "Keywords", "Description"],
            output_cols: &[
                "Category",
                "Issue",
                "Platform",
                "Description",
                "Do",
                "Don't",
                "Code Example Good",
                "Code Example Bad",
                "Severity",
            ],
        },
    ),
    (
        "web",
        DomainConfig {
            file: "web-interface.csv",
            search_cols: &["Category", "Issue", "Keywords", "Description"],
            output_cols: &[
                "Category",
                "Issue",
                "Platform",
                "Description",
                "Do",
                "Don't",
                "Code Example Good",
                "Code Example Bad",
                "Severity",
            ],
        },
    ),
];

/// `STACK_CONFIG` from `core.py`: stack name -> data file, in insertion order.
pub const STACK_CONFIG: &[(&str, &str)] = &[
    ("html-tailwind", "stacks/html-tailwind.csv"),
    ("react", "stacks/react.csv"),
    ("nextjs", "stacks/nextjs.csv"),
    ("astro", "stacks/astro.csv"),
    ("vue", "stacks/vue.csv"),
    ("nuxtjs", "stacks/nuxtjs.csv"),
    ("nuxt-ui", "stacks/nuxt-ui.csv"),
    ("svelte", "stacks/svelte.csv"),
    ("swiftui", "stacks/swiftui.csv"),
    ("react-native", "stacks/react-native.csv"),
    ("flutter", "stacks/flutter.csv"),
    ("shadcn", "stacks/shadcn.csv"),
    ("jetpack-compose", "stacks/jetpack-compose.csv"),
];

/// `_STACK_COLS["search_cols"]` — common search columns shared by every stack CSV.
pub const STACK_SEARCH_COLS: &[&str] = &["Category", "Guideline", "Description", "Do", "Don't"];

/// `_STACK_COLS["output_cols"]` — common output columns shared by every stack CSV.
pub const STACK_OUTPUT_COLS: &[&str] = &[
    "Category",
    "Guideline",
    "Description",
    "Do",
    "Don't",
    "Code Good",
    "Code Bad",
    "Severity",
    "Docs URL",
];

/// Default `max_results` (`MAX_RESULTS` in `core.py`).
pub const MAX_RESULTS: usize = 3;

/// Look up a `CSV_CONFIG` entry by domain name.
pub fn domain_config(domain: &str) -> Option<DomainConfig> {
    CSV_CONFIG
        .iter()
        .find(|(name, _)| *name == domain)
        .map(|(_, cfg)| *cfg)
}

/// `AVAILABLE_STACKS = list(STACK_CONFIG.keys())`.
pub fn available_stacks() -> Vec<&'static str> {
    STACK_CONFIG.iter().map(|(name, _)| *name).collect()
}

/// Look up a stack's data file by stack name.
pub fn stack_file(stack: &str) -> Option<&'static str> {
    STACK_CONFIG
        .iter()
        .find(|(name, _)| *name == stack)
        .map(|(_, file)| *file)
}

/// All domain names, in `CSV_CONFIG` insertion order (used by the CLI's `--domain`
/// choices, mirroring `list(CSV_CONFIG.keys())` in `search.py`).
pub fn domain_names() -> Vec<&'static str> {
    CSV_CONFIG.iter().map(|(name, _)| *name).collect()
}
