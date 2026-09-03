---
name: prose-sanitiser
description: >
  De-slop prose for AI writing tells (lexical, structural, narrative), strip
  invisible-Unicode carriers and container provenance metadata (C2PA, EXIF, XMP,
  document properties) losslessly and verifiably, decode smuggled Unicode
  payloads, and enforce UK English with sense-aware rules. Use when writing or
  editing public-facing content, blog posts, docs, tutorials, articles,
  presentations, short fiction, or when asked to "sanitise this", "de-slop",
  "remove AI tells", "strip metadata", "clean provenance", "check for hidden
  characters" or "make this read human". Also covers substance-first editing,
  draft review without rewriting, and interview-driven co-writing: use when a
  piece reads generic or hollow, or when asked to "review this draft" or
  "co-write this with me".
---

# Prose Sanitiser

Two jobs, one workflow. Make prose read as though a competent human with
opinions decided every word of it. Make the files that carry it clean of the
provenance metadata and invisible-Unicode contraband a machine can read.

UK English throughout.

Everything below is a baked binary on `PATH`. No Python, no virtualenv, no
`pip install`, except the four optional torch harnesses described in
[provenance.md](references/provenance.md).

## What this tool can and cannot do

Claim nothing outside this table. The evidence for each row is in
[provenance.md](references/provenance.md).

**Detects and strips losslessly, verifiable by diffing the output**

| Capability | Basis |
|---|---|
| Invisible `Cf`-class controls in text: zero-width family, tag block, variation selectors, bidi controls, Hangul fillers | Deterministic codepoint classification with context rules |
| Exotic whitespace (`U+00A0`, `U+202F`). **Detected always; the fold to `U+0020` is opt-in** | Orthographically load-bearing, so reported rather than rewritten |
| Variation-selector and tag-block smuggled payloads, including decoding the hidden bytes | The byte mapping is fully specified |
| Homoglyph and mixed-script substitution. **Detected always; the fold to ASCII is opt-in** (`--aggressive-homoglyphs`) | UTS #39 skeleton and restriction levels |
| C2PA JUMBF manifests in JPEG `APP11`, PNG `caBX`, WebP `C2PA`, PDF embedded files, SVG `c2pa:manifest` | Container structure is normatively specified; deletion is byte-level |
| EXIF, XMP (including Extended XMP), IPTC/Photoshop IRB, PNG text chunks, `tIME`, GIF comments | Well-delimited container structures |
| PDF `/Info` and `/Metadata`, with a structural rewrite so earlier incremental revisions do not survive in the byte stream | Full object-graph rewrite |
| OOXML `docProps/*.xml`, `word/comments.xml`, `w:ins`/`w:del`, `rsid`; ODF `meta.xml` | ZIP part deletion, compression and entry order preserved |

**Detects and reports only. Never claims to strip**

