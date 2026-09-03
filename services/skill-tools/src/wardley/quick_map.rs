//! Port of `skills/wardley-maps/tools/quick_map.py`'s library functions
//! (`quick_parse_input`, `advanced_nlp_parse`, `interactive_mode`, `print_help`). The
//! CLI `main()` menu itself lives in `src/bin/wardley_quick_map.rs`.
//!
//! ## Bug 1 — the CSV/tab-delimited branch is a silent, unconditional no-op
//!
//! ```python
//! if '\t' in text or ',' in text:
//!     lines = text.strip().split('\n')
//!     for line in lines:
//!         parts = line.split('\t') if '\t' in line else line.split(',')
//!         if len(parts) >= 3:
//!             try:
//!                 components.append({
//!                     'name': parts.strip(),        # AttributeError: list has no .strip()
//!                     'visibility': float(parts),    # TypeError: float() arg must be a
//!                     'evolution': float(parts)      #   string/number, not a list
//!                 })
//!             except:
//!                 pass
//! ```
//! `parts` is the `list` returned by `.split(...)`, not an indexed element — every one
//! of those three expressions raises, and the bare `except: pass` swallows it. This
//! branch therefore **never appends anything, for any input, ever**; falls through to
//! `advanced_nlp_parse` in every case. Per the port brief, this is reproduced exactly
//! as an observable no-op below — we do not implement real CSV parsing, since that
//! would change behaviour relative to the (silently broken) Python original.
//!
//! ## Bug 2 — the simple `"Name - description"` fallback line, fixed (not replicated)
//!
//! ```python
//! if ' - ' in line:
//!     name = line.split(' - ').strip()   # AttributeError: list has no .strip()
//!     desc = line.split(' - ').strip().lower()
//! ```
//! Same class of bug as Bug 1, but here there is **no enclosing `try`/`except`** — this
//! is an unconditional crash the one time this code path is ever reached (confirmed by
//! reading the surrounding function: no `try` wraps this `if not components:` block).
//! There is no sane Rust equivalent of "reproduce an uncaught Python traceback", so
//! per the brief's engineering-judgement guidance we implement the evidently intended
//! behaviour instead: split on `' - '`, first part -> name, remainder -> description,
//! both trimmed.

use super::{py_title_case, CompDict};
use regex::Regex;
use serde_json::Value;

/// `quick_parse_input(text) -> (components, dependencies)`
pub fn quick_parse_input(text: &str) -> (Vec<CompDict>, Vec<(String, String)>) {
    let trimmed = text.trim();

    // JSON branch.
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            match value {
                Value::Array(items) => {
                    let components = items.into_iter().filter_map(value_as_comp_dict).collect();
                    return (components, Vec::new());
                }
                Value::Object(map) => {
                    let components = map
                        .get("components")
                        .and_then(Value::as_array)
                        .map(|arr| arr.iter().cloned().filter_map(value_as_comp_dict).collect())
                        .unwrap_or_default();
                    let dependencies = map
                        .get("dependencies")
                        .and_then(Value::as_array)
                        .map(|arr| arr.iter().filter_map(value_as_dep_pair).collect())
                        .unwrap_or_default();
                    return (components, dependencies);
                }
                _ => {}
            }
        }
        // json.loads failure falls through, matching Python's bare `except: pass`.
    }

    // CSV/tab-delimited branch: see module docs — always a no-op in the original,
    // reproduced faithfully as a no-op (never appends a component).
    let mut components: Vec<CompDict> = Vec::new();
    let dependencies: Vec<(String, String)> = Vec::new();
    if text.contains('\t') || text.contains(',') {
        // Intentionally does nothing further — matches the Python original's
        // unconditionally-failing `try` block silently swallowed by `except: pass`.
    }

    if components.is_empty() {
        let (nlp_components, nlp_dependencies) = advanced_nlp_parse(text);
        components = nlp_components;
        return (components, nlp_dependencies);
    }

    (components, dependencies)
}

fn value_as_comp_dict(v: Value) -> Option<CompDict> {
    match v {
        Value::Object(m) => Some(m),
        _ => None,
    }
}

fn value_as_dep_pair(v: &Value) -> Option<(String, String)> {
    let arr = v.as_array()?;
    if arr.len() < 2 {
        return None;
    }
    Some((arr[0].as_str()?.to_string(), arr[1].as_str()?.to_string()))
}

