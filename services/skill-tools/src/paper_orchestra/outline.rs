//! Typed validation of the Outline Agent's `outline.json`.
//!
//! Derived from `validate_outline.py`, `references/outline_schema.json` and
//! `references/allowed-values.md`. Validation runs in two passes:
//!
//! 1. [`validate_value`] walks the raw JSON and collects *every* problem with
//!    its JSON path (`plotting_plan[2].aspect_ratio`), because serde stops at
//!    the first error and reports no path.
//! 2. When pass 1 finds nothing, the document is deserialised into the typed
//!    [`Outline`] tree (enums for the allowed values, `deny_unknown_fields`
//!    throughout) and the semantic checks of [`semantic_checks`] run on it.
//!
//! Unlike the upstream JSON Schema, unknown fields are rejected at every
//! level; the single exception is a root-level `_comment` string, which
//! upstream's own example output carries.

use serde::Deserialize;
use serde_json::Value;

/// `plot_type` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlotType {
    /// A statistical chart; the objective must name the chart type.
    Plot,
    /// A conceptual or architectural diagram.
    Diagram,
}

/// `data_source` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum DataSource {
    /// Concept or architecture from the idea.
    #[serde(rename = "idea.md")]
    Idea,
    /// Numbers from the experimental log.
    #[serde(rename = "experimental_log.md")]
    ExperimentalLog,
    /// Both.
    #[serde(rename = "both")]
    Both,
}

/// The twelve permitted aspect ratios.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum AspectRatio {
    /// `1:1`
    #[serde(rename = "1:1")]
    R1x1,
    /// `1:4`
    #[serde(rename = "1:4")]
    R1x4,
    /// `2:3`
    #[serde(rename = "2:3")]
    R2x3,
    /// `3:2`
    #[serde(rename = "3:2")]
    R3x2,
    /// `3:4`
    #[serde(rename = "3:4")]
    R3x4,
    /// `4:1`
    #[serde(rename = "4:1")]
    R4x1,
    /// `4:3`
    #[serde(rename = "4:3")]
    R4x3,
    /// `4:5`
    #[serde(rename = "4:5")]
    R4x5,
    /// `5:4`
    #[serde(rename = "5:4")]
    R5x4,
    /// `9:16`
    #[serde(rename = "9:16")]
    R9x16,
    /// `16:9`
    #[serde(rename = "16:9")]
    R16x9,
    /// `21:9`
    #[serde(rename = "21:9")]
    R21x9,
}

const ASPECTS: &[&str] = &[
    "1:1", "1:4", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
];

/// One entry of `plotting_plan`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FigureSpec {
    /// Snake-case identifier, conventionally `fig_...`.
    pub figure_id: String,
    /// Figure title.
    pub title: String,
    /// Chart or diagram.
    pub plot_type: PlotType,
    /// Where the data comes from.
    pub data_source: DataSource,
    /// What the figure shows; must name a chart type when `plot_type` is `plot`.
    pub objective: String,
    /// Aspect ratio.
    pub aspect_ratio: AspectRatio,
}

/// `intro_related_work_plan.introduction_strategy`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntroductionStrategy {
    /// The opening hook.
    pub hook_hypothesis: String,
    /// The gap in the literature.
    pub problem_gap_hypothesis: String,
    /// Three to eight search directions.
    pub search_directions: Vec<String>,
}

/// One related-work cluster.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelWorkSubsection {
    /// Subsection heading.
    pub subsection_title: String,
    /// Methodology cluster covered.
    pub methodology_cluster: String,
    /// State-of-the-art investigation mission.
    pub sota_investigation_mission: String,
    /// Hypothesised limitation.
    pub limitation_hypothesis: String,
    /// At least one search query.
    pub limitation_search_queries: Vec<String>,
    /// Bridge to the paper's method.
    pub bridge_to_our_method: String,
}

/// `intro_related_work_plan.related_work_strategy`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelatedWorkStrategy {
    /// Overview paragraph.
    pub overview: String,
    /// Two to four clusters.
    pub subsections: Vec<RelWorkSubsection>,
}

/// `intro_related_work_plan`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntroRelatedWorkPlan {
    /// Introduction plan.
    pub introduction_strategy: IntroductionStrategy,
    /// Related-work plan.
    pub related_work_strategy: RelatedWorkStrategy,
}

