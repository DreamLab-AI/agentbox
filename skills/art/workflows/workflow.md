# Editorial Illustration Workflow

**Hand-drawn editorial illustrations for blog headers and article visuals using the default aesthetic.**

Creates **ABSTRACT VISUAL METAPHORS** — not literal depictions, but conceptual illustrations that capture the essence of an idea.

---

## Purpose

Editorial illustrations communicate complex ideas through visual metaphors. Unlike technical diagrams (which show structure) or data visualizations (which show numbers), editorial illustrations capture the *feeling* and *essence* of a concept.

**Use this workflow for:**
- Newsletter/blog header images
- Article hero illustrations
- Social media visuals for ideas
- Abstract concept representation

---

## Visual Aesthetic: Warm Expertise

**Think:** New Yorker illustration meets Excalidraw whiteboard sketch

### Core Characteristics
1. **Hand-drawn quality** — Imperfect, sketchy lines (NOT clean vectors)
2. **Abstract metaphors** — Conceptual, not literal representations
3. **Warm cream backgrounds** — Light, inviting, readable
4. **Strategic accents** — Teal for expertise, burnt orange for warmth
5. **Minimal compositions** — 2-4 elements maximum, generous negative space
6. **Editorial sophistication** — Magazine-quality conceptual illustration

---

## Color System

### Background
```
Warm Cream      #F7F4EA   (primary background)
Pure White      #FFFFFF   (alternative - maximum clarity)
```

### Structure
```
Charcoal        #2D2D2D   (primary sketch lines)
Dark Gray       #4A4A4A   (secondary sketch lines)
```

### Accents
```
Deep Teal       #1A6B6B   (expertise - primary accent)
Burnt Orange    #C85A2A   (warmth - secondary accent)
```

### Color Strategy
- Charcoal sketch lines dominate (70-80%)
- Deep Teal as primary accent (10-15%) — expertise and trust
- Burnt Orange as secondary accent (5-10%) — energy and approachability
- Subtle soft shadows for depth

---

## MANDATORY WORKFLOW STEPS

### Step 1: Extract Core Concept

**Identify the single idea to visualize:**

1. **What's the article about?** (one sentence)
2. **What feeling should the image evoke?**
3. **What's the key tension or relationship?**
4. **What visual metaphor captures this?**

**Output:**
```
CORE CONCEPT: [The single idea]
FEELING: [Emotional tone]
METAPHOR: [Visual representation]
```

---

### Step 2: Design Composition

**Plan the visual elements:**

1. **Primary element** — The main visual metaphor
2. **Supporting element(s)** — 1-2 complementary elements
3. **Accent placement** — Where teal/orange highlights go
4. **Negative space** — Where the image breathes

**Composition Guidelines:**
- 2-4 elements maximum
- 40-50% negative space
- Clear focal point
- Balanced but not centered

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn editorial illustration in Excalidraw sketch style on warm cream background (#F7F4EA).

STYLE REFERENCE: New Yorker illustration, Saul Steinberg, editorial sketch, hand-drawn conceptual art

BACKGROUND: Warm Cream #F7F4EA — clean, flat, inviting

AESTHETIC:
- Rough, imperfect charcoal sketch lines (#2D2D2D)
- Variable stroke weight (thicker at connections, thinner at ends)
- Multiple overlapping strokes like whiteboard markers
- Wobbly curves, imperfect shapes
- Editorial illustration quality with hand-drawn warmth

COMPOSITION:
[Describe 2-4 key elements and their arrangement]

PRIMARY ELEMENT:
- [Main visual metaphor]
- Hand-drawn sketch quality
- Charcoal lines with [teal/orange] accent

SUPPORTING ELEMENTS:
- [Element 2]
- [Element 3 if needed]

COLOR USAGE:
- Charcoal (#2D2D2D) for all primary linework
- Deep Teal (#1A6B6B) accent on [focal element]
- Burnt Orange (#C85A2A) accent on [secondary element]
- Subtle soft shadows for depth

LAYOUT:
- 40-50% negative space
- Balanced composition
- Clear visual hierarchy
- Warm cream background for readability

CRITICAL REQUIREMENTS:
- Hand-drawn imperfect quality (NOT smooth vectors)
- Abstract conceptual metaphor (NOT literal depiction)
- Minimal elements (2-4 max)
- Generous breathing room
- Editorial illustration aesthetic
```

---

### Step 4: Determine Aspect Ratio

| Use Case | Aspect Ratio | Reasoning |
|----------|--------------|-----------|
| Blog header | 16:9 | Standard widescreen |
| Newsletter header | 2:1 | Email-optimized wide |
| Social square | 1:1 | Instagram/LinkedIn |
| Vertical social | 4:5 | Instagram feed |
| Hero image | 21:9 | Ultra-wide cinematic |

**Default: 16:9** — Most versatile for web use

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 16:9 \
  --output /path/to/output.png
```

**Model:** Nano Banana 2 (default) for editorial illustrations

**Immediately Open:**
```bash
open /path/to/output.png
```

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Hand-drawn quality** — Sketchy, imperfect lines
- [ ] **Abstract metaphor** — Conceptual, not literal
- [ ] **Minimal composition** — 2-4 elements max
- [ ] **Generous negative space** — 40-50% breathing room
- [ ] **Strategic accents** — Teal/orange used purposefully
- [ ] **Warm cream background** — Light, inviting

#### Must NOT Have
- [ ] Clean vector graphics
- [ ] Literal/photorealistic depiction
- [ ] Cluttered composition
- [ ] Overwhelming color usage
- [ ] Dark or moody backgrounds

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Too polished | Add "rough wobbly lines, imperfect hand-drawn strokes, multiple overlapping marks" |
| Too literal | Rethink metaphor — ask "what does this FEEL like?" not "what does this LOOK like?" |
| Too busy | Reduce to 2-3 core elements, increase negative space to 50%+ |
| Wrong colors | Reinforce color palette explicitly in prompt |
| Dark background | Explicitly state "warm cream background #F7F4EA" |

---

## Example Use Cases

### Example 1: "AI Replacing Human Judgment"
- **Metaphor:** Scales of justice with one side holding a brain, other side holding circuit board
- **Accent:** Teal on brain, orange on circuit
- **Feeling:** Thoughtful tension

### Example 2: "Building Your Second Brain"
- **Metaphor:** Architect's hand sketching a thought cloud blueprint
- **Accent:** Teal on blueprint lines, orange on hand
- **Feeling:** Creative construction

### Example 3: "The Attention Economy"
- **Metaphor:** Multiple hands reaching toward a single glowing point
- **Accent:** Orange glow on focal point, teal on reaching hands
- **Feeling:** Competition, scarcity

---

## Quick Reference

**The Formula:**
```
1. Extract core concept (single clear idea)
2. Design composition (2-4 elements, 40-50% space)
3. Construct prompt with the default aesthetic
4. Choose aspect ratio for use case
5. Generate image
6. Validate hand-drawn quality and conceptual clarity
```

**Color Quick Reference:**
- Background: Warm Cream #F7F4EA
- Lines: Charcoal #2D2D2D
- Primary accent: Deep Teal #1A6B6B
- Secondary accent: Burnt Orange #C85A2A

---

**The workflow: Extract → Design → Construct → Generate → Validate → Complete**
