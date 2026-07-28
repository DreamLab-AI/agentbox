---
name: typography
description: >
  Correct typographic detail — curly quotes, en/em dashes, single spacing, hierarchy,
  line length, and layout — in generated or reviewed UI code. Use when writing or
  auditing HTML/CSS/React/JSX that renders visible text, or when making an interface's
  type read as professional.
---

# UI Typography Skill

Applies timeless typographic correctness that LLMs routinely get wrong: proper quote
marks (curly, not straight), the three dashes (hyphen / en / em), spacing, hierarchy,
and page layout. Two modes:

- **ENFORCEMENT (default):** when generating any UI with visible text, apply the rules
  automatically using correct HTML entities and CSS. No need to ask or explain — just
  produce correct typography.
- **AUDIT:** when reviewing existing code or design, flag violations with before/after fixes.

These are strong, well-grounded defaults drawn from how the human eye reads (see
Attribution), not passing trends. Follow them by default; deviate deliberately when a
specific design calls for it, not by accident.

## When to Use

- Any HTML/CSS/React/JSX artifact containing visible text
- Landing pages, components, dashboards, UI layouts
- Fixing typography or making an interface look professional
- Reviewing existing layouts for typographic issues
- Web design, presentation design, document generation
- Any task producing visible text for humans — apply even if typography isn't mentioned

## When Not to Use

- Font pairing, type-scale selection, brand type systems → **ui-ux-pro-max-skill**
- Text accessibility audits (contrast, screen readers, WCAG) → **bencium-controlled-ux-designer**
- LaTeX typesetting / academic paper prep → **latex-documents**
- Plain markdown or text with no UI rendering → standard editing suffices

## Core Rules (quick-path)

Apply these directly; the reasoning, edge cases, and full catalogue live in `references/rules.md`.

1. Prefer curly quotes over straight — `&ldquo;` `&rdquo;` for double, `&lsquo;` `&rsquo;` for single
2. Three distinct dashes: hyphen (-), en dash (`&ndash;`), em dash (`&mdash;`) — don't approximate with `--`
3. One space after punctuation, not two
4. Line length 45–90 characters (`max-width: 65ch`)
5. Line spacing 120–145% of point size (`line-height: 1.2`–`1.45`)
6. Bold or italic, not both at once
7. Letterspace ALL CAPS (5–12%) with kerning on
8. Avoid underlining for emphasis in UI — use bold or italic
9. Keep to ~2 fonts, each with a consistent role
10. Set body text first — its 4 properties (font, size, line spacing, line length) drive everything else

## Quick Examples

**Curly apostrophe in JSX** (escape sequences render literally between tags — see the JSX warning in the rules reference):
```jsx
<p>Don{'’'}t use straight quotes</p>
```

**Dashes:**
```html
<p>Pages 1&ndash;10</p>          <!-- range: en dash -->
<p>A bold claim&mdash;indeed</p>  <!-- break: em dash -->
```

**CSS baseline:**
```css
body {
  max-width: 65ch;
  line-height: 1.4;
  font-feature-settings: "kern" 1, "liga" 1;
  text-rendering: optimizeLegibility;
}
```

## References

Read on demand:

- **`references/rules.md`** — full rule catalogue with reasoning and edge cases:
  characters, spacing, text formatting, page layout, responsive, screen, maxims, and the
  JSX/React unicode-escape correctness trap.
- **`references/css-templates.md`** — complete CSS baseline template, responsive patterns, OpenType features.
- **`references/html-entities.md`** — full entity table with characters and codes.

## Attribution

Rules distilled from **Matthew Butterick's *Practical Typography*** (https://practicaltypography.com) —
professional typography made accessible for everyday digital writing. If this skill is useful, consider
supporting his work directly.
