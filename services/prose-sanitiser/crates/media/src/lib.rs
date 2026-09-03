//! Container-level provenance surgery, plus the filesystem helpers it needs.
//!
//! This is the layer that touches the world. [`image`] handles PNG, JPEG and
//! WebP at chunk and segment granularity; [`container`] handles SVG, PDF,
//! DOCX/ODT, HTML and Markdown at part granularity. [`io`] provides the
//! size-capped reads and symlink-safe atomic writes both rely on.
//!
//! Removal is byte-level and structural: a chunk or part is deleted and the
//! file written back otherwise unchanged. Pixel data is never re-encoded.
//!
//! # No hand-rolled format parsing, and no subprocesses
//!
//! Every container format is read and written by a maintained, permissively
//! licensed crate, and the whole implementation path runs in-process:
//!
//! | Format | Library | Licence |
//! |---|---|---|
//! | JPEG segments, PNG chunks, RIFF/WebP chunks | [`img_parts`] 0.4 | MIT OR Apache-2.0 |
//! | PDF object graph, with a full rewrite on save | [`lopdf`] 0.44 | MIT |
//! | OOXML and ODF zip containers | [`zip`] | MIT |
//! | WordprocessingML, `[Content_Types]`, `_rels` | [`quick_xml`] | MIT |
//! | C2PA manifest **read and validate only** | [`c2pa`] 0.90 (feature `c2pa-read`) | MIT OR Apache-2.0 |
//!
//! `exiftool`, `c2patool` and `qpdf` are no longer on the implementation path.
//! They survive only as an advisory cross-check behind the non-default
//! `external-verify` feature (see [`image::tools`]). [`proc`] remains because
//! the optional pixel-domain torch harnesses in [`image::harness`] are model
//! stacks rather than parsers, and still run out of process.
//!
//! # Features
//!
//! * `c2pa-read` (default) — read and validate embedded C2PA manifests with the
//!   official SDK, including whether a durable credential is declared. Declared
//!   with `default-features = false`, so there is no OpenSSL C dependency and no
//!   HTTP backend: a remote manifest can never be fetched.
//! * `external-verify` (off) — cross-check against installed `exiftool` and
//!   `c2patool` binaries. Advisory only.
//!
//! # Honest scope
//!
//! From the capability matrix (section B of the design brief):
//!
//! **Can detect and losslessly strip (verifiable by diff)**
//!
//! | Capability | Basis |
//! |---|---|
//! | C2PA JUMBF manifests embedded in JPEG APP11, PNG `caBX`, WebP `C2PA`, PDF embedded-file, SVG `c2pa:manifest` | Container structure is normatively specified; deletion is byte-level |
//! | EXIF, XMP (including Extended XMP), IPTC/Photoshop IRB, PNG text chunks, `tIME`, GIF comment extension | Well-delimited container structures |
//! | PDF `/Info` and `/Metadata`, with full object-graph rewrite so prior incremental revisions do not survive | `lopdf` re-serialises from the merged object graph, so a superseded incremental revision never reaches the output |
//! | OOXML `docProps/core.xml`, `app.xml` (including `TotalTime` and `Company`), `custom.xml`, `word/comments.xml`, `w:ins`/`w:del`, `w:rsid*`; ODF `meta.xml` | ZIP part deletion with preserved compression and ordering, plus event-driven XML rewriting |
//!
//! **Can detect and report, but must not claim to strip**
//!
//! | Capability | Why |
//! |---|---|
//! | Pixel-domain image watermarks (SynthID-Image, Stable Signature, Tree-Ring, TrustMark, StegaStamp, DwtDct) | Each needs a proprietary trained decoder or diffusion inversion |
//! | Durable Content Credentials (C2PA soft binding plus cloud repository) | The crate cannot know whether a soft binding exists |
//!
//! **Must never touch**
//!
//! | Never modify | Rule |
//! |---|---|
//! | Pixel data of any image | Container surgery only. Never re-encode |
//!
//! Stripping a container manifest does **not** guarantee unlinkability. C2PA
//! defines a soft binding — a fingerprint or invisible watermark — that lets a
//! validator find a stripped asset's original manifest in a cloud repository.
//! A clean container is not an anonymous file.
//!
//! The optional torch harnesses for pixel-domain work stay behind a subprocess
//! boundary in [`image::harness`]: they are model stacks, not parsers.
//!
//! # Verified guarantees
//!
//! Two properties are asserted in `tests/lossless.rs` against real encoded
//! images, for PNG, JPEG and WebP:
//!
//! * A file carrying no provenance marks comes out **byte-identical** — the
//!   SHA-256 before and after a strip are equal.
//! * After a strip that did remove marks, both files decode to **bit-identical
//!   pixel buffers**, and the compressed image data (PNG `IDAT`, the JPEG
//!   entropy-coded scan) is carried across verbatim.

pub mod container;
pub mod image;
pub mod io;
pub mod proc;
