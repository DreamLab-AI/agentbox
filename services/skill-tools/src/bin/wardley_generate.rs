//! `wardley-generate` — port of `generate_wardley_map.py`'s `__main__` demo.
//!
//! Writes `wardley_map.html` to the current working directory using the same
//! hardcoded example components/dependencies as the Python original, and prints the
//! same confirmation line.

use serde_json::json;
use skill_tools::wardley::generator::WardleyMapGenerator;

fn main() {
    let example_components = vec![
        json!({"name": "User Interface", "visibility": 0.95, "evolution": 0.7, "type": "user"}),
        json!({"name": "Business Logic", "visibility": 0.7, "evolution": 0.5, "type": "custom"}),
        json!({"name": "Data Processing", "visibility": 0.5, "evolution": 0.6, "type": "product"}),
        json!({"name": "Database", "visibility": 0.3, "evolution": 0.8, "type": "commodity"}),
        json!({"name": "Cloud Infrastructure", "visibility": 0.1, "evolution": 0.9, "type": "commodity"}),
    ]
    .into_iter()
    .map(|v| v.as_object().unwrap().clone())
    .collect::<Vec<_>>();

    let example_dependencies = vec![
        ("User Interface".to_string(), "Business Logic".to_string()),
        ("Business Logic".to_string(), "Data Processing".to_string()),
        ("Data Processing".to_string(), "Database".to_string()),
        ("Database".to_string(), "Cloud Infrastructure".to_string()),
    ];

    let generator = WardleyMapGenerator::default();
    let html_map = generator.create_map(&example_components, &example_dependencies);

    std::fs::write("wardley_map.html", html_map).expect("failed to write wardley_map.html");

    println!("Wardley map generated: wardley_map.html");
}
