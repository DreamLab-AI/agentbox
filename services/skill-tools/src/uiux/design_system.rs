//! Data structures for a generated design system, and the module-level
//! `generate_design_system` entry point from `design_system.py` (renamed
//! [`generate_design_system_text`] here to make clear it returns rendered text, not a
//! dict). The generation logic itself (`DesignSystemGenerator`) lives in
//! [`super::design_system_generator`].

/// `pattern` section of a generated design system.
#[derive(Debug, Clone, Default)]
pub struct Pattern {
    pub name: String,
    pub sections: String,
    pub cta_placement: String,
    pub color_strategy: String,
    pub conversion: String,
}

/// `style` section of a generated design system.
#[derive(Debug, Clone, Default)]
pub struct Style {
    pub name: String,
    pub type_: String,
    pub effects: String,
    pub keywords: String,
    pub best_for: String,
    pub performance: String,
    pub accessibility: String,
}

/// `colors` section of a generated design system.
#[derive(Debug, Clone, Default)]
pub struct Colors {
    pub primary: String,
    pub secondary: String,
    pub cta: String,
    pub background: String,
    pub text: String,
    pub notes: String,
}

/// `typography` section of a generated design system.
#[derive(Debug, Clone, Default)]
pub struct Typography {
    pub heading: String,
    pub body: String,
    pub mood: String,
    pub best_for: String,
    pub google_fonts_url: String,
    pub css_import: String,
}

/// The full generated design system dict, as returned by `DesignSystemGenerator.generate`.
#[derive(Debug, Clone, Default)]
pub struct DesignSystem {
    pub project_name: String,
    pub category: String,
    pub pattern: Pattern,
    pub style: Style,
    pub colors: Colors,
    pub typography: Typography,
    pub key_effects: String,
    pub anti_patterns: String,
    pub severity: String,
}

/// `generate_design_system` (module-level function in `design_system.py`): generate a
/// design system and render it as ascii/markdown text, optionally persisting it to
/// `design-system/<project-slug>/` first (mirroring the Python function's exact
/// call order: generate, then persist-if-requested, then format).
pub fn generate_design_system_text(
    query: &str,
    project_name: Option<&str>,
    output_format: &str,
    persist: bool,
    page: Option<&str>,
    output_dir: Option<&std::path::Path>,
) -> std::io::Result<String> {
    let generator = super::design_system_generator::DesignSystemGenerator::new();
    let ds = generator.generate(query, project_name);

    if persist {
        super::persist::persist_design_system(&ds, page, output_dir, Some(query))?;
    }

    Ok(if output_format == "markdown" {
        super::formatters::format_markdown(&ds)
    } else {
        super::formatters::format_ascii_box(&ds)
    })
}
