# Refinement Lenses — Inferred-Intent Transformation Modes

Adapted from [pbakaus/impeccable](https://github.com/pbakaus/impeccable)'s
transformation commands (Apache-2.0). Impeccable exposes each as an explicit
`/impeccable <verb>` slash command. **We do not.** Our methodology infers the
lens from what the user actually says and the project's accumulated memory, then
applies the concrete transformation below. A lens is a *focused* design pass with
a single objective — narrower than a full `design-audit`, applied when the user
asks for one specific kind of change.

## How a lens is selected

1. **Infer** the lens from the request (trigger phrases below). No command syntax.
2. **Ground** in context: read `DESIGN.md`/`MASTER.md` tokens, and recall prior
   decisions from RuVector (`memory_search namespace:project-state "design <lens>"`).
3. **Apply** only the transformation that lens owns — do not silently widen scope.
4. **Gate** the result through `../open-design/references/anti-slop-rules.md` and
   `scripts/slop-detect.py` (in open-design) before presenting.
5. **Persist** the decision: `memory_store namespace:project-state` with the lens,
   the change, and the rationale — so the next session inherits the intent.

## The lenses

| Lens | Infer from phrases like… | Transformation it applies |
|------|--------------------------|---------------------------|
| **bolder** | "more striking", "make it pop", "too timid", "more confident" | Increase contrast between hierarchy levels; enlarge the primary focal point ≥2× the second; commit one decisive flourish. Never add a second competing flourish. |
| **quieter** | "calm it down", "too busy", "tone it down", "more restraint" | Reduce accent uses to ≤2 per viewport; remove decorative gradients/shadows; widen whitespace; collapse competing focal points to one. |
| **colorize** | "needs colour", "palette feels flat", "more life" | Derive tones from the 6 DESIGN.md tokens via `color-mix()` — no new raw hex. One accent, applied with intent. Verify contrast. |
| **typeset** | "fix the type", "typography pass", "tighten the text" | Enforce Butterick rules (see `../typography`): line-length 65–75ch, line-height 1.5–1.75, letter-spacing floor, one display + one body face, tabular numerics. |
| **layout** | "fix the layout", "spacing is off", "alignment", "grid" | Establish a grid; vary section widths (full-bleed → narrow → wide); kill monotonous spacing; lock every element to the baseline. |
| **animate** | "add motion", "make it feel alive", "transitions" | `transform`/`opacity` only, 150–300ms ease-out; respect `prefers-reduced-motion`; motion must enhance, never decorate. Bans bounce/elastic. |
| **delight** | "add personality", "a moment of delight", "feels sterile" | One earned micro-interaction or detail that serves the thesis — not confetti. Subtract if it competes with the primary action. |
| **distill** | "too much copy", "cut it down", "simplify the message" | Headlines <10 words; remove restated headers; every element must earn its place (reduction filter). |
| **clarify** | "confusing", "hard to follow", "what do I do here" | Establish unambiguous visual hierarchy + a single obvious primary action; resolve competing entry points. |
| **harden** | "edge cases", "empty/loading/error states", "robustness" | Design every state: empty, loading (skeleton), error (helpful, styled), disabled, focus. No broken-looking zero-data screens. |
| **onboard** | "first-run", "onboarding", "getting started" | Guide a new user to first value; progressive disclosure; the empty state *is* the onboarding. |
| **optimize** | "feels slow", "perf", "heavy", "jank" | Reserve space for async content (no layout shift); lazy-load + `srcset`; `transform`/`opacity` motion; audit bundle/asset weight. |
| **adapt** | "make it responsive", "mobile", "tablet", "fits everywhere" | Fluid reflow (not just breakpoints) at 375/768/1024/1440; ≥44px touch targets; no mobile-amputation; no horizontal scroll. |
| **document** | "document the design", "design system doc", "spec this" | Emit/update `DESIGN.md` per `../open-design/references/design-system-schema.md`; capture tokens, type scale, components. |
| **overdrive** | "go further", "push it", "make it unforgettable" | Deliberately raise the Innovation dimension: one unexpected layout/typographic move that *earns* its place within the thesis. Highest risk — gate hardest. |

## Scope discipline

A lens is **purely visual/structural refinement** — same boundary as the parent
`design-audit` skill. It does not add features or touch logic. When a requested
lens would require a functional change, flag it for the build agent rather than
implementing it.

## Composing lenses

Lenses chain. A common sequence after a first build:

```
distill → clarify → typeset → layout → quieter → harden → animate
(cut)     (focus)   (text)     (grid)   (restraint) (states) (motion)
```

Apply one at a time, gate each, persist each. Stop when the five-dimensional
critique (`../open-design/references/critique-dimensions.md`) holds ≥7 across the
board and `slop-detect.py` reports clean.
