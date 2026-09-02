//! Port of `skills/wardley-maps/tools/generate_wardley_map.py`.
//!
//! `WardleyMapGenerator` renders a static SVG Wardley map wrapped in a dark-theme-ish
//! (actually light, see the CSS) HTML page with export buttons. `parse_text_to_components`
//! is a small standalone free function that turns `-`/`:`-delimited lines of text into
//! a component list using keyword heuristics.
//!
//! ## A note on numeric formatting
//!
//! Python 3's `/` operator always returns `float`, and multiplying an `int` by a
//! `float` also yields `float`; only pure `int`-only arithmetic (`+`, `-`, `*` between
//! two ints) stays `int`. The Python original interpolates every one of these values
//! directly into f-strings with no format spec, so whether an attribute prints as
//! `"550"` or `"550.0"` depends on that dynamic-typing trail. This module tracks that
//! by hand at each call site: `self.width`/`self.height`/`self.margin`/`map_width`/
//! `map_height` are kept as `i64` (Python `int`, never reassigned from their int
//! constructor values) and formatted with plain `{}`; every coordinate touched by a
//! `visibility`/`evolution` multiplication or a `/` is computed in `f64` and formatted
//! with [`crate::wardley::py_float_str`]. See the Wardley port report for the one
//! documented exception (Genesis stage's `start = 0` int literal) and for the general
//! statement that generated HTML is content-identical but not whitespace-identical to
//! the Python triple-quoted f-string layout.

use super::{generator_template, py_float_str, CompDict, Dependency};
use std::collections::HashMap;

/// Generate Wardley maps as a static SVG embedded in a standalone HTML page.
pub struct WardleyMapGenerator {
    pub width: i64,
    pub height: i64,
    pub margin: i64,
    pub map_width: i64,
    pub map_height: i64,
}

impl Default for WardleyMapGenerator {
    /// `WardleyMapGenerator()` in Python defaults to `width=800, height=600`.
    fn default() -> Self {
        Self::new(800, 600)
    }
}

impl WardleyMapGenerator {
    pub fn new(width: i64, height: i64) -> Self {
        let margin = 50;
        Self {
            width,
            height,
            margin,
            map_width: width - 2 * margin,
            map_height: height - 2 * margin,
        }
    }

    /// `create_map(components, dependencies=None) -> str`
    pub fn create_map(&self, components: &[CompDict], dependencies: &[Dependency]) -> String {
        let svg = self.generate_svg(components, dependencies);
        self.wrap_in_html(&svg)
    }

    fn generate_svg(&self, components: &[CompDict], dependencies: &[Dependency]) -> String {
        let mut svg_elements = String::new();
        svg_elements.push_str(&self.create_background());
        svg_elements.push_str(&self.create_evolution_axis());
        svg_elements.push_str(&self.create_value_chain_axis());

        // Component lookup: name -> (x, y). Python indexes `comp['evolution']` /
        // `comp['visibility']` / `comp['name']` directly (KeyError on a missing key);
        // we degrade gracefully instead of panicking, defaulting evolution/visibility
        // to the neutral midpoint (0.5) and name to "" when absent.
        let mut comp_positions: HashMap<String, (f64, f64)> = HashMap::new();
        for comp in components {
            let name = super::get_str(comp, "name", "");
            let evolution = super::get_f64(comp, "evolution", 0.5);
            let visibility = super::get_f64(comp, "visibility", 0.5);
            let (x, y) = self.component_to_coords(evolution, visibility);
            comp_positions.insert(name, (x, y));
        }

        // Dependencies: the Python original's equivalent loop is
        //   for dep in dependencies:
        //       if dep in comp_positions and dep in comp_positions:
        //           svg_elements.append(self._create_dependency_line(
        //               comp_positions[dep], comp_positions[dep]))
        // `dep` is a 2-tuple there, and `comp_positions` is keyed by component *name*
        // strings — a tuple is never a dict key, so `dep in comp_positions` is always
        // False. Verified empirically (`python3 -c` round-trip: 0 `<line>` tags are
        // ever emitted for a dependency edge, only the 2 axis lines). This is a real,
        // silent bug in the original: dependency lines are dead code and are NEVER
        // drawn, for any input. We reproduce that observable behaviour exactly by
        // never emitting a line here either.
        let _ = dependencies; // intentionally unused: see note above

        for comp in components {
            let name = super::get_str(comp, "name", "");
            let comp_type = super::get_str(comp, "type", "default");
            if let Some(&(x, y)) = comp_positions.get(&name) {
                svg_elements.push_str(&self.create_component_circle(x, y, &name, &comp_type));
            }
        }

        format!(
            r##"<svg width="{}" height="{}" xmlns="http://www.w3.org/2000/svg"><defs>{}</defs>{}</svg>"##,
            self.width,
            self.height,
            self.create_svg_defs(),
            svg_elements
        )
    }

