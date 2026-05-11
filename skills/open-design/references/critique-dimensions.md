# Five-Dimensional Design Critique — Scoring Rubric

Self-review every artifact before delivery. Score honestly; a 7 means "strong," not "acceptable."

---

## Dimension 1: Philosophy Consistency

**Question:** Does the artifact pick a clear direction and stick to it through every micro-decision?

| Score | Meaning | Evidence |
|-------|---------|----------|
| 9–10 | One thesis runs through every detail — font choice, spacing, color budget, interaction style all reinforce the same idea | Every element could only belong to this design |
| 7–8 | Clear direction with minor inconsistencies | 1–2 elements feel borrowed from a different aesthetic |
| 5–6 | Direction is visible but diluted | Mixing metaphors (e.g., brutalist grid + glassmorphism cards) |
| 3–4 | No coherent thesis | Feels assembled from multiple templates |
| 0–2 | Actively contradictory | Elements fight each other visually |

**How to fix low scores:** Remove the element that doesn't match. Don't add more — subtract.

---

## Dimension 2: Visual Hierarchy

**Question:** Can a stranger figure out what to read first, second, third?

| Score | Meaning | Evidence |
|-------|---------|----------|
| 9–10 | Instant comprehension — eyes guided naturally without instruction | F-pattern or Z-pattern clearly established |
| 7–8 | Hierarchy clear with minor ambiguity | One competing focal point in a secondary section |
| 5–6 | Requires effort to parse | Multiple elements at same visual weight |
| 3–4 | Confusing — multiple entry points compete | No clear primary heading or CTA |
| 0–2 | Unreadable — wall of undifferentiated content | Everything same size, weight, color |

**How to fix:** Increase contrast between levels. Make the most important thing 2x larger than the second most important thing. Use weight 600+ for exactly one heading level.

---

## Dimension 3: Detail Execution

**Question:** Is the craftsmanship magazine-grade?

| Score | Meaning | Evidence |
|-------|---------|----------|
| 9–10 | Pixel-perfect — baseline alignment, consistent spacing, proper kerning | Grid inspector shows no drift |
| 7–8 | Professional — consistent spacing with minor imperfections | One spacing inconsistency, one alignment drift |
| 5–6 | Adequate — spacing works but isn't systematic | Mix of spacing values without clear scale |
| 3–4 | Sloppy — visible alignment issues, inconsistent gaps | Multiple alignment issues per section |
| 0–2 | Broken — overlaps, clipping, orphaned elements | Layout visually broken |

**How to fix:** Pick a spacing scale (4, 8, 12, 16, 24, 32, 48, 64) and use only those values. Align elements to a grid. Check text baseline alignment.

---

## Dimension 4: Functionality

**Question:** Does it work for its intended use?

| Score | Meaning | Evidence |
|-------|---------|----------|
| 9–10 | Robust across all contexts — mobile, desktop, assistive tech, print | All links work, tap targets ≥44px, keyboard navigable |
| 7–8 | Works well in primary context with minor edge-case gaps | Slightly tight mobile tap targets, one missing hover state |
| 5–6 | Primary path works but edges are rough | Horizontal scroll on mobile, some overlapping text |
| 3–4 | Partially broken — key functionality fails | Navigation doesn't collapse on mobile, CTA unreachable |
| 0–2 | Non-functional | Page doesn't render, critical content hidden |

**How to fix:** Test at 375px, 768px, 1440px. Ensure all interactive elements have visible hover/focus states. Check that no content requires horizontal scroll.

---

## Dimension 5: Innovation

**Question:** Does this push past the median?

| Score | Meaning | Evidence |
|-------|---------|----------|
| 9–10 | Genuinely novel solution that earns its complexity | Layout, typography, or interaction pattern I haven't seen combined this way |
| 7–8 | Fresh interpretation of established patterns | Familiar structure with distinctive execution |
| 5–6 | Competent but generic — could be any AI output | Standard landing page with stock-image vibes |
| 3–4 | Below median — looks dated or derivative | Obvious template without customization |
| 0–2 | Actively harmful to the brand | Inappropriate for context |

**How to fix:** Add one unexpected element that stays within the design thesis. A pull quote with distinctive typography. An asymmetric section break. A data visualization used as a hero. Not decoration — a structural choice.

**Note:** Conservative production work (enterprise dashboards, compliance pages) may legitimately score 5–6 here. That's fine — don't force innovation where reliability is the goal.

---

## Applying the Gate

**Minimum viable:** All dimensions ≥6.

**Priority order for fixes:**
1. Functionality (broken = unusable)
2. Visual Hierarchy (confusing = unusable differently)
3. Philosophy Consistency (incoherent = unprofessional)
4. Detail Execution (sloppy = untrustworthy)
5. Innovation (generic = forgettable, but functional)

**Output format (internal, not shown to user):**

```
Critique: Philosophy=8 Hierarchy=7 Detail=7 Functionality=8 Innovation=6
Gate: PASS (all ≥6)
```

If any dimension fails, fix silently and re-score. Don't tell the user the score — show them the result.
