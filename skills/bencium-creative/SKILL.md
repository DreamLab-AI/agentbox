---
name: bencium-creative
description: >
  Consolidated creative UI/UX skill combining design vision and production-grade implementation.
  Two modes: --design (ask-first, bold creative direction) and --build (production frontend code).
  Anti-AI-slop, distinctive aesthetics, shadcn/Tailwind/Phosphor stack. Replaces
  bencium-innovative-ux-designer and bencium-impact-designer.
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

Choose a clear aesthetic direction and execute with precision:

- **Brutally minimal** — stripped to essence, bold typography, vast whitespace
- **Retro-futuristic** — vintage meets sci-fi, nostalgic tech aesthetics
- **Organic/natural** — soft edges, earthy colors, nature-inspired textures
- **Editorial/magazine** — strong typography hierarchy, asymmetric layouts
- **Brutalist/raw** — exposed structure, harsh contrasts, intentionally rough
- **Art deco/geometric** — bold patterns, metallic accents, symmetric elegance
- **Neo-Swiss Grid** — rigorous grid, restrained palette, typographic clarity
- **Anti-Grid Experimental** — intentional misalignment, broken columns, art-school energy
- **Monochrome High-Contrast** — black/white only, stark hierarchy, graphic punch
- **Duotone Pop** — two-color system, bold overlays, poster-like impact
- **Kinetic Typography** — type as motion, stretched/warped letterforms
- **Glitch/Digital Noise** — scanlines, chromatic offsets, "corrupted" UI textures
- **Y2K Cyber Gloss** — chrome gradients, gel buttons, translucent panels
- **Vaporwave Nostalgia** — neon dusk palette, faux-3D, retro mall ambience
- **Synthwave Night Drive** — magenta/cyan, grid horizons, cinematic neon noir
- **Memphis Playful** — squiggles, confetti geometry, loud upbeat patterns
- **Bauhaus Modernism** — primary colors, simple geometry, functional clarity
- **Constructivist Propaganda** — diagonals, bold blocks, commanding headlines
- **Cinematic Noir** — moody shadows, tight spotlighting, grain
- **Clay/Soft 3D** — rounded forms, matte materials, playful product-UI vibe
- **Data-Driven Dashboard** — dense but legible, charts as hero elements
- **Scientific/Technical** — annotation callouts, thin rules, lab-manual precision
- **Startup Crisp** — clean UI, bold CTA geometry, vibrant accent
- **High-Fashion Lookbook** — ultra-thin type, dramatic photography framing, luxe whitespace
- **Museum Exhibition** — quiet typography, generous margins, gallery placard vibe
- **Whimsical Storybook** — soft illustration cues, charming type, warm narrative palette
- **Nordic Calm** — pale neutrals, soft contrast, clean type, quiet warmth

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

---

## Creative Reframing (When Stuck)

**Designer lens**:
- "What would Sagmeister do?" → Provocation, conceptual depth
- "What would Neville Brody do?" → Typography as art, rule-breaking hierarchy
- "What would Studio Dumbar do?" → Bold color, geometric play, Dutch directness

**Context shift**:
- "What if this was a magazine spread?" → Editorial hierarchy, art direction
- "What if this was a protest poster?" → Urgency, stark contrast, immediate impact
- "What if this was a vinyl record cover?" → Square constraint, tactile, collectible

**Era lens**:
- "1960s Swiss International?" → Grid perfection, rational clarity
- "1990s Emigre/Ray Gun?" → Chaos, layering, deliberately challenging
- "2000s Flash era?" → Motion-first, experimental navigation

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

1. **Typography** — Headlines: emotional, attention-grabbing, UNEXPECTED. Body: functional, legible.
   Mathematical scale (1.25x between sizes). 2-3 typefaces max.

2. **Color Architecture**
   - Base: 4-5 neutral shades (backgrounds, surfaces, borders, text)
   - Accent: 1-3 bold colors (CTAs, status, emphasis)
   - Warm greys → organic/approachable; Cool greys → modern/tech-forward

3. **Motion** — CSS-only preferred; Motion library for React. One well-orchestrated page load
   with staggered reveals beats scattered micro-interactions. Scroll-triggering + hover surprises.

