# Comparisons Workflow

**Hand-drawn X vs Y visualizations showing contrasts and trade-offs.**

Creates **SPLIT COMPARISON VISUALS** — side-by-side contrasts that help audiences understand differences, trade-offs, and choices.

---

## Purpose

Comparisons clarify choices. Unlike frameworks (which position on dimensions) or taxonomies (which categorize), comparisons put two (or more) options side by side to highlight differences.

**Use this workflow for:**
- "X vs Y" content
- Trade-off analysis
- Option comparison
- Before/After contrasts
- Pro/Con layouts
- Paradigm shifts

---

## Visual Aesthetic: Split Canvas

**Think:** Whiteboard divided in half with each side representing an option

### Core Characteristics
1. **Clear division** — Obvious split between options
2. **Balanced layout** — Equal visual weight to each side
3. **Comparison points** — Aligned attributes to compare
4. **Visual metaphors** — Each option represented visually
5. **Hand-drawn quality** — Sketchy dividers, organic elements

---

## Comparison Types

### Side-by-Side Split
- Canvas divided vertically
- Option A on left, Option B on right
- Comparison points aligned horizontally

### Before/After
- Temporal split showing change
- "Before" on left, "After" on right
- Transformation emphasized in center

### Stacked Comparison
- Options stacked vertically
- Attributes as columns
- Good for 3+ options

### Versus Layout
- Central "VS" with options radiating
- More dramatic, editorial feel

---

## Color System

### Structure
```
Charcoal        #2D2D2D   (dividers, text, main structure)
Dark Gray       #4A4A4A   (secondary elements)
```

### Option Coding
```
Deep Teal       #1A6B6B   (Option A / "better" choice / new)
Burnt Orange    #C85A2A   (Option B / alternative / old)
```

### Background
```
Warm Cream      #F7F4EA   (primary)
Pure White      #FFFFFF   (alternative)
```

### Color Strategy
- Each option gets distinct color identity
- Teal for recommended/new/better option (if applicable)
- Orange for alternative/old/contrasting option
- Neutral charcoal for shared elements

---

## MANDATORY WORKFLOW STEPS

### Step 1: Define Comparison Structure

**Analyze what's being compared:**

1. **What are the options?** [Option A vs Option B]
2. **What comparison type?** [Side-by-side / Before-After / Stacked / Versus]
3. **Comparison points?** [Attributes to compare]
4. **Key difference?** [Most important distinction]
5. **Recommendation?** [Is one option favored?]

**Output:**
```
COMPARISON: [Option A] vs [Option B]
TYPE: [Side-by-side / Before-After / Stacked / Versus]

OPTION A: [Name]
- Metaphor: [Visual representation]
- Color: [Teal / Orange / Neutral]
- Attributes:
  * [Attribute 1]: [Value]
  * [Attribute 2]: [Value]
  ...

OPTION B: [Name]
- Metaphor: [Visual representation]
- Color: [Teal / Orange / Neutral]
- Attributes:
  * [Attribute 1]: [Value]
  * [Attribute 2]: [Value]
  ...

KEY DIFFERENCE: [What matters most]
RECOMMENDATION: [None / Option A / Option B]
```

---

### Step 2: Design Split Layout

**Plan the visual structure:**

1. **Division style:**
   - Clean vertical split
   - Diagonal dynamic split
   - Central divider with VS
   - Overlapping comparison zone

2. **Content alignment:**
   - Attributes aligned for easy comparison
   - Headers at same level
   - Consistent visual treatment

3. **Emphasis:**
   - How to highlight the recommended option (if any)
   - How to show the key difference