    fn create_background(&self) -> String {
        // (stage, start, width_frac, color). `start` is an `int` literal (`0`) only
        // for Genesis; every other stage's `start` and every stage's `width_frac` are
        // float literals in the Python source.
        let stages: [(&str, f64, bool, f64, &str); 4] = [
            ("Genesis", 0.0, true, 0.15, "#f8f8f8"),
            ("Custom", 0.15, false, 0.35, "#f0f0f0"),
            ("Product", 0.35, false, 0.30, "#e8e8e8"),
            ("Commodity", 0.65, false, 0.35, "#e0e0e0"),
        ];

        let mut out = String::new();
        for (stage, start, start_is_int_zero, width_frac, color) in stages {
            // x = self.margin + start * self.map_width
            let x_val = self.margin as f64 + start * self.map_width as f64;
            let x_str = if start_is_int_zero {
                // int(margin) + int(0)*int(map_width) == int -> plain int format.
                format!("{}", self.margin)
            } else {
                py_float_str(x_val)
            };
            // w = width_frac * self.map_width  (float * int -> always float)
            let w = width_frac * self.map_width as f64;
            out.push_str(&format!(
                r##"<rect x="{}" y="{}" width="{}" height="{}" fill="{}" opacity="0.5"/>"##,
                x_str,
                self.margin,
                py_float_str(w),
                self.map_height,
                color
            ));
            // label_x = x + w / 2  (w/2 is always float via true division, so
            // label_x is always float regardless of the Genesis int special case)
            let label_x = x_val + w / 2.0;
            let label_y = self.height - 20; // int - int -> int
            out.push_str(&format!(
                r##"<text x="{}" y="{}" text-anchor="middle" font-size="12" fill="#666">{}</text>"##,
                py_float_str(label_x),
                label_y,
                stage
            ));
        }
        out
    }

    fn create_evolution_axis(&self) -> String {
        let margin = self.margin; // int
        let y_line = self.height - self.margin; // int - int -> int
        let x2 = self.width - self.margin; // int - int -> int
        let text_x = self.width as f64 / 2.0; // true division -> always float
        let text_y = self.height - 5; // int - int -> int
        format!(
            r##"<line x1="{margin}" y1="{y_line}" x2="{x2}" y2="{y_line}" stroke="#333" stroke-width="2"/><text x="{}" y="{text_y}" text-anchor="middle" font-size="14" font-weight="bold">Evolution →</text>"##,
            py_float_str(text_x)
        )
    }

    fn create_value_chain_axis(&self) -> String {
        let margin = self.margin;
        let y2 = self.height - self.margin; // int
        let text_y = self.height as f64 / 2.0; // float
        let visible_y = self.margin - 5; // int
        let invisible_y = self.height - self.margin + 15; // int
        format!(
            r##"<line x1="{margin}" y1="{margin}" x2="{margin}" y2="{y2}" stroke="#333" stroke-width="2"/><text x="15" y="{ty}" text-anchor="middle" font-size="14" font-weight="bold" transform="rotate(-90 15 {ty})">Value Chain →</text><text x="{vx}" y="{visible_y}" text-anchor="end" font-size="12" fill="#666">Visible</text><text x="{vx}" y="{invisible_y}" text-anchor="end" font-size="12" fill="#666">Invisible</text>"##,
            ty = py_float_str(text_y),
            vx = margin - 5,
            visible_y = visible_y,
            invisible_y = invisible_y,
        )
    }

