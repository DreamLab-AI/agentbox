---
name: bencium-creative
description: >
  Consolidated creative UI/UX skill combining design vision and production-grade implementation.
  Two modes: --design (ask-first, bold creative direction) and --build (production frontend code).
  Anti-AI-slop, distinctive aesthetics, shadcn/Tailwind/Phosphor stack. Replaces
  bencium-innovative-ux-designer and bencium-impact-designer.
  Use when building bold creative UX, production frontend, or anti-AI-slop design with shadcn/Tailwind implementation.
  NOT for enterprise/WCAG-first UI (use bencium-controlled-ux-designer), daisyUI work (use daisyui), auditing existing UI (use design-audit), or generating a brand spec from intake (use open-design).
version: 1.0.0
replaces:
  - bencium-innovative-ux-designer
  - bencium-impact-designer
tags:
  - ui
  - ux
  - design
  - frontend
  - creative
user-invocable: true
---

# Bencium Creative — Design Vision + Production Frontend

Distinctive, production-grade UI/UX that avoids generic "AI slop" aesthetics.

## Modes

**`--design`** — Ask first, commit boldly. Design direction before a single line of code.
**`--build`** — Implementation-first. Production code with a specific aesthetic already chosen.
**Default** — If no mode flag: ask design questions first, then implement. Full pipeline.

---

## Core Philosophy: Design Thinking Protocol

### Step 1 — Ask (Even in --build mode, confirm if unspecified)
1. **Purpose**: What problem does this interface solve? Who uses it?
2. **Tone**: Which aesthetic direction? (see Tone Options below)
3. **Constraints**: Framework, performance, accessibility requirements?
4. **Differentiation**: What makes this *unforgettable*?

### Step 2 — Commit Boldly
Choose a clear direction. Execute with precision. No half-measures.
Maximalism and refined minimalism both work — the key is **intentionality, not intensity**.

### Step 3 — Implement (--build or default)
Production-grade, functional, visually striking. Every detail intentional.

---

## Tone Options (Pick an Extreme)

Commit to one clear aesthetic direction — intentionality over intensity. The full catalogue of 27 tone directions (brutally minimal → nordic calm), each with a one-line brief, lives in [`references/tone-options.md`](references/tone-options.md).

---

## Anti-AI-Slop Rules (NEVER)

**Fonts**: Inter, Roboto, Arial, Space Grotesk as primary choice
**Colors**: Generic SaaS blue (#3B82F6), purple gradients on white
**Patterns**: Cookie-cutter layouts, glass morphism, Apple mimicry
**Overall**: Anything that looks "Claude-generated" or machine-made

**Instead**:
- Distinctive font pairing: unexpected display + refined body
- Unexpected neutrals: warm greys, soft off-whites, deep charcoals
- Dominant color with SHARP accent — outperforms timid distributed palettes
- Atmosphere: gradient meshes, noise textures, grain overlays, dramatic shadows
- Vary light/dark — no two designs should look the same

**Extended slop detection**: See `../open-design/references/anti-slop-rules.md` for the 12-point checklist and remediation steps.

---

## Creative Reframing (When Stuck)

Unblock direction with designer, context-shift, and era lenses ("What would Sagmeister do?", "What if this was a protest poster?", "1960s Swiss International?") — full lens set in [`references/creative-reframing.md`](references/creative-reframing.md).

---

## Force Variety (Anti-Sameness Protocol)

Before implementing, decide:

| Dimension | Choice A | Choice B |
|-----------|----------|----------|
| Color temperature | Warm (terracotta, ochre, cream) | Cool (slate, ice blue, mint) |
| Layout | Left-heavy asymmetry / diagonal flow | Center-dominant / right-heavy |
| Type personality | Geometric/Slab/Monospace | Humanist/Serif/Display-decorative |
| Motion | Minimal feedback only | Choreographed scroll-triggered reveals |
| Density | Generous whitespace (luxury) | Controlled density (editorial) |

---

## Foundational Design Principles

Six principles — typography, colour architecture, motion, spatial composition, visual effects, accessibility (WCAG 2.1 AA) — detailed in [`references/design-principles.md`](references/design-principles.md).

---

## Implementation Stack (--build mode)

shadcn/ui + Tailwind + Phosphor + sonner, layout/loading-state conventions, and the responsive testing checklist — full stack notes in [`references/implementation-stack.md`](references/implementation-stack.md).

---

## Design Workflow

1. **Understand** — Problem? Users? Success criteria?
2. **Explore** — Present 2-3 alternative directions with trade-offs
3. **Implement iteratively** — Structure → visual polish → test
4. **Validate** — Playwright MCP when available

---

## Quick Code Examples

Copy-ready shadcn/Tailwind/Phosphor snippets — distinctive button, editorial typography hierarchy, grain overlay — in [`references/code-examples.md`](references/code-examples.md).

---

## Modern UX Patterns

Direct manipulation, immediate feedback, progressive disclosure, adaptive layouts — pattern briefs in [`references/modern-ux-patterns.md`](references/modern-ux-patterns.md).

---

## Routing Notes

- **Enterprise/WCAG-first** → use `bencium-controlled-ux-designer` instead
- **daisyUI-specific** → use `daisyui` instead
- **General palette/font selection** → `ui-ux-pro-max-skill` (50 styles, 97 palettes)
- **Typography enforcement only** → `typography`
- **Audit existing UI** → `design-audit`
- **Prototype from brand spec** → use `open-design` (structured intake + DESIGN.md + quality gate)
- **Need a brand spec first** → use `open-design` to generate DESIGN.md, then hand off here for production

## Open Design Integration

When a DESIGN.md brand specification exists (from `open-design/design-systems/`):
- Map its 6 tokens to your implementation's CSS variables or Tailwind theme
- Respect the typography weights and features specified
- Use the brand's elevation/shadow system, not generic Tailwind shadows
- Apply the critique gate (5 dimensions ≥6) before delivery

When no brand spec exists but you're in `--build` mode:
- Generate a lightweight DESIGN.md following `../open-design/references/design-system-schema.md`
- Commit to it — don't freestyle hex values mid-implementation