**Output:**
```
LAYOUT:
- Division: [Vertical split / Diagonal / Central VS]
- Left side: [Option A content arrangement]
- Right side: [Option B content arrangement]
- Attribute alignment: [How comparison points line up]

VISUAL METAPHORS:
- Option A: [Icon or illustration]
- Option B: [Icon or illustration]

EMPHASIS:
- Key difference: [How it's highlighted]
- Recommendation: [How preference is shown]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn comparison visualization in Excalidraw sketch style on warm cream background (#F7F4EA).

STYLE REFERENCE: Editorial comparison graphic, X vs Y illustration, hand-drawn split canvas

BACKGROUND: Warm Cream #F7F4EA — clean, flat

AESTHETIC:
- Hand-drawn divider (wobbly line, not ruler-straight)
- Sketchy visual metaphors for each option
- Variable stroke weight
- Editorial illustration quality
- Balanced but dynamic composition

COMPARISON: [Option A] vs [Option B]

LAYOUT: [Split type]
- Division: [Vertical line / diagonal / central VS]
- Left side: [Option A]
- Right side: [Option B]

LEFT SIDE — [OPTION A]:
Header: "[Option A Name]"
- Color: Deep Teal #1A6B6B
- Visual metaphor: [Sketchy illustration of concept]
- Attributes:
  * [Attribute 1]: [Value]
  * [Attribute 2]: [Value]
  * [Attribute 3]: [Value]

RIGHT SIDE — [OPTION B]:
Header: "[Option B Name]"
- Color: Burnt Orange #C85A2A
- Visual metaphor: [Sketchy illustration of concept]
- Attributes:
  * [Attribute 1]: [Value]
  * [Attribute 2]: [Value]
  * [Attribute 3]: [Value]

CENTER ELEMENT: (if applicable)
- "VS" in hand-drawn style
- Or: Key difference callout

TYPOGRAPHY:
- Main title: Bold hand-lettered, charcoal
- Option headers: Bold, colored (teal/orange)
- Attributes: Regular, charcoal
- Values: Smaller, aligned

COLOR USAGE:
- Option A elements: Teal (#1A6B6B) accents
- Option B elements: Orange (#C85A2A) accents
- Structure/text: Charcoal (#2D2D2D)
- Divider: Charcoal or subtle gray

LAYOUT BALANCE:
- Equal visual weight to each side
- Attributes aligned horizontally for comparison
- 30-40% negative space
- Clear reading path

CRITICAL REQUIREMENTS:
- Hand-drawn quality throughout
- Clear visual distinction between options
- Aligned comparison points for easy scanning
- Balanced but not boring composition
- Editorial illustration aesthetic
```

---

### Step 4: Determine Aspect Ratio

| Comparison Type | Aspect Ratio | Reasoning |
|-----------------|--------------|-----------|
| Side-by-side (2 options) | 16:9 | Wide for horizontal split |
| Before/After | 16:9 | Wide for temporal contrast |
| Stacked (3+ options) | 4:5 or 9:16 | Tall for vertical stacking |
| Dramatic VS | 1:1 | Square for balanced drama |

**Default: 16:9** — Best for side-by-side comparisons

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 16:9 \
  --output /path/to/comparison.png
```

**Model:** Nano Banana 2 (default) (text-heavy comparisons need good rendering)

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Clear split** — Obvious division between options
- [ ] **Balanced layout** — Neither side visually dominant (unless intentional)
- [ ] **Aligned attributes** — Easy to compare same points
- [ ] **Hand-drawn quality** — Sketchy, organic feel
- [ ] **Color coding** — Options distinguishable by color
- [ ] **Readable text** — All labels and values legible

#### Must NOT Have
- [ ] Unbalanced composition (one side much larger)
- [ ] Misaligned comparison points
- [ ] Perfect straight divider lines
- [ ] Confusing color overlap
- [ ] Missing option labels

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Unbalanced | "Equal visual weight to both sides, balanced composition" |
| Attributes misaligned | "Comparison points aligned horizontally for easy scanning" |
| Too perfect | "Hand-drawn divider, wobbly line, organic split" |
| Options unclear | Strengthen color coding, add visual metaphors |
| Too much text | Reduce to key comparison points only |

---

## Example Use Cases

### Example 1: "RAG vs Fine-Tuning"
- **Option A (Teal):** RAG — retrieval, dynamic, no training
- **Option B (Orange):** Fine-tuning — embedded, static, training required
- **Key difference:** Cost vs customization trade-off

### Example 2: "Before/After AI Adoption"
- **Before (Orange):** Manual, slow, inconsistent
- **After (Teal):** Automated, fast, standardized
- **Emphasis:** Transformation in the middle

### Example 3: "Build vs Buy vs Partner"
- **Three-way comparison**
- **Stacked layout** for 3 options
- **Color:** Teal for recommended, orange for alternatives

---

## Quick Reference

**The Formula:**
```
1. Define comparison structure (options, attributes, key difference)
2. Design split layout (division style, alignment, emphasis)
3. Construct prompt with color-coded options
4. Choose aspect ratio for layout
5. Generate image
6. Validate balance and alignment
```

**Comparison Type Decision:**
```
How many options?
├─ 2 options → Side-by-side split (16:9)
├─ Before/After → Temporal split (16:9)
├─ 3+ options → Stacked (9:16) or matrix
└─ Dramatic single contrast → VS layout (1:1)
```

---

**The workflow: Define → Design → Construct → Generate → Validate → Complete**
