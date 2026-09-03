//! `wardley-heuristics` — port of `heuristics_engine.py`'s `__main__` demo.
//!
//! Runs the same `test_components` list through `HeuristicsEngine::score_component`
//! and `get_component_rationale`, printing the same format (including the rationale
//! dict fields), then prints the JSON knowledge-base export.

use serde_json::json;
use skill_tools::wardley::heuristics::HeuristicsEngine;
use skill_tools::wardley::CompDict;

fn ctx(pairs: &[(&str, bool)]) -> CompDict {
    let mut m = CompDict::new();
    for (k, v) in pairs {
        m.insert((*k).to_string(), json!(*v));
    }
    m
}

fn main() {
    let engine = HeuristicsEngine::new();

    let test_components: Vec<(&str, CompDict)> = vec![
        ("PostgreSQL Database", ctx(&[("is_infrastructure", true)])),
        ("React Frontend", ctx(&[("is_customer_facing", true)])),
        (
            "Custom Recommendation Engine",
            ctx(&[("provides_competitive_advantage", true)]),
        ),
        ("AWS Hosting", ctx(&[("is_infrastructure", true)])),
    ];

    println!("=== Heuristics Engine Testing ===\n");
    for (name, context) in &test_components {
        let (evo, vis) = engine.score_component(name, context);
        let rationale = engine.get_component_rationale(name, evo, vis);
        println!("{name}:");
        println!(
            "  Evolution: {evo:.2} ({})",
            rationale["evolution_stage"].as_str().unwrap()
        );
        println!(
            "  Visibility: {vis:.2} ({})",
            rationale["visibility_level"].as_str().unwrap()
        );
        println!(
            "  Rationale: {}\n",
            rationale["evolution_rationale"].as_str().unwrap()
        );
    }

    println!("\n=== Knowledge Base Summary ===");
    println!("{}", engine.export_rules_to_json());
}