/// `evolution_map` from `quick_map.py`'s `advanced_nlp_parse`, in exact declaration
/// order (first-match-wins matters for both lookup loops below).
const EVOLUTION_MAP: [(&str, f64); 35] = [
    ("innovative", 0.1),
    ("experimental", 0.1),
    ("novel", 0.1),
    ("research", 0.15),
    ("prototype", 0.15),
    ("alpha", 0.1),
    ("unprecedented", 0.05),
    ("breakthrough", 0.1),
    ("custom", 0.3),
    ("bespoke", 0.35),
    ("proprietary", 0.35),
    ("differentiated", 0.4),
    ("unique", 0.35),
    ("specialized", 0.4),
    ("in-house", 0.35),
    ("homegrown", 0.3),
    ("tailored", 0.35),
    ("product", 0.6),
    ("solution", 0.65),
    ("platform", 0.65),
    ("service", 0.6),
    ("offering", 0.6),
    ("package", 0.65),
    ("commercial", 0.7),
    ("mature", 0.7),
    ("stable", 0.7),
    ("commodity", 0.85),
    ("utility", 0.9),
    ("standard", 0.85),
    ("outsourced", 0.9),
    ("cloud", 0.85),
    ("saas", 0.8),
    ("off-the-shelf", 0.85),
    ("cots", 0.85),
    ("common", 0.8),
];

fn evolution_keywords() -> Vec<(&'static str, f64)> {
    EVOLUTION_MAP.to_vec()
}

/// `visibility_map` from `quick_map.py`'s `advanced_nlp_parse`, in exact declaration
/// order.
const VISIBILITY_MAP: [(&str, f64); 19] = [
    ("customer", 0.9),
    ("user", 0.9),
    ("client", 0.9),
    ("consumer", 0.9),
    ("interface", 0.85),
    ("experience", 0.85),
    ("facing", 0.85),
    ("api", 0.6),
    ("integration", 0.6),
    ("middleware", 0.5),
    ("backend", 0.4),
    ("database", 0.3),
    ("storage", 0.3),
    ("infrastructure", 0.2),
    ("hosting", 0.2),
    ("server", 0.2),
    ("internal", 0.4),
    ("core", 0.5),
    ("engine", 0.4),
];

fn visibility_keywords() -> Vec<(&'static str, f64)> {
    VISIBILITY_MAP.to_vec()
}

/// `advanced_nlp_parse(text) -> (components, dependencies)` — the lightweight
/// regex-pattern parser (distinct from the spaCy-based `advanced_nlp_parser.py`,
/// which despite the similar name is a completely different, untouched module).
pub fn advanced_nlp_parse(text: &str) -> (Vec<CompDict>, Vec<(String, String)>) {
    let component_patterns = [
        r"(?i)(?:our|the|a)\s+(\w[\w\s]+?)\s+(?:is|are|provides|handles)",
        r"(?i)(?:using|leverage|built on)\s+(\w[\w\s]+?)(?:\s+for|\s+to|\.|,)",
        r"(?i)(\w[\w\s]+?)\s+(?:service|system|platform|component|tool)",
        r"(?i)(?:customer|user|client)\s+(\w[\w\s]+)",
    ];

    let evolution_map = evolution_keywords();
    let visibility_map = visibility_keywords();

    let mut components: Vec<CompDict> = Vec::new();
    let mut seen_components: std::collections::HashSet<String> = std::collections::HashSet::new();
    let text_lower = text.to_lowercase();

    for pattern in component_patterns {
        let re = Regex::new(pattern).expect("static regex is valid");
        for cap in re.captures_iter(text) {
            let Some(m) = cap.get(1) else { continue };
            let component_name = m.as_str().trim().to_string();
            if component_name.is_empty() || seen_components.contains(&component_name) {
                continue;
            }
            seen_components.insert(component_name.clone());

            let mut evolution = 0.5;
            let name_lower = component_name.to_lowercase();
            if let Some(name_pos) = text_lower.find(&name_lower) {
                let ctx_start = name_pos.saturating_sub(50);
                let ctx_end = (name_pos + 50).min(text_lower.len());
                // Clamp to char boundaries (Python indexes by code point; text here is
                // effectively ASCII-ish for the domain this parser targets, but guard
                // against panics on multi-byte boundaries regardless).
                let ctx_start = floor_char_boundary(&text_lower, ctx_start);
                let ctx_end = ceil_char_boundary(&text_lower, ctx_end);
                let context = &text_lower[ctx_start..ctx_end];
                for (keyword, score) in &evolution_map {
                    if text_lower.contains(keyword) && context.contains(keyword) {
                        evolution = *score;
                        break;
                    }
                }
            }

            let mut visibility = 0.5;
            for (keyword, score) in &visibility_map {
                if name_lower.contains(keyword) {
                    visibility = *score;
                    break;
                }
            }

            let mut comp = CompDict::new();
            comp.insert("name".into(), py_title_case(&component_name).into());
            comp.insert("visibility".into(), visibility.into());
            comp.insert("evolution".into(), evolution.into());
            components.push(comp);
        }
    }

    let dep_patterns = [
        r"(?i)(\w[\w\s]+?)\s+(?:depends on|requires|needs)\s+(\w[\w\s]+)",
        r"(?i)(\w[\w\s]+?)\s+(?:uses|leverages|built on)\s+(\w[\w\s]+)",
        r"(?i)(\w[\w\s]+?)\s+(?:→|->|connects to)\s+(\w[\w\s]+)",
    ];

    let comp_names: Vec<String> = components
        .iter()
        .map(|c| super::get_str(c, "name", ""))
        .collect();
    let mut dependencies: Vec<(String, String)> = Vec::new();
    for pattern in dep_patterns {
        let re = Regex::new(pattern).expect("static regex is valid");
        for cap in re.captures_iter(text) {
            let (Some(a), Some(b)) = (cap.get(1), cap.get(2)) else {
                continue;
            };
            let from_comp = py_title_case(a.as_str().trim());
            let to_comp = py_title_case(b.as_str().trim());
            if comp_names.contains(&from_comp) && comp_names.contains(&to_comp) {
                dependencies.push((from_comp, to_comp));
            }
        }
    }

    // Fallback: simple "Name - description" line format (see module docs for the fix
    // applied to the Python original's uncaught `.strip()`-on-a-list crash here).
    if components.is_empty() {
        for raw_line in text.split('\n') {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(idx) = line.find(" - ") {
                let name = line[..idx].trim().to_string();
                let desc = line[idx + 3..].trim().to_lowercase();

                let mut evolution = 0.5;
                for (keyword, score) in &evolution_map {
                    if desc.contains(keyword) {
                        evolution = *score;
                        break;
                    }
                }
                let mut visibility = 0.5;
                for (keyword, score) in &visibility_map {
                    if desc.contains(keyword) {
                        visibility = *score;
                        break;
                    }
                }

                let mut comp = CompDict::new();
                comp.insert("name".into(), name.into());
                comp.insert("visibility".into(), visibility.into());
                comp.insert("evolution".into(), evolution.into());
                components.push(comp);
            }
        }
    }

    (components, dependencies)
}

