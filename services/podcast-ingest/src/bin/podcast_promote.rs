//! `podcast-promote` — ledger-promotion candidacy detector and dossier
//! assembler. Rust port of `promote.py`; CLI flags mirror the Python
//! `argparse` definition exactly.

#[tokio::main]
async fn main() {
    let code = podcast_ingest_core::promote::run_main().await;
    std::process::exit(code);
}
