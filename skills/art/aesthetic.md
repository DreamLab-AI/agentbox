# Example Aesthetic — Warm Hand-Drawn Sketch

**An example aesthetic file demonstrating the format. Replace this with your own brand aesthetic.**

---

## How Aesthetics Work

Each aesthetic file defines a visual identity that gets applied to all image generation for that brand. The skill reads this file before generating any image and uses its parameters to ensure visual consistency.

**To create your own:** Copy this file to `aesthetics/your-brand.md` and replace the values with your brand's visual identity.

---

## Core Concept

Define the overall visual philosophy in one sentence:

> *"Expert advice from a friend."*

- Hand-drawn warmth meets professional clarity
- Color accents provide energy without overwhelming
- Simplicity = Clarity (remove everything that doesn't serve the message)

---

## Style Direction

### What to aim for
- **Hand-drawn sketch lines** — Rough, imperfect, whiteboard aesthetic
- **Light backgrounds** — Warm, readable, inviting
- **Strategic color accents** — 2 accent colors used purposefully
- **Minimal compositions** — 2-4 elements maximum, plenty of breathing room
- **Subtle shadows** — Soft, not harsh

### What to avoid
- Over-polished corporate vectors
- Excessive color saturation
- Perfect geometric shapes
- Cluttered compositions
- Dark/moody backgrounds
- Photorealistic elements

---

## Color System

### Backgrounds
```
Primary         #F7F4EA   (warm cream)
Alternative     #FFFFFF   (pure white — maximum clarity)
```

### Lines
```
Primary         #2D2D2D   (charcoal sketch lines)
Secondary       #4A4A4A   (lighter sketch lines)
```

### Accents
```
Primary Accent  #1A6B6B   (deep teal — trust, expertise)
Secondary Accent #C85A2A  (burnt orange — warmth, action)
```

### Color Usage
- **Lines** dominate (70-80% of composition)
- **Primary accent** (10-15%) — focal elements
- **Secondary accent** (5-10%) — action/highlight elements
- **Backgrounds** — warm and readable

---

## Linework

1. **Rough, imperfect strokes** — Like drawing on a whiteboard
2. **Variable line weight** — Thicker at connections, thinner at ends
3. **Wobbly curves** — No perfect circles or smooth Beziers
4. **Multiple overlapping strokes** — Looks hand-drawn, not vector
5. **Casual confidence** — Quick strokes, not labored perfection

---

## Composition Rules

1. **Minimal elements** — 2-4 key components maximum
2. **Generous negative space** — 40-50% breathing room
3. **Clear hierarchy** — Clear focal point, supporting elements
4. **Warm depth** — Subtle shadows create depth without harshness

---

## Base Prompt Prefix (MANDATORY)

**Every image generation using this aesthetic must be prepended with this prefix.** This ensures visual consistency across all illustrations.

```
Hand-drawn editorial illustration in rough sketch style on warm cream paper background. Medium-weight charcoal ink pen lines with wobbly hand-drawn quality, multiple overlapping strokes like whiteboard markers. Variable line weight — thicker at connections, thinner at ends. Soft warm shadows, not harsh. Illustration fills 60 percent of frame with 40 percent cream background breathing room. Muted color palette: charcoal sketch lines dominate at 70 percent, deep teal accent at 10-15 percent for focal elements, burnt orange accent at 5-10 percent for action elements.
```

### Consistency Lock Parameters

| Parameter | Locked Value | Why |
|-----------|-------------|-----|
| Line weight | Medium charcoal ink pen | Too thin = pencil, too thick = cartoon |
| Line quality | Wobbly, overlapping strokes | Consistent hand-drawn imperfection |
| Fill ratio | 60% illustration, 40% background | Prevents overcrowding |
| Color balance | 70% charcoal, 15% teal, 10% orange, 5% shadow | Consistent palette weight |
| Shadow intensity | Soft, warm, subtle | Not dramatic, not absent |
| Composition | 2-4 elements maximum | Minimal and clear |

---

## Prompt Template

```
[BASE PROMPT PREFIX from above]

COMPOSITION:
[Describe 2-4 key elements]

ACCENTS:
- Primary: [your primary accent] highlights on [focal element]
- Secondary: [your secondary accent] highlights on [action element]

LAYOUT:
- Balanced composition
- Elements loosely arranged

CRITICAL:
- Hand-drawn imperfect quality (NOT smooth vectors)
- Minimal elements (2-4 max)
- Generous breathing room
```

---

## AI Generation Signals

**Positive (use these phrases):**
```
"hand-drawn sketch style"
"rough wobbly lines"
"imperfect hand-drawn strokes"
"warm cream background"
"editorial illustration style"
"sketchy casual diagram"
"whiteboard marker style"
"generous negative space"
"minimal composition"
```

**Negative (avoid these):**
```
--no perfect vectors
--no smooth curves
--no polished corporate
--no dark backgrounds
--no photorealistic
--no harsh shadows
--no complex compositions
```

---

**Replace this file with your own aesthetic. The format above — colors, linework, composition rules, base prompt prefix, and consistency locks — is what the skill expects.**
