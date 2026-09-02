//! `wardley-quick-map` — full port of `quick_map.py`'s CLI (`main()`).
//!
//! Presents the same 3-choice menu read from stdin exactly as Python's `input()`
//! prompts do, writes `quick_wardley_map.html`, and prints the same component-summary
//! format.

use serde_json::json;
use skill_tools::wardley::generator::WardleyMapGenerator;
use skill_tools::wardley::quick_map::{interactive_mode, quick_parse_input};
use skill_tools::wardley::{get_f64, get_str, CompDict, Dependency};
use std::io::{self, Write};

/// Read one line the way Python's `input(prompt)` does: write the prompt with no
/// trailing newline, flush, then read and strip one line (returns `None` at EOF).
fn prompt(text: &str) -> Option<String> {
    print!("{text}");
    let _ = io::stdout().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).unwrap_or(0) == 0 {
        return None;
    }
    Some(line.trim().to_string())
}

fn quick_example() -> (Vec<CompDict>, Vec<Dependency>) {
    let components = vec![
        json!({"name": "User Interface", "visibility": 0.95, "evolution": 0.7}),
        json!({"name": "Business Logic", "visibility": 0.7, "evolution": 0.5}),
        json!({"name": "Custom Algorithm", "visibility": 0.5, "evolution": 0.3}),
        json!({"name": "Database", "visibility": 0.3, "evolution": 0.8}),
        json!({"name": "Cloud Hosting", "visibility": 0.1, "evolution": 0.9}),
    ]
    .into_iter()
    .map(|v| v.as_object().unwrap().clone())
    .collect::<Vec<_>>();

    let dependencies = vec![
        ("User Interface".to_string(), "Business Logic".to_string()),
        ("Business Logic".to_string(), "Custom Algorithm".to_string()),
        ("Custom Algorithm".to_string(), "Database".to_string()),
        ("Database".to_string(), "Cloud Hosting".to_string()),
    ];

    (components, dependencies)
}

fn main() {
    println!("Choose input method:");
    println!("1. Interactive mode");
    println!("2. Parse from file");
    println!("3. Quick example");

    let choice = prompt("\nSelect (1-3): ").unwrap_or_default();

    let (components, dependencies) = match choice.as_str() {
        "1" => interactive_mode(),
        "2" => {
            let filename = prompt("Enter filename: ").unwrap_or_default();
            match std::fs::read_to_string(&filename) {
                Ok(text) => quick_parse_input(&text),
                Err(e) => {
                    eprintln!("Error reading {filename}: {e}");
                    return;
                }
            }
        }
        _ => {
            println!("\nGenerating example map...");
            quick_example()
        }
    };

    if components.is_empty() {
        println!("No components found. Exiting.");
        return;
    }

    println!(
        "\nGenerating map with {} components and {} dependencies...",
        components.len(),
        dependencies.len()
    );

    let generator = WardleyMapGenerator::default();
    let html_map = generator.create_map(&components, &dependencies);

    let output_file = "quick_wardley_map.html";
    std::fs::write(output_file, html_map).expect("failed to write quick_wardley_map.html");

    println!("\u{2713} Map saved to {output_file}");
    println!("\nComponent Summary:");
    for comp in &components {
        let evolution = get_f64(comp, "evolution", 0.5);
        let visibility = get_f64(comp, "visibility", 0.5);
        let evolution_stage = if evolution < 0.2 {
            "Genesis"
        } else if evolution < 0.5 {
            "Custom"
        } else if evolution < 0.8 {
            "Product"
        } else {
            "Commodity"
        };
        println!(
            "  - {}: {evolution_stage} (vis:{visibility:.1}, evo:{evolution:.1})",
            get_str(comp, "name", "")
        );
    }
}
