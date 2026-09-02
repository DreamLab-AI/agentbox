//! Phase 4 orchestration — port of `phase_integrate` in `ingest.py`. Lands
//! verified assertions into per-episode assertion-ledger pages (curated
//! pages are never edited) and hands unresolved-topic assertions on to
//! `propose_new_pages`.

use super::config::Settings;
use super::ledger::{build_page_index, ledger_page_path, write_assertion_ledger};
use super::newpage::propose_new_pages;
use super::pyval::{get_str, get_str_vec, Assertion};
use crate::common::state::IngestState;
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Port of `phase_integrate`.
pub async fn phase_integrate(
    verified: &IndexMap<String, Vec<Assertion>>,
    ontology_dir: Option<&Path>,
    settings: &Settings,
    state: &mut IngestState,
    dry_run: bool,
    episode_paths: &HashMap<String, PathBuf>,
) {
    let ontology_dir = match ontology_dir {
        Some(d) if d.exists() => d,
        _ => {
            println!("  No ontology directory configured, skipping integration.");
            return;
        }
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut total_integrated = 0usize;
    let mut all_unmatched: Vec<Assertion> = Vec::new();
    let page_index = if !dry_run {
        Some(build_page_index(ontology_dir))
    } else {
        None
    };

    for (filename, assertions) in verified {
        if dry_run {
            println!(
                "    [DRY RUN] Would write ledger for {filename}: {} assertions",
                assertions.len()
            );
            for a in assertions {
                println!(
                    "      Claim: {}",
                    truncate_chars(&get_str(a, "claim", ""), 100)
                );
            }
            continue;
        }

        let ep_path = episode_paths.get(filename);
        let tagged: Vec<Assertion> = assertions
            .iter()
            .map(|a| {
                let mut t = a.clone();
                let value = match ep_path {
                    Some(p) => Value::String(p.to_string_lossy().to_string()),
                    None => Value::Null,
                };
                t.insert("_episode_path".to_string(), value);
                t
            })
            .collect();

        let (n_written, unmatched) = write_assertion_ledger(
            filename,
            &tagged,
            ontology_dir,
            &mut state.assertions,
            &today,
            page_index.as_ref(),
        );
        total_integrated += n_written;
        all_unmatched.extend(unmatched);

        if n_written > 0 {
            let episode_slug = Path::new(filename)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ledger_name = ledger_page_path(ontology_dir, &episode_slug)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            println!(
                "    Ledger updated for {filename}: {n_written} new assertions ({ledger_name})"
            );
        } else {
            println!("    Ledger for {filename}: nothing new (idempotent re-run)");
        }
    }

    println!("  Total assertions landed in ledger: {total_integrated}");

    // NB: `all_unmatched` is only ever populated on the non-dry-run path
    // above (the dry-run branch `continue`s before reaching it) — the
    // dry-run summary branch below is therefore unreachable in practice,
    // exactly as in the Python original (`phase_integrate`'s `elif unmatched
    // and dry_run` can never fire, since `unmatched` is always `[]` when
    // `dry_run` is true). Kept for line-for-line fidelity.
    let unmatched = all_unmatched;
    if !unmatched.is_empty() && !dry_run {
        propose_new_pages(&unmatched, ontology_dir, settings, state, &today).await;
    } else if !unmatched.is_empty() && dry_run {
        println!(
            "\n  [DRY RUN] {} assertions had no placement — would propose new pages:",
            unmatched.len()
        );
        let mut seen_topics: std::collections::HashSet<String> = std::collections::HashSet::new();
        for a in &unmatched {
            let terms = get_str_vec(a, "ontology_terms");
            let topic = terms
                .first()
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            if seen_topics.insert(topic.clone()) {
                println!(
                    "    → {topic}: {}",
                    truncate_chars(&get_str(a, "claim", ""), 80)
                );
            }
        }
    }
}
