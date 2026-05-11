---
name: "Open Design"
description: "Design production pipeline with structured intake, brand-system enforcement, and 5-dimensional quality gates. Use when generating web prototypes, landing pages, dashboards, mobile mockups, presentations, or any visual artifact. Combines structured questioning, design-system token enforcement, P0/P1/P2 checklists, and anti-slop critique. Supports 129 brand specifications and 64 surface types."
---

# Open Design — Production Design Pipeline

Generate professional visual artifacts constrained by brand specifications, quality gates, and structured workflows. Not freestyle generation — compositional design from validated parts.

## When To Use This Skill

- Web prototypes, landing pages, marketing pages
- SaaS dashboards, admin panels, analytics views
- Mobile app mockups (iOS/Android frame-accurate)
- Slide decks, presentations, pitch decks
- Email marketing templates
- Social media carousels, posters
- Any HTML artifact requiring brand consistency

## Prerequisites

- A design brief (what to build, for whom)
- Optional: a DESIGN.md brand specification (see `design-systems/` for 129 ready-made brands)
- If no brand spec provided, the skill generates one using the structured intake

---

## Workflow

### Phase 1 — Structured Intake (Never Skip)

Before generating anything, collect these five dimensions:

| Dimension | Question | Why |
|-----------|----------|-----|
| **Surface** | What are we building? (landing, dashboard, mobile, deck, email) | Routes to correct layout library |
| **Audience** | Who sees this? (developers, executives, consumers, designers) | Sets information density and tone |
| **Tone** | What aesthetic direction? (see Tone Library below) | Prevents generic output |
| **Brand** | Existing design system? Logo/colors/fonts? | Enforces token consistency |
| **Scale** | How many screens/sections? One-shot or system? | Scopes the deliverable |

If the user provides a clear brief covering all five, proceed. Otherwise, ask concise questions to fill gaps. Never generate on incomplete context.

### Phase 2 — Design System Resolution

Resolve a DESIGN.md before writing any HTML/CSS:

1. **Named brand exists** → Load from `design-systems/{brand}/DESIGN.md`
2. **User provides tokens** → Generate a DESIGN.md following the schema in `references/design-system-schema.md`
3. **No brand specified** → Use one of five default visual directions:
   - **Editorial** — serif display, generous whitespace, magazine grid
   - **Modern Minimal** — Inter/system-ui, strict whitespace, single accent
   - **Tech Utility** — mono accents, dense but legible, dashboard-native
   - **Brutalist** — raw structure, harsh contrast, exposed grid
   - **Soft Warm** — rounded forms, warm neutrals, approachable

### Phase 3 — Compose (Not Generate)

Select a surface archetype and compose from its layout library:

| Surface | Layout Source | Sections |
|---------|--------------|----------|
| Landing/Marketing | `references/layouts-web.md` | hero → features → proof → pricing → cta → footer |
| Dashboard | `references/layouts-dashboard.md` | sidebar + topbar + KPI grid + charts |
| Mobile | `references/layouts-mobile.md` | 6 archetypes: Feed, Detail, Onboarding, Profile, Checkout, Focus |
| Deck/Presentation | `references/layouts-deck.md` | title → agenda → content slides → summary |
| Email | `references/layouts-email.md` | header → hero → body → cta → footer |

**Hard rules during composition:**
- All colors from DESIGN.md tokens via CSS variables — no raw hex outside `:root`
- Display font for headings, body font for text — never override
- Accent used at most twice per screen (eyebrow + primary CTA)
- No emoji as icons — use inline SVG or monospace glyphs
- No filler copy — real, specific content or labeled placeholders
- Semantic HTML (`<header>`, `<main>`, `<section>`, `<footer>`)
- `data-od-id` on every top-level `<section>` for targeting
- Mobile reflow works at ≤920px without horizontal scroll

### Phase 4 — Five-Dimensional Critique (Quality Gate)

Before emitting the artifact, self-score across five dimensions:

#### 1. Philosophy Consistency (0–10)
Does the artifact pick one clear direction and maintain it through every micro-decision? One coherent design thesis, no conflicting styles.

#### 2. Visual Hierarchy (0–10)
Can a stranger identify what to read first, second, third? Type scale, weight, and semantic font choices guide attention without instruction.

#### 3. Detail Execution (0–10)
The 90/10 stuff: alignment, leading, kerning, image framing, baseline work. Magazine-grade precision in spacing.

#### 4. Functionality (0–10)
Navigation works, click targets are adequate (≥44px mobile), readability at viewing distance, edge cases handled (mobile, print, paste).

#### 5. Innovation (0–10)
Does this push past the median? Unexpected layout or typographic moves that earn their place within the design thesis. Generic output scores 5.

**Scoring discipline:**
- 0–4: Broken | 5–6: Functional | 7–8: Strong | 9–10: Exceptional
- Lowest sustained band becomes the score — don't average away failures
- Cite specific elements as evidence
- Conservative production work may legitimately score 5 on Innovation

**Gate**: All dimensions must score ≥6. If any dimension scores ≤5, fix before emitting.

### Phase 5 — P0/P1/P2 Checklist

#### P0 — Must Pass
- [ ] No raw hex outside `:root` token block
- [ ] All headings use declared display font
- [ ] Accent appears at most twice per screen
- [ ] No purple/violet gradient backgrounds (unless brand-specified)
- [ ] No emoji as feature icons
- [ ] No invented metrics or unsourced claims
- [ ] No filler copy or lorem ipsum
- [ ] Mobile reflow works (single column ≤920px, no horizontal scroll)
- [ ] All text is content-meaningful

