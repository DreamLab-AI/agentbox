---
name: prose-sanitiser
description: >
  Audit and de-slop prose for AI writing tells (lexical, structural, and
  narrative) and enforce UK English. Use when writing or editing public-facing
  content — blog posts, docs, tutorials, articles, presentations — or short
  fiction, or when asked to "sanitise this", "de-slop", "remove AI tells", or
  "make this read human".
---

# Prose Sanitiser

Strip LLM writing fingerprints from text. Output should read as if written by a
competent human with opinions, not by a model hedging its way through a prompt.

UK English throughout. No exceptions.

Two modes:
- **Generative** — apply the Section A principles when drafting new content.
- **Destructive** — run the Section B audit on existing text.

## Quick path

1. **Scan first.** Run `scripts/slop_scan.py` to catch the mechanical tells
   before you read for the ones a regex cannot see.
2. **Fix in priority order** — high-severity findings first (see the reference
   sections for the full catalogs).
3. **Then do the human read** — narrative defaults, altitude, voice, and whether
   a sentence is actually true. The scanner is blind to all of these.

```bash
python3 scripts/slop_scan.py <path>                 # full report + slop score
python3 scripts/slop_scan.py <path> --severity high # only the strongest signals
python3 scripts/slop_scan.py <path> --json          # machine-readable, for CI
```

The scanner reads `.md .markdown .mdx .txt .rst`, skips fenced code and
blockquotes, respects the `slop-ignore` marker, and reports each finding with
`file:line` and the fix. Its exit code is the high-severity count, so CI can gate
a docs build on it. It sees lexical and structural tells only.

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

Load the relevant catalog on demand — don't hold all of it in context at once:

- [Section A — Generative Principles](references/generative-principles.md):
  lead with value, show don't tell, honest trade-offs, audience framing, write
  from experience. Read this when drafting new content.
- [Section B — Destructive Audit](references/destructive-audit.md): the
  mechanical catalog — em-dash density, "The X" headings, negative parallelism,
  Tier 1/2 vocabulary tables, throat-clearing, hedges, structural tells,
  transitions, passive voice, UK spelling. Read this when auditing existing text.
- [Section C — Narrative Tells (Fiction)](references/narrative-tells.md): the
  StoryScope-derived structural defaults (thematic over-explanation, embodied
  emotion, single-track plots, tidy resolutions, per-model fingerprints, and
  more). Read this when sanitising stories or character-driven prose.
- [Section D — Checklist, Output Format, and Scope](references/output-and-checklist.md):
  the pre-publish checklist, the report format, when NOT to sanitise, and the
  `slop-ignore` marker.
