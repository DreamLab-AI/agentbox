//! Deterministic AI-provenance sanitiser: the CLI layer.
//!
//! This crate wires the workspace together and ships the binaries. The
//! detection and surgery live in the layered crates below it; what is defined
//! here is the aggregate work that needs all of them at once — [`audit`] (the
//! directory sweep and the published-site crawl), [`dispatch`] (format
//! classification and routing) and [`rewrite`] (the optional model-backed
//! Layer B pass).
//!
//! Three layers, mirrored from the prose-sanitiser skill:
//!
//! - **Layer A** ([`text`], from `prose-sanitiser-unicode`) — invisible/format
//!   Unicode and homoglyph carriers in plain text. Deterministic and
//!   reversible-free: what it removes is contraband, what it keeps is
//!   load-bearing.
//! - **Metadata** ([`image`], [`container`], from `prose-sanitiser-media`) —
//!   C2PA/JUMBF, EXIF, XMP and frontmatter provenance in PNG/JPEG/WebP and in
//!   SVG/PDF/DOCX/ODT/HTML/Markdown containers, at chunk/segment/part
//!   granularity.
//! - **Layer B** ([`rewrite`]) — an optional model-backed rewrite. Paraphrase
//!   changes tokens, which degrades a statistical sampling watermark as a side
//!   effect. That is lossy, cannot be verified without the vendor key, and is
//!   not removal.
//!
//! [`slop`] adds the stylistic scanners (prose tells and design anti-patterns),
//! [`uk`] the UK-English rule, and the HTTP surface lives in the separate
//! `prose-sanitiser-server` crate.
//!
//! The heavy pixel- and token-domain backends (MarkLLM, MarkDiffusion,
//! CtrlRegen, reverse-SynthID) stay behind a subprocess boundary in
//! [`image::harness`]: they are torch programs, not parsers.
//!
//! # Output and exit codes
//!
//! Human output is `file:line:col`, rustc and clippy style, and is the primary
//! format. `--json` emits JSON Lines (the ripgrep and typos convention) and
//! `--sarif` emits SARIF 2.1.0, which is the exact version GitHub code scanning
//! requires.
//!
//! | Exit code | Meaning |
//! |---|---|
//! | 0 | Clean |
//! | 1 | Findings at or above the gate severity |
//! | 2 | Tool error |
//!
//! This matches shellcheck and Vale. `typos` inverts it and uses 2 for
//! findings; that convention is deliberately not copied.
//!
//! # The write policy
//!
//! Report-only by default. `--write` applies
//! [`ConfidenceTier::CertainMechanical`](prose_sanitiser_core::ConfidenceTier)
//! and `HighConfidenceStylistic` findings and never `LowConfidenceJudgement`
//! ones, so an ambiguous case stays ambiguous whatever flags are passed. That
//! is the property that stops a linter "correcting" *a driving licence* or *the
//! gas meter*.
//!
//! The dedicated cleaners (`clean-text`, `clean-file`, `clean-image`) strip
//! unconditionally, because everything they touch is `CertainMechanical` and
//! the result is verifiable by diffing the output.

pub mod audit;
pub mod dispatch;
pub mod rewrite;

pub use prose_sanitiser_media::{container, image};
pub use prose_sanitiser_slop as slop;
pub use prose_sanitiser_uk as uk;
pub use prose_sanitiser_unicode as text;

/// The shared helpers every binary uses.
///
/// A facade over the pure helpers in `prose-sanitiser-core` and the filesystem
/// and subprocess helpers in `prose-sanitiser-media`, gathered back under one
/// path so a binary imports from one place. The split behind it is a
/// dependency-hygiene boundary, not something a caller should have to track:
/// `core` stays free of I/O so it can be depended on from a library context,
/// while the reads, atomic writes and child-process launching that only the
/// tools need live with the code that touches files.
pub mod common {
    pub use prose_sanitiser_core::*;
    pub use prose_sanitiser_media::io::{
        backup_path, cleaned_path, guard_binary, max_input_bytes, read_text_input,
        safe_write_bytes, safe_write_text, write_text_output,
    };
    pub use prose_sanitiser_media::proc::{safe_arg, which};
    pub use prose_sanitiser_media::{io, proc};
}