4. **Spatial Composition** — Asymmetry, overlap, diagonal flow, grid-breaking elements.
   Generous negative space OR controlled density. Never timid middle ground.

5. **Visual Effects** — Gradient meshes, noise/grain overlays (opacity 0.03-0.08), dramatic layered
   shadows (add color from accent palette), custom cursors for brand differentiation.

6. **Accessibility** — WCAG 2.1 AA. Min 44×44px touch targets. Keyboard nav. Semantic HTML.
   Don't rely on color alone to convey meaning.

---

## Implementation Stack (--build mode)

### Component Library
- **shadcn/ui** (v4): prefer over plain HTML — `import { Button } from "@/components/ui/button"`
- **Tailwind CSS**: utility classes exclusively; `@theme` variables from `tailwind.config.js`
- **Icons**: `@phosphor-icons/react` — `import { Plus } from "@phosphor-icons/react"`
- **Toasts**: `sonner` — `import { toast } from 'sonner'`
- **Animation**: CSS-first; Motion library for React when complex orchestration needed

### Layout Implementation
- Grid/flex wrappers with `gap` for spacing; nest wrappers as needed
- Conditional styling: `clsx('base-class', { 'active-class': isActive })`
- Responsive: mobile-first, relative units (%, em, rem), content-based breakpoints

### Loading States
- Always add loading states — skeletons until content renders
- Spinners for >300ms operations; placeholder animations for skeleton screens

### Testing Checklist
- Playwright MCP for automated visual testing
- Responsive across breakpoints (mobile/tablet/desktop)
- Touch targets verified on mobile
- Keyboard navigation + screen reader compatibility
- Color contrast ratios (4.5:1 normal text, 3:1 large text)

---

## Design Workflow

1. **Understand** — Problem? Users? Success criteria?
2. **Explore** — Present 2-3 alternative directions with trade-offs
3. **Implement iteratively** — Structure → visual polish → test
4. **Validate** — Playwright MCP when available

---

## Quick Code Examples

### Distinctive Button (Not Generic)
```tsx
import { Button } from "@/components/ui/button";
import { ArrowRight } from "@phosphor-icons/react";

// Terracotta accent — not the default SaaS blue
<Button className="bg-[#C4603C] hover:bg-[#A8502F] text-white px-6 py-3 rounded-none
                   font-mono tracking-widest text-xs uppercase transition-colors duration-200">
  Begin
  <ArrowRight className="ml-2" />
</Button>
```

### Typography Hierarchy (Distinctive)
```tsx
<div className="space-y-4">
  {/* Editorial serif — NOT Inter */}
  <h1 className="font-['Playfair_Display'] text-6xl font-bold tracking-tight text-slate-900">
    Headline
  </h1>
  <p className="font-['IBM_Plex_Mono'] text-sm text-slate-600 leading-relaxed max-w-prose">
    Body copy with technical clarity.
  </p>
</div>
```

### Grain Overlay (Anti-Flat Background)
```css
.atmospheric-bg::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,..."); /* SVG noise */
  opacity: 0.04;
  pointer-events: none;
  z-index: 0;
}
```

---

## Modern UX Patterns

**Direct Manipulation** — Drag to reorder (not buttons), inline editing (not separate forms),
sliders for ranges.

**Immediate Feedback** — Every interaction < 100ms. Visual state changes on hover/press.
Skeleton screens for loading. Shake on error. Checkmark on success.

**Progressive Disclosure** — Summary visible → expand for details → advanced behind toggle.
Show 3-5 filters; hide rest behind "More filters".

**Adaptive Layouts** — Auto dark/light based on system preference. Collapsed nav on mobile.
Simplified UI on slow connections.

---

## Routing Notes

- **Enterprise/WCAG-first** → use `bencium-controlled-ux-designer` instead
- **daisyUI-specific** → use `daisyui` instead
- **General palette/font selection** → `ui-ux-pro-max-skill` (50 styles, 97 palettes)
- **Typography enforcement only** → `typography`
- **Audit existing UI** → `design-audit`
