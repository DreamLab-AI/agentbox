# Section D — Final Editing Checklist, Output Format, and Scope

## Final editing checklist

Before publishing:

- [ ] Title promises something specific
- [ ] Opening hooks in 30 seconds (no warm-up)
- [ ] Every claim is backed by a specific example, number, or quote
- [ ] All Tier 1 vocabulary removed
- [ ] Em-dash count under threshold; no em-dashes in lists
- [ ] No "The X" headings (unless proper noun)
- [ ] No negative parallelism
- [ ] No throat-clearing openers
- [ ] UK English consistent throughout
- [ ] No invisible Unicode watermark carriers (`inspect_text.py` clean)
- [ ] File metadata stripped — no C2PA, EXIF AI-provenance, or XMP tags
- [ ] (If required) Statistical rewrite applied; meaning verified post-rewrite
- [ ] (Fiction) at least one subplot doesn't tidily resolve
- [ ] (Fiction) at least one emotion labelled directly
- [ ] (Fiction) at least one named real-world reference
- [ ] Would send to a respected colleague without an apology

## Output Format

Default: return the cleaned text with no commentary.

If asked for a report (or running an audit), lead with the verdict, not the
findings:

1. **Verdict and the single highest-impact change.** One line: the slop score
   and verdict from the scanner, then the one fix that matters most.
2. **Findings by priority**, each with `file:line`, the tell, and the fix.
   High-severity first. Quote the offending span, not the whole paragraph.
3. **Close with the slop score and the top three changes.** Plain and specific.

The goal is prose a person decided the wording of, which is the one thing the
scanner cannot do for them. State what is mechanical (the scanner found it) and
what needed a human read (Section C, voice, truth).

## When NOT to sanitise

- Direct quotes from other people (blockquotes — the scanner already skips these)
- Code, terminal output, API responses (the scanner skips fenced blocks)
- Proper nouns and product names
- Technical terms of art (even if they overlap with the banned list)
- Content the user explicitly flags as intentional
- Stylistic choices that violate a rule but serve the piece (e.g. a deliberately
  philosophical dialogue in a Socratic essay)

**Marking intentional choices.** Put `slop-ignore` on a line (an HTML comment
`<!-- slop-ignore -->` works in markdown) and the scanner skips it. Use it when
a flagged word is a real decision, so the audit stays trustworthy and does not
nag about a chosen term. A line you have to mark is a line you have made a
choice about — which is the whole point.
