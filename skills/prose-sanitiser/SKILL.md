---
name: prose-sanitiser
description: >
  Audit and de-slop prose for AI writing tells (lexical, structural, and
  narrative), strip technical AI provenance marks (invisible Unicode watermarks,
  statistical sampling fingerprints, C2PA/EXIF/XMP metadata), and enforce UK
  English. Use when writing or editing public-facing content — blog posts, docs,
  tutorials, articles, presentations — or short fiction, or when asked to
  "sanitise this", "de-slop", "remove AI tells", "strip watermarks", "remove
  provenance", or "make this read human". Also covers substance-first editing,
  draft review without rewriting, and interview-driven co-writing — use when a
  piece reads generic or hollow, or when asked to "review this draft" or
  "co-write this with me".
---

# Prose Sanitiser

Strip LLM fingerprints from text — both the stylistic tells a human reader spots
and the technical provenance marks a machine detector finds. Output should read as
if written by a competent human with opinions, carry no invisible Unicode carriers
or sampling watermarks, and ship with clean file metadata.

UK English throughout. No exceptions.

Five layers:
- **Generative** — apply the Section A principles when drafting new content.
- **Editorial** — substance-first diagnosis and repair (Section F), plus review
  and co-write workflows (Section G). De-slopping cannot supply a missing point;
  this layer finds and fixes the hollow piece before style work starts.
- **Destructive** — run the Section B audit on existing text.
- **Simplification** — LLM-driven rewrite to plain English (`simplify`, `declaudish`
  strengths) for readability without manual line-by-line fixes. Useful as a first pass
  before the destructive audit, or standalone when the goal is readability not watermark
  evasion. Inspired by [claudish-to-english](https://github.com/gvzdv/claudish-to-english).
- **Watermark** — strip technical AI provenance marks (Section E).

## Quick path

0. **Triage substance before style.** If the piece reads hollow rather than
   merely slopped — generic claims, no mechanism, nothing only this author could
   say — start with Section F (or Section G to review/interview). Steps 1–7
   remove tells; they cannot supply a missing point.
1. **Strip invisible marks first.** Run `inspect-text` / `clean-text` to
   remove Unicode watermark carriers (Layer A). This is lossless and always safe.
2. **Simplify (optional, fast path).** If the text is dense AI prose and you want
   a quick first pass, run `rewrite-text --strength simplify` (or `declaudish`
   for Claude-specific tells). This is an LLM-driven rewrite to plain English
   that can save manual editing time. Add `--context "the original question"` for
   better results. Skip this if you prefer manual control.
3. **Scan for stylistic tells.** Run `slop-scan` to catch the
   mechanical writing tells a regex can see.
4. **Fix in priority order** — high-severity findings first (see the reference
   sections for the full catalogues).
5. **Do the human read** — narrative defaults, altitude, voice, and whether a
   sentence is actually true. The scanner is blind to all of these.
6. **Statistical rewrite (optional).** If the text must also defeat token-sampling
   detectors, run `rewrite-text` last — it changes wording, so do it after all
   editorial choices are final.
7. **Strip file metadata.** Before publication, run `clean-file` to remove
   C2PA manifests, EXIF, XMP, and document properties from exported files.

```bash
# Layer A — invisible Unicode carriers (lossless, always first)
inspect-text <path>                      # report invisible chars
clean-text <path>                        # strip them
clean-text <path> --stats                # strip + report counts

# Stylistic tells
slop-scan <path>                 # full report + slop score
slop-scan <path> --severity high # only the strongest signals
slop-scan <path> --json          # machine-readable, for CI

# Layer B — statistical watermark attack (lossy, last)
rewrite-text <path>                      # default strength (paraphrase)
rewrite-text <path> --strength simplify  # plain English, short sentences
rewrite-text <path> --strength declaudish # targets Claude-specific tells
rewrite-text <path> --strength simplify --context "What does X do?"
rewrite-text <path> --strength humanize  # defeat AI detectors
rewrite-text <path> --min-chars 200      # skip short texts

# File metadata
inspect-file <path>                      # report metadata found
clean-file <path>                        # strip metadata

# Aggregate audit
audit-dir <directory>                    # recursive directory sweep
audit-website --base <url>               # crawl and scan a published site
```

The slop scanner reads `.md .markdown .mdx .txt .rst`, skips fenced code and
blockquotes, respects the `slop-ignore` marker, and reports each finding with
`file:line` and the fix. Its exit code is the high-severity count, so CI can gate
a docs build on it. It sees lexical and structural tells only.

Every command above is a baked binary on `PATH` — no Python, no virtualenv, no
`pip install`. The watermark tools (`inspect-text`, `clean-text`, `rewrite-text`,
`inspect-file`, `clean-file`, `audit-dir`) began as
[watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) and
were ported to Rust; the CLI surface and output shape are unchanged. `c2patool`,
`exiftool`, and `qpdf` extend file metadata coverage when present on PATH.
Sections F and G are adapted from Addy Osmani's
[clarity](https://github.com/addyosmani/clarity) (MIT).

The only Python left in this skill is the four torch harnesses — `score_synthid.py`
(reverse-SynthID), `clean_ctrlregen.py` (CtrlRegen), `markdiffusion_harness.py`
(MarkDiffusion) and `detect_text_watermark.py` (MarkLLM) — plus the `common.py`
they share. Those wrap diffusion/model stacks that only exist in Python; the Rust
locates them, runs them under resource caps and parses their JSON back. They are
found via `$PROSE_SANITISER_SCRIPTS_DIR`, else the baked skill directory.

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
- [Section F — Editorial Method](references/editorial-method.md): substance
  before style — truth/ownership safeguards, the job of the piece and its
  register, the order of work (truth → substance → development → sentences →
  craft), the high-value diagnoses (importance without mechanism, flatten and
  relation tests, structural regularity), putting craft back, and per-medium
  routing. Read this when a piece is hollow or generic, or before any
  substantial rewrite.
- [Section G — Review and Co-write](references/review-and-cowrite.md): critique
  without rewriting (keep/revise/ask-author/cut verdicts) and the perspective
  interview for building drafts from the author's own material, with provenance
  notes and `[TK]` gap markers. Read this when asked to review a draft or
  co-write.
