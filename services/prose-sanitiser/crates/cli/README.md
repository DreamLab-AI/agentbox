# prose-sanitiser

The CLI layer of [prose-sanitiser](https://github.com/DreamLab-AI/agentbox): a
deterministic AI-provenance sanitiser.

## Binaries

| Binary | Does |
|---|---|
| `inspect-text` / `clean-text` | invisible-Unicode and homoglyph surgery |
| `inspect-image` / `clean-image` | PNG/JPEG/WebP metadata stripping |
| `inspect-file` / `clean-file` | SVG/PDF/DOCX/ODT/HTML/Markdown scrubbing |
| `audit-dir` / `audit-website` | recursive sweep, published-site crawl |
| `rewrite-text` | model-backed rewrite (Layer B) |
| `slop-scan` | prose slop scanner |
| `slop-detect` | design slop scanner |

The HTTP service lives in the separate `prose-sanitiser-server` crate.

## Layers

- **Layer A** (`prose-sanitiser-unicode`) — invisible/format Unicode and
  homoglyph carriers. Deterministic; strips are verifiable by diff.
- **Metadata** (`prose-sanitiser-media`) — C2PA/JUMBF, EXIF, XMP and frontmatter
  provenance, at chunk/segment/part granularity. Pixel data is never re-encoded.
- **Layer B** (`rewrite`) — an optional model-backed rewrite. Paraphrase changes
  tokens, which degrades a statistical sampling watermark as a side effect. That
  is lossy, cannot be verified without the vendor key, and **is not removal**.

Stylistic scanning comes from `prose-sanitiser-slop` and `prose-sanitiser-uk`;
those findings are report-only heuristics, not forensic verdicts.

## Licence

MIT OR Apache-2.0.
