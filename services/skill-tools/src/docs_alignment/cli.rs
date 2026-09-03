//! Small helpers shared by the docs-alignment binaries: writing JSON output
//! either to stdout or to a file, matching the Python scripts'
//! `json.dumps(report, indent=2)` + "Report written to {path}" convention.

use std::path::Path;

use serde::Serialize;

/// Serialize `value` as pretty (2-space indent) JSON and either print it to
/// stdout, or write it to `output_path` and print a confirmation line —
/// mirroring every Python script's
/// ```python
/// if args.output:
///     Path(args.output).write_text(json_output)
///     print(f"Report written to {args.output}")
/// else:
///     print(json_output)
/// ```
pub fn emit_json<T: Serialize>(value: &T, output_path: Option<&str>) -> std::io::Result<String> {
    let json_output =
        serde_json::to_string_pretty(value).expect("report structs are always serializable");

    if let Some(path) = output_path {
        std::fs::write(Path::new(path), &json_output)?;
        println!("Report written to {path}");
    } else {
        println!("{json_output}");
    }

    Ok(json_output)
}

/// Default ignore-list applied by every file walker
/// (`validate_links.py`, `check_mermaid.py`, `detect_ascii.py` all skip
/// `node_modules`/`.git`/`target` at minimum; `validate_links.py` additionally
/// skips `__pycache__`, `.venv`, `dist`).
pub const DEFAULT_IGNORES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "__pycache__",
    ".venv",
    "dist",
];

/// True if `path`'s string form contains any of `patterns` as a substring —
/// mirrors `LinkValidator.should_ignore`'s `if pattern in path_str`.
pub fn path_contains_any(path: &Path, patterns: &[&str]) -> bool {
    let path_str = path.to_string_lossy();
    patterns.iter().any(|p| path_str.contains(p))
}
