//! Port of `skills/wardley-maps/tools/wardley_mapper.py` — the MCP-style stdin/stdout
//! JSON-line dispatch tool. Four request methods (`create_map`, `analyze_map`,
//! `parse_text`, `create_interactive_map`), each mapped here to a function taking and
//! returning `serde_json::Value` so the response shape (field names, nesting,
//! conditional presence) matches the Python dict responses exactly — this feeds other
//! tooling downstream, so fidelity here matters more than anywhere else in the port.
//!
//! ## NLP fallback semantics
//!
//! `create_map` and `parse_text` both call the excluded, spaCy-based
//! `advanced_nlp_parser.py`'s `parse_components_text` via [`super::nlp_bridge`] when
//! `use_advanced_nlp` is true (the default), and fall back to
//! [`super::quick_map::quick_parse_input`] on ANY failure — subprocess spawn failure,
//! non-zero exit, malformed JSON — mirroring the Python `try: ... except Exception: ...`
//! wrapping in both functions.
//!
//! ## JSON key order
//!
//! Response objects are built as `serde_json::Map`s, which (no `preserve_order`
//! feature on this crate's `serde_json` dependency) serialise in sorted key order
//! rather than Python `dict`'s insertion order. Field *names*, *nesting*, *types*, and
//! *conditional presence* all match the Python original exactly; only the byte
//! position of keys within each JSON object may differ, which has no effect on any
//! spec-compliant JSON consumer.

use super::{
    heuristics, interactive, nlp_bridge, quick_map, strategic_analyzer, CompDict, Dependency,
};
use serde_json::{json, Map, Value};

fn get_param_str(params: &Value, key: &str, default: &str) -> String {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| default.to_string())
}

fn get_param_bool(params: &Value, key: &str, default: bool) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn get_param_components(params: &Value, key: &str) -> Vec<CompDict> {
    params
        .get(key)
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_object().cloned()).collect())
        .unwrap_or_default()
}