    /// Component circle colours, keyed by the `type` field (default `"default"`).
    fn type_color(comp_type: &str) -> &'static str {
        match comp_type {
            "user" => "#e74c3c",
            "custom" => "#f39c12",
            "product" => "#27ae60",
            "commodity" => "#95a5a6",
            _ => "#4a90e2", // "default" and anything unrecognised
        }
    }

    fn create_component_circle(&self, x: f64, y: f64, name: &str, comp_type: &str) -> String {
        let color = Self::type_color(comp_type);
        let x_s = py_float_str(x);
        let y_s = py_float_str(y);
        let y_label = py_float_str(y - 12.0); // float - int -> float
        format!(
            r##"<g class="component"><circle cx="{x_s}" cy="{y_s}" r="8" fill="{color}" stroke="#fff" stroke-width="2"/><text x="{x_s}" y="{y_label}" text-anchor="middle" font-size="11" fill="#333">{name}</text></g>"##
        )
    }

    /// `_create_dependency_line` — kept for structural parity with the Python source
    /// (which also defines this helper) but, per the note in [`generate_svg`], it is
    /// never actually invoked: the caller's membership check is always false, so no
    /// dependency line is ever drawn for any input. The Python original additionally
    /// had a second bug here — the f-string interpolated the whole `(x, y)` tuple into
    /// each coordinate attribute instead of indexing into it — which we do not bother
    /// reproducing precisely since the method is unreachable either way.
    #[allow(dead_code)]
    fn create_dependency_line(&self, from_pos: (f64, f64), to_pos: (f64, f64)) -> String {
        format!(
            r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#666" stroke-width="1" stroke-dasharray="2,2" marker-end="url(#arrowhead)"/>"##,
            py_float_str(from_pos.0),
            py_float_str(from_pos.1),
            py_float_str(to_pos.0),
            py_float_str(to_pos.1),
        )
    }

    fn create_svg_defs(&self) -> String {
        r##"<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#666"/></marker>"##.to_string()
    }

    /// `_component_to_coords(evolution, visibility) -> (x, y)`. `margin` (int) plus a
    /// float multiplication is always float in Python, so both `x` and `y` are always
    /// float here.
    fn component_to_coords(&self, evolution: f64, visibility: f64) -> (f64, f64) {
        let x = self.margin as f64 + evolution * self.map_width as f64;
        let y = self.margin as f64 + (1.0 - visibility) * self.map_height as f64;
        (x, y)
    }

    fn wrap_in_html(&self, svg: &str) -> String {
        let mut out = String::with_capacity(
            svg.len() + generator_template::HTML_HEAD.len() + generator_template::HTML_TAIL.len(),
        );
        out.push_str(generator_template::HTML_HEAD);
        out.push_str(svg);
        out.push_str(generator_template::HTML_TAIL);
        out
    }
}

