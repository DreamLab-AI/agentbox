//! Deterministic AI-provenance sanitiser.
//!
//! Three layers, mirrored from the prose-sanitiser skill:
//!
//! - **Layer A** ([`text`]) — invisible/format Unicode and homoglyph carriers
//!   in plain text. Deterministic and reversible-free: what it removes is
//!   contraband, what it keeps is load-bearing.
//! - **Metadata** ([`image`], [`container`]) — C2PA/JUMBF, EXIF, XMP and
//!   frontmatter provenance in PNG/JPEG/WebP and in SVG/PDF/DOCX/ODT/HTML/
//!   Markdown containers, at chunk/segment/part granularity.
//! - **Layer B** ([`rewrite`]) — an optional model-backed rewrite for
//!   statistical token-sampling watermarks, which no parser can see.
//!
//! [`slop`] adds the stylistic scanners (prose tells and design anti-patterns),
//! [`audit`] the aggregate directory and website sweeps, and [`server`] the
//! HTTP surface.
//!
//! The heavy pixel- and token-domain backends (MarkLLM, MarkDiffusion,
//! CtrlRegen, reverse-SynthID) stay behind a subprocess boundary in
//! [`image::harness`]: they are torch programs, not parsers.

pub mod audit;
pub mod common;
pub mod container;
pub mod dispatch;
pub mod image;
pub mod rewrite;
pub mod server;
pub mod slop;
pub mod text;