| Capability | Why |
|---|---|
| Statistical sampling watermarks (SynthID-Text, Kirchenbauer, Aaronson, and Claude's own mark since 2 August 2026) | Detection needs the vendor key. The tool can note that a source model probably watermarks, nothing more |
| Pixel-domain image watermarks (SynthID-Image, Stable Signature, Tree-Ring, TrustMark, StegaStamp) | Each needs a proprietary trained decoder or diffusion inversion |
| Durable Content Credentials (C2PA soft binding plus a cloud manifest repository) | The tool cannot know whether a soft binding exists. A clean container is not an anonymous file |
| AI stylistic tells, lexical, structural and narrative | Heuristic, not forensic. Population-level evidence only |

**Degrades, never removes. Say so every time**

| Capability | Honest wording |
|---|---|
| Statistical watermark "removal" by paraphrase (`rewrite-text`) | Paraphrase changes tokens, which degrades any sampling watermark as a side effect. It is lossy, cannot be verified without the vendor key, and is not removal. No lossless removal exists anywhere in the literature |

One law governs the Unicode layer, and it is worth reading before the rows
above: **detection is unconditional; mutation is gated separately.** Every rule
has two switches, not one: whether the finding exists, and whether it carries a
repair. Contraband is always reported, and whether the tool then rewrites it is
a policy question with its own default, so "tell me but do not touch it" is
always a position you can take.

The defaults differ per carrier. A default clean rewrites **only** the
zero-width, tag-block and variation-selector contraband; exotic whitespace,
homoglyphs and soft hyphens are reported and left in place, because each has a
legitimate reading that no codepoint inspection can rule out. The full table is
in [unicode.md](references/unicode.md).

**Never touches**

`U+200D` inside a well-formed RGI emoji ZWJ sequence; `Mn`/`Mc` combining marks;
ZWNJ/ZWJ after an Indic virama or between Persian morphemes; balanced bidi
controls in genuine RTL prose; `U+FEFF` at byte offset 0, where it is a BOM;
`U+00AD` soft hyphen, which is a hyphenation hint as often as a carrier, so it
is reported and stripped only on request; content inside code fences, inline code, HTML attributes, URLs, file paths or
front matter; US spelling in proper nouns, organisation names and direct
quotations; sense-dependent pairs such as `program`, `meter`, `disk`, `sulfur`,
`fetus` and `dialog box`; the pixel data of any image, on the default path;
NFKC normalisation of user-facing prose, which is lossy by design.

**Scope of "lossless" and "never touches pixels".** Both describe the default
path: a container-only operation that succeeds, with pixel removal disabled.
`clean-image --remove-pixel ctrlregen|diffusion` is outside it by design: it
hands the file to a diffusion harness that rewrites pixels deliberately, lossily
and unverifiably.

**What a clean report means.** A clean `inspect-*` is evidence that no known
embedded carrier remains. It is not proof of anonymity or of complete provenance
removal: it says nothing about a statistical sampling watermark, a pixel-domain
watermark, or a C2PA soft binding that retrieves the original manifest from a
cloud repository after the local one is gone.

## Confidence tiers and the write policy

Severity rates impact. Confidence rates whether the rule is right. They are
orthogonal on purpose, because a rule can be high-impact and still be a guess.
Only confidence gates an automatic fix.

| Tier | Contents | Auto-fix |
|---|---|---|
| `certain-mechanical` | Invisible Unicode, container metadata, homoglyphs, exotic whitespace | Yes, and verifiable by diff. The tier rates the *classification*, so a conservative default can still withhold the edit behind a flag |
| `high-confidence-stylistic` | Unconditional dialect pairs, always-ise and always-yse sets | Only behind an explicit `--write` |
| `low-confidence-judgement` | Sense-dependent pairs, slop phrasing, organisation-adjacent tokens | Never. Report only |

Default behaviour is report-only, and there are two opt-ins rather than one:

| Flag | Applies |
|---|---|
| (none) | Nothing. Reports only |
| `--fix` | `certain-mechanical` |
| `--write` | `certain-mechanical` and `high-confidence-stylistic`. Implies `--fix` |
| `--diff` | Previews what would change, writing nothing |

**Nothing applies a `low-confidence-judgement` finding**, so an ambiguous case
stays ambiguous no matter which flags are passed. The dedicated cleaners
(`clean-text`, `clean-file`, `clean-image`) strip unconditionally, because
everything they touch is `certain-mechanical`.

Exit codes: 0 clean, 1 findings reported, 2 tool error. Output format is one
flag, `--format {text,json,jsonl,sarif}`, with `--json` kept as an alias for
`--format json`. Use `jsonl` for pipelines and `sarif` for GitHub code scanning.

## Quick path

0. **Triage substance before style.** If a piece reads hollow rather than merely
   slopped, generic claims with no mechanism and nothing only this author could
   say, start at [editorial-method.md](references/editorial-method.md), or
   [review-and-cowrite.md](references/review-and-cowrite.md) to review or
   interview. The steps below remove tells. They cannot supply a missing point.
1. **Strip invisible marks.** `inspect-text` then `clean-text`. Lossless,
   deterministic, always safe, always first.
2. **Scan for stylistic tells.** `slop-scan` catches what a regex can see.
3. **Fix in priority order,** high severity first, using the catalogues in
   [destructive-audit.md](references/destructive-audit.md).
4. **Do the human read.** Narrative defaults, altitude, voice, and whether a
   sentence is actually true. The scanner is blind to all four.
5. **Optional rewrite.** `rewrite-text` if you want a plain-English pass or you
   accept a lossy paraphrase. Run it last, because it changes wording after
   every deliberate editorial choice is made.
6. **Strip file metadata.** `clean-file` on the exported artefacts, before
   publication.

```bash
# Invisible Unicode, lossless, always first
inspect-text <path>                # report invisible characters and payloads
inspect-text <path> --aggressive   # also flag Latin confusables and fullwidth
clean-text <path>                  # strip them
clean-text <path> --stats          # strip and report counts on stderr
clean-text <path> --in-place       # overwrite, keeping a .bak

# Stylistic tells
slop-scan <path>                   # full report plus slop score
slop-scan <path> --severity high   # strongest signals only
slop-scan <path> --format sarif    # for GitHub code scanning
slop-scan <path> --structural      # add whole-document structural measures
slop-scan <path> --explain-rules   # print the rule table with tiers and sources
slop-scan <path> --disable RULE    # skip one rule; repeatable

# Everything at once, on one confidence scale
sanitise <path>                    # report; add --fix, --write or --diff
sanitise <path> --format sarif --severity high

# File and container metadata
inspect-file <path>                # report metadata found
clean-file <path>                  # strip it
inspect-image <path> / clean-image <path>

# Aggregate
audit-dir <directory>              # recursive sweep
audit-website --base <url>         # crawl and scan a published site

# Optional lossy rewrite, last
rewrite-text <path> --strength simplify    # plain English, short sentences
rewrite-text <path> --strength declaudish  # Claude-specific tells
rewrite-text <path> --strength paraphrase  # default
```

`slop-scan` reads `.md .markdown .mdx .txt .rst`, skips fenced code and
blockquotes, respects the `slop-ignore` marker, and reports each finding with
`file:line` and the fix. It sees lexical and structural tells only.

The provenance binaries began as
[watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) and
were ported to Rust. The editorial and review sections are adapted from Addy
Osmani's [clarity](https://github.com/addyosmani/clarity) (MIT).

## Do not launder slop into new slop

The failure mode of every de-slop pass is swapping one default for another. Kill
every "leverage" and the prose acquires a different fingerprint: uniform "use",
staccato two-word fragments ("Fast. Actually fast."), the same inverted "X, not
Y" cadence every other line, hedges amputated until the voice reads clipped and
machine-confident. An editor clocks a de-slopped-by-AI draft as fast as a
slopped one. The replacement vocabulary, applied mechanically, is itself a tell.

So the rules in the references are a detector, not a target. The replace-with
column is a prompt to make a choice, not a lookup table to apply on autopilot.
The only durable property is the one a default can never have: a wording you
chose for this sentence and can say why. Vary the repair. Sometimes "leverage"
wants "use", sometimes "lean on", sometimes the clause should be cut. A fix that
introduces a new uniform default is not a fix.

## Ethics and framing

Legitimate editing improves a text and enforces a house style regardless of who
or what drafted it. Evasion targets a specific detector's signature. This tool
markets itself on the first and refuses to market itself on detector-defeat
metrics. The legal and evidential grounding for that position, including the EU
AI Act Article 50(4) editorial-review exemption, is in
[provenance.md](references/provenance.md) P11.

## Reference sections

Load one on demand. Do not hold all of them in context at once.

- [Generative principles](references/generative-principles.md): lead with value,
  show do not tell, honest trade-offs, audience framing, write from experience.
  Read when drafting new content.
- [Destructive audit](references/destructive-audit.md): the mechanical
  catalogue. Em-dash density, "The X" headings, negative parallelism, Tier 1 and
  Tier 2 vocabulary, throat-clearing, hedges, structural tells, transitions,
  passive voice, Claudish patterns, insider voice, preamble labels. Read when
  auditing existing text.
- [UK English](references/uk-english.md): the VarCon-backed subsystem. Span
  exclusion, the Oxford flag, the always-ise and always-yse sets, sense pairs,
  the organisation gazetteer, and what stays judgement-only forever.
- [Unicode](references/unicode.md): carrier classes, the two-switch law and the
  per-carrier defaults (X1a), protected sets, payload decoding, the split bidi
  policy, and why NFC and never NFKC.
- [Provenance](references/provenance.md): the 2026 threat model. Vendor
  watermarks stated honestly, container metadata surgery, durable Content
  Credentials, pixel-domain watermarks, what the torch harnesses actually prove,
  the ethics position (P11), aggregate auditing and the HTTP service.
- [Narrative tells](references/narrative-tells.md): structural defaults in
  fiction. Thematic over-explanation, embodied emotion, single-track plots, tidy
  resolutions, per-model fingerprints. Read when sanitising stories.
- [Output and checklist](references/output-and-checklist.md): the pre-publish
  checklist, report format, output formats and exit codes, when not to sanitise,
  and the `slop-ignore` marker.
- [Editorial method](references/editorial-method.md): substance before style.
  Truth and ownership safeguards, the job of the piece, the order of work, the
  high-value diagnoses, putting craft back, per-medium routing. Read when a
  piece is hollow, or before any substantial rewrite.
- [Review and co-write](references/review-and-cowrite.md): critique without
  rewriting (keep, revise, ask-author, cut) and the perspective interview for
  building a draft from the author's own material, with provenance notes and
  `[TK]` gap markers.
