# Recipe Cards Workflow

**Hand-drawn step-by-step process cards showing how to do something.**

Creates **ILLUSTRATED PROCESS GUIDES** — numbered step sequences with small illustrations, like a recipe card for any procedure.

---

## Purpose

Recipe cards break down processes into digestible steps. Unlike technical diagrams (which show structure) or timelines (which show change), recipe cards show **how to do something** in sequential order.

**Use this workflow for:**
- How-to guides
- Tutorial summaries
- Process checklists
- Setup instructions
- Best practice lists
- Quick reference cards

---

## Visual Aesthetic: Kitchen Recipe Style

**Think:** Grandma's recipe card with hand-drawn illustrations for each step

### Core Characteristics
1. **Numbered steps** — Clear 1, 2, 3 sequence
2. **Small illustrations** — Visual for each step
3. **Brief text** — Concise action descriptions
4. **Card format** — Bounded, portable feel
5. **Hand-drawn quality** — Sketchy numbers and icons

---

## Color System

### Structure
```
Charcoal        #2D2D2D   (numbers, text, borders)
Dark Gray       #4A4A4A   (secondary text)
```

### Emphasis
```
Deep Teal       #1A6B6B   (step numbers, key actions)
Burnt Orange    #C85A2A   (warnings, important notes)
```

### Background
```
Warm Cream      #F7F4EA   (primary — recipe card feel)
Pure White      #FFFFFF   (alternative)
Light Teal      #E6F3F3   (step background variation)
```

### Color Strategy
- Step numbers in teal (primary visual anchor)
- Action text in charcoal
- Warning/important steps in orange
- Subtle background variation for visual rhythm

---

## MANDATORY WORKFLOW STEPS

### Step 1: Define the Process

**Break down the procedure:**

1. **What's the process?** [Name/goal]
2. **How many steps?** [3-8 ideal, 10 max]
3. **What's each step?** [Action + brief explanation]
4. **Visual for each?** [Small icon representing the action]
5. **Any warnings?** [Steps that need orange highlight]

**Output:**
```
PROCESS: [What this teaches/shows]
GOAL: [Outcome when complete]

STEPS:
1. [Action verb] — [Brief description]
   - Visual: [Icon idea]
   - Note: [Optional tip/warning]

2. [Action verb] — [Brief description]
   - Visual: [Icon idea]

3. [Action verb] — [Brief description]
   - Visual: [Icon idea]
...

WARNINGS: [Any steps that need orange highlight]
KEY STEP: [Most important step — teal emphasis]
```

---

### Step 2: Design Card Layout

**Plan the visual structure:**

1. **Layout orientation:**
   - Vertical stack (most common)
   - Horizontal flow (for wide formats)
   - Grid (for parallel steps)

2. **Step representation:**
   - Large circled number + text + small illustration
   - Or: Illustration dominant with number badge
   - Or: Checkbox style for checklists

3. **Card boundaries:**
   - Subtle border
   - Background variation
   - Title header