/// `parse_text_to_components(text) -> List[Dict]`
///
/// Simple keyword-based extraction of components from `-`/`:`-delimited lines.
///
/// **Bug found and fixed** (beyond the two documented in `quick_map.py`): the Python
/// original does
/// ```python
/// parts = line.replace('-', ':').split(':')
/// if len(parts) >= 2:
///     name = parts.strip()          # AttributeError: 'list' object has no attribute 'strip'
///     description = parts.strip().lower()
/// ```
/// i.e. it calls `.strip()` on the *list* `parts` rather than indexing into it — this
/// is the exact same class of bug documented for `quick_map.py`'s simple-line-format
/// fallback, but here there is no enclosing `try`/`except`, so it is an *unconditional
/// crash* on every line that contains `-` or `:` and splits into 2+ parts (verified:
/// `python3 -c "from generate_wardley_map import parse_text_to_components; ..."` raises
/// `AttributeError` immediately). This function is also, separately, dead code in the
/// original — it's imported by `quick_map.py` but never actually called anywhere in
/// the six ported files. Since the crash is unconditional and there is no Python
/// traceback worth reproducing in Rust, we implement the evidently intended behaviour
/// instead: `name = parts[0].trim()`, `description = parts[1..].join(":").trim().to_lowercase()`.
pub fn parse_text_to_components(text: &str) -> Vec<CompDict> {
    let keywords_evolution: [(&str, f64); 12] = [
        ("innovative", 0.1),
        ("novel", 0.1),
        ("experimental", 0.15),
        ("custom", 0.3),
        ("proprietary", 0.35),
        ("differentiated", 0.4),
        ("product", 0.6),
        ("solution", 0.65),
        ("platform", 0.7),
        ("commodity", 0.85),
        ("utility", 0.9),
        ("standard", 0.95),
    ];

    let mut components = Vec::new();

    for line in text.split('\n') {
        if line.contains('-') || line.contains(':') {
            let normalised = line.replace('-', ":");
            let parts: Vec<&str> = normalised.split(':').collect();
            if parts.len() >= 2 {
                let name = parts[0].trim().to_string();
                let description = parts[1..].join(":").trim().to_lowercase();

                let mut evolution = 0.5;
                for (keyword, evo_value) in keywords_evolution {
                    if description.contains(keyword) {
                        evolution = evo_value;
                        break;
                    }
                }

                let visibility = if ["user", "customer", "client"]
                    .iter()
                    .any(|w| description.contains(w))
                {
                    0.9
                } else if ["api", "service", "platform"]
                    .iter()
                    .any(|w| description.contains(w))
                {
                    0.6
                } else if ["data", "database", "storage"]
                    .iter()
                    .any(|w| description.contains(w))
                {
                    0.3
                } else {
                    0.5
                };

                let mut comp = CompDict::new();
                comp.insert("name".into(), name.into());
                comp.insert("evolution".into(), evolution.into());
                comp.insert("visibility".into(), visibility.into());
                components.push(comp);
            }
        }
    }

    components
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comp(name: &str, visibility: f64, evolution: f64, comp_type: &str) -> CompDict {
        let mut c = CompDict::new();
        c.insert("name".into(), name.into());
        c.insert("visibility".into(), visibility.into());
        c.insert("evolution".into(), evolution.into());
        c.insert("type".into(), comp_type.into());
        c
    }

    #[test]
    fn create_map_contains_svg_html_and_component_names() {
        let generator = WardleyMapGenerator::default();
        let components = vec![
            comp("User Interface", 0.95, 0.7, "user"),
            comp("Database", 0.3, 0.8, "commodity"),
        ];
        let deps = vec![("User Interface".to_string(), "Database".to_string())];
        let html = generator.create_map(&components, &deps);

        assert!(html.contains("<svg"));
        assert!(html.contains("<html"));
        assert!(html.contains("User Interface"));
        assert!(html.contains("Database"));
        // Each component name should appear exactly once as a circle label.
        assert_eq!(html.matches("User Interface").count(), 1);
    }

    #[test]
    fn dependency_lines_are_never_drawn_matching_the_python_bug() {
        let generator = WardleyMapGenerator::default();
        let components = vec![comp("A", 0.9, 0.1, "user"), comp("B", 0.5, 0.5, "custom")];
        let deps = vec![("A".to_string(), "B".to_string())];
        let html = generator.create_map(&components, &deps);
        // Only the 2 axis lines should be present — no dependency `<line>`.
        assert_eq!(html.matches("<line").count(), 2);
    }

    #[test]
    fn parse_text_to_components_extracts_and_scores() {
        let text = "Custom platform - our innovative solution\nDatabase: postgresql storage\nno delimiter here";
        let comps = parse_text_to_components(text);
        assert_eq!(comps.len(), 2);
        assert_eq!(
            super::super::get_str(&comps[0], "name", ""),
            "Custom platform"
        );
        // "innovative" appears in the description and is checked before "custom".
        assert_eq!(super::super::get_f64(&comps[0], "evolution", -1.0), 0.1);
        assert_eq!(super::super::get_str(&comps[1], "name", ""), "Database");
        assert_eq!(super::super::get_f64(&comps[1], "visibility", -1.0), 0.3);
    }

    #[test]
    fn component_to_coords_matches_formula() {
        let g = WardleyMapGenerator::default();
        let (x, y) = g.component_to_coords(0.5, 0.5);
        assert_eq!(x, g.margin as f64 + 0.5 * g.map_width as f64);
        assert_eq!(y, g.margin as f64 + 0.5 * g.map_height as f64);
    }
}
