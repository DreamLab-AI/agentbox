# prose-sanitiser-media

Container-level provenance surgery for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox), plus the filesystem
helpers it needs.

Removal is byte-level and structural: a chunk or part is deleted and the file
written back otherwise unchanged. **Pixel data is never re-encoded**, and the
whole implementation path runs in-process: no `exiftool`, no `c2patool`, no
`qpdf`.

## Container libraries

Nothing here hand-parses a format that a maintained crate already covers.

| Format | Library | Licence |
|---|---|---|
| JPEG segments, PNG chunks, RIFF/WebP chunks | [`img-parts`](https://lib.rs/crates/img-parts) 0.4 | MIT OR Apache-2.0 |
| PDF object graph, full rewrite on save | [`lopdf`](https://github.com/J-F-Liu/lopdf) 0.44 | MIT |
| OOXML and ODF zip containers | [`zip`](https://lib.rs/crates/zip) | MIT |
| WordprocessingML, `[Content_Types]`, `_rels` | [`quick-xml`](https://docs.rs/quick-xml) | MIT |
| C2PA manifests, **read and validate only** | [`c2pa`](https://docs.rs/c2pa) 0.90 | MIT OR Apache-2.0 |

GPL and AGPL alternatives are deliberately excluded: no `rexiv2` (GPL-3.0), no
`mupdf-rs` (AGPL-3.0).

### Features

- `c2pa-read` *(default)* — read and validate embedded C2PA manifests with the
  official SDK, and report whether a durable credential is declared. The
  dependency is declared with `default-features = false`, which drops the
  OpenSSL C dependency in favour of pure-Rust crypto and removes every HTTP
  backend, so no remote manifest can be fetched and nothing leaves the machine.
- `external-verify` *(off)* — advisory cross-check against installed `exiftool`
  and `c2patool`. Never part of the implementation path.

### Why the C2PA SDK is read-only here

`c2pa-rs` exposes removal only as the internal `CAIWriter::remove_cai_store_from_stream`
and `AssetIO::remove_cai_store` trait methods, reachable through its largely
private `jumbf_io` machinery; there is no top-level `c2pa::remove_manifest`, and
`c2patool` has no `--remove` flag. So the SDK reads and validates, and stripping
is the container-level surgery above: delete the PNG `caBX` chunk, the JPEG
`APP11` JUMBF segments and the WebP `C2PA` chunk outright.

## Capability row

| Class | Contents |
|---|---|
| **Detects and strips losslessly**, verifiable by diff | C2PA JUMBF manifests in JPEG `APP11` (including a box split across several segments), PNG `caBX`, WebP `C2PA`, PDF embedded-file specifications and SVG `c2pa:manifest`. EXIF, XMP (`iTXt XML:com.adobe.xmp` and Extended XMP), IPTC/Photoshop IRB, PNG text chunks and `tIME`. PDF `/Info` and `/Metadata`, with a full object-graph rewrite so earlier incremental revisions do not survive in the byte stream. OOXML `docProps/core.xml`, `app.xml` (`Application`, `Company`, `TotalTime`), `custom.xml`, `customXml/`, the `word/comments*.xml` parts with their `[Content_Types]` overrides and `_rels` entries, `w:ins`/`w:del` tracked changes and the whole `w:rsid*` editing-session family; ODF `meta.xml` including `meta:generator`, `meta:editing-cycles` and `meta:editing-duration`, with compression method and entry order preserved for untouched parts |
| **Detects and reports only** | Pixel-domain image watermarks (SynthID-Image, Stable Signature, Tree-Ring, TrustMark, StegaStamp, DwtDct). Each needs a proprietary trained decoder or diffusion inversion. Durable Content Credentials, because the crate cannot know whether a soft binding exists |
| **Never touches** | The pixel data of any image. Container surgery only, never a re-encode |

## Stripping is not unlinking

C2PA defines a **soft binding**: a fingerprint or invisible watermark that lets
a validator find a stripped asset's original signed manifest in a cloud
repository, through the
[Soft Binding Resolution API](https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html).
Adobe runs a live implementation.

So this crate removes the manifest from the container, verifiably. It cannot
know whether a soft binding exists, and removing the manifest does not defeat
one. **A clean container is not an anonymous file.**

## Two structural traps it handles

- **PDF incremental updates append rather than rewrite.** A naive metadata edit
  leaves the original `/Info` and `/Metadata` objects fully recoverable earlier
  in the byte stream. Only a full object-graph rewrite removes them.
- **A ZIP round trip is itself a fingerprint.** Every untouched entry keeps its
  original compression method and relative order. A re-zip that reorders
  alphabetically or recompresses is a detectable "repacked by a non-Office tool"
  signal, which is worse than the metadata it removed.

## Example

```rust
use prose_sanitiser_media::image::detect_format;

// Format detection is by signature, not by file extension.
let png_signature = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR";
assert_eq!(detect_format(png_signature), "png");

assert_eq!(detect_format(b"\xff\xd8\xff\xe0"), "jpeg");
assert_eq!(detect_format(b"not an image"), "unknown");
```

`inspect_bytes` reports what a buffer carries without touching the filesystem;
`clean_image` and `clean_container` take paths and write atomically, through a
symlink-safe temporary file.

## Optional external tools

`c2patool` and `exiftool` are an *advisory* cross-check behind the non-default
`external-verify` feature. With the feature off — the default — nothing is
executed and both report as unavailable. `qpdf` is gone entirely: `lopdf`'s full
rewrite is what the `qpdf --linearize` pass used to provide.

The pixel-domain torch harnesses stay behind a subprocess boundary: they are
model stacks, not parsers, and what they prove is limited. See the skill's
provenance reference.

## Licence

MIT OR Apache-2.0, at your option.

## Publishing position

Not a first-wave publication candidate. The licences are clean and the default
build runs no subprocesses, but this crate carries the heavy end of the
dependency tree (`img-parts`, `lopdf`, `zip`, `quick-xml`, `c2pa`) and it
touches the filesystem, so it does not have the near-zero-dependency argument
that makes `core`, `unicode`, `uk` and `slop` worth publishing first. It stays
in the workspace until that tree has settled, in particular the pre-1.0 `c2pa`
SDK.

Verification it must pass regardless, now asserted in the test suite:

- [x] Byte-exact round trip: a file with no provenance marks comes out
      byte-identical. SHA-256 before and after, for PNG, JPEG and WebP
      (`tests/lossless.rs`)
- [x] Pixel-exact images after a metadata strip. Both sides decoded with the
      `image` crate and the buffers compared for equality — not PSNR, exact —
      plus a stronger check that the compressed `IDAT` and entropy-coded scan
      are carried across verbatim (`tests/lossless.rs`)
- [x] OOXML zip integrity, XML well-formedness, and compression method and entry
      order preserved for untouched parts (`container::ooxml::tests`)
- [x] A PDF whose metadata was written by an incremental update yields no
      recoverable original `/Info` anywhere in the output byte stream
      (`container::pdf::tests`)

Fixtures are generated in-process, so the suite is hermetic: no checked-in
binaries and no external tools on the test path.
