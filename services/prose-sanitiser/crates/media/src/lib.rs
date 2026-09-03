//! Container-level provenance surgery, plus the filesystem and subprocess
//! helpers it needs.
//!
//! This is the layer that touches the world. [`image`] handles PNG, JPEG and
//! WebP at chunk and segment granularity; [`container`] handles SVG, PDF,
//! DOCX/ODT, HTML and Markdown at part granularity. [`io`] provides the
//! size-capped reads and symlink-safe atomic writes both rely on, and [`proc`]
//! locates and runs the optional external tools under resource limits.
//!
//! Removal is byte-level and structural: a chunk or part is deleted and the
//! file written back otherwise unchanged. Pixel data is never re-encoded.
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
//! | PDF `/Info` and `/Metadata`, with full object-graph rewrite so prior incremental revisions do not survive | Structural rewrite |
//! | OOXML `docProps/core.xml`, `app.xml`, `custom.xml`, `word/comments.xml`, `w:ins`/`w:del`, `rsid`; ODF `meta.xml` | ZIP part deletion with preserved compression and ordering |
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

pub mod container;
pub mod image;
pub mod io;
pub mod proc;
