# Output, exit codes, and the pre-publish checklist

As of 2026-09-03.

## Output formats

One flag selects the format: `--format {text,json,jsonl,sarif}`.

| Format | Use |
|---|---|
| `text` | `file:line:col`, rustc and clippy style. The default and the primary format |
| `json` | The tool's own report shape, which differs per binary and predates the workspace. `--json` is kept as an alias for this |
| `jsonl` | One JSON object per line. The ripgrep and typos convention, and the one to pipe |
| `sarif` | GitHub code scanning, which requires exactly SARIF 2.1.0, gzipped under 10 MB |

Only `jsonl` and `sarif` are generic serialisations of the shared report type.
SARIF output separates `runs[].tool.driver.rules[]` from `runs[].results[]` and
carries `partialFingerprints`, so a CI run deduplicates findings across commits
rather than re-reporting a moved line.

A machine format owns stdout completely: a progress line or a summary
interleaved with SARIF makes the document unparseable.

A fix is represented **as data**, never as pre-applied text: a finding carries a
span and an edit the caller chooses to apply. That is what lets one core serve
the CLI, an editor language server and the SARIF exporter without any of them
knowing about the others.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean, nothing found |
| 1 | Findings reported |
| 2 | Tool error: bad arguments, unreadable input, failed write |

This matches shellcheck and Vale. Note that `typos` inverts it and uses 2 for
findings; do not copy that convention here. Every binary prints the contract in
its `--help` epilogue.

Gate a docs build on `slop-scan --severity high`, which exits 1 only on
high-severity tells.

## Configuration

`--config` points at a `.prose-sanitiser.toml`; without it the nearest one is
discovered by walking up from the target, so the settings are committed
alongside the prose rather than living in a CI invocation. `--disable RULE` is
repeatable for a one-off, and `--explain-rules` prints the rule table with its
tiers, dates and sources, which is how you check whether a lexical rule has
decayed since it was written.

## The write policy

Report-only is the default for every stylistic and spelling rule. Nothing is
rewritten unless asked.

| Tier | Under default | Under `--write` |
|---|---|---|
| `certain-mechanical` | Reported. Applied by the dedicated cleaners (`clean-text`, `clean-file`, `clean-image`) | Applied |
| `high-confidence-stylistic` | Reported | Applied |
| `low-confidence-judgement` | Reported | **Still only reported** |

`--diff` previews what `--write` would do without touching the file. An
ambiguous case stays ambiguous no matter which flags are passed, which is the
single most important property of the whole design: a tool that silently
"corrects" *a driving licence* is worse than no tool.

## Suppression

Put `slop-ignore` on a line and the scanner skips it. An HTML comment
(`<!-- slop-ignore -->`) works in Markdown and is inert in every renderer.

For a region, the Vale-style toggle pair:

```markdown
<!-- prose-sanitiser off -->
...prose the scanner should leave alone...
<!-- prose-sanitiser on -->
```

and for one rule on one line, `<!-- prose-sanitiser:ignore RULE_ID -->`.

Use suppression when a flagged word is a real decision. A line you had to mark
is a line you made a choice about, which is the whole point. It also keeps the
audit trustworthy, because a report that nags about settled terms gets ignored
wholesale.

## Final editing checklist

Before publishing:

- [ ] Title promises something specific
- [ ] Opening hooks in 30 seconds, with no warm-up
- [ ] Every claim is backed by a specific example, number, or quote
- [ ] The most important claim has evidence, mechanism, example, or honest
      uncertainty beside it (see [editorial-method.md](editorial-method.md))
- [ ] No fact, attribution, scope, condition, quotation, or link drifted during
      editing; any gaps marked `[TK: question]`, never filled in
- [ ] The ending stops on the last useful thought, not a recap or send-off
- [ ] All Tier 1 vocabulary removed
- [ ] Em-dash count under threshold, and none in lists
- [ ] No "The X" headings, unless a proper noun
- [ ] No negative parallelism
- [ ] No throat-clearing openers
- [ ] UK English consistent, with the sense pairs checked by a human rather than
      a rule (see [uk-english.md](uk-english.md))
- [ ] No Claudish filler phrases (B13) <!-- slop-ignore -->
- [ ] `inspect-text` clean: no invisible carriers, no decoded payloads, no
      homoglyph substitution
- [ ] File metadata stripped: no C2PA manifest, EXIF, XMP, or document
      properties in the exported artefacts
- [ ] If a rewrite was applied, meaning verified afterwards
- [ ] (Fiction) at least one subplot does not tidily resolve
- [ ] (Fiction) at least one emotion labelled directly
- [ ] (Fiction) at least one named real-world reference
- [ ] Would send to a respected colleague without an apology

One thing the checklist cannot cover: a clean scan is not evidence of human
authorship, and neither is a clean `inspect-text`. Both say only that the
mechanical layer found nothing.

## Report format

Default: return the cleaned text with no commentary.

If asked for a report, or when running an audit, lead with the verdict rather
than the findings:

1. **Verdict and the single highest-impact change.** One line: the slop score
   and verdict, then the one fix that matters most.
2. **Findings by priority,** each with `file:line`, the tell, and the fix.
   High severity first. Quote the offending span, not the whole paragraph. Say
   the confidence tier where it is not obvious, so the reader knows what was
   mechanical and what is a judgement call.
3. **Close with the slop score and the top three changes.** Plain and specific.

State what the scanner found and what needed a human read. The goal is prose a
person decided the wording of, which is the one thing the scanner cannot do for
them.

## When not to sanitise

- Direct quotes from other people. The scanner already skips blockquotes
- Code, terminal output, API responses. The scanner skips fenced blocks
- Proper nouns and product names
- Technical terms of art, even where they overlap the banned list
- Content the user explicitly flags as intentional
- A stylistic choice that violates a rule but serves the piece, such as a
  deliberately philosophical dialogue in a Socratic essay
- Anything where the goal is to defeat a specific detector rather than to
  improve the text. See the ethics note in SKILL.md
