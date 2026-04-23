# Aphorisms Workflow

**Hand-drawn quote cards with massive typography for memorable statements.**

Creates **VISUAL QUOTE CARDS** — single powerful statements rendered with dramatic typography and minimal visual accompaniment.

---

## Purpose

Aphorisms capture wisdom in memorable form. Unlike articles (which explain) or frameworks (which structure), aphorism cards make a **single statement unforgettable** through visual impact.

**Use this workflow for:**
- Key insight cards
- Memorable quotes
- Newsletter pullquotes
- Social media quotes
- Wisdom/maxim visuals
- Signature statements

---

## Visual Aesthetic: Massive Typography

**Think:** Poster with one powerful sentence, hand-lettered

### Core Characteristics
1. **Typography dominant** — The words ARE the visual
2. **Massive scale** — Text fills most of the space
3. **Hand-lettered quality** — Imperfect, characterful letters
4. **Minimal accompaniment** — Small illustration or none
5. **High contrast** — Statement pops from background

---

## Typography Approaches

### All-Caps Impact
- Entire quote in uppercase
- Variable letter sizing for emphasis
- Works for short, punchy statements

### Mixed Case Flow
- Natural capitalization
- Key words larger or accented
- Works for longer quotes

### Word Stacking
- One word per line
- Builds visual rhythm
- Works for 3-7 word statements

### Emphasis Highlight
- Most text in one style
- Key phrase in contrasting treatment
- Works for longer quotes with punchline

---

## Color System

### Text
```
Charcoal        #2D2D2D   (primary text)
Deep Teal       #1A6B6B   (emphasis words/phrases)
Burnt Orange    #C85A2A   (alternative emphasis)
```

### Background
```
Warm Cream      #F7F4EA   (primary)
Pure White      #FFFFFF   (maximum contrast)
Light Teal      #E6F3F3   (subtle variation)
```

### Accent Elements
```
Deep Teal       #1A6B6B   (small illustrations)
Burnt Orange    #C85A2A   (decorative marks)
```

### Color Strategy
- Most text in charcoal for readability
- 1-3 key words in teal for emphasis
- Small accent elements only (quote marks, small illustration)
- Background keeps text readable

---

## MANDATORY WORKFLOW STEPS

### Step 1: Craft the Statement

**Refine the quote:**

1. **The quote:** [Exact text to display]
2. **Source:** [Attribution if any]
3. **Key emphasis:** [Which word(s) matter most]
4. **Tone:** [Inspiring / Provocative / Wise / Urgent]
5. **Length:** [Word count — shorter is better]

**Output:**
```
QUOTE: "[The exact statement]"
ATTRIBUTION: [Source or none]

EMPHASIS WORD(S): [Which words to highlight]
TONE: [Inspiring / Provocative / Wise / Urgent]
WORD COUNT: [Number]

TYPOGRAPHY APPROACH:
[All-caps / Mixed case / Word stacking / Emphasis highlight]
```

**Guidelines for good aphorisms:**
- Under 15 words ideal
- One clear idea
- Memorable phrasing
- Stands alone without context

---

### Step 2: Design Typography Layout

**Plan how words fill space:**

1. **Word arrangement:**
   - Single block of text
   - Stacked words (one per line)
   - Split across space

2. **Size hierarchy:**
   - Which words are largest
   - How size varies

3. **Emphasis treatment:**
   - Color change on key words
   - Size change
   - Style change (italic, underline)

4. **Accompaniment:**
   - Small illustration (optional)
   - Decorative quote marks
   - Attribution placement

