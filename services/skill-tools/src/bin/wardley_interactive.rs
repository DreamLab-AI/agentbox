//! `wardley-interactive` — port of `interactive_map_generator.py`'s `__main__` demo.
//!
//! Writes `interactive_wardley_map.html` to the current working directory using the
//! same hardcoded test components/dependencies, and prints the same confirmation
//! line.

use serde_json::json;
use skill_tools::wardley::interactive::create_interactive_wardley_map;

fn main() {
    let test_components = vec![
        json!({"name": "Customer Portal", "visibility": 0.95, "evolution": 0.7, "category": "Frontend"}),
        json!({"name": "Recommendation Engine", "visibility": 0.6, "evolution": 0.35, "category": "ML"}),
        json!({"name": "PostgreSQL Database", "visibility": 0.1, "evolution": 0.9, "category": "Database"}),
        json!({"name": "AWS Infrastructure", "visibility": 0.05, "evolution": 0.95, "category": "Infrastructure"}),
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
            "PostgreSQL Database".to_string(),
        ),
        (
            "PostgreSQL Database".to_string(),
            "AWS Infrastructure".to_string(),
        ),
    ];

    let html = create_interactive_wardley_map(&test_components, &test_dependencies, None);

    std::fs::write("interactive_wardley_map.html", html)
        .expect("failed to write interactive_wardley_map.html");

    println!("Interactive map created: interactive_wardley_map.html");
}
