# prose-sanitiser

The CLI layer of [prose-sanitiser](https://github.com/DreamLab-AI/agentbox): a
deterministic AI-provenance sanitiser and prose linter.

## Binaries

| Binary | Does |
|---|---|
| `inspect-text` / `clean-text` | Invisible-Unicode and homoglyph surgery, with payload decoding |
| `inspect-image` / `clean-image` | PNG/JPEG/WebP metadata stripping |
| `inspect-file` / `clean-file` | SVG/PDF/DOCX/ODT/HTML/Markdown scrubbing, format detected by signature |
| `audit-dir` / `audit-website` | Recursive sweep, published-site crawl |
| `slop-scan` | Prose and Markdown AI-tell scanner |
| `slop-detect` | Design anti-pattern scanner for source |
| `rewrite-text` | Optional model-backed rewrite. Lossy |

The HTTP service lives in the separate `prose-sanitiser-server` crate.

## Layers

- **Layer A** (`prose-sanitiser-unicode`): invisible and format Unicode,
  homoglyph carriers, smuggled payloads. Deterministic; every strip is
  verifiable by diff. Run it first, always.
- **Metadata** (`prose-sanitiser-media`): C2PA/JUMBF, EXIF, XMP and front-matter
  provenance at chunk, segment and part granularity. Pixel data is never
  re-encoded.
- **Stylistic** (`prose-sanitiser-slop`, `prose-sanitiser-uk`): report-only
  heuristics, not forensic verdicts.
- **Layer B** (`rewrite`): an optional model-backed rewrite. Paraphrase changes
  tokens, which degrades a statistical sampling watermark as a side effect. That
  is lossy, cannot be verified without the vendor key, and **is not removal**.

## Output and exit codes

| Format | Flag |
|---|---|
| Human, `file:line:col`, rustc style | default |
| JSON Lines | `--json` |
| SARIF 2.1.0, for GitHub code scanning | `--sarif` |

| Exit code | Meaning |
|---|---|
| 0 | Clean |
| 1 | Findings at or above the gate severity |
| 2 | Tool error |

This matches shellcheck and Vale. Note that `typos` inverts it and uses 2 for
findings; that convention is deliberately not copied.

## The write policy

Report-only by default. `--write` applies `certain-mechanical` and
`high-confidence-stylistic` findings and never `low-confidence-judgement` ones,
so an ambiguous case stays ambiguous no matter which flags are passed. `--diff`
previews what `--write` would do.

The dedicated cleaners (`clean-text`, `clean-file`, `clean-image`) strip
unconditionally, because everything they touch is `certain-mechanical` and the
result is verifiable by diffing the output.

## Suppression

`slop-ignore` on a line skips it. An HTML comment works in Markdown and is inert
in every renderer. For a region, use the toggle pair
`<!-- prose-sanitiser off -->` and `<!-- prose-sanitiser on -->`; for one rule on
one line, `<!-- prose-sanitiser:ignore RULE_ID -->`.

## Provenance of the code

The provenance binaries began as
[watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) (MIT)
and were ported to Rust.

## Licence

MIT OR Apache-2.0, at your option.
