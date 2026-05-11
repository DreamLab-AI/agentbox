# DESIGN.md Schema — Brand Specification Format

Every design system follows this 9-section schema. When creating a new brand spec, fill each section. When consuming one, map tokens to CSS `:root` variables.

---

## Section 1: Visual Theme & Atmosphere

One sentence capturing the brand's visual DNA. This is the design thesis — every decision downstream must align with it.

```markdown
### Visual Theme & Atmosphere
"[Adjective], [adjective], [adverb] [quality]. [Constraint]. [Priority]-first, [secondary]-second."
```

**Example:** "Dark-mode-native, confident, quietly technical. No ornament. Content-first, chrome-second."

---

## Section 2: Color Palette & Roles

Six required tokens plus semantic colors:

```markdown
### Color Palette & Roles

| Token | Hex | Role |
|-------|-----|------|
| `--bg` | #FAFAFA | Page background |
| `--fg` | #111111 | Primary text |
| `--accent` | #2F6FEB | CTAs, links, one hero element per screen |
| `--muted` | #6B6B6B | Secondary text, captions |
| `--border` | #E5E5E5 | Dividers, card borders |
| `--surface` | #FFFFFF | Cards, modals, elevated containers |

**Semantic:**
| Token | Hex | Use |
|-------|-----|-----|
| `--success` | #17A34A | Positive states |
| `--warn` | #EAB308 | Caution states |
| `--danger` | #DC2626 | Error states |
```

**Rules:**
- Never pure black (`#000000`) for text — use near-black
- Never pure white for backgrounds — use off-white or tinted
- Accent budget: maximum 2 uses per viewport height
- All derived tones via `color-mix()` — no token proliferation

---

## Section 3: Typography Rules

```markdown
### Typography Rules

| Role | Family | Weight | Size Range | Line Height | Letter Spacing |
|------|--------|--------|-----------|-------------|----------------|
| Display | [font] | [weight] | 32–72px | 1.0–1.15 | -0.02em to -0.04em |
| Body | [font] | [weight] | 14–18px | 1.4–1.6 | normal |
| Mono | [font] | [weight] | 12–14px | 1.4–1.6 | normal |
| Caption | [font] | [weight] | 11–13px | 1.3 | 0.01em |

**Scale (px):** 12 · 14 · 16 · 20 · 24 · 32 · 48 · 64
**OpenType features:** [list any required: ss01, cv01, tnum, etc.]
**Fallback stack:** [system fallbacks]
```

**Rules:**
- Maximum 2 font families per project (display + body, or 1 family multi-weight)
- Display weight is the brand signature — document it explicitly
- Tabular numbers (`font-variant-numeric: tabular-nums`) for all data/prices
- Negative letter-spacing only on display sizes (≥32px)

---

## Section 4: Component Stylings

```markdown
### Component Stylings

**Buttons:**
- Radius: [px]
- Padding: [block] [inline]
- Primary: [bg] text [color], hover [state]
- Ghost: transparent, [border], hover [state]

**Cards:**
- Background: [token]
- Border: [width] solid [token]
- Radius: [px]
- Padding: [px]
- Shadow: [if any]

**Inputs:**
- Border: [width] solid [token]
- Radius: [px]
- Focus: [treatment]
- Label: [token], [size]

**Links:**
- Color: [token]
- Decoration: [none|underline]
- Hover: [treatment]
```

---

## Section 5: Layout Principles

```markdown
### Layout Principles

- Grid: [columns]-column, [max-width] max, [gutter] gutters
- Hero: [height range], [content alignment]
- Section spacing: [desktop]px / [tablet]px / [mobile]px
- Container padding: [px]
```

---

## Section 6: Depth & Elevation

```markdown
### Depth & Elevation

| Level | Shadow | Use |
|-------|--------|-----|
| Flat (0) | none | Default surfaces |
| Raised (1) | [shadow definition] | Cards, dropdowns |
| Elevated (2) | [shadow definition] | Modals, overlays |
```

---

## Section 7: Do's and Don'ts

```markdown
### Do's and Don'ts

✅ [Brand-appropriate behaviors — 3-5 items]
❌ [Brand-inappropriate behaviors — 3-5 items]
```

---

## Section 8: Responsive Behavior

```markdown
### Responsive Behavior

| Breakpoint | Columns | Gutters | Notes |
|------------|---------|---------|-------|
| Desktop ≥1024px | 12 | 24px | Full layout |
| Tablet 640–1023px | 8 | 16px | Collapsed sidebar |
| Phone <640px | 4 | 12px | Single column |
```

---

## Section 9: Agent Prompt Guide (Optional)

Instructions for AI agents consuming this design system:

```markdown
### Agent Prompt Guide

- Map tokens to `:root` CSS custom properties
- [Brand-specific generation rules]
- [What to avoid when generating for this brand]
- [Signature details that must be present]
```

---

## File Naming Convention

```
design-systems/
├── {brand-slug}/
│   └── DESIGN.md
```

Brand slug: lowercase, hyphens, no spaces. Examples: `linear-app`, `stripe`, `vercel`, `airbnb`.

## Minimum Viable DESIGN.md

At minimum, sections 1–3 (theme, colors, typography) must be present. Sections 4–9 enhance but aren't required for basic prototype generation.