fn floor_char_boundary(s: &str, idx: usize) -> usize {
    let mut i = idx.min(s.len());
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_char_boundary(s: &str, idx: usize) -> usize {
    let mut i = idx.min(s.len());
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// `print_help()` — printed verbatim by the `wardley-quick-map` binary's interactive
/// mode.
pub fn print_help() {
    println!("\n=== Help ===");
    println!("Examples of input formats:");
    println!("1. Natural: 'Our customer portal is built on a custom platform'");
    println!("2. CSV: 'Customer Portal, 0.9, 0.7'");
    println!("3. Simple: 'Customer Portal - user-facing web interface'");
    println!("4. Dependency: 'dep: Customer Portal -> API Gateway'");
    println!("\nEvolution keywords:");
    println!("- Genesis/Custom: innovative, experimental, proprietary, custom");
    println!("- Product: platform, solution, service, stable");
    println!("- Commodity: standard, utility, cloud, outsourced");
    println!("\nVisibility keywords:");
    println!("- High: customer, user, interface");
    println!("- Medium: api, backend, integration");
    println!("- Low: infrastructure, database, hosting\n");
}

/// `interactive_mode() -> (components, dependencies)`. Reads lines from stdin exactly
/// like Python's `input("> ")` loop.
pub fn interactive_mode() -> (Vec<CompDict>, Vec<(String, String)>) {
    use std::io::{self, BufRead, Write};

    println!("=== Wardley Map Quick Generator ===");
    println!("\nEnter components in one of these formats:");
    println!("1. Natural language description");
    println!("2. 'Name, visibility, evolution' (CSV format)");
    println!("3. 'Name - description' format");
    println!("4. JSON format");
    println!("\nType 'done' when finished, 'help' for more info\n");

    let mut components = Vec::new();
    let mut dependencies = Vec::new();
    let stdin = io::stdin();
    let dep_re = Regex::new(r"(?i)^dep:\s*(.+?)\s*->\s*(.+)$").expect("static regex is valid");

    loop {
        print!("> ");
        let _ = io::stdout().flush();

        let mut line = String::new();
        if stdin.lock().read_line(&mut line).unwrap_or(0) == 0 {
            break; // EOF
        }
        let line = line.trim();

        if line.eq_ignore_ascii_case("done") {
            break;
        } else if line.eq_ignore_ascii_case("help") {
            print_help();
            continue;
        } else if line.starts_with("dep:") {
            if let Some(cap) = dep_re.captures(line) {
                let from = cap[1].trim().to_string();
                let to = cap[2].trim().to_string();
                println!("Added dependency: {from} -> {to}");
                dependencies.push((from, to));
            }
            continue;
        } else if line.is_empty() {
            continue;
        }

        let (parsed_comps, parsed_deps) = quick_parse_input(line);
        if !parsed_comps.is_empty() {
            println!("Added {} component(s)", parsed_comps.len());
            components.extend(parsed_comps);
            dependencies.extend(parsed_deps);
        }
    }

    (components, dependencies)
}

#[cfg(test)]
#[path = "quick_map_tests.rs"]
mod tests;
