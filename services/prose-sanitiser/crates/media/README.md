# prose-sanitiser-media

Container-level provenance surgery for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox), plus the filesystem
and subprocess helpers it needs.

Removal is byte-level and structural: a chunk or part is deleted and the file
written back otherwise unchanged. **Pixel data is never re-encoded.**

## Capability row

| Class | Contents |
|---|---|
| **Detects and strips losslessly**, verifiable by diff | C2PA JUMBF manifests in JPEG `APP11`, PNG `caBX`, WebP `C2PA`, PDF embedded-file specifications and SVG `c2pa:manifest`. EXIF, XMP (including Extended XMP), IPTC/Photoshop IRB, PNG text chunks, `tIME`, GIF comment extensions. PDF `/Info` and `/Metadata`, with a structural rewrite so earlier incremental revisions do not survive in the byte stream. OOXML `docProps/core.xml`, `app.xml`, `custom.xml`, `word/comments.xml`, `w:ins`/`w:del` and `rsid`; ODF `meta.xml`, with compression method and entry order preserved for untouched parts |
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

`c2patool`, `exiftool` and `qpdf` are used as a cross-check when present on
`PATH`. They are not the implementation, and their absence narrows the
cross-check rather than the capability.

The pixel-domain torch harnesses stay behind a subprocess boundary: they are
model stacks, not parsers, and what they prove is limited. See the skill's
provenance reference.

## Licence

MIT OR Apache-2.0, at your option.

## Publishing position

Not a first-wave publication candidate. This crate pulls the heavier dependency
tree (ZIP, XML, optional subprocesses) and touches the filesystem, so the
licence and dependency hygiene argument that makes `core`, `unicode`, `uk` and
`slop` worth publishing does not apply as cleanly here. It stays in the
workspace and is published only once its dependency set is settled.

Verification it must pass regardless:

- [ ] Byte-exact round trip: a file with no provenance marks comes out
      byte-identical. Hash before and after, for every supported format
- [ ] Pixel-exact images after a metadata strip. Decode both and assert
      equality. Not PSNR, exact. Changed pixels mean the tool re-encoded, which
      is a bug
- [ ] OOXML and ODF still open in a validator, with compression method and entry
      order preserved for untouched parts
- [ ] A PDF whose metadata was written by an incremental update yields no
      recoverable original `/Info` anywhere in the output byte stream
