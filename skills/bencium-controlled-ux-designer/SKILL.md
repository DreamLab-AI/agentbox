---
name: bencium-controlled-ux-designer
description: Collaborative UI/UX design guidance for building unique, accessible, non-generic web interfaces. Use when building or styling web components, pages, or apps and making visual decisions about colour, typography, layout, motion, or accessibility — especially when the goal is to break away from generic AI/SaaS-template aesthetics.
metadata:
  version: 1.1.0
---

# UX Designer

Helps create unique, accessible, thoughtfully designed interfaces. Emphasises design
collaboration, breaking away from generic patterns, and interfaces that stand out while
staying functional and accessible. Targets a React + Tailwind + shadcn stack, but the
principles are stack-agnostic.

## Working mode

Design is collaborative. Before committing to significant visual decisions (colour
systems, typefaces, overall layout direction), surface options and confirm direction
rather than silently picking one — present alternatives and trade-offs, not a single
"correct" answer. Small, obvious, or explicitly-requested choices don't need a
check-in; use judgment about when a decision is consequential enough to confirm first.
The guidance in the references is what to apply once a direction is agreed.

## Quick path

1. **Understand context** — problem, users, success criteria.
2. **Explore options** — present 2-3 approaches with trade-offs; confirm direction on
   consequential visual decisions.
3. **Implement iteratively** — structure and hierarchy first, then visual polish.
4. **Validate** — playwright MCP for visual/responsive checks; verify accessibility.

## Core principles (at a glance)

- **Simplicity through reduction** — every element justifies its existence.
- **Material honesty** — affordance via colour/spacing/typography, not skeuomorphic shadows.
- **Functional layering** — hierarchy from scale, contrast, and space; depth only for modals/dropdowns.
- **Stand out** — avoid default "Claude style" / generic SaaS aesthetics and the default SaaS blue; reach for distinctive neutral+accent pairings, subtle motion, texture.
- **Coherence** — every element communicates its function; nothing arbitrary.
- **Accessibility is non-negotiable** — WCAG 2.1 AA, keyboard nav, 44×44px touch targets, semantic HTML, never colour alone.

### Design decision checklist

Purpose · Hierarchy · Consistency · Accessibility (WCAG AA) · Responsiveness ·
Uniqueness · Direction confirmed on consequential choices.

## References (load on demand)

| Topic | File |
|-------|------|
| Full design philosophy + practice detail | [references/design-principles.md](./references/design-principles.md) |
| Colour, contrast, typography, layout | [references/visual-design.md](./references/visual-design.md) |
| Motion, animation, UX patterns, navigation | [references/interaction-design.md](./references/interaction-design.md) |
| Styling stack (shadcn/Tailwind), accessibility, workflow & testing | [references/implementation.md](./references/implementation.md) |
| Worked examples + do/don't checklist | [references/examples.md](./references/examples.md) |
| Design-system meta-framework (fixed / project / adaptable) | [references/design-system-template.md](./references/design-system-template.md) |
| Motion spec (easing curves, duration tables) | [references/motion-spec.md](./references/motion-spec.md) |
| Responsive design (breakpoints, mobile-first) | [references/responsive-design.md](./references/responsive-design.md) |
| Accessibility deep reference (WCAG 2.1 AA, POUR, ARIA) | [references/accessibility.md](./references/accessibility.md) |

## External references

- WCAG 2.1 Guidelines: https://www.w3.org/WAI/WCAG21/quickref/
- Google Fonts: https://fonts.google.com/
- Tailwind CSS Docs: https://tailwindcss.com/docs
- Shadcn UI Components: https://ui.shadcn.com/

## Version History

- v1.1.0 (2026-07-28): Restructured to lean guide + `references/`; softened rigid
  ask-first rule to judgment-based collaboration; tightened routing description.
- v1.0.0 (2025-10-18): Initial release with comprehensive UI/UX design guidance.
