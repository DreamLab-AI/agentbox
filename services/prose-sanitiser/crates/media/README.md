# prose-sanitiser-media

Container-level provenance surgery for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox), plus the filesystem
and subprocess helpers it needs.

Removal is byte-level and structural: a chunk or part is deleted and the file
written back otherwise unchanged. **Pixel data is never re-encoded.**

## Detects and losslessly strips

- C2PA JUMBF manifests in JPEG `APP11`, PNG `caBX`, WebP `C2PA`, PDF
  embedded-file specifications and SVG `c2pa:manifest`.
- EXIF, XMP (including Extended XMP), IPTC/Photoshop IRB, PNG text chunks,
  `tIME`, GIF comment extensions.
- PDF `/Info` and `/Metadata`, with a structural rewrite so prior incremental
  revisions do not survive in the byte stream.
- OOXML `docProps/core.xml`, `app.xml`, `custom.xml`, `word/comments.xml`,
  `w:ins`/`w:del` and `rsid`; ODF `meta.xml` — with compression method and entry
  order preserved for untouched parts.

## Detects, but cannot strip

- Pixel-domain image watermarks (SynthID-Image, Stable Signature, Tree-Ring,
  TrustMark, StegaStamp, DwtDct). Each needs a proprietary trained decoder or
  diffusion inversion.
- Durable Content Credentials. **Stripping the manifest does not guarantee
  unlinkability**: C2PA defines a soft binding — a fingerprint or invisible
  watermark — that lets a validator recover the original signed manifest from a
  cloud repository. A clean container is not an anonymous file.

## Licence

MIT OR Apache-2.0.
