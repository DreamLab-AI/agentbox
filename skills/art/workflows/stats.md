# Stats Workflow

**Hand-drawn single statistic cards highlighting one striking number.**

Creates **VISUAL STAT CARDS** — single powerful numbers rendered with dramatic typography and minimal contextual illustration.

---

## Purpose

Stat cards make numbers memorable. Unlike dashboards (which show many metrics) or charts (which show relationships), stat cards spotlight **one number** that tells a story.

**Use this workflow for:**
- Key metric highlights
- Research findings
- Impact statements
- Newsletter stats
- Social media data points
- Presentation callouts

---

## Visual Aesthetic: Big Number Energy

**Think:** One massive number with just enough context to understand why it matters

### Core Characteristics
1. **Number dominant** — The statistic IS the visual
2. **Massive scale** — Number fills most of space
3. **Minimal context** — Brief label explaining what it measures
4. **Hand-drawn quality** — Sketchy numerals with character
5. **Small illustration** — Optional visual metaphor

---

## Stat Card Components

### The Number
- LARGE, dominant, impossible to miss
- Hand-drawn numerals (slightly imperfect)
- Unit/suffix as needed (%, $, K, M, etc.)

### The Label
- Brief text explaining what the number measures
- Below or above the number
- Much smaller than the number itself

### The Context (Optional)
- Comparison: "up from X" or "vs Y"
- Time period: "in 2024" or "per month"
- Small supporting detail

### The Illustration (Optional)
- Small visual metaphor related to the stat
- Doesn't compete with number
- Adds warmth and meaning

---

## Color System

### Number
```
Deep Teal       #1A6B6B   (primary — positive/neutral stats)
Burnt Orange    #C85A2A   (secondary — growth/warning stats)
Charcoal        #2D2D2D   (alternative — neutral stats)
```

### Text
```
Charcoal        #2D2D2D   (labels, context)
Dark Gray       #4A4A4A   (secondary text)
```

### Background
```
Warm Cream      #F7F4EA   (primary)
Pure White      #FFFFFF   (maximum contrast)
```

### Illustration Accents
```
Deep Teal       #1A6B6B   (complementary illustration)
Burnt Orange    #C85A2A   (alternative accent)
```

### Color Strategy
- Number in teal (expertise/trust) or orange (growth/energy)
- All text in charcoal
- Illustration matches number color
- Background keeps number readable

---

## MANDATORY WORKFLOW STEPS

### Step 1: Define the Statistic

**Prepare the number:**

1. **The number:** [Exact value to display]
2. **Unit/format:** [%, $, K, M, x, etc.]
3. **What it measures:** [Brief label]
4. **Why it matters:** [The story behind it]
5. **Context:** [Comparison or timeframe]
6. **Sentiment:** [Positive / Negative / Neutral]

**Output:**
```
NUMBER: [Value]
FORMAT: [How to display — e.g., "73%", "$2.4M", "10x"]

LABEL: [What this measures]
CONTEXT: [Optional comparison or timeframe]

SENTIMENT: [Positive / Negative / Neutral]
COLOR: [Teal for positive/neutral, Orange for growth/warning]

ILLUSTRATION: [Optional small visual metaphor]
```

**Guidelines for good stat cards:**
- Round to memorable numbers when appropriate
- Use appropriate units (K, M, B for large numbers)
- One clear metric only
- Context should be brief (5 words max)

---

### Step 2: Design Layout

**Plan the visual hierarchy:**

1. **Number placement:**
   - Centered (classic)
   - Left-aligned with label right
   - Number above context

2. **Size ratios:**
   - Number: 70% of visual attention
   - Label: 20% of visual attention
   - Context/illustration: 10%

3. **Illustration position:**
   - None (pure typography)
   - Small, corner placement
   - Behind number (subtle)

