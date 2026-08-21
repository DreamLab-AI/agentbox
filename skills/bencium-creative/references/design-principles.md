# Foundational Design Principles

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
