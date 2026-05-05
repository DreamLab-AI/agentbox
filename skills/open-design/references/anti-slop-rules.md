# Anti-Slop Detection & Remediation

Rules for identifying and eliminating generic AI-generated design patterns.

---

## Detection Checklist

Score 1 point per match. If ≥3 points, the output is slop — redo Phase 3.

| # | Signal | Description |
|---|--------|-------------|
| 1 | **Generic SaaS blue** | Primary accent is #3B82F6 or similar Tailwind blue-500 |
| 2 | **Purple gradient hero** | Background gradient from blue to purple/violet |
| 3 | **Inter as display font** | Inter, Roboto, or Space Grotesk serving as marketing headline font |
| 4 | **Glass morphism everywhere** | `backdrop-filter: blur()` on every card without design thesis justification |
| 5 | **3-card feature grid** | Exactly three cards, icon + title + paragraph, centered, equal width |
| 6 | **Abstract mesh gradient** | Decorative background mesh with no meaning |
| 7 | **Unsubstantiated metrics** | "10x faster", "loved by 10,000+", "99.9% uptime" without source |
| 8 | **Stock photography vibes** | Described image placeholder that sounds like "diverse team collaborating" |
| 9 | **"Get Started" CTA** | Generic button text that doesn't specify the outcome |
| 10 | **Emoji as icons** | Using emoji characters instead of monoline SVG icons |
| 11 | **Pill buttons** | `border-radius: 999px` without brand justification |
| 12 | **Dark mode with neon** | Dark background + bright gradient text for no design-thesis reason |

---

## Remediation Steps

When slop is detected:

### Step 1 — Identify the thesis violation
Which of the 5 critique dimensions did the sloppy element violate? Usually Philosophy Consistency (mixing aesthetics) or Innovation (defaulting to generic).

### Step 2 — Replace, don't add
Don't add a flourish to mask the slop. Remove the generic element and replace it with something specific to the brief.

**Generic → Specific replacements:**

| Slop | Replacement |
|------|-------------|
| "Loved by thousands" | "[Real company name] reduced [metric] by [amount]" or remove entirely |
| Abstract gradient bg | Solid background from DESIGN.md token, or remove |
| 3 identical feature cards | Asymmetric layout: 1 large feature + 2 supporting, or use different card sizes |
| Stock photo placeholder | Product screenshot, code snippet, or labeled `.ph-img` placeholder |
| "Get Started" | Outcome verb: "Deploy in 30 seconds", "Start your free plan", "See the demo" |
| Emoji icons | Inline SVG from a monoline icon set, or single-character mono glyphs |
| Purple gradient hero | Single flat color from DESIGN.md `--accent` or `--bg` |

### Step 3 — The designer embarrassment test
Would a professional designer put this in their portfolio? If no, it's slop.

---

## Prevention (Build It Right First)

### Typography
- Choose a display font that is NOT Inter, Roboto, or system-ui for marketing pages
- If the DESIGN.md specifies Inter, use it with distinctive weight/tracking (see Linear's 510 + cv01)
- Serif display fonts immediately differentiate (Charter, Iowan Old Style, Playfair)

### Color
- One accent, applied to maximum 2 elements per viewport height
- Derive all other colors via `color-mix()` from the 6 tokens
- No gradients unless the DESIGN.md explicitly includes them in its thesis

### Layout
- Asymmetry > symmetry for marketing pages
- Vary section widths (full-bleed hero → narrow content → wide stats)
- Use whitespace as a design element, not as padding filler

### Content
- Every piece of text must be specific to the product or labeled as placeholder
- Headlines under 10 words — if longer, the writing is doing design's job
- Stats must have sources or be explicitly labeled `[PLACEHOLDER]`

### Icons
- Inline SVG, monoline, consistent stroke width
- One icon style per page (don't mix filled and outlined)
- 20-24px standard, 32px for feature cards

---

## Acceptable Exceptions

Slop signals are heuristics, not absolute rules. These exceptions are valid:

- **Inter as display** → Fine if using distinctive weight/features (e.g., Inter Variable 510 + cv01)
- **3-card feature grid** → Fine if content is genuinely three distinct, specific features (not padding)
- **Glass morphism** → Fine if it's the stated design thesis (glassmorphism DESIGN.md)
- **Gradient hero** → Fine if DESIGN.md explicitly includes gradient in its visual theme
- **Pill buttons** → Fine for specific brands (Apple, Spotify) that use them in reality

The test is always: does this element serve the design thesis, or did the AI default to it because it's the most common pattern in training data?