**Output:**
```
ARRANGEMENT: [Single block / Stacked / Split]

SIZE HIERARCHY:
- Largest: "[Key word(s)]"
- Medium: "[Supporting text]"
- Smallest: [Attribution if any]

EMPHASIS:
- "[Word]" in Teal #1A6B6B
- Other words in Charcoal #2D2D2D

ACCOMPANIMENT:
- [None / Small illustration: description]
- Quote marks: [Yes/No, style]
- Attribution: [Position, style]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn quote card in editorial illustration style on warm cream background (#F7F4EA).

STYLE REFERENCE: Typographic poster, hand-lettered quote, editorial pullquote, inspirational typography

BACKGROUND: Warm Cream #F7F4EA — clean, flat

AESTHETIC:
- Hand-lettered typography (imperfect, characterful)
- Variable letter sizing for emphasis
- Organic letter shapes (not perfect geometric)
- Minimal visual accompaniment
- Editorial poster quality

QUOTE: "[THE QUOTE TEXT]"

TYPOGRAPHY TREATMENT:

ARRANGEMENT: [How words are positioned]
- [Single block centered / Stacked one word per line / etc.]

WORD SIZING:
- "[KEY WORD]" — LARGEST, bold, [color]
- "[Secondary words]" — medium size
- "[Rest of text]" — supporting size

LETTER STYLE:
- Hand-lettered feel (slightly irregular)
- Variable weight within words
- Imperfect but intentional baseline
- [All-caps / Mixed case]

COLOR:
- Main text: Charcoal #2D2D2D
- Emphasis word "[WORD]": Deep Teal #1A6B6B
- [Alternative: key phrase in Burnt Orange #C85A2A]

ACCOMPANIMENT: (if any)
- [Small hand-drawn illustration: description]
- OR: Decorative hand-drawn quote marks
- Position: [Where relative to text]

ATTRIBUTION: (if any)
- "— [Source]"
- Small italic, charcoal
- Position: [Below quote, right-aligned typically]

LAYOUT:
- Quote fills 60-70% of space
- Generous margins
- Balanced but not perfectly centered
- 30-40% negative space

CRITICAL REQUIREMENTS:
- Typography IS the visual (words dominant)
- Hand-lettered quality (NOT clean fonts)
- Emphasis word(s) clearly highlighted
- Minimal decoration (don't compete with words)
- Readable and impactful
- Poster-worthy visual statement
```

---

### Step 4: Determine Aspect Ratio

| Quote Card Type | Aspect Ratio | Reasoning |
|-----------------|--------------|-----------|
| Social square | 1:1 | Instagram, LinkedIn |
| Vertical social | 4:5 | Instagram feed optimal |
| Story/Pin | 9:16 | Stories, Pinterest |
| Wide banner | 16:9 | Website headers, Twitter |
| Poster | 3:4 | Print, presentation |

**Default: 1:1** — Most versatile for social sharing

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 1:1 \
  --output /path/to/aphorism.png
```

**Model:** Nano Banana 2 (default) (best for typography rendering)

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Readable quote** — Every word legible
- [ ] **Typography dominant** — Words are the main visual
- [ ] **Hand-lettered quality** — Imperfect, characterful
- [ ] **Clear emphasis** — Key word(s) stand out
- [ ] **Visual impact** — Poster-worthy at a glance

#### Must NOT Have
- [ ] Illegible text
- [ ] Perfect geometric fonts
- [ ] Competing visual elements
- [ ] Too much decoration
- [ ] Weak/muddy contrast

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Text illegible | Increase size, improve contrast, simplify layout |
| Looks like font | "Hand-lettered, imperfect letters, variable weight, organic shapes" |
| Emphasis unclear | Strengthen color/size difference on key word |
| Too decorated | Remove competing elements, let typography breathe |
| Low impact | Increase quote size, strengthen contrast |

---

## Example Use Cases

### Example 1: "The Map is Not the Territory"
- **Typography:** Stacked words
- **Emphasis:** "Map" and "Territory" largest
- **Accompaniment:** Tiny hand-drawn map icon

### Example 2: "What Gets Measured Gets Managed"
- **Typography:** All-caps block
- **Emphasis:** "Measured" in teal
- **Accompaniment:** None (pure typography)

### Example 3: "The Best Time to Plant a Tree..."
- **Quote:** "The best time to plant a tree was twenty years ago. The second best time is now."
- **Typography:** Two-line split at period
- **Emphasis:** "now" in orange, large

---

## Quick Reference

**The Formula:**
```
1. Craft the statement (refine to essential words)
2. Design typography layout (arrangement, hierarchy, emphasis)
3. Construct prompt with typography focus
4. Choose aspect ratio for platform
5. Generate image
6. Validate readability and impact
```

**Typography Quick Decision:**
```
How long is the quote?
├─ 1-3 words → MASSIVE single treatment
├─ 4-7 words → Stacked or sized hierarchy
├─ 8-15 words → Block with emphasis word(s)
└─ 15+ words → Consider editing shorter
```

---

**The workflow: Craft → Design → Construct → Generate → Validate → Complete**
