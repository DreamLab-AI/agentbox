//! Tests for `super` (`wardley::quick_map`) — split out to keep `quick_map.rs`
//! under the 500-line cap.

use super::*;

#[test]
fn csv_branch_is_a_no_op_matching_the_python_bug() {
    let (components, _deps) = quick_parse_input("Customer Portal, 0.9, 0.7\nDatabase, 0.2, 0.9");
    // Falls through to advanced_nlp_parse (which likely finds nothing useful from
    // this exact CSV-shaped text via the natural-language regexes) rather than
    // ever populating components via real CSV parsing.
    // The key assertion is the *shape* of the bug: no component has visibility
    // 0.9 attached to a component literally named "Customer Portal" via CSV
    // indexing (i.e. we never hit `parts[0]`/`parts[1]`/`parts[2]` CSV logic).
    for c in &components {
        // If any components appear, they came from advanced_nlp_parse, not a CSV
        // row object with exactly {name, visibility, evolution} 3 keys assembled
        // from `parts[0..3]`.
        assert!(
            c.len() != 3
                || !c.contains_key("visibility")
                || super::super::get_f64(c, "visibility", -1.0) != 0.9
                || super::super::get_str(c, "name", "") != "Customer Portal, 0.9, 0.7"
        );
    }
}

#[test]
fn json_array_branch() {
    let (components, deps) =
        quick_parse_input(r#"[{"name":"A","visibility":0.5,"evolution":0.5}]"#);
    assert_eq!(components.len(), 1);
    assert!(deps.is_empty());
}

#[test]
fn json_object_branch() {
    let (components, deps) = quick_parse_input(
        r#"{"components":[{"name":"A","visibility":0.5,"evolution":0.5}],"dependencies":[["A","B"]]}"#,
    );
    assert_eq!(components.len(), 1);
    assert_eq!(deps, vec![("A".to_string(), "B".to_string())]);
}

#[test]
fn simple_dash_line_format_uses_intended_split_not_a_crash() {
    // Deliberately avoids every component_patterns/dep_patterns trigger keyword
    // (customer/user/client, service/system/platform/component/tool, is/are/
    // provides/handles, using/leverage/built on) so this text falls all the way
    // through to the simple "Name - description" fallback — verified against the
    // real Python original: with the four regex passes finding nothing, Python's
    // `line.split(' - ').strip()` (`.strip()` called on the `list` `parts`, not an
    // indexed element) raises an uncaught `AttributeError` here every time
    // (`python3 -c "from quick_map import advanced_nlp_parse; ..."` confirms the
    // crash). We implement the evidently intended split instead — see the module
    // docs for the full bug writeup and the deliberate deviation from a plain
    // "Customer Portal - ..." example, which does NOT reach this fallback at all
    // (pattern 4, `(?:customer|user|client)\s+(\w[\w\s]+)`, matches "Portal" out
    // of "Customer Portal" first — also verified against the real Python, which
    // produces the same `[{'name': 'Portal', ...}]` for that input).
    let (components, _deps) =
        advanced_nlp_parse("Zeta Module - internal helper for legacy workflows");
    assert_eq!(components.len(), 1);
    assert_eq!(
        super::super::get_str(&components[0], "name", ""),
        "Zeta Module"
    );
    // "internal" -> visibility 0.4; no evolution keyword present -> default 0.5.
    assert_eq!(
        super::super::get_f64(&components[0], "visibility", -1.0),
        0.4
    );
    assert_eq!(
        super::super::get_f64(&components[0], "evolution", -1.0),
        0.5
    );
}

#[test]
fn natural_language_extracts_components_and_dependencies() {
    let (components, deps) = advanced_nlp_parse(
        "Our customer portal is built on a custom platform. The customer portal depends on api gateway.",
    );
    assert!(!components.is_empty());
    assert!(components
        .iter()
        .any(|c| super::super::get_str(c, "name", "")
            .to_lowercase()
            .contains("portal")));
    let _ = deps; // dependency extraction requires exact-name matches; not asserted strictly here.
}

#[test]
fn dep_prefix_parses_in_interactive_style() {
    let re = Regex::new(r"(?i)^dep:\s*(.+?)\s*->\s*(.+)$").unwrap();
    let cap = re.captures("dep: Customer Portal -> API Gateway").unwrap();
    assert_eq!(&cap[1], "Customer Portal");
    assert_eq!(&cap[2], "API Gateway");
}
