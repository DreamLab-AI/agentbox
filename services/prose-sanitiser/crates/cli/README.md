# prose-sanitiser

The CLI layer of [prose-sanitiser](https://github.com/DreamLab-AI/agentbox): a
deterministic AI-provenance sanitiser and prose linter.

## Binaries

| Binary | Does |
|---|---|
| `sanitise` | The umbrella: every layer over a file or tree, on one confidence scale |
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

One flag selects the format: `--format {text,json,jsonl,sarif}`.

| Format | What it is |
|---|---|
| `text` | Human-readable, `file:line:col`, rustc and clippy style. The default |
| `json` | The tool's own long-standing report shape, per binary. `--json` is kept as an alias |
| `jsonl` | One JSON object per line, the ripgrep and typos convention |
| `sarif` | SARIF 2.1.0, the exact version GitHub code scanning requires |

Only `jsonl` and `sarif` are generic serialisations of the shared `Report`;
`text` and `json` are laid out per binary, because those shapes predate the
workspace and must not change. A machine format owns stdout completely.

| Exit code | Meaning |
|---|---|
| 0 | Clean, nothing found |
| 1 | Findings reported |
| 2 | Tool error: bad arguments, unreadable input, failed write |

This matches shellcheck and Vale. Note that `typos` inverts it and uses 2 for
findings; that convention is deliberately not copied. Every binary prints the
contract in its `--help` epilogue.

## Configuration

`--config` points at a `.prose-sanitiser.toml`; without it, the nearest one is
discovered by walking up from the target. `--disable RULE` is repeatable, and
`slop-scan --explain-rules` prints the rule table with tiers, dates and sources
so a decaying rule is visible rather than silent.

## The write policy

Report-only by default. `--fix` applies the `certain-mechanical` findings;
`--write` applies those **and** the `high-confidence-stylistic` ones, and implies
`--fix`. Nothing applies a `low-confidence-judgement` finding, so an ambiguous
case stays ambiguous no matter which flags are passed. `--diff` previews what
would change without writing.

`sanitise` reports image and container provenance but never rewrites those
bytes: stripping a JUMBF manifest is byte surgery on a specific format, and
`clean-image` and `clean-file` own it.

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

**MIT OR Apache-2.0**, at your option.

Per [ADR-2030](../../../../docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md), crates under `services/` are
permissive per crate while the containing repository stays AGPL-3.0-only.
That is not a contradiction: the AGPL governs the aggregate hosted service,
not the licence of each part, and this grant travels with the crate.