/// One subsection of a section plan.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubsectionSpec {
    /// Subsection heading.
    pub subsection_title: String,
    /// At least one content bullet.
    pub content_bullets: Vec<String>,
    /// Citation hints (may be empty).
    pub citation_hints: Vec<String>,
}

/// One entry of `section_plan`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SectionSpec {
    /// Section heading.
    pub section_title: String,
    /// Subsections (may be empty).
    pub subsections: Vec<SubsectionSpec>,
}

/// The whole outline.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Outline {
    /// Free-text note some producers add; ignored.
    #[serde(default, rename = "_comment")]
    pub comment: Option<String>,
    /// Figures to produce.
    pub plotting_plan: Vec<FigureSpec>,
    /// Introduction and related-work plan.
    pub intro_related_work_plan: IntroRelatedWorkPlan,
    /// Section plan.
    pub section_plan: Vec<SectionSpec>,
}

// ------------------------------------------------------------ pass 1: shape

struct Walker<'a> {
    errors: &'a mut Vec<String>,
}

impl Walker<'_> {
    fn err(&mut self, path: &str, msg: impl AsRef<str>) {
        self.errors.push(format!("{path}: {}", msg.as_ref()));
    }

    fn object<'v>(
        &mut self,
        v: &'v Value,
        path: &str,
        required: &[&str],
        optional: &[&str],
    ) -> Option<&'v serde_json::Map<String, Value>> {
        let Some(map) = v.as_object() else {
            self.err(path, format!("expected an object, found {}", kind(v)));
            return None;
        };
        for r in required {
            if !map.contains_key(*r) {
                self.err(path, format!("missing required field `{r}`"));
            }
        }
        for k in map.keys() {
            if !required.contains(&k.as_str()) && !optional.contains(&k.as_str()) {
                self.err(path, format!("unknown field `{k}`"));
            }
        }
        Some(map)
    }

    fn string(&mut self, v: Option<&Value>, path: &str) {
        match v {
            None => {}
            Some(Value::String(s)) if !s.is_empty() => {}
            Some(Value::String(_)) => self.err(path, "must not be empty"),
            Some(other) => self.err(path, format!("expected a string, found {}", kind(other))),
        }
    }

    fn enumerated(&mut self, v: Option<&Value>, path: &str, allowed: &[&str]) {
        match v {
            None => {}
            Some(Value::String(s)) if allowed.contains(&s.as_str()) => {}
            Some(other) => self.err(
                path,
                format!(
                    "{} is not one of {}",
                    other,
                    allowed
                        .iter()
                        .map(|a| format!("\"{a}\""))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            ),
        }
    }

    fn array<'v>(
        &mut self,
        v: Option<&'v Value>,
        path: &str,
        min: usize,
        max: Option<usize>,
    ) -> Option<&'v Vec<Value>> {
        let v = v?;
        let Some(arr) = v.as_array() else {
            self.err(path, format!("expected an array, found {}", kind(v)));
            return None;
        };
        if arr.len() < min {
            self.err(
                path,
                format!("has {} item(s); at least {min} required", arr.len()),
            );
        }
        if let Some(max) = max {
            if arr.len() > max {
                self.err(
                    path,
                    format!("has {} items; at most {max} allowed", arr.len()),
                );
            }
        }
        Some(arr)
    }

    fn strings(&mut self, v: Option<&Value>, path: &str, min: usize, max: Option<usize>) {
        if let Some(arr) = self.array(v, path, min, max) {
            for (i, s) in arr.iter().enumerate() {
                self.string(Some(s), &format!("{path}[{i}]"));
            }
        }
    }
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

