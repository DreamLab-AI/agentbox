---
name: prose-sanitiser
description: >
  Audit and de-slop prose for AI writing tells (lexical, structural, and
  narrative), strip technical AI provenance marks (invisible Unicode watermarks,
  statistical sampling fingerprints, C2PA/EXIF/XMP metadata), and enforce UK
  English. Use when writing or editing public-facing content — blog posts, docs,
  tutorials, articles, presentations — or short fiction, or when asked to
  "sanitise this", "de-slop", "remove AI tells", "strip watermarks", "remove
  provenance", or "make this read human".
---

# Prose Sanitiser

Strip LLM fingerprints from text — both the stylistic tells a human reader spots
and the technical provenance marks a machine detector finds. Output should read as
if written by a competent human with opinions, carry no invisible Unicode carriers
or sampling watermarks, and ship with clean file metadata.

UK English throughout. No exceptions.

Four layers:
- **Generative** — apply the Section A principles when drafting new content.
- **Destructive** — run the Section B audit on existing text.
- **Simplification** — LLM-driven rewrite to plain English (`simplify`, `declaudish`
  strengths) for readability without manual line-by-line fixes. Useful as a first pass
  before the destructive audit, or standalone when the goal is readability not watermark
  evasion. Inspired by [claudish-to-english](https://github.com/gvzdv/claudish-to-english).
- **Watermark** — strip technical AI provenance marks (Section E).

## Quick path

1. **Strip invisible marks first.** Run `inspect_text.py` / `clean_text.py` to
   remove Unicode watermark carriers (Layer A). This is lossless and always safe.
2. **Simplify (optional, fast path).** If the text is dense AI prose and you want
   a quick first pass, run `rewrite_text.py --strength simplify` (or `declaudish`
   for Claude-specific tells). This is an LLM-driven rewrite to plain English
   that can save manual editing time. Add `--context "the original question"` for
   better results. Skip this if you prefer manual control.
3. **Scan for stylistic tells.** Run `scripts/slop_scan.py` to catch the
   mechanical writing tells a regex can see.
4. **Fix in priority order** — high-severity findings first (see the reference
   sections for the full catalogues).
5. **Do the human read** — narrative defaults, altitude, voice, and whether a
   sentence is actually true. The scanner is blind to all of these.
6. **Statistical rewrite (optional).** If the text must also defeat token-sampling
   detectors, run `rewrite_text.py` last — it changes wording, so do it after all
   editorial choices are final.
7. **Strip file metadata.** Before publication, run `clean_file.py` to remove
   C2PA manifests, EXIF, XMP, and document properties from exported files.

```bash
# Layer A — invisible Unicode carriers (lossless, always first)
python3 inspect_text.py <path>                      # report invisible chars
python3 clean_text.py <path>                        # strip them
python3 clean_text.py <path> --stats                # strip + report counts

# Stylistic tells
python3 scripts/slop_scan.py <path>                 # full report + slop score
python3 scripts/slop_scan.py <path> --severity high # only the strongest signals
python3 scripts/slop_scan.py <path> --json          # machine-readable, for CI

# Layer B — statistical watermark attack (lossy, last)
python3 rewrite_text.py <path>                      # default strength (paraphrase)
python3 rewrite_text.py <path> --strength simplify  # plain English, short sentences
python3 rewrite_text.py <path> --strength declaudish # targets Claude-specific tells
python3 rewrite_text.py <path> --strength simplify --context "What does X do?"
python3 rewrite_text.py <path> --strength humanize  # defeat AI detectors
python3 rewrite_text.py <path> --min-chars 200      # skip short texts

# File metadata
python3 inspect_file.py <path>                      # report metadata found
python3 clean_file.py <path>                        # strip metadata

# Aggregate audit
python3 audit_dir.py <directory>                    # recursive directory sweep
python3 audit_website.py <url>                      # crawl and scan a published site
```

The slop scanner reads `.md .markdown .mdx .txt .rst`, skips fenced code and
blockquotes, respects the `slop-ignore` marker, and reports each finding with
`file:line` and the fix. Its exit code is the high-severity count, so CI can gate
a docs build on it. It sees lexical and structural tells only.

The watermark tools (`inspect_text.py`, `clean_text.py`, `rewrite_text.py`,
`inspect_file.py`, `clean_file.py`, `audit_dir.py`) come from
[watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover). Core
text cleaning needs only Python 3.10+ stdlib; `c2patool`, `exiftool`, and `qpdf`
extend file metadata coverage when present on PATH.

## Don't launder slop into new slop (second-order defaults)

The failure mode of every de-slop pass is swapping one default for another. Kill
every "leverage" and the prose acquires a different fingerprint: uniform "use",
staccato two-word fragments ("Fast. Actually fast."), the same inverted "X, not
Y" cadence on every other line, hedges amputated until the voice reads as clipped
and machine-confident. An editor can clock a *de-slopped-by-AI* draft as fast as a
slopped one. The replacement vocabulary, applied mechanically, is itself a tell.

So the rules in the references are a detector, not a target. The replace-with
column is a prompt to make a choice, not a lookup table to apply on autopilot.
The only durable property is the one a default can never have: a wording you chose
for this sentence and can say why. Vary the repair. Sometimes "leverage" wants
"use", sometimes "lean on", sometimes the clause should be cut. If a fix
introduces a new uniform default, it is not a fix.

## Reference sections

Load the relevant catalogue on demand — don't hold all of it in context at once:

- [Section A — Generative Principles](references/generative-principles.md):
  lead with value, show don't tell, honest trade-offs, audience framing, write
  from experience. Read this when drafting new content.
- [Section B — Destructive Audit](references/destructive-audit.md): the
  mechanical catalogue — em-dash density, "The X" headings, negative parallelism,
  Tier 1/2 vocabulary tables, throat-clearing, hedges, structural tells,
  transitions, passive voice, UK spelling, and Claudish structural patterns
  (B13), insider voice in external documents (B14), and preamble setup labels (B15). Read this when auditing existing text.
- [Section C — Narrative Tells (Fiction)](references/narrative-tells.md): the
  StoryScope-derived structural defaults (thematic over-explanation, embodied
  emotion, single-track plots, tidy resolutions, per-model fingerprints, and
  more). Read this when sanitising stories or character-driven prose.
- [Section D — Checklist, Output Format, and Scope](references/output-and-checklist.md):
  the pre-publish checklist, the report format, when NOT to sanitise, and the
  `slop-ignore` marker.
- [Section E — Watermark Removal](references/watermark-removal.md): technical
  AI provenance marks — invisible Unicode carriers (Layer A, lossless), statistical
  sampling watermarks (Layer B, lossy rewrite), file metadata (C2PA/EXIF/XMP),
  pixel-domain image watermarks, aggregate auditing, and the HTTP service API.
  Read this when stripping machine-detectable marks or preparing files for
  publication.
