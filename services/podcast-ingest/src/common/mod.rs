//! Utilities shared by all three binaries (`ingest`, `promote`, `bulk`) —
//! ported from code that was byte-identical, or near-identical, across
//! `ingest.py`, `promote.py`, and `bulk_ingest.py`.

pub mod fingerprint;
pub mod http;
pub mod ingest_status;
pub mod pyjson;
pub mod slug;
pub mod state;
pub mod transcript_md;
pub mod yaml_scalar;
pub mod ytdlp;

pub use fingerprint::{assertion_fingerprint, sha256_hex_prefix};
pub use ingest_status::{get_ingest_status, set_ingest_status, INGEST_PREFIX};
pub use pyjson::to_json_pretty_ascii;
pub use slug::{slugify, slugify_default};
pub use yaml_scalar::yaml_scalar;