**Output:**
```
LAYOUT: [Vertical / Horizontal / Grid]

CARD STYLE:
- Border: [Subtle charcoal / None]
- Title area: [Style]
- Step format: [Number + text + illustration arrangement]

STEP VISUAL TREATMENT:
- Numbers: Hand-drawn circled, teal
- Text: [Position relative to number]
- Illustrations: [Position, size]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn recipe card in Excalidraw sketch style on warm cream background (#F7F4EA).

STYLE REFERENCE: Recipe card, step-by-step guide, illustrated how-to, hand-drawn process card

BACKGROUND: Warm Cream #F7F4EA — like an actual recipe card

AESTHETIC:
- Hand-drawn circled numbers (wobbly, not perfect)
- Small sketchy illustrations for each step
- Variable line weight
- Recipe/instruction card quality
- Warm, approachable, helpful

PROCESS: "[Process Name/Title]"

CARD LAYOUT:
- Subtle hand-drawn border (or no border)
- Title at top in bold hand-lettered style
- [Number] steps arranged vertically

TITLE:
- "[PROCESS NAME]"
- Bold hand-lettered, charcoal #2D2D2D
- Top of card

STEPS:

STEP 1: "[Action]"
- Number: Hand-drawn circled "1" in Teal #1A6B6B
- Text: "[Brief action description]"
- Illustration: [Small sketchy icon representing action]
- Position: [First in sequence]

STEP 2: "[Action]"
- Number: Hand-drawn circled "2" in Teal #1A6B6B
- Text: "[Brief action description]"
- Illustration: [Small sketchy icon]

STEP 3: "[Action]"
- Number: Hand-drawn circled "3" in Teal #1A6B6B
- Text: "[Brief action description]"
- Illustration: [Small sketchy icon]

[Continue for all steps...]

STEP [N — WARNING]: "[Action]" (if applicable)
- Number: Hand-drawn circled in Orange #C85A2A
- Text: "[Warning/important action]"
- Note: "*[Important tip]*"

TYPOGRAPHY:
- Title: Bold, hand-lettered, charcoal
- Step numbers: Teal, circled, prominent
- Action text: Regular charcoal
- Tips/notes: Smaller italic

COLOR USAGE:
- Step numbers: Teal #1A6B6B
- Warning steps: Orange #C85A2A
- All text: Charcoal #2D2D2D
- Illustrations: Charcoal outline with subtle accents

LAYOUT:
- Steps evenly spaced
- Illustrations aligned
- 25-35% negative space
- Easy to follow top-to-bottom

CRITICAL REQUIREMENTS:
- Hand-drawn quality (NOT clean vectors)
- Clear numbered sequence
- Small illustration for each step
- Recipe card warmth and helpfulness
- Scannable and actionable
```

---

### Step 4: Determine Aspect Ratio

| Recipe Card Type | Aspect Ratio | Reasoning |
|------------------|--------------|-----------|
| Standard vertical | 4:5 or 3:4 | Classic card proportions |
| Long process (6+ steps) | 9:16 | Room for all steps |
| Horizontal flow | 16:9 | Left-to-right sequence |
| Quick reference square | 1:1 | Compact card |

**Default: 4:5** — Classic recipe card feel

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 4:5 \
  --output /path/to/recipe-card.png
```

**Model:** Nano Banana 2 (default) (best for numbered text + illustrations)

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Clear sequence** — Numbers obvious and ordered
- [ ] **Readable text** — All steps legible
- [ ] **Illustrations present** — Visual for each/most steps
- [ ] **Hand-drawn quality** — Sketchy, warm feel
- [ ] **Actionable steps** — Each step is clear action

#### Must NOT Have
- [ ] Missing step numbers
- [ ] Illegible text
- [ ] Corporate checklist aesthetic
- [ ] Too many steps (overwhelming)
- [ ] No visual interest (text only)

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Numbers unclear | "Large hand-drawn circled numbers in teal, prominent and clear" |
| Steps run together | Increase spacing, add visual dividers |
| No illustrations | Explicitly describe illustration for each step |
| Too corporate | "Recipe card warmth, hand-drawn like grandma's cooking instructions" |
| Too many steps | Combine related steps, max 8 |

---

## Example Use Cases

### Example 1: "How to Write a Good Prompt"
1. Start with context
2. Be specific about format
3. Include examples
4. Specify constraints
5. Review and iterate

### Example 2: "Morning Routine Checklist"
1. Review calendar
2. Check inbox (15 min max)
3. Set top 3 priorities
4. Deep work block
5. Quick wins batch

### Example 3: "Publishing a Newsletter Issue"
1. Write draft
2. Add visuals
3. Review in preview
4. Schedule send
5. Promote on social

---

## Quick Reference

**The Formula:**
```
1. Define the process (steps, visuals, warnings)
2. Design card layout (orientation, step format)
3. Construct prompt with numbered sequence
4. Choose aspect ratio (usually 4:5)
5. Generate image
6. Validate sequence clarity and warmth
```

**Step Count Guidelines:**
- 3-5 steps: Quick reference card
- 6-8 steps: Standard process guide
- 9-10 steps: Consider splitting into parts
- 10+ steps: Definitely split or simplify

---

**The workflow: Define → Design → Construct → Generate → Validate → Complete**
