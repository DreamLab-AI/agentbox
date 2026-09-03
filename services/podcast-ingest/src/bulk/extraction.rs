//! Phase 2: run source extraction across a transcript directory and write
//! `.enrichment/` outputs — port of `run_extraction` from `bulk_ingest.py`.
//! Split out of `sources.rs` (which owns the per-sentence matching logic)
//! purely to keep both files under the crate's 500-line-per-file limit.

use super::sources::extract_sources;
use crate::common::to_json_pretty_ascii;
use indexmap::IndexMap;
use regex::Regex;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::OnceLock;

fn re_transcript_section() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)## Transcript\n\n(.+)").unwrap())
}
fn re_title() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)^# (.+)").unwrap())
}

fn sorted_md_files(out_dir: &Path) -> Vec<std::path::PathBuf> {
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(out_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Port of `run_extraction`.
pub fn run_extraction(out_dir: &Path) {
    let enrichment_dir = out_dir.join(".enrichment");
    let _ = std::fs::create_dir_all(&enrichment_dir);

    let md_files = sorted_md_files(out_dir);
    println!("\nExtracting sources from {} files...", md_files.len());

    let mut all_sources: Vec<Value> = Vec::new();
    let mut episodes_with_sources = 0usize;

    for (i, md_path) in md_files.iter().enumerate() {
        let content = std::fs::read_to_string(md_path).unwrap_or_default();
        let title = re_title()
            .captures(&content)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| {
                md_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            });

        let transcript = match re_transcript_section().captures(&content) {
            Some(c) => c[1].to_string(),
            None => continue,
        };
        if transcript.starts_with("_Transcript not available") {
            continue;
        }

        let sources = extract_sources(&transcript, &title);
        if !sources.is_empty() {
            episodes_with_sources += 1;
            all_sources.extend(sources.clone());
            let stem = md_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ep_path = enrichment_dir.join(format!("{stem}.json"));
            let doc = json!({
                "episode": title,
                "file": md_path.file_name().map(|n| n.to_string_lossy().to_string()),
                "sources": sources,
            });
            if let Ok(text) = to_json_pretty_ascii(&doc) {
                let _ = std::fs::write(ep_path, text);
            }
        }

        if (i + 1) % 20 == 0 {
            println!(
                "  [{}/{}] {} sources found",
                i + 1,
                md_files.len(),
                all_sources.len()
            );
        }
    }

    write_summary_and_unique(
        &enrichment_dir,
        &md_files,
        episodes_with_sources,
        &all_sources,
    );
}

fn write_summary_and_unique(
    enrichment_dir: &Path,
    md_files: &[std::path::PathBuf],
    episodes_with_sources: usize,
    all_sources: &[Value],
) {
    let summary = json!({
        "total_episodes": md_files.len(),
        "episodes_with_sources": episodes_with_sources,
        "total_sources": all_sources.len(),
    });
    if let Ok(text) = to_json_pretty_ascii(&summary) {
        let _ = std::fs::write(enrichment_dir.join("extraction_summary.json"), text);
    }
    if let Ok(text) = to_json_pretty_ascii(&all_sources) {
        let _ = std::fs::write(enrichment_dir.join("all_sources.json"), text);
    }

    let mut unique: IndexMap<String, Value> = IndexMap::new();
    for s in all_sources {
        let source = s
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let type_ = s
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let context = s
            .get("context")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let episode = s
            .get("episode")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let key = format!("{source}|{type_}");
        match unique.get_mut(&key) {
            None => {
                unique.insert(key, json!({"source": source, "type": type_, "contexts": [context], "episodes": [episode]}));
            }
            Some(entry) => {
                let contexts = entry
                    .get_mut("contexts")
                    .and_then(|v| v.as_array_mut())
                    .unwrap();
                if !contexts
                    .iter()
                    .any(|c| c.as_str() == Some(context.as_str()))
                {
                    contexts.push(Value::String(context));
                }
                let episodes = entry
                    .get_mut("episodes")
                    .and_then(|v| v.as_array_mut())
                    .unwrap();
                if !episodes
                    .iter()
                    .any(|e| e.as_str() == Some(episode.as_str()))
                {
                    episodes.push(Value::String(episode));
                }
            }
        }
    }
    let mut unique_list: Vec<Value> = unique.into_values().collect();
    unique_list.sort_by_key(|v| {
        std::cmp::Reverse(
            v.get("episodes")
                .and_then(|e| e.as_array())
                .map(|a| a.len())
                .unwrap_or(0),
        )
    });
    if let Ok(text) = to_json_pretty_ascii(&unique_list) {
        let _ = std::fs::write(enrichment_dir.join("unique_sources.json"), text);
    }

    println!(
        "\nExtraction done! {episodes_with_sources} episodes, {} sources, {} unique.",
        all_sources.len(),
        unique_list.len()
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_enrichment_outputs() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("ep1.md"),
            "ingest-status:: downloaded\n# Ep 1\n\n## Transcript\n\nBloomberg reported the news today across many outlets.\n",
        )
        .unwrap();
        run_extraction(dir.path());

        let summary_path = dir.path().join(".enrichment/extraction_summary.json");
        assert!(summary_path.exists());
        let summary: Value =
            serde_json::from_str(&std::fs::read_to_string(&summary_path).unwrap()).unwrap();
        assert_eq!(summary["episodes_with_sources"], 1);

        let unique_path = dir.path().join(".enrichment/unique_sources.json");
        assert!(unique_path.exists());
        let per_episode = dir.path().join(".enrichment/ep1.json");
        assert!(per_episode.exists());
    }

    #[test]
    fn skips_episodes_without_transcript() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("ep1.md"),
            "ingest-status:: downloaded\n# Ep 1\n\n## Transcript\n\n_Transcript not available for this episode._\n",
        )
        .unwrap();
        run_extraction(dir.path());
        let summary_path = dir.path().join(".enrichment/extraction_summary.json");
        let summary: Value =
            serde_json::from_str(&std::fs::read_to_string(&summary_path).unwrap()).unwrap();
        assert_eq!(summary["episodes_with_sources"], 0);
    }
}
