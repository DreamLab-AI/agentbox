//! `podcast-bulk-ingest` — one-off historical backfill of a YouTube podcast
//! series. Rust port of `bulk_ingest.py`; CLI flags mirror the Python
//! `argparse` definition exactly.

#[tokio::main]
async fn main() {
    podcast_ingest_core::bulk::run_main().await;
}
