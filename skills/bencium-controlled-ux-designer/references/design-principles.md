# Foundational Design Principles

Full detail behind the SKILL.md quick-path. These are practical guidance for when
design decisions are approved — present alternatives and trade-offs, not single
"correct" solutions.

## Stand Out From Generic Patterns

**Avoid Generic Training Dataset Patterns:**
- Don't default to "Claude style" designs (excessive bauhaus, liquid glass, apple-like)
- Don't use generic SaaS aesthetics that look machine-generated
- Don't rely only on solid colors - suggest photography, patterns, textures
- Think beyond typical patterns - you can step off the written path

**Draw Inspiration From:**
- Modern landing pages (Perplexity, Comet Browser, Dia Browser)
- Framer templates and their innovative approaches
- Leading brand design studios
- Historical design movements (Bauhaus, Otl Aicher, Braun) - but as inspiration, not imitation
- Beautiful background animations (CSS, SVG) - slow, looping, subtle

**Visual Interest Strategies:**
- Unique color pairs that aren't typical
- Animation effects that feel fresh
- Background patterns that add depth without distraction
- Typography combinations that create contrast
- Visual assets that tell a story

## Core Design Philosophy

1. **Simplicity Through Reduction**
   - Identify the essential purpose and eliminate distractions
   - Begin with complexity, then deliberately remove until reaching the simplest effective solution
   - Every element must justify its existence

2. **Material Honesty**
   - Digital materials have unique properties - embrace them
   - Buttons should communicate affordance through color, spacing, and typography (not shadows)
   - Cards use borders and background differentiation (not depth effects)
   - Animations follow real-world physics principles adapted to digital responsiveness

   **Examples:**
   - Clickable: Use distinct colors, hover state changes, cursor feedback
   - Containers: Use subtle borders (1px), background color shifts, or generous padding
   - Hierarchy: Use scale, weight, and spacing rather than elevation

3. **Functional Layering (Not Visual Depth)**
   - Create hierarchy through typography scale, color contrast, and spatial relationships
   - Layer information conceptually (primary → secondary → tertiary)
   - Reject skeuomorphic shadows/gradients that imitate physical depth
   - Embrace functional depth: modals over content, dropdowns over UI

4. **Obsessive Detail**
   - Consider every pixel, interaction, and transition
   - Excellence emerges from hundreds of small, intentional decisions
   - Balance: Details should serve simplicity, not complexity
   - When detail conflicts with clarity, clarity wins

5. **Coherent Design Language**
   - Every element should visually communicate its function
   - Elements should feel part of a unified system
   - Nothing should feel arbitrary

6. **Invisibility of Technology**
   - The best technology disappears
   - Users should focus on content and goals, not on understanding the interface

## What This Means in Practice

**Color Usage:**
- Base palette: 4-5 neutral shades (backgrounds, borders, text)
- Accent palette: 1-3 bold colors (CTAs, status, emphasis)
- Neutrals are slightly desaturated, warm or cool based on brand intent
- Accents are saturated enough to create clear contrast

**Typography:**
- Headlines: Emotional, attention-grabbing (personality over pure legibility)
- Body/UI: Functional, highly legible (clarity over expression)
- 2-3 typefaces maximum
- Clear mathematical scale (e.g., 1.25x between sizes)

**Animation:**
- Purposeful: Guides attention, establishes relationships, provides feedback
- Subtle: Felt rather than seen (100-300ms for most interactions)
- Physics-informed: Natural easing, appropriate mass/momentum

**Spacing:**
- Generous negative space creates clarity and breathing room
- Mathematical relationships (e.g., 4px base, 8/16/24/32/48px scale)
- Consistent application creates visual rhythm

## Design Decision Checklist

Before presenting any design, verify:

1. **Purpose**: Does every element serve a clear function?
2. **Hierarchy**: Is visual importance aligned with content importance?
3. **Consistency**: Do similar elements look and behave similarly?
4. **Accessibility**: Does it meet WCAG AA standards? (contrast, touch targets, keyboard nav)
5. **Responsiveness**: Does it work on mobile, tablet, desktop?
6. **Uniqueness**: Does this break from generic SaaS patterns?
7. **Approval**: Have I confirmed direction before implementing colors, fonts, sizes, layouts?

**Design System Framework:** For understanding what's fixed (universal rules),
project-specific (brand personality), and adaptable (context-dependent) in your
design system, see [design-system-template.md](./design-system-template.md)
(meta-framework, project templates, decision trees).