#### P1 — Should Pass
- [ ] One decisive visual flourish (not multiple competing flourishes)
- [ ] Section rhythm alternates (no consecutive identical patterns)
- [ ] Headlines under 14 words
- [ ] CTA buttons specify outcomes ("Start free" not "Get Started")
- [ ] Hover states present on all interactive elements
- [ ] Numerics use monospace/tabular setting
- [ ] One image style per page (consistent framing)

#### P2 — Nice to Have
- [ ] `text-wrap: pretty` / `balance` on headings
- [ ] `color-mix()` for derived tones (no token proliferation)
- [ ] Sticky nav with `backdrop-filter: blur()`
- [ ] System-first font loading with web font enhancement

### Phase 6 — Anti-Slop Spot-Check

If the output resembles generic AI startup pages:
1. Replace one feature cell with product-specific content (screenshot, concrete example, actual output)
2. Remove one accent color use
3. Check: would a designer be embarrassed to claim this? If yes, redo Phase 3.

**Explicit slop blacklist:**
- Inter/Roboto/Space Grotesk as display font on a marketing page
- Generic SaaS blue (#3B82F6) with purple gradient hero
- Glass morphism cards floating over abstract mesh gradients
- Cookie-cutter 3-card feature grids with generic iconography
- "10x faster", "loved by thousands", unsubstantiated social proof

### Phase 7 — Emit

```
<artifact identifier="kebab-case-slug" type="text/html" title="Human Title">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact describing what's delivered. Nothing after.

---

## Tone Library (26 Directions)

| Tone | Character |
|------|-----------|
| Brutally minimal | Stripped essence, bold type, vast whitespace |
| Retro-futuristic | Vintage meets sci-fi, nostalgic tech |
| Organic/natural | Soft edges, earthy colors, nature textures |
| Editorial/magazine | Strong hierarchy, asymmetric layouts |
| Brutalist/raw | Exposed structure, harsh contrasts |
| Art deco/geometric | Bold patterns, metallic, symmetric |
| Neo-Swiss Grid | Rigorous grid, restrained palette |
| Anti-Grid Experimental | Intentional misalignment, art-school energy |
| Monochrome High-Contrast | Black/white only, graphic punch |
| Duotone Pop | Two-color system, poster impact |
| Kinetic Typography | Type as motion, warped letterforms |
| Glitch/Digital Noise | Scanlines, chromatic offsets |
| Y2K Cyber Gloss | Chrome gradients, gel buttons |
| Vaporwave Nostalgia | Neon dusk, faux-3D, retro mall |
| Synthwave Night Drive | Magenta/cyan, grid horizons |
| Memphis Playful | Squiggles, confetti geometry |
| Bauhaus Modernism | Primary colors, functional clarity |
| Constructivist | Diagonals, bold blocks, commanding |
| Cinematic Noir | Moody shadows, grain, spotlighting |
| Clay/Soft 3D | Rounded forms, matte materials |
| Data-Driven | Dense but legible, charts as hero |
| Scientific/Technical | Annotations, thin rules, lab precision |
| Startup Crisp | Clean UI, bold CTA, vibrant accent |
| High-Fashion | Ultra-thin type, dramatic photography |
| Museum Exhibition | Quiet typography, gallery placard |
| Nordic Calm | Pale neutrals, soft contrast, warmth |

---

## Design System Library

129 brand specifications available in `design-systems/`. Each follows the schema defined in `references/design-system-schema.md`.

**Usage:** Specify a brand name to load its tokens:
- "Use the Linear design system" → loads `design-systems/linear-app/DESIGN.md`
- "Use the Stripe design system" → loads `design-systems/stripe/DESIGN.md`
- "Minimal modern feel" → uses `design-systems/default/DESIGN.md` (Neutral Modern)

See `references/brand-index.md` for the complete catalog with categories.

---

## Integration with Other Skills

This skill composes with the existing design skill suite:

| Existing Skill | Relationship |
|---------------|-------------|
| **ui-ux-pro-max-skill** | Provides the 97 palettes, 57 font pairings, 50 styles data — use for discovery/inspiration before locking a DESIGN.md |
| **bencium-creative** | Handles the `--build` implementation with shadcn/Tailwind stack — hand off when moving from prototype to production components |
| **bencium-controlled-ux-designer** | Enforces WCAG 2.1 AA — invoke for accessibility validation pass |
| **design-audit** | Runs the 14-dimension post-build audit — invoke after delivery for polish |
| **typography** | Enforces Butterick rules — invoke on any text-heavy artifact |
| **daisyui** | Component library for Tailwind builds — use when implementing in Tailwind ecosystem |
| **relationship-design** | Agentic UX patterns — use when building AI-facing interfaces |

### Recommended Pipeline

```
1. /open-design (this skill) → structured intake + brand + prototype
2. /bencium-creative --build   → production component implementation
3. /typography                  → typographic enforcement pass
4. /design-audit               → 14-dimension quality review
```

---

## Reference Files

- `references/design-system-schema.md` — DESIGN.md authoring schema (9 sections)
- `references/layouts-web.md` — 8 web section layout skeletons
- `references/layouts-dashboard.md` — Dashboard layout patterns
- `references/layouts-mobile.md` — 6 mobile screen archetypes
- `references/critique-dimensions.md` — Extended scoring rubric with examples
- `references/brand-index.md` — Complete catalog of 129 brand specifications
- `references/anti-slop-rules.md` — Expanded slop detection and remediation
