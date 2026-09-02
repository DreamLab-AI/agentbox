//! `podcast_ingest_core` — shared library backing the `podcast-ingest`,
//! `podcast-promote`, and `podcast-bulk-ingest` binaries.
//!
//! Rust port of the Python `podcast-knowledge-ingest` and
//! `podcast-bulk-ingest` skills. Module layout mirrors the three original
//! scripts:
//!
//! - [`common`] — helpers shared verbatim (or near-verbatim) across all
//!   three Python originals: slugify, fingerprints, JSON byte-format,
//!   ingest-status marker, yt-dlp subprocess wrapper, transcript markdown
//!   assembly.
//! - [`ingest`] — port of `ingest.py` (weekly cron: download, extract
//!   assertions via the Loom, verify, land on assertion-ledger pages).
//! - [`promote`] — port of `promote.py` (ledger-promotion candidacy
//!   detector, dossier assembly, blind judge + completeness pre-filter).
//! - [`bulk`] — port of `bulk_ingest.py` (one-off historical backfill,
//!   source extraction, domain-coverage probe).

pub mod bulk;
pub mod common;
pub mod ingest;
pub mod promote;