/// Pass 1: structural validation of a raw JSON document. Returns every error,
/// each prefixed with its JSON path; an empty list means the document matches
/// the schema.
#[must_use]
pub fn validate_value(doc: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let mut w = Walker {
        errors: &mut errors,
    };
    let root = "(root)";
    let Some(map) = w.object(
        doc,
        root,
        &["plotting_plan", "intro_related_work_plan", "section_plan"],
        &["_comment"],
    ) else {
        return errors;
    };
    if let Some(c) = map.get("_comment") {
        if !c.is_string() {
            w.err("_comment", "expected a string");
        }
    }

    if let Some(figs) = w.array(map.get("plotting_plan"), "plotting_plan", 1, None) {
        for (i, f) in figs.iter().enumerate() {
            let p = format!("plotting_plan[{i}]");
            let req = [
                "figure_id",
                "title",
                "plot_type",
                "data_source",
                "objective",
                "aspect_ratio",
            ];
            if let Some(m) = w.object(f, &p, &req, &[]) {
                w.string(m.get("figure_id"), &format!("{p}.figure_id"));
                if let Some(Value::String(id)) = m.get("figure_id") {
                    for e in figure_id_problems(id) {
                        w.err(&format!("{p}.figure_id"), e);
                    }
                }
                w.string(m.get("title"), &format!("{p}.title"));
                w.enumerated(
                    m.get("plot_type"),
                    &format!("{p}.plot_type"),
                    &["plot", "diagram"],
                );
                w.enumerated(
                    m.get("data_source"),
                    &format!("{p}.data_source"),
                    &["idea.md", "experimental_log.md", "both"],
                );
                w.string(m.get("objective"), &format!("{p}.objective"));
                w.enumerated(m.get("aspect_ratio"), &format!("{p}.aspect_ratio"), ASPECTS);
            }
        }
    }

    if let Some(irw) = map.get("intro_related_work_plan") {
        let p = "intro_related_work_plan";
        if let Some(m) = w.object(
            irw,
            p,
            &["introduction_strategy", "related_work_strategy"],
            &[],
        ) {
            let ip = format!("{p}.introduction_strategy");
            if let Some(i) = m.get("introduction_strategy") {
                if let Some(im) = w.object(
                    i,
                    &ip,
                    &[
                        "hook_hypothesis",
                        "problem_gap_hypothesis",
                        "search_directions",
                    ],
                    &[],
                ) {
                    w.string(im.get("hook_hypothesis"), &format!("{ip}.hook_hypothesis"));
                    w.string(
                        im.get("problem_gap_hypothesis"),
                        &format!("{ip}.problem_gap_hypothesis"),
                    );
                    w.strings(
                        im.get("search_directions"),
                        &format!("{ip}.search_directions"),
                        3,
                        Some(8),
                    );
                }
            }
            let rp = format!("{p}.related_work_strategy");
            if let Some(r) = m.get("related_work_strategy") {
                if let Some(rm) = w.object(r, &rp, &["overview", "subsections"], &[]) {
                    w.string(rm.get("overview"), &format!("{rp}.overview"));
                    if let Some(subs) = w.array(
                        rm.get("subsections"),
                        &format!("{rp}.subsections"),
                        2,
                        Some(4),
                    ) {
                        for (j, s) in subs.iter().enumerate() {
                            let sp = format!("{rp}.subsections[{j}]");
                            let req = [
                                "subsection_title",
                                "methodology_cluster",
                                "sota_investigation_mission",
                                "limitation_hypothesis",
                                "limitation_search_queries",
                                "bridge_to_our_method",
                            ];
                            if let Some(sm) = w.object(s, &sp, &req, &[]) {
                                for f in req {
                                    if f == "limitation_search_queries" {
                                        w.strings(sm.get(f), &format!("{sp}.{f}"), 1, None);
                                    } else {
                                        w.string(sm.get(f), &format!("{sp}.{f}"));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(secs) = w.array(map.get("section_plan"), "section_plan", 1, None) {
        for (i, s) in secs.iter().enumerate() {
            let p = format!("section_plan[{i}]");
            if let Some(sm) = w.object(s, &p, &["section_title", "subsections"], &[]) {
                w.string(sm.get("section_title"), &format!("{p}.section_title"));
                if let Some(subs) =
                    w.array(sm.get("subsections"), &format!("{p}.subsections"), 0, None)
                {
                    for (j, sub) in subs.iter().enumerate() {
                        let sp = format!("{p}.subsections[{j}]");
                        let req = ["subsection_title", "content_bullets", "citation_hints"];
                        if let Some(m) = w.object(sub, &sp, &req, &[]) {
                            w.string(m.get("subsection_title"), &format!("{sp}.subsection_title"));
                            w.strings(
                                m.get("content_bullets"),
                                &format!("{sp}.content_bullets"),
                                1,
                                None,
                            );
                            w.strings(
                                m.get("citation_hints"),
                                &format!("{sp}.citation_hints"),
                                0,
                                None,
                            );
                        }
                    }
                }
            }
        }
    }
    errors
}

/// Problems with a figure identifier: the `^[a-z0-9_]+$` pattern and the
/// "no `figure` word" rule (the conventional `fig_` prefix is allowed).
fn figure_id_problems(id: &str) -> Vec<String> {
    let mut out = Vec::new();
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        out.push(format!("{id:?} is not snake_case matching ^[a-z0-9_]+$"));
    }
    let body = id.strip_prefix("fig_").unwrap_or(id);
    if body.to_lowercase().contains("figure") {
        out.push(format!(
            "{id:?} contains 'figure' — forbidden by the Outline Agent prompt (App. F.1)"
        ));
    } else {
        // Schema rule `figure(?!_)`: "figure" not followed by an underscore.
        let mut from = 0;
        while let Some(p) = id[from..].find("figure") {
            let end = from + p + "figure".len();
            if id.as_bytes().get(end) != Some(&b'_') {
                out.push(format!("{id:?} contains 'figure' not followed by '_'"));
                break;
            }
            from = end;
        }
    }
    out
}

// ------------------------------------------------------ pass 2: semantics

/// Findings of [`semantic_checks`].
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Semantic {
    /// Blocking problems.
    pub errors: Vec<String>,
    /// Advisory problems.
    pub warnings: Vec<String>,
}

const CHART_WORDS: &[&str] = &[
    "radar",
    "bar",
    "line",
    "scatter",
    "box",
    "violin",
    "heatmap",
    "histogram",
    "pie",
    "stacked",
    "grouped",
    "ridge",
    "density",
    "convergence",
    "training curve",
];

/// Semantic rules the JSON Schema cannot express: a `plot` objective must name
/// a chart type, and a section with exactly one subsection is an orphan.
#[must_use]
pub fn semantic_checks(outline: &Outline) -> Semantic {
    let mut s = Semantic::default();
    for (i, fig) in outline.plotting_plan.iter().enumerate() {
        if fig.plot_type == PlotType::Plot {
            let obj = fig.objective.to_lowercase();
            if !CHART_WORDS.iter().any(|k| obj.contains(k)) {
                s.warnings.push(format!(
                    "plotting_plan[{i}] is plot_type='plot' but objective does not name a \
                     specific chart type. The Outline Agent prompt requires this."
                ));
            }
        }
    }
    for (i, sec) in outline.section_plan.iter().enumerate() {
        if sec.subsections.len() == 1 {
            s.warnings.push(format!(
                "section_plan[{i}] {:?} has only one subsection — this is an orphan. The \
                 Outline Agent prompt requires that if X.1 exists, X.2 must too.",
                sec.section_title
            ));
        }
    }
    s
}

/// Result of [`validate_outline_text`].
#[derive(Debug)]
pub struct OutlineReport {
    /// Schema errors, each with its JSON path.
    pub schema_errors: Vec<String>,
    /// Semantic errors.
    pub semantic_errors: Vec<String>,
    /// Warnings.
    pub warnings: Vec<String>,
    /// One-line summary when valid.
    pub summary: Option<String>,
}

impl OutlineReport {
    /// True when there are no errors.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.schema_errors.is_empty() && self.semantic_errors.is_empty()
    }
}

/// Validates the text of an `outline.json`.
///
/// # Errors
///
/// Returns the JSON parse error message when `text` is not JSON.
pub fn validate_outline_text(text: &str, label: &str) -> Result<OutlineReport, String> {
    let doc: Value =
        serde_json::from_str(text).map_err(|e| format!("{label} is not valid JSON: {e}"))?;
    let schema_errors = validate_value(&doc);
    if !schema_errors.is_empty() {
        return Ok(OutlineReport {
            schema_errors,
            semantic_errors: vec![],
            warnings: vec![],
            summary: None,
        });
    }
    match serde_json::from_value::<Outline>(doc) {
        Err(e) => Ok(OutlineReport {
            // Pass 1 accepted the shape, so this is a defensive fallback.
            schema_errors: vec![format!("(root): {e}")],
            semantic_errors: vec![],
            warnings: vec![],
            summary: None,
        }),
        Ok(outline) => {
            let sem = semantic_checks(&outline);
            let n_hints: usize = outline
                .section_plan
                .iter()
                .flat_map(|s| &s.subsections)
                .map(|s| s.citation_hints.len())
                .sum();
            let summary = format!(
                "{label} — {} figures, {} related-work clusters, {} sections, {n_hints} citation hints",
                outline.plotting_plan.len(),
                outline.intro_related_work_plan.related_work_strategy.subsections.len(),
                outline.section_plan.len(),
            );
            Ok(OutlineReport {
                schema_errors: vec![],
                semantic_errors: sem.errors,
                warnings: sem.warnings,
                summary: Some(summary),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn good() -> Value {
        json!({
          "_comment": "note",
          "plotting_plan": [{"figure_id":"fig_main_results","title":"T","plot_type":"plot",
            "data_source":"both","objective":"A grouped bar chart of accuracy","aspect_ratio":"16:9"}],
          "intro_related_work_plan": {
            "introduction_strategy": {"hook_hypothesis":"h","problem_gap_hypothesis":"g",
               "search_directions":["a","b","c"]},
            "related_work_strategy": {"overview":"o","subsections":[
              sub("A"), sub("B")]}},
          "section_plan": [{"section_title":"Method","subsections":[
              {"subsection_title":"X","content_bullets":["b"],"citation_hints":[]},
              {"subsection_title":"Y","content_bullets":["b"],"citation_hints":["Vaswani et al. (Attention Is All You Need)"]}]}]
        })
    }

    fn sub(t: &str) -> Value {
        json!({"subsection_title":t,"methodology_cluster":"m","sota_investigation_mission":"s",
               "limitation_hypothesis":"l","limitation_search_queries":["q"],"bridge_to_our_method":"b"})
    }

    #[test]
    fn valid_outline_passes_with_summary() {
        let r = validate_outline_text(&good().to_string(), "o.json").unwrap();
        assert!(r.is_valid(), "{:?}", r);
        assert!(r
            .summary
            .unwrap()
            .contains("1 figures, 2 related-work clusters, 1 sections, 1 citation hints"));
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn errors_name_the_json_path() {
        let mut d = good();
        d["plotting_plan"][0]["aspect_ratio"] = json!("7:3");
        d["plotting_plan"][0]["extra"] = json!(1);
        d["section_plan"][0]["subsections"][1]["content_bullets"] = json!([]);
        d["intro_related_work_plan"]["introduction_strategy"]["search_directions"] = json!(["a"]);
        let e = validate_value(&d);
        let joined = e.join("\n");
        assert!(joined.contains("plotting_plan[0].aspect_ratio"), "{joined}");
        assert!(
            joined.contains("plotting_plan[0]: unknown field `extra`"),
            "{joined}"
        );
        assert!(
            joined.contains("section_plan[0].subsections[1].content_bullets"),
            "{joined}"
        );
        assert!(
            joined.contains("introduction_strategy.search_directions: has 1 item"),
            "{joined}"
        );
    }

    #[test]
    fn missing_required_and_wrong_enum() {
        let mut d = good();
        d.as_object_mut().unwrap().remove("section_plan");
        d["plotting_plan"][0]["plot_type"] = json!("chart");
        let e = validate_value(&d).join("\n");
        assert!(e.contains("missing required field `section_plan`"));
        assert!(e.contains("plotting_plan[0].plot_type"));
    }

    #[test]
    fn figure_ids_follow_the_rules() {
        assert!(figure_id_problems("fig_main_results").is_empty());
        assert!(!figure_id_problems("Fig-1").is_empty());
        assert!(!figure_id_problems("fig_figure_two").is_empty());
        assert!(!figure_id_problems("figure").is_empty());
        let mut d = good();
        d["plotting_plan"][0]["figure_id"] = json!("fig_figure_two");
        assert!(validate_value(&d)
            .iter()
            .any(|e| e.contains("plotting_plan[0].figure_id")));
    }

    #[test]
    fn semantic_warnings_for_vague_plot_and_orphan_subsection() {
        let mut d = good();
        d["plotting_plan"][0]["objective"] = json!("Show the results");
        d["section_plan"][0]["subsections"]
            .as_array_mut()
            .unwrap()
            .pop();
        let r = validate_outline_text(&d.to_string(), "o.json").unwrap();
        assert!(r.is_valid());
        assert_eq!(r.warnings.len(), 2);
    }

    #[test]
    fn non_json_is_an_error() {
        assert!(validate_outline_text("{nope", "o.json").is_err());
    }

    #[test]
    fn allowed_enum_values_deserialise() {
        for a in ASPECTS {
            let v = json!(a);
            assert!(serde_json::from_value::<AspectRatio>(v).is_ok(), "{a}");
        }
    }
}