fn get_param_dependencies(params: &Value, key: &str) -> Vec<Dependency> {
    params
        .get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let pair = v.as_array()?;
                    if pair.len() < 2 {
                        return None;
                    }
                    Some((pair[0].as_str()?.to_string(), pair[1].as_str()?.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn dependencies_to_json(deps: &[Dependency]) -> Value {
    Value::Array(deps.iter().map(|(a, b)| json!([a, b])).collect())
}

fn components_to_json(comps: &[CompDict]) -> Value {
    Value::Array(comps.iter().map(|c| Value::Object(c.clone())).collect())
}

/// NLP-first, regex-fallback text parse shared by `create_map` and `parse_text`,
/// mirroring the Python `try: parse_components_text(...) except Exception:
/// quick_parse_input(...)` shape.
fn parse_text_with_fallback(text: &str, use_nlp: bool) -> (Vec<CompDict>, Vec<Dependency>) {
    if use_nlp {
        match nlp_bridge::parse_via_nlp(text, true) {
            Ok(result) => return result,
            Err(_) => return quick_map::quick_parse_input(text),
        }
    }
    quick_map::quick_parse_input(text)
}

/// `create_map(params) -> dict`
pub fn create_map(params: &Value) -> Value {
    let mut components = get_param_components(params, "components");
    let mut dependencies = get_param_dependencies(params, "dependencies");
    let input_text = get_param_str(params, "text", "");
    let use_nlp = get_param_bool(params, "use_advanced_nlp", true);

    if components.is_empty() && !input_text.is_empty() {
        let (parsed_components, parsed_dependencies) =
            parse_text_with_fallback(&input_text, use_nlp);
        components = parsed_components;
        dependencies = parsed_dependencies;
    } else if components.is_empty() {
        return json!({"success": false, "error": "No components or text provided."});
    }

    let engine = heuristics::get_heuristics_engine();
    let mut enhanced_components: Vec<CompDict> = Vec::with_capacity(components.len());
    for mut comp in components {
        let name = super::get_str(&comp, "name", "");
        let (evo, vis) = engine.score_component(&name, &comp);
        // Only overwrite when the name is an EXACT pattern match (Python:
        // `engine.patterns.get(comp_dict.get('name'))`) — a fuzzy match or
        // heuristic-rule fallback inside score_component computes evo/vis too, but
        // create_map discards those unless the name is an exact key in the pattern
        // table. See the module docs for why this is a deliberately faithful
        // reproduction, not a simplification.
        if engine.has_pattern(&name) {
            comp.insert("evolution".into(), json!(evo));
            comp.insert("visibility".into(), json!(vis));
        }
        enhanced_components.push(comp);
    }

    let generator = super::generator::WardleyMapGenerator::default();
    let html_map = generator.create_map(&enhanced_components, &dependencies);

    json!({
        "success": true,
        "map_html": html_map,
        "component_count": enhanced_components.len(),
        "dependency_count": dependencies.len(),
        "components": components_to_json(&enhanced_components),
        "dependencies": dependencies_to_json(&dependencies),
    })
}

/// `analyze_map(params) -> dict`
pub fn analyze_map(params: &Value) -> Value {
    let components = get_param_components(params, "components");
    let dependencies = get_param_dependencies(params, "dependencies");

    if components.is_empty() {
        return json!({"success": false, "error": "No components provided for analysis."});
    }

    let analysis = strategic_analyzer::analyze_wardley_map(&components, &dependencies);
    let markdown_report =
        strategic_analyzer::StrategicAnalyzer::export_analysis_to_markdown(&analysis);

    let mut evolution_trajectory = Map::new();
    for (name, trajectory) in &analysis.evolution_trajectory {
        evolution_trajectory.insert(name.clone(), json!(trajectory));
    }

    let insights: Vec<Value> = analysis
        .insights
        .iter()
        .map(|i| {
            json!({
                "type": i.insight_type.value(),
                "component": i.component,
                "title": i.title,
                "description": i.description,
                "impact": i.impact,
                "recommendation": i.recommendation,
            })
        })
        .collect();

    json!({
        "success": true,
        "analysis": {
            "total_components": analysis.total_components,
            "total_dependencies": analysis.total_dependencies,
            "competitive_advantages": analysis.competitive_advantages,
            "vulnerabilities": analysis.vulnerabilities,
            "opportunities": analysis.opportunities,
            "threats": analysis.threats,
            "strategic_recommendations": analysis.strategic_recommendations,
            "evolution_trajectory": Value::Object(evolution_trajectory),
            "critical_path": analysis.critical_path,
        },
        "markdown_report": markdown_report,
        "insights_count": analysis.insights.len(),
        "insights": insights,
    })
}

/// `parse_text(params) -> dict`
pub fn parse_text(params: &Value) -> Value {
    let text = get_param_str(params, "text", "");
    let use_nlp = get_param_bool(params, "use_advanced_nlp", true);

    if text.is_empty() {
        return json!({"success": false, "error": "No text provided."});
    }

    let (components, dependencies) = parse_text_with_fallback(&text, use_nlp);

    json!({
        "success": true,
        "components": components_to_json(&components),
        "dependencies": dependencies_to_json(&dependencies),
        "component_count": components.len(),
        "dependency_count": dependencies.len(),
    })
}

/// `create_interactive_map(params) -> dict`
pub fn create_interactive_map(params: &Value) -> Value {
    let components = get_param_components(params, "components");
    let dependencies = get_param_dependencies(params, "dependencies");
    let insights = params
        .get("insights")
        .map(interactive::MapInsights::from_value);

    if components.is_empty() {
        return json!({"success": false, "error": "No components provided."});
    }

    let html_map =
        interactive::create_interactive_wardley_map(&components, &dependencies, insights.as_ref());

    json!({
        "success": true,
        "interactive_map_html": html_map,
        "component_count": components.len(),
        "dependency_count": dependencies.len(),
    })
}

/// Dispatch one already-parsed `{"method": ..., "params": {...}}` request to the
/// matching handler, returning `{"result": ...}` or `{"error": "Unknown method: ..."}`
/// exactly like the Python `main()` loop's per-line dispatch.
pub fn dispatch(request: &Value) -> Value {
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let empty_params = json!({});
    let params = request.get("params").unwrap_or(&empty_params);

    match method {
        "create_map" => json!({"result": create_map(params)}),
        "analyze_map" => json!({"result": analyze_map(params)}),
        "parse_text" => json!({"result": parse_text(params)}),
        "create_interactive_map" => json!({"result": create_interactive_map(params)}),
        other => json!({"error": format!("Unknown method: {other}")}),
    }
}

/// `main()` — read JSON-RPC-ish lines from stdin, write one JSON response per line to
/// stdout, flushing after each (matching the Python original's explicit
/// `sys.stdout.flush()` after every write, which matters for a long-lived pipe
/// consumer that reads responses as they arrive).
pub fn run_stdio_loop() {
    use std::io::{self, BufRead, Write};

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // matches Python's implicit end-of-iteration on stream error
        };

        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => dispatch(&request),
            Err(_) => json!({"error": "Invalid JSON received"}),
        };

        let _ = writeln!(stdout, "{}", response);
        let _ = stdout.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_map_with_direct_components_succeeds() {
        let params = json!({
            "components": [
                {"name": "User Interface", "visibility": 0.95, "evolution": 0.7, "type": "user"},
                {"name": "Database", "visibility": 0.3, "evolution": 0.8, "type": "commodity"},
            ],
            "dependencies": [["User Interface", "Database"]],
        });
        let result = create_map(&params);
        assert_eq!(result["success"], true);
        assert_eq!(result["component_count"], 2);
        assert_eq!(result["dependency_count"], 1);
        assert!(result["map_html"]
            .as_str()
            .unwrap()
            .contains("User Interface"));
    }

    #[test]
    fn create_map_applies_heuristics_only_on_exact_pattern_match() {
        // "PostgreSQL" is an exact pattern key: evolution/visibility must be
        // overwritten to the pattern's defaults (0.9 stage score / 0.15 visibility).
        let params = json!({
            "components": [{"name": "PostgreSQL", "visibility": 0.5, "evolution": 0.5}],
        });
        let result = create_map(&params);
        let comps = result["components"].as_array().unwrap();
        assert_eq!(comps[0]["visibility"], 0.15);

        // "PostgreSQL Database" is only a FUZZY match, not an exact key: the
        // heuristic score is computed internally but discarded — original values
        // must survive untouched.
        let params2 = json!({
            "components": [{"name": "PostgreSQL Database", "visibility": 0.5, "evolution": 0.5}],
        });
        let result2 = create_map(&params2);
        let comps2 = result2["components"].as_array().unwrap();
        assert_eq!(comps2[0]["visibility"], 0.5);
        assert_eq!(comps2[0]["evolution"], 0.5);
    }

    #[test]
    fn create_map_without_components_or_text_errors() {
        let result = create_map(&json!({}));
        assert_eq!(result["success"], false);
    }

    #[test]
    fn analyze_map_returns_markdown_and_insights() {
        let params = json!({
            "components": [
                {"name": "Customer Portal", "visibility": 0.95, "evolution": 0.7},
                {"name": "AWS Infrastructure", "visibility": 0.05, "evolution": 0.95},
            ],
            "dependencies": [["Customer Portal", "AWS Infrastructure"]],
        });
        let result = analyze_map(&params);
        assert_eq!(result["success"], true);
        assert!(result["markdown_report"]
            .as_str()
            .unwrap()
            .starts_with("# Wardley Map"));
        assert!(result["analysis"]["total_components"] == 2);
    }

    #[test]
    fn parse_text_falls_back_to_regex_parser_without_nlp() {
        let params = json!({"text": "Customer Portal - user-facing web interface", "use_advanced_nlp": false});
        let result = parse_text(&params);
        assert_eq!(result["success"], true);
        assert_eq!(result["component_count"], 1);
    }

    #[test]
    fn create_interactive_map_returns_html() {
        let params = json!({
            "components": [{"name": "A", "visibility": 0.5, "evolution": 0.5}],
        });
        let result = create_interactive_map(&params);
        assert_eq!(result["success"], true);
        assert!(result["interactive_map_html"]
            .as_str()
            .unwrap()
            .contains("<svg"));
    }

    #[test]
    fn dispatch_unknown_method_reports_error() {
        let response = dispatch(&json!({"method": "nonexistent", "params": {}}));
        assert!(response["error"]
            .as_str()
            .unwrap()
            .contains("Unknown method"));
    }

    #[test]
    fn dispatch_create_map_roundtrip() {
        let request = json!({
            "method": "create_map",
            "params": {"components": [{"name": "A", "visibility": 0.5, "evolution": 0.5}]}
        });
        let response = dispatch(&request);
        assert_eq!(response["result"]["success"], true);
    }

    /// Integration test spawning the compiled `wardley-mapper` binary and piping a
    /// `create_map` JSON line on stdin, asserting valid JSON with `"success": true`
    /// comes back — per the port brief. Skipped (not failed) if the binary can't be
    /// located, since a `cargo test` sandbox may not have run `cargo build` for bins.
    #[test]
    fn wardley_mapper_binary_responds_to_create_map_over_stdio() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let Some(bin_path) = find_wardley_mapper_binary() else {
            eprintln!("skipping: wardley-mapper binary not found (build it with `cargo build --bin wardley-mapper` first)");
            return;
        };

        let mut child = Command::new(&bin_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn wardley-mapper");

        {
            let stdin = child.stdin.as_mut().unwrap();
            let request = json!({
                "method": "create_map",
                "params": {"components": [{"name": "A", "visibility": 0.5, "evolution": 0.5}]}
            });
            writeln!(stdin, "{request}").unwrap();
        }
        // Dropping stdin (closing it) lets the child's stdin-line loop see EOF and exit.
        drop(child.stdin.take());

        let output = child
            .wait_with_output()
            .expect("failed to wait on wardley-mapper");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let first_line = stdout
            .lines()
            .next()
            .expect("expected at least one response line");
        let response: Value =
            serde_json::from_str(first_line).expect("response must be valid JSON");
        assert_eq!(response["result"]["success"], true);
    }

    fn find_wardley_mapper_binary() -> Option<std::path::PathBuf> {
        let exe = std::env::current_exe().ok()?;
        // `current_exe` for a test binary is under target/{debug,release}/deps/; the
        // sibling `wardley-mapper` binary (if built) lives one directory up.
        let deps_dir = exe.parent()?;
        let target_profile_dir = deps_dir.parent()?;
        for candidate in ["wardley-mapper", "wardley-mapper.exe"] {
            let path = target_profile_dir.join(candidate);
            if path.is_file() {
                return Some(path);
            }
            let path = deps_dir.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
        None
    }
}
