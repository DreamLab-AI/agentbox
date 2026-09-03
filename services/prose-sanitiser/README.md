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
| Invisible `Cf`-class controls: zero-width family, tag block, variation selectors, bidi controls, exotic whitespace, Hangul fillers | Deterministic codepoint classification with context rules |
| Variation-selector and tag-block smuggled payloads, **including decoding the hidden bytes** | The byte mapping is fully specified |
| Homoglyph and mixed-script substitution. **Detected always; the fold to ASCII is opt-in** (`--aggressive-homoglyphs`) | UTS #39 skeleton and restriction levels |
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

### The principle behind the rows

**Detection is unconditional; mutation is conservative.** Anything whose repair
is a judgement is reported and not applied unless asked. Folding honest Cyrillic
or Greek prose into Latin is worse than leaving a homoglyph in place, and
removing a typesetter's hyphenation is worse than leaving a soft hyphen, so
neither happens by default. `--aggressive-homoglyphs` and
`CleanOptions::strip_soft_hyphen` are the opt-ins.

### Never touches

`U+200D` inside a well-formed RGI emoji ZWJ sequence; `Mn`/`Mc` combining marks;
ZWNJ/ZWJ after an Indic virama or between Persian morphemes; balanced bidi
controls in genuine RTL prose; `U+FEFF` at byte offset 0; `U+00AD` soft hyphen,
which is a hyphenation hint as often as a carrier, so it is reported and
stripped only on request; content inside code fences, inline code, HTML attributes, URLs, file paths or front matter; US
spelling in proper nouns, organisation names and direct quotations;
sense-dependent pairs such as `program`, `meter`, `disk`, `sulfur`, `fetus` and
`dialog box`; the pixel data of any image; NFKC normalisation of user-facing
prose.

## Confidence tiers

Severity rates impact. Confidence rates whether the rule is right. They are
orthogonal, and only confidence gates a fix.

| Tier | Contents | Auto-fix |
|---|---|---|
| `certain-mechanical` | Invisible Unicode, container metadata, homoglyphs | Yes, and the result is verifiable by diff. The tier rates the *classification*, so a conservative default can still hold a fold back behind a flag |
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

## Measured

A capability matrix is a claim until someone counts. Measured September 2026:

| What | Result |
|---|---|
| Homoglyph detection, SilverSpeak fixtures at 5, 10 and 20 per cent substitution | Precision 1.0000, recall 1.0000 |
| Legitimate-Unicode controls: emoji ZWJ, Devanagari, Persian, Hebrew-Latin, BOM, the three subdivision flags | Zero strips, byte-identical round trip |
| Container surgery, PNG/JPEG/WebP with no provenance marks | SHA-256 byte-identical; images pixel-exact, with the compressed `IDAT` and entropy-coded scan carried across verbatim |
| PDF metadata written by an incremental update | No recoverable original `/Info` anywhere in the output byte stream |
| UK English, the trap set (*gas meter*, *to license a doctor*, *World Health Organization*, *sulfur dioxide*, *dialog box*) | Zero findings, in both `-ise` and Oxford mode |
| UK English, 413,746 words of British technical prose | 64 fixable findings, all hand-inspected, **false-positive rate 0 of 64** |

The last row is the one worth having. No published study measured detector or
linter false positives on British English before this, which is why the crate
went and produced the number rather than citing one.

Two things are deliberately *not* claimed. A clean scan is not evidence of human
authorship. And the slop rules report TPR at 1 per cent FPR rather than AUROC,
because high AUROC routinely coexists with a near-zero true-positive rate at the
thresholds any real deployment needs.

## Building and testing

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
cargo doc --workspace --no-deps
```

## Licence

> **Open decision, and a hard publication blocker.** The mechanical half is now
> fixed: `LICENSE-MIT` and `LICENSE-APACHE` exist at this workspace root and are
> linked into every crate, so a packaged tarball carries its licence texts.
>
> The governing half is not. [ADR-016](../../docs/adr/) (2026-05-16, licence
> consolidation) records that all first-party code is **AGPL-3.0-only**, having
> "eliminated remaining MIT designations from sub-package manifests". The
> repository root `LICENSE` is AGPL-3.0. Ten `services/*` crates declare
> `MIT OR Apache-2.0` against that ADR, and `docs/developer/licensing.md` has no
> entry for any of them. Adding the licence texts did not resolve that conflict;
> if anything it sharpened it, because the repository now ships two contradictory
> grants for the same code.
>
> Relicensing is the copyright holder's call, not something to settle in a
> checklist. Nothing should be published to crates.io until this resolves one of
> three ways: the crates become AGPL-3.0 per ADR-016 and the publication plan is
> dropped; a new ADR supersedes ADR-016 to carve these leaf crates out as
> `MIT OR Apache-2.0` and `docs/developer/licensing.md` is updated to match; or
> the crates move to their own repository under their own licence.

The rest of this section describes the position the crates *declare*, which is
what the dependency choices were made to support.

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
