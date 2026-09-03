//! `wardley-strategic-analyzer` — port of `strategic_analyzer.py`'s `__main__` demo.
//!
//! Runs the same test data through `StrategicAnalyzer::analyze` and prints the same
//! markdown analysis export.
//!
//! Note: the Python original's `__main__` block can never actually run — the module
//! fails to import (`NameError: name 'StrategicAnalysis' is not defined`) before
//! `__main__` is even reached; see `src/wardley/strategic_analyzer.rs`'s module docs
//! for the full analysis. This binary reproduces the *intended*, working demo output
//! (verified against a locally patched copy of the Python source with only that one
//! dangling return-type annotation fixed, which is the only change needed to make the
//! original run).

use serde_json::json;
use skill_tools::wardley::strategic_analyzer::StrategicAnalyzer;

fn main() {
    let test_components = vec![
        json!({"name": "Customer Portal", "visibility": 0.95, "evolution": 0.7}),
        json!({"name": "Recommendation Engine", "visibility": 0.6, "evolution": 0.35}),
        json!({"name": "PostgreSQL Database", "visibility": 0.1, "evolution": 0.9}),
        json!({"name": "Custom ML Model", "visibility": 0.4, "evolution": 0.2}),
        json!({"name": "AWS Infrastructure", "visibility": 0.05, "evolution": 0.95}),
    ]
    .into_iter()
    .map(|v| v.as_object().unwrap().clone())
    .collect::<Vec<_>>();

    let test_dependencies = vec![
        (
            "Customer Portal".to_string(),
            "Recommendation Engine".to_string(),
        ),
        (
            "Recommendation Engine".to_string(),
            "Custom ML Model".to_string(),
        ),
        (
            "Custom ML Model".to_string(),
            "PostgreSQL Database".to_string(),
        ),
        (
            "PostgreSQL Database".to_string(),
            "AWS Infrastructure".to_string(),
        ),
    ];

    let analysis = StrategicAnalyzer::analyze(&test_components, &test_dependencies);

    println!("=== Strategic Analysis Results ===\n");
    println!(
        "{}",
        StrategicAnalyzer::export_analysis_to_markdown(&analysis)
    );
}