**Output:**
```
LAYOUT:
- Number: [Position, size dominance]
- Label: [Position relative to number]
- Context: [Position if included]
- Illustration: [Position and size if included]

SIZE HIERARCHY:
- Number: DOMINANT (70% visual weight)
- Label: Supporting (20%)
- Other: Minimal (10%)
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn statistic card in editorial illustration style on warm cream background (#F7F4EA).

STYLE REFERENCE: Data visualization callout, big number graphic, hand-drawn stat card, editorial metric highlight

BACKGROUND: Warm Cream #F7F4EA — clean, flat

AESTHETIC:
- Hand-drawn numerals (slightly imperfect, characterful)
- Variable stroke weight in numbers
- Minimal supporting elements
- Editorial quality
- Warm and approachable data

STATISTIC: "[NUMBER WITH UNIT]"
- Example: "73%" or "$2.4M" or "10x"

NUMBER TREATMENT:
- Size: MASSIVE, dominant, fills 60-70% of space
- Style: Hand-drawn, bold, slightly irregular
- Color: [Teal #1A6B6B / Orange #C85A2A / Charcoal #2D2D2D]
- Position: [Centered / Left-aligned]

UNIT/SUFFIX:
- "[% / $ / K / M / x / etc.]"
- Size: Smaller than main digits, attached
- Position: [After number / Superscript]

LABEL:
- "[What this measures]"
- Size: Much smaller than number
- Color: Charcoal #2D2D2D
- Position: [Below / Above] number
- Style: Hand-lettered, clear

CONTEXT: (if applicable)
- "[Comparison or timeframe]"
- Size: Smallest text
- Color: Dark Gray #4A4A4A
- Style: Italic or smaller

ILLUSTRATION: (if applicable)
- [Small hand-drawn visual metaphor]
- Size: Small, doesn't compete with number
- Color: Match number color (Teal or Orange)
- Position: [Corner / Behind / Adjacent]

LAYOUT:
- Number dominates composition
- Clear visual hierarchy
- Generous margins
- 30-40% negative space

CRITICAL REQUIREMENTS:
- Number IS the visual (typography dominant)
- Hand-drawn quality (NOT clean digital fonts)
- Minimal supporting elements
- Clear at a glance what the number means
- Impactful and memorable
```

---

### Step 4: Determine Aspect Ratio

| Stat Card Type | Aspect Ratio | Reasoning |
|----------------|--------------|-----------|
| Social square | 1:1 | Instagram, LinkedIn |
| Presentation slide | 16:9 | Slides, wide screens |
| Vertical callout | 4:5 | Feed posts, cards |
| Story format | 9:16 | Stories, mobile |

**Default: 1:1** — Most versatile for social/presentations

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 1:1 \
  --output /path/to/stat.png
```

**Model:** Nano Banana 2 (default) (best for number rendering)

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Number dominant** — Impossible to miss the statistic
- [ ] **Hand-drawn quality** — Sketchy, characterful numerals
- [ ] **Clear label** — Obvious what number measures
- [ ] **Readable** — Number and label both legible
- [ ] **Visual impact** — Memorable at a glance

#### Must NOT Have
- [ ] Number too small
- [ ] Perfect digital fonts
- [ ] Competing visual elements
- [ ] Missing label/context
- [ ] Cluttered layout

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Number not dominant | Increase number size to 70%+ of composition |
| Looks digital | "Hand-drawn numerals, slightly imperfect, variable stroke weight" |
| Label unclear | Position label clearly below/above, increase size slightly |
| Too busy | Remove illustration, simplify to number + label only |
| Low impact | Increase contrast, strengthen number color |

---

## Example Use Cases

### Example 1: "Newsletter Growth"
- **Number:** 147%
- **Label:** subscriber growth
- **Context:** year over year
- **Color:** Teal (positive)
- **Illustration:** Small upward arrow

### Example 2: "Time Saved"
- **Number:** 4.2 hours
- **Label:** saved per week
- **Context:** per team member
- **Color:** Teal (positive)
- **Illustration:** Small clock

### Example 3: "Error Rate"
- **Number:** 0.3%
- **Label:** error rate
- **Context:** down from 2.1%
- **Color:** Teal (positive improvement)
- **Illustration:** None (pure number)

---

## Quick Reference

**The Formula:**
```
1. Define the statistic (number, format, label, sentiment)
2. Design layout (hierarchy, placement, illustration)
3. Construct prompt with dominant number
4. Choose aspect ratio (usually 1:1)
5. Generate image
6. Validate number dominance and clarity
```

**Number Format Guide:**
```
Raw number → Display format
├─ 73.2% → 73% (round for impact)
├─ 1,234 → 1.2K (abbreviate thousands)
├─ 2,400,000 → 2.4M (abbreviate millions)
├─ 10.3x → 10x (round multipliers)
└─ $147.89 → $148 (round currency)
```

---

**The workflow: Define → Design → Construct → Generate → Validate → Complete**
