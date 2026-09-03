//! Embedded CSV reference data for the `ui-ux-pro-max` skill.
//!
//! The Python original (`core.py`) resolved `DATA_DIR` relative to the script's own
//! location on disk (`Path(__file__).parent.parent / "data"`). A compiled Rust binary
//! has no equivalent notion of "next to the source file" at runtime, so instead of
//! copying the CSV files into this crate (which would create a second copy that can
//! drift from the original) we embed them at *compile* time directly from their
//! original location under `skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/` via
//! `include_str!`. Cargo resolves `include_str!` paths relative to the current source
//! file (this one), not the crate root, so the `../../../../` prefix walks from
//! `services/skill-tools/src/uiux/` up to the repo root before descending into
//! `skills/...`. This keeps the CSVs as the single source of truth on disk — nothing
//! here needs to stay in sync with a duplicate.
//!
//! Because this is a `[workspace]`-rooted standalone crate under `services/skill-tools`
//! two levels below the repo root, and this file lives one level deeper still under
//! `src/uiux/`, the walk-up is four `..` segments: `uiux -> src -> skill-tools ->
//! services -> <repo root>`.

// ---- Domain CSVs (CSV_CONFIG) ----
pub const STYLES_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/styles.csv");
pub const COLORS_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/colors.csv");
pub const CHARTS_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/charts.csv");
pub const LANDING_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/landing.csv");
pub const PRODUCTS_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/products.csv");
pub const UX_GUIDELINES_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/ux-guidelines.csv");
pub const TYPOGRAPHY_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/typography.csv");
pub const ICONS_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/icons.csv");
pub const REACT_PERFORMANCE_CSV: &str = include_str!(
    "../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/react-performance.csv"
);
pub const WEB_INTERFACE_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/web-interface.csv");

// ---- Design-system reasoning CSV ----
pub const UI_REASONING_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/ui-reasoning.csv");

// ---- Stack CSVs (STACK_CONFIG) ----
pub const STACK_HTML_TAILWIND_CSV: &str = include_str!(
    "../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/html-tailwind.csv"
);
pub const STACK_REACT_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/react.csv");
pub const STACK_NEXTJS_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/nextjs.csv");
pub const STACK_ASTRO_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/astro.csv");
pub const STACK_VUE_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/vue.csv");
pub const STACK_NUXTJS_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/nuxtjs.csv");
pub const STACK_NUXT_UI_CSV: &str = include_str!(
    "../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/nuxt-ui.csv"
);
pub const STACK_SVELTE_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/svelte.csv");
pub const STACK_SWIFTUI_CSV: &str = include_str!(
    "../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/swiftui.csv"
);
pub const STACK_REACT_NATIVE_CSV: &str = include_str!(
    "../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/react-native.csv"
);
pub const STACK_FLUTTER_CSV: &str = include_str!(
    "../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/flutter.csv"
);
pub const STACK_SHADCN_CSV: &str =
    include_str!("../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/shadcn.csv");
pub const STACK_JETPACK_COMPOSE_CSV: &str = include_str!(
    "../../../../skills/ui-ux-pro-max-skill/src/ui-ux-pro-max/data/stacks/jetpack-compose.csv"
);

/// Resolve the embedded CSV text for a `CSV_CONFIG`/`STACK_CONFIG`/reasoning file path,
/// mirroring how `core.py`/`design_system.py` resolved `DATA_DIR / config["file"]`.
///
/// `file` is the exact string stored in the config tables, e.g. `"styles.csv"` or
/// `"stacks/react.csv"`.
pub fn csv_by_filename(file: &str) -> Option<&'static str> {
    Some(match file {
        "styles.csv" => STYLES_CSV,
        "colors.csv" => COLORS_CSV,
        "charts.csv" => CHARTS_CSV,
        "landing.csv" => LANDING_CSV,
        "products.csv" => PRODUCTS_CSV,
        "ux-guidelines.csv" => UX_GUIDELINES_CSV,
        "typography.csv" => TYPOGRAPHY_CSV,
        "icons.csv" => ICONS_CSV,
        "react-performance.csv" => REACT_PERFORMANCE_CSV,
        "web-interface.csv" => WEB_INTERFACE_CSV,
        "ui-reasoning.csv" => UI_REASONING_CSV,
        "stacks/html-tailwind.csv" => STACK_HTML_TAILWIND_CSV,
        "stacks/react.csv" => STACK_REACT_CSV,
        "stacks/nextjs.csv" => STACK_NEXTJS_CSV,
        "stacks/astro.csv" => STACK_ASTRO_CSV,
        "stacks/vue.csv" => STACK_VUE_CSV,
        "stacks/nuxtjs.csv" => STACK_NUXTJS_CSV,
        "stacks/nuxt-ui.csv" => STACK_NUXT_UI_CSV,
        "stacks/svelte.csv" => STACK_SVELTE_CSV,
        "stacks/swiftui.csv" => STACK_SWIFTUI_CSV,
        "stacks/react-native.csv" => STACK_REACT_NATIVE_CSV,
        "stacks/flutter.csv" => STACK_FLUTTER_CSV,
        "stacks/shadcn.csv" => STACK_SHADCN_CSV,
        "stacks/jetpack-compose.csv" => STACK_JETPACK_COMPOSE_CSV,
        _ => return None,
    })
}
