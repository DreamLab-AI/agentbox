//! Phase 3: apply enrichment tables to markdown files — port of
//! `run_apply_enrichment` from `bulk_ingest.py`.

use super::sources::FALSE_POSITIVES;
use indexmap::IndexMap;
use serde_json::Value;
use std::path::Path;

/// Port of `re.sub(r'## Sources Mentioned\n.*?(?=## Transcript|$)', '', content, flags=re.DOTALL)`.
/// The `regex` crate has no look-ahead support, so this is a direct
/// boundary-search implementation of the same lazy-match-up-to-boundary
/// semantics: strip from the first `"## Sources Mentioned\n"` up to (not
/// including) the next `"## Transcript"`, or end of string if there is none.
fn strip_existing_sources_table(content: &str) -> String {
    const MARKER: &str = "## Sources Mentioned\n";
    match content.find(MARKER) {
        Some(start) => {
            let search_from = start + MARKER.len();
            let end = content[search_from..]
                .find("## Transcript")
                .map(|i| search_from + i)
                .unwrap_or(content.len());
            format!("{}{}", &content[..start], &content[end..])
        }
        None => content.to_string(),
    }
}

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn load_resolved_urls(enrichment_dir: &Path) -> IndexMap<String, Value> {
    let mut resolved_urls: IndexMap<String, Value> = IndexMap::new();
    let path = enrichment_dir.join("resolved_urls.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) {
            for item in items {
                let source_key = item
                    .get("source")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_lowercase();
                let is_high = item.get("confidence").and_then(|v| v.as_str()) == Some("high");
                if !resolved_urls.contains_key(&source_key) || is_high {
                    resolved_urls.insert(source_key, item);
                }
            }
        }
    }
    resolved_urls
}

fn load_assets(assets_dir: &Path) -> IndexMap<String, String> {
    let mut assets = IndexMap::new();
    if let Ok(entries) = std::fs::read_dir(assets_dir) {
        let mut paths: Vec<std::path::PathBuf> =
            entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        paths.sort();
        for f in paths {
            if !f.is_file() {
                continue;
            }
            let ext = f
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if ext == "pdf" || ext == "html" {
                let stem = f
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                let name = f
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                assets.insert(stem, name);
            }
        }
    }
    assets
}

fn load_extraction_data(enrichment_dir: &Path) -> IndexMap<String, Value> {
    const SKIP: &[&str] = &[
        "extraction_summary.json",
        "all_sources.json",
        "unique_sources.json",
        "crosscheck_results.json",
        "resolved_urls.json",
    ];
    let mut extraction_data = IndexMap::new();
    if let Ok(entries) = std::fs::read_dir(enrichment_dir) {
        let mut paths: Vec<std::path::PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
            .collect();
        paths.sort();
        for f in paths {
            let file_name = f
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if SKIP.contains(&file_name.as_str()) {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&f) {
                if let Ok(data) = serde_json::from_str::<Value>(&text) {
                    if let Some(file) = data.get("file").and_then(|v| v.as_str()) {
                        extraction_data.insert(file.to_string(), data);
                    }
                }
            }
        }
    }
    extraction_data
}

fn resolve_url_col(
    source: &str,
    resolved_urls: &IndexMap<String, Value>,
    assets: &IndexMap<String, String>,
) -> String {
    let source_lower = source.to_lowercase();
    if let Some(item) = resolved_urls.get(&source_lower) {
        let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("");
        return format!("[link]({url})");
    }
    let dashed = source_lower.replace(' ', "-");
    let words: Vec<&str> = source_lower
        .split_whitespace()
        .filter(|w| w.chars().count() > 4)
        .collect();
    for (asset_key, asset_file) in assets {
        if asset_key.contains(&dashed) || words.iter().any(|w| asset_key.contains(w)) {
            return format!("[local](assets/{asset_file})");
        }
    }
    String::new()
}

/// Port of `run_apply_enrichment`.
pub fn run_apply_enrichment(out_dir: &Path) {
    let enrichment_dir = out_dir.join(".enrichment");
    let assets_dir = out_dir.join("assets");

    let resolved_urls = load_resolved_urls(&enrichment_dir);
    let assets = load_assets(&assets_dir);
    let extraction_data = load_extraction_data(&enrichment_dir);

    let mut md_files: Vec<std::path::PathBuf> = std::fs::read_dir(out_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    md_files.sort();

    let mut updated = 0usize;

    for md_path in &md_files {
        let file_name = md_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let sources: Vec<Value> = extraction_data
            .get(&file_name)
            .and_then(|d| d.get("sources"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if sources.is_empty() {
            continue;
        }

        let mut rows: Vec<String> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for s in &sources {
            let source = s
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let stype = s.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
            let raw_context = s.get("context").and_then(|v| v.as_str()).unwrap_or("");
            let context = truncate_chars(raw_context, 150)
                .replace('|', "\u{2014}")
                .replace('\n', " ")
                .trim()
                .to_string();

            let key = source.to_lowercase();
            if seen.contains(&key) || FALSE_POSITIVES.contains(&key.as_str()) {
                continue;
            }
            seen.insert(key);

            let url_col = resolve_url_col(source, &resolved_urls, &assets);
            rows.push(format!("| {source} | {stype} | {context} | {url_col} |"));
        }

        if rows.is_empty() {
            continue;
        }

        let table = format!(
            "## Sources Mentioned\n\n| Source | Type | Context | URL |\n|--------|------|---------|-----|\n{}\n",
            rows.join("\n")
        );

        let mut content = std::fs::read_to_string(md_path).unwrap_or_default();
        content = strip_existing_sources_table(&content);
        if content.contains("## Transcript") {
            content = content.replace("## Transcript", &format!("{table}\n## Transcript"));
        } else {
            content.push('\n');
            content.push_str(&table);
        }

        let _ = std::fs::write(md_path, content);
        updated += 1;
    }

    println!("\nEnrichment applied to {updated} files.");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn applies_table_before_transcript() {
        let dir = tempdir().unwrap();
        let enrichment_dir = dir.path().join(".enrichment");
        std::fs::create_dir_all(&enrichment_dir).unwrap();
        std::fs::write(
            enrichment_dir.join("ep1.json"),
            serde_json::to_string(&serde_json::json!({
                "episode": "Ep 1", "file": "ep1.md",
                "sources": [{"source": "Bloomberg", "type": "article", "context": "Bloomberg reported news."}]
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            dir.path().join("ep1.md"),
            "ingest-status:: downloaded\n# Ep 1\n\n## Transcript\n\nSome text.\n",
        )
        .unwrap();

        run_apply_enrichment(dir.path());

        let content = std::fs::read_to_string(dir.path().join("ep1.md")).unwrap();
        assert!(content.contains("## Sources Mentioned"));
        assert!(content.contains("| Bloomberg | article | Bloomberg reported news. |  |"));
        let sources_pos = content.find("## Sources Mentioned").unwrap();
        let transcript_pos = content.find("## Transcript").unwrap();
        assert!(sources_pos < transcript_pos);
    }

    #[test]
    fn skips_files_with_no_sources() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".enrichment")).unwrap();
        std::fs::write(
            dir.path().join("ep1.md"),
            "ingest-status:: downloaded\n# Ep 1\n\n## Transcript\n\nSome text.\n",
        )
        .unwrap();
        run_apply_enrichment(dir.path());
        let content = std::fs::read_to_string(dir.path().join("ep1.md")).unwrap();
        assert!(!content.contains("## Sources Mentioned"));
    }
}
