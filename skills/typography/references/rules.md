# Typography Rules — Full Reference

The complete rule catalogue behind the skill's quick-path. Read this when you need
the reasoning behind a rule, an edge case, or the exact entity/CSS to apply. Rules
are distilled from **Matthew Butterick's *Practical Typography*** and reflect how the
human eye reads — treat them as strong, well-grounded defaults rather than as
inviolable law. Deviate deliberately when a specific design calls for it; do not
deviate by accident.

Companion references:
- `css-templates.md` — full CSS baseline, responsive patterns, OpenType features
- `html-entities.md` — complete entity table with characters and codes

---

## Characters

### Quotes and Apostrophes — Prefer Curly

Straight quotes are typewriter artifacts. Use `&ldquo;` `&rdquo;` for double, `&lsquo;` `&rsquo;` for single.

Apostrophes point down — identical to the closing single quote `&rsquo;`. Smart-quote engines wrongly
insert opening quotes before decade abbreviations ('70s) and word-initial contractions ('n'). Fix these
with an explicit `&rsquo;`.

The `<q>` tag auto-applies curly quotes when `<html lang="en">` is set.

Hawaiian okina points upward — it's a letter, not an apostrophe. Use an opening single quote or anglicize.

### JSX/React Implementation Warning

This is a genuine correctness trap, not a style preference — get it wrong and the user sees raw escape text.

**Unicode escape sequences (`’`, `“`, etc.) do NOT work in JSX text content.** They render
as literal characters — the user sees `’` instead of a curly apostrophe. JSX text between tags is
treated as a string literal by the transpiler, not as a JavaScript expression.

**What fails:**
```jsx
{/* WRONG — renders literally as ’ */}
<p>Don’t do this</p>
```

**What works (pick one):**

1. **Actual UTF-8 characters (preferred):** Paste the real character directly into the source file.
   ```jsx
   <p>Don't do this</p>  {/* the actual curly apostrophe character U+2019 */}
   ```

2. **JSX expression with string literal:** Wrap in curly braces so the JS engine interprets the escape.
   ```jsx
   <p>Don{'’'}t do this</p>
   ```

3. **HTML entity (HTML files only):** Use `&rsquo;` — this does NOT work in JSX/React.

**For bulk fixes via CLI**, use `sed` with raw UTF-8 bytes (not escape sequences):
```bash
CURLY=$(printf '\xe2\x80\x99')  # U+2019 RIGHT SINGLE QUOTATION MARK
sed -i '' "s/don't/don${CURLY}t/g" file.tsx
```

**In JavaScript data arrays and string literals**, `’` works correctly because the JS engine
processes the escape. The bug only affects JSX text content between tags.

### Dashes and Hyphens — Three Distinct Characters

| Character | HTML | Use |
|-----------|------|-----|
| - (hyphen) | `-` | Compound words (cost-effective), line breaks |
| – (en dash) | `&ndash;` | Ranges (1–10), connections (Sarbanes–Oxley Act) |
| — (em dash) | `&mdash;` | Sentence breaks—like this |

Avoid approximating with `--` or `---`. If you open with "from", pair with "to" rather than an en dash.
Hyphen for compound names (marriage); en dash for joint authorship. Em dash typically sits flush; add
`&thinsp;` if it looks crushed. Prefer an en dash over a slash where a range is meant. Hyphenate phrasal
adjectives (five-dollar bills). No hyphen after -ly adverbs.

### Ellipses — One Character

Use `&hellip;` (…) rather than three periods. Spaces before and after; use `&nbsp;` on the text-adjacent
side. For interrupted dialogue, an em dash usually reads better than an ellipsis.

### Math and Measurement

Use `&times;` for multiplication, `&minus;` for subtraction. Use `+` and `=` from the keyboard.
An en dash is acceptable as a simple minus. Dimensions: 8.5″ × 14″ uses `&times;`.

**Foot and inch marks** — the one place curly quotes do not apply. These should be STRAIGHT: `&#39;` for
foot, `&quot;` for inch. Use `&nbsp;` between values: `6&#39;&nbsp;10&quot;`.

### Trademark and Copyright

Use real symbols: `&copy;` `&trade;` `&reg;` in preference to (c) (TM) (R). ™/® are superscripts, no
space before. © is inline, followed by `&nbsp;` then the year. "Copyright ©" is redundant — word OR
symbol, not both.

### Paragraph and Section Marks

`&sect;` (§) and `&para;` (¶) are followed by `&nbsp;`: `&sect;&nbsp;1782`. Spell them out at a sentence
start. Double for plurals: `&sect;&sect;`.

### Accented Characters

Proper names: keep the accents (François Truffaut, Plácido Domingo) — they are part of the spelling.
Loanwords: check a dictionary — some are naturalized (naive), some not (cause célèbre).

### Other Punctuation

- **Semicolons** join independent clauses. **Colons** introduce a completion. Don't mix them.
- **Question marks**: underused — simplifying a topic sentence into a question often helps.
- **Exclamation points**: overused — budget roughly one per long document, and avoid multiples in a row.
- **Ampersands**: reserve for proper names; write "and" in body text.
- **Parentheses/brackets**: do not adopt the formatting of the surrounded material.
- **Emoticons/emoji**: fine in email/Slack; out of place in formal documents or professional UI copy.

---

## Spacing

### One Space After Punctuation

Use exactly one space after any punctuation, not two. Two spaces create rivers and disrupt text balance —
the period already carries visual white space.

### Nonbreaking Spaces

`&nbsp;` prevents a line break. Use it before numeric refs (`&sect;&nbsp;42`, `Fig.&nbsp;3`), after ©
(`&copy;&nbsp;2025`), after honorifics (`Dr.&nbsp;Smith`), and between foot/inch values.

### White-Space Characters

| Need | Tool |
|------|------|
| Space between words | One word space (spacebar) |
| Prevent line break | `&nbsp;` |
| New line, same paragraph | `<br>` |
| New paragraph | `<p>` tags |
| New page (print) | `page-break-before: always` |
| Suggest hyphenation point | `&shy;` |

Avoid holding the spacebar, doubling carriage returns for spacing, or using tabs for indentation in
output. HTML collapses runs of whitespace to a single space (except `&nbsp;`).

---

## Text Formatting

### Bold and Italic

- **Bold or italic, not both at once** — combining them muddies the emphasis.
- **Use as little as possible.** If everything is emphasized, nothing is.

Serif: italic for gentle emphasis, bold for strong. Sans serif: lean on bold — italic sans barely stands
out. Avoid bolding entire paragraphs, and don't use quotation marks for emphasis.

### Underlining

Avoid underlining for emphasis in a document or UI — it's a typewriter workaround; reach for bold or
italic instead. For web links, keep the underline subtle:
`text-decoration-thickness: 1px; text-underline-offset: 2px`.

### All Caps — Short Runs, Letterspaced

Caps are harder to read (homogeneous rectangles vs the varied contour of lowercase), so keep them to short
headings, labels, and captions. Add 5–12% letterspacing and keep kerning on; `letter-spacing: 0.06em` is a
good starting point. Avoid setting whole paragraphs in caps.

### Small Caps — Real Only

Use `font-variant-caps: small-caps` with fonts that carry real small caps (OpenType `smcp`); avoid faking
them by scaling down regular caps. System fonts often lack real small caps. Add letterspacing + kerning.

### Point Size

Print: 10–12pt. Web: 15–25px. The 12pt default is a typewriter relic. Half-point differences matter — use
the smallest increment for emphasis. `clamp()` handles fluid web sizing well.

### Letterspacing

Add 5–12% on ALL CAPS and small caps; leave lowercase alone. Don't spread letters so far apart that
another letter could fit in the gap. CSS: `letter-spacing: 0.05em` to `0.12em`.

### Kerning — Keep On

Leave kerning on as a default. `font-feature-settings: "kern" 1; text-rendering: optimizeLegibility;`

### Ligatures

Most valuable when fi/fl visually collide — check bold and italic too. Otherwise optional.
CSS: `font-feature-settings: "liga" 1`.

### Alternate Figures

Tabular (`"tnum"`) for data tables; oldstyle (`"onum"`) for body text; default figures are fine for most
uses. `font-variant-numeric: tabular-nums lining-nums` for numeric tables.

### Font Selection

1. Avoid novelty/script/handwriting/circus fonts in professional work.
2. Avoid monospaced for body text — reserve it for code (Courier is the weakest choice).
3. Print body: serif is usually the stronger choice.
4. Web body: serif or sans both read well on modern screens.
5. Prefer metrics spacing in InDesign over optical (optical can mangle kerning).

### Mixing Fonts

Keep to about two fonts, each with a consistent role. Serif+serif or sans+sans both work. Rarely mix
within a paragraph. Lower contrast between the two is often more effective than high contrast.

---

## Page Layout

### Body Text First

Set body text before anything else. Four decisions cascade to everything downstream: font, point size,
line spacing, line length. Calibrate every other element against these.

### Line Length — 45–90 Characters

The readability factor most often gotten wrong, and the most common flaw in responsive web layouts.
Measure in characters, not inches. Alphabet test: fit 2–3 lowercase alphabets per line.
CSS: `max-width: 65ch` on text containers.

### Line Spacing — 120–145% of Point Size

`line-height: 1.2` to `1.45`. Single-spaced (~117%) is too tight; double (~233%) too loose. Word-processor
"Single" and "Double" both miss the optimal range.

### Page Margins

One inch is rarely enough for proportional fonts. Print: 1.5–2.0″ at 12pt. Web: `max-width` on text
containers plus `padding`. Don't fear white space — generous margins read as professional.

### Text Alignment

Left-align for web (the default). Justified needs `hyphens: auto`, and browser engines hyphenate crudely.
Center sparingly, only for short titles (< 1 line); avoid centring whole text blocks.

### Paragraph Separation — Indent OR Space

Pick one, not both. **First-line indent**: 1–4× point size, `text-indent: 1.5em` (optional on the first
paragraph). **Space between**: 50–100% of font size, `margin-bottom: 0.75em`. Avoid double `<br>` tags.

### Headings — Around 3 Levels

1. Avoid all-caps headings (unless very short and letterspaced).
2. Avoid underlining headings.
3. Avoid centring headings (rare exceptions).
4. Emphasize with **space above and below** — subtle and effective.
5. Prefer **bold over italic** — it stands out better.
6. Use the smallest point-size increment that reads as a heading (body 11pt → 13pt, not 18pt).
7. `hyphens: none` on headings.
8. Space above > space below (a heading relates to the text that follows).
9. Keep a heading with its next paragraph (`page-break-after: avoid`).
10. Prefer tiered numbers (1.1, 2.1) over roman numerals (I.A.1.a.i).

### Block Quotations

Reduce size and line spacing slightly. Indent 2–5em. Drop the quotation marks (the indent signals the
quote). Keep line length readable. Use sparingly — long block quotes often signal lazy writing.

### Lists

Use semantic markup (`<ul>`, `<ol>`) rather than manual bullets. Prefer hollow bullets; asterisks are too
small. Don't over-indent.

### Tables — Fewer Borders, More Padding

Data creates an implied grid, so borders mostly add clutter — keep only a thin rule under the header row.
`padding: 0.5em 1em`. Tabular figures for numeric columns; right-align numbers.

### Rules and Borders

Try space above and below before reaching for a rule. Border thickness: 0.5–1pt. Avoid patterned borders;
thick lines read as chartjunk.

### Flow Control

Watch widows (last line alone at the top of a page) and orphans (first line alone at the bottom). CSS
print: `orphans: 2; widows: 2`. Headings: `page-break-after: avoid`. Soft hyphens `&shy;` help words that
confuse hyphenation engines.

### Columns and Grids

Print columns: 2–3 on letter paper, rarely 4. Web columns are awkward (indefinite bottom edge). Grids
guide rather than guarantee — simpler grids enforce more consistency, and aligning ugly to a grid still
produces ugly.

---

## Responsive Web Typography

The rules hold across screen sizes — same line length, line spacing, and hierarchy.

1. Scale `font-size` and container `width` together.
2. Keep `max-width` on text containers — avoid edge-to-edge text.
3. Don't use the `ch` unit for exact measurement (it only measures zero width).
4. `clamp()` for fluid scaling: `font-size: clamp(16px, 2.5vw, 20px)`.
5. Mobile minimum: `padding: 0 1rem` on text containers.
6. Common failure: images/nav scale carefully while body text is ignored.

---

## Screen Considerations

Modern screens render type nearly as well as print. "Sans serif for screens" was true at 72dpi and is now
obsolete — serif fonts work fine on modern screens. Dark mode: reduce weight slightly. Test on macOS and
Windows, where antialiasing differs.

---

## Maxims of Page Layout

1. **Body text first** — its 4 properties determine everything.
2. **Foreground vs background** — don't let chrome upstage body text.
3. **Smallest visible increments** — half-points matter.
4. **When in doubt, try both** — make samples, don't theorize.
5. **Consistency** — same things look the same.
6. **Relate new to existing** — each element constrains the next.
7. **Keep it simple** — 3 colors and 5 fonts? Think again.
8. **Imitate what you like** — emulate good typography from the wild.

---

## Attribution

These rules are distilled from **Matthew Butterick's *Practical Typography*** (https://practicaltypography.com).
Butterick is a typographer, writer, and type designer whose work bridges professional typography and everyday
digital writing. If you find this skill valuable, consider supporting his work directly.
