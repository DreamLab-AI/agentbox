//! Phase 5: new-domain detection + OntoCast bootstrapping guidance — port
//! of `extract_key_terms`, `probe_ontology_coverage`, `run_domain_probe`,
//! and `generate_ontocast_sample` from `bulk_ingest.py`.

use rand::seq::SliceRandom;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn re_transcript_section() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)## Transcript\n\n(.+)").unwrap())
}
fn re_title_line() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)^# (.+)").unwrap())
}
fn re_term() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Python: r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b'
    RE.get_or_init(|| Regex::new(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b").unwrap())
}

const STOPTERMS: &[&str] = &[
    "United States",
    "New York",
    "Last Week",
    "This Week",
    "Thank You",
    "One Thing",
    "Right Now",
    "First Time",
    "Real Time",
    "Let Me",
    "Long Time",
    "At This",
    "At That",
    "In Fact",
    "Of Course",
];

fn sorted_md_files(out_dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(out_dir)
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

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Port of `extract_key_terms`. Sampling is unseeded (matches Python's
/// unseeded `random.sample`) — not reproducible run-to-run in either
/// language.
pub fn extract_key_terms(out_dir: &Path, sample_count: usize) -> Vec<String> {
    let md_files = sorted_md_files(out_dir);
    if md_files.is_empty() {
        return Vec::new();
    }

    let mut rng = rand::thread_rng();
    let n = sample_count.min(md_files.len());
    let sample: Vec<&PathBuf> = md_files.choose_multiple(&mut rng, n).collect();

    let mut excerpts: Vec<String> = Vec::new();
    for f in &sample {
        let content = std::fs::read_to_string(f).unwrap_or_default();
        if let Some(caps) = re_transcript_section().captures(&content) {
            excerpts.push(truncate_chars(&caps[1], 3000));
        }
    }
    let original_text = excerpts.join(" ");

    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for caps in re_term().captures_iter(&original_text) {
        let term = caps[1].to_string();
        if !counts.contains_key(&term) {
            order.push(term.clone());
        }
        *counts.entry(term).or_insert(0) += 1;
    }

    // Counter.most_common(50): descending count, ties broken by first
    // appearance (stable sort over first-seen order).
    let mut ranked: Vec<(String, usize)> =
        order.into_iter().map(|t| (t.clone(), counts[&t])).collect();
    ranked.sort_by_key(|r| std::cmp::Reverse(r.1));
    ranked.truncate(50);

    ranked
        .into_iter()
        .filter(|(t, c)| *c >= 2 && !STOPTERMS.contains(&t.as_str()))
        .take(30)
        .map(|(t, _)| t)
        .collect()
}

/// Python `str.title()` approximation: capitalise the first letter of each
/// whitespace-separated word, lowercase the rest.
fn title_case(s: &str) -> String {
    s.split(' ')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub struct CoverageProbe {
    pub total: usize,
    pub matched: usize,
    pub matched_terms: Vec<String>,
    pub unmatched: Vec<String>,
    pub coverage: f64,
}

/// Port of `probe_ontology_coverage`.
pub fn probe_ontology_coverage(terms: &[String], ontology_dir: Option<&Path>) -> CoverageProbe {
    let ontology_dir = match ontology_dir {
        Some(d) if d.exists() => d,
        _ => {
            return CoverageProbe {
                total: terms.len(),
                matched: 0,
                matched_terms: Vec::new(),
                unmatched: terms.to_vec(),
                coverage: 0.0,
            }
        }
    };

    let mut matched = Vec::new();
    let mut unmatched = Vec::new();
    for term in terms {
        let variants = [
            term.clone(),
            term.replace(' ', "-"),
            term.clone(),
            title_case(term),
            term.to_lowercase().replace(' ', "-"),
        ];
        let found = variants
            .iter()
            .any(|v| ontology_dir.join(format!("{v}.md")).exists());
        if found {
            matched.push(term.clone());
        } else {
            unmatched.push(term.clone());
        }
    }

    let coverage = if terms.is_empty() {
        0.0
    } else {
        matched.len() as f64 / terms.len() as f64
    };
    CoverageProbe {
        total: terms.len(),
        matched: matched.len(),
        matched_terms: matched,
        unmatched,
        coverage,
    }
}

/// Port of `run_domain_probe`. Returns a JSON-shaped summary (mirrors the
/// Python `dict` return value for `probe.get("coverage", 1.0)` call sites).
pub fn run_domain_probe(out_dir: &Path, ontology_dir: Option<&Path>) -> Value {
    println!("\n--- Domain coverage probe ---");
    let terms = extract_key_terms(out_dir, 5);
    if terms.is_empty() {
        println!("  No key terms extracted from transcripts.");
        return json!({"coverage": 1.0});
    }

    println!("  Extracted {} key terms from sample.", terms.len());
    let probe = probe_ontology_coverage(&terms, ontology_dir);
    let pct = probe.coverage * 100.0;
    println!(
        "  Ontology coverage: {}/{} terms ({:.0}%)",
        probe.matched, probe.total, pct
    );

    if probe.coverage < 0.3 {
        println!("\n  \u{26a0} LOW COVERAGE — this podcast likely covers a domain not yet in the ontology.");
        println!(
            "  Unmatched terms: {}",
            probe
                .unmatched
                .iter()
                .take(15)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        );
        println!("\n  RECOMMENDATION: Use OntoCast to bootstrap ontology pages for this domain.");
        println!("  See: agentbox/skills/podcast-bulk-ingest/SKILL.md § 'New domain detection'");
        println!("\n  To bootstrap with OntoCast:");
        println!("    1. Install: pip install 'ontocast[server,openai]'");
        println!("    2. Configure LLM backend (Loom or external):");
        println!("       export LLM_PROVIDER=openai_compatible");
        println!("       export LLM_BASE_URL=http://192.168.2.132:8084/v1");
        println!("       export LLM_API_KEY=not-needed");
        println!("       export LLM_MODEL_NAME=qwen3.8-27b");
        println!("    3. Run OntoCast on a sample transcript:");
        println!("       ontocast process --input-path sample.txt --output-dir ./ontocast-out");
        println!("    4. Stage candidates via the knowledgeGraph pipeline:");
        println!("       python -m pipeline.ontocast_import ontocast-out/ontology.ttl \\");
        println!("         --output-dir review/podcast-bootstrap \\");
        println!("         --project-token ngm --domain [DOMAIN] \\");
        println!("         --source-document 'podcast:bootstrap' \\");
        println!("         --default-parent-iri urn:ngm:class/[domain-root] \\");
        println!("         --default-parent-label '[Domain Root]'");
        println!("    5. Review candidates, promote to mainKnowledgeGraph/pages/");
        println!("    6. Re-run this ingest — weekly cron will now enrich the new pages.");
    } else if probe.coverage < 0.6 {
        println!("\n  \u{2139} PARTIAL COVERAGE — some new concepts may need ontology pages.");
        println!(
            "  Consider adding pages for: {}",
            probe
                .unmatched
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        );
    } else {
        println!("\n  \u{2713} Good ontology coverage for this domain.");
    }

    json!({
        "total": probe.total, "matched": probe.matched, "matched_terms": probe.matched_terms,
        "unmatched": probe.unmatched, "coverage": probe.coverage,
    })
}

/// Port of `generate_ontocast_sample`.
pub fn generate_ontocast_sample(out_dir: &Path, sample_count: usize) -> Option<PathBuf> {
    let md_files = sorted_md_files(out_dir);
    if md_files.is_empty() {
        return None;
    }

    let mut rng = rand::thread_rng();
    let n = sample_count.min(md_files.len());
    let sample: Vec<&PathBuf> = md_files.choose_multiple(&mut rng, n).collect();

    let sample_path = out_dir.join(".ontocast-sample.txt");
    let mut parts: Vec<String> = Vec::new();
    for f in &sample {
        let content = std::fs::read_to_string(f).unwrap_or_default();
        let title = re_title_line()
            .captures(&content)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| {
                f.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            });
        if let Some(caps) = re_transcript_section().captures(&content) {
            parts.push(format!(
                "=== {title} ===\n\n{}\n\n",
                truncate_chars(&caps[1], 5000)
            ));
        }
    }

    if parts.is_empty() {
        return None;
    }

    let _ = std::fs::write(&sample_path, parts.join("\n"));
    println!("\n  OntoCast sample written to: {}", sample_path.display());
    println!("  Contains {} episode excerpts.", parts.len());
    Some(sample_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn title_case_matches_python_semantics() {
        assert_eq!(title_case("UNITED STATES"), "United States");
        assert_eq!(title_case("new york"), "New York");
    }

    #[test]
    fn extract_key_terms_finds_multiword_capitalised_terms() {
        // The term regex `[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+` requires each word
        // to be a single capital followed by only lowercase letters — an
        // internally-capitalised word like "DeepMind" does NOT match (this
        // mirrors the real Python regex, verified against CPython: "Google
        // DeepMind" finds no matches, but "Ontology Loom" does).
        let dir = tempdir().unwrap();
        let content = "ingest-status:: downloaded\n# Ep\n\n## Transcript\n\nThe Ontology Loom announced the Ontology Loom results with the Ontology Loom again and again.\n";
        std::fs::write(dir.path().join("ep1.md"), content).unwrap();
        let terms = extract_key_terms(dir.path(), 5);
        assert!(terms.contains(&"Ontology Loom".to_string()));
    }

    #[test]
    fn extract_key_terms_empty_dir_returns_empty() {
        let dir = tempdir().unwrap();
        assert!(extract_key_terms(dir.path(), 5).is_empty());
    }

    #[test]
    fn probe_ontology_coverage_matches_existing_pages() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("Google DeepMind.md"), "content").unwrap();
        let terms = vec!["Google DeepMind".to_string(), "Unrelated Term".to_string()];
        let probe = probe_ontology_coverage(&terms, Some(dir.path()));
        assert_eq!(probe.matched, 1);
        assert_eq!(probe.total, 2);
        assert!((probe.coverage - 0.5).abs() < 1e-9);
    }

    #[test]
    fn probe_ontology_coverage_no_dir_is_zero() {
        let terms = vec!["Term One".to_string()];
        let probe = probe_ontology_coverage(&terms, None);
        assert_eq!(probe.matched, 0);
        assert_eq!(probe.coverage, 0.0);
    }
}
