//! Port of `bulk_ingest.py` — one-off historical backfill of a YouTube
//! podcast series into structured markdown transcripts, with optional
//! source extraction/enrichment and OntoCast new-domain-coverage probing.

pub mod domain_probe;
pub mod download;
pub mod enrichment;
pub mod extraction;
pub mod mark;
pub mod run;
pub mod sources;

/// Naive-local ISO-8601 timestamp with microsecond precision, matching
/// Python's `datetime.now().isoformat()`.
pub fn iso_now() -> String {
    chrono::Local::now()
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string()
}

pub use run::run_main;
