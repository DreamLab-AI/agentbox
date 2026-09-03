# prose-sanitiser

A deterministic AI-provenance sanitiser and prose linter, in Rust.

Two jobs. Make prose read as though a competent human with opinions decided
every word of it. Make the files that carry it clean of the provenance metadata
and invisible-Unicode contraband a machine can read.

The distinguishing claim is the combination: deterministic slop detection, plus
lossless verifiable provenance surgery, plus sense-aware UK English. Each of
those exists separately. Together they do not, and the technical provenance
layer in particular is untouched by the deslop tooling that exists.

## The honest capability matrix

This table is the contract. Nothing outside the first block should appear in a
crate description, a README or a `--help`.

### Detects and strips losslessly, verifiable by diff

| Capability | Basis |
|---|---|
| Invisible `Cf`-class controls: zero-width family, tag block, variation selectors, bidi controls, exotic whitespace, soft hyphen, Hangul fillers | Deterministic codepoint classification with context rules |
| Variation-selector and tag-block smuggled payloads, **including decoding the hidden bytes** | The byte mapping is fully specified |
| Homoglyph and mixed-script substitution | UTS #39 skeleton and restriction levels |
| C2PA JUMBF manifests in JPEG `APP11`, PNG `caBX`, WebP `C2PA`, PDF embedded files, SVG `c2pa:manifest` | Container structure is normatively specified; deletion is byte-level |
| EXIF, XMP (including Extended XMP), IPTC/Photoshop IRB, PNG text chunks, `tIME`, GIF comments | Well-delimited container structures |
| PDF `/Info` and `/Metadata`, with a full object-graph rewrite so prior incremental revisions do not survive | Structural rewrite |
| OOXML `docProps/*.xml`, `word/comments.xml`, `w:ins`/`w:del`, `rsid`; ODF `meta.xml` | ZIP part deletion, compression and entry order preserved |

### Detects and reports, but never claims to strip

| Capability | Why |
|---|---|
| Statistical sampling watermarks (SynthID-Text, Kirchenbauer, Aaronson, and Claude's own mark since 2 August 2026) | Detection requires the vendor key |
| Pixel-domain image watermarks (SynthID-Image, Stable Signature, Tree-Ring, TrustMark, StegaStamp) | Each needs a proprietary trained decoder or diffusion inversion |
| Durable Content Credentials (C2PA soft binding plus a cloud repository) | The tool cannot know whether a soft binding exists |
| AI stylistic tells: lexical, structural, narrative | Heuristic, not forensic. Population-level evidence only |

### Degrades, never removes

Paraphrase changes tokens, which degrades any sampling watermark as a side
effect. It is lossy, cannot be verified without the vendor key, and is not
removal. No lossless, token-preserving removal exists anywhere in the
literature.

### Never touches

`U+200D` inside a well-formed RGI emoji ZWJ sequence; `Mn`/`Mc` combining marks;
ZWNJ/ZWJ after an Indic virama or between Persian morphemes; balanced bidi
controls in genuine RTL prose; `U+FEFF` at byte offset 0; content inside code
fences, inline code, HTML attributes, URLs, file paths or front matter; US
spelling in proper nouns, organisation names and direct quotations;
sense-dependent pairs such as `program`, `meter`, `disk`, `sulfur`, `fetus` and
`dialog box`; the pixel data of any image; NFKC normalisation of user-facing
prose.

## Confidence tiers

Severity rates impact. Confidence rates whether the rule is right. They are
orthogonal, and only confidence gates a fix.

| Tier | Contents | Auto-fix |
|---|---|---|
| `certain-mechanical` | Invisible Unicode, container metadata, homoglyphs | Yes, always. Verifiable by diff |
| `high-confidence-stylistic` | Unconditional dialect pairs, always-ise and always-yse sets | Only behind an explicit `--write` |
| `low-confidence-judgement` | Sense-dependent pairs, slop phrasing, organisation-adjacent tokens | Never. Report only |

## Workspace layout

| Crate | Role | Published |
|---|---|---|
| [`prose-sanitiser-core`](crates/core) | Shared types: `Finding`, `Span`, `Patch`, `Severity`, `ConfidenceTier`, the `Check`/`Fix` traits. No I/O, no subprocesses | Candidate |
| [`prose-sanitiser-unicode`](crates/unicode) | Layer A: classification, UTS #39, payload decoding | Candidate |
| [`prose-sanitiser-uk`](crates/uk) | VarCon-backed UK English with span exclusion and sense disambiguation | Candidate |
| [`prose-sanitiser-slop`](crates/slop) | Versioned, confidence-tiered AI-tell rule tables | Candidate |
| [`prose-sanitiser-media`](crates/media) | Image and container provenance surgery | Not first wave |
| [`prose-sanitiser`](crates/cli) | The CLI binaries, audit sweeps and rewrite layer | Workspace |
| [`prose-sanitiser-server`](crates/server) | The HTTP service | No |

The split is licence and dependency hygiene. `core`, `unicode`, `uk` and `slop`
are pure Rust with no C dependencies, no subprocesses and no network, which is
the part worth publishing. `media` pulls the heavier tree.

## Library shape

A config builder, `check(&Document) -> Vec<Finding>` that never mutates, and a
separate `fix(&Document, &[Finding]) -> Patch` returning an applyable diff. That
one core then serves the CLI, an editor language server (findings as code
actions) and the SARIF exporter without any of them reimplementing a rule.

A fix is represented as data, never as pre-applied text.

## Building and testing

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
cargo doc --workspace --no-deps
```

## Licence

MIT OR Apache-2.0, at your option.

Dependency licences are kept clean deliberately. Avoided: `rexiv2` (GPL-3.0),
`mupdf-rs` (AGPL-3.0), LibreOffice en_GB Hunspell dictionaries (GPL/LGPL/MPL
tri-licensed), LanguageTool rules (LGPL, reference only), `spellbook` (MPL-2.0,
usable as a dependency but not vendorable). Wikipedia-derived word lists are
fine as *facts*; the article prose is CC BY-SA and is not copied.

Vendored VarCon data keeps its own permissive notice in
[`crates/uk/data/LICENSE-VarCon`](crates/uk/data/LICENSE-VarCon).

## Ethics

Legitimate editing improves a text and enforces a house style regardless of who
or what drafted it. Evasion targets a specific detector's signature. This
project markets itself on the first and refuses to market itself on
detector-defeat metrics.

Under EU AI Act Article 50(4), AI-generated text that underwent genuine human
editorial review, with a named person holding editorial responsibility, is
exempt from the marking duty. Supporting that review is a lawful and disclosed
workflow, and it is what this tool is for.

## Documentation

The user-facing workflow, the editorial method and the full reference
catalogues live in the agentbox skill at `skills/prose-sanitiser/`.
