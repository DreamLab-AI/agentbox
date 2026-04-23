# Comics Workflow

**Hand-drawn multi-panel comic strips telling visual stories.**

Creates **EDITORIAL COMIC STRIPS** — 3-4 panel narratives that explain concepts through sequential visual storytelling.

---

## Purpose

Comics explain through narrative. Unlike diagrams (which show structure) or charts (which show data), comics use **sequential storytelling** to make concepts memorable and engaging.

**Use this workflow for:**
- Concept explanations through story
- Before/during/after narratives
- Problem → solution arcs
- Day-in-the-life scenarios
- Abstract concepts made concrete
- Humorous takes on serious topics

---

## Visual Aesthetic: Editorial Strip

**Think:** New Yorker cartoon meets tech explainer

### Core Characteristics
1. **Panel structure** — Clear 3-4 panel sequence
2. **Simple characters** — Sketchy stick figures or simple shapes
3. **Hand-drawn quality** — Wobbly panels, organic lines
4. **Minimal detail** — Focus on the story, not artistic flourish
5. **Clear progression** — Setup → Development → Payoff
6. **Text integration** — Speech bubbles, captions, labels

---

## Comic Structures

### 3-Panel Classic
- **Panel 1:** Setup (establish situation)
- **Panel 2:** Development (complication or action)
- **Panel 3:** Payoff (resolution or punchline)

### 4-Panel Extended
- **Panel 1:** Setup
- **Panel 2:** Rising action
- **Panel 3:** Climax/turn
- **Panel 4:** Resolution

### Before/After Split
- **Panel 1-2:** Before state (problem)
- **Panel 3-4:** After state (solution)

### Day Sequence
- **Panel 1:** Morning/start
- **Panel 2:** Midday/middle
- **Panel 3:** Evening/end
- **Panel 4:** Reflection (optional)

---

## Color System

### Structure
```
Charcoal        #2D2D2D   (panel borders, outlines, text)
Dark Gray       #4A4A4A   (secondary lines)
```

### Characters/Elements
```
Deep Teal       #1A6B6B   (protagonist, positive elements)
Burnt Orange    #C85A2A   (antagonist, problem elements, emphasis)
Light Gray      #E5E7EB   (backgrounds, subtle fills)
```

### Background
```
Warm Cream      #F7F4EA   (panel backgrounds)
Pure White      #FFFFFF   (speech bubbles)
```

### Color Strategy
- Simple two-tone character coloring (teal vs orange)
- Charcoal for all lines and text
- White speech bubbles with charcoal text
- Subtle backgrounds, don't compete with story

---

## MANDATORY WORKFLOW STEPS

### Step 1: Develop the Story

**Plan the narrative arc:**

1. **Concept to explain:** [What idea/situation]
2. **Story structure:** [3-panel / 4-panel / Before-After]
3. **Characters:** [Who's in the story]
4. **Sequence:** [What happens in each panel]
5. **Payoff:** [Punchline or insight]

**Output:**
```
CONCEPT: [What this comic explains/shows]
STRUCTURE: [3-panel / 4-panel / Before-After]

CHARACTERS:
- [Character A]: [Role, description]
- [Character B]: [Role, description] (if any)

PANEL SEQUENCE:

Panel 1: [Scene description]
- Visual: [What's shown]
- Text: "[Dialogue or caption]"

Panel 2: [Scene description]
- Visual: [What's shown]
- Text: "[Dialogue or caption]"

Panel 3: [Scene description]
- Visual: [What's shown]
- Text: "[Dialogue or caption]"

Panel 4: (if applicable)
- Visual: [What's shown]
- Text: "[Dialogue or caption]"

PAYOFF: [The insight or punchline]
```

---

### Step 2: Design Panel Layout

**Plan the visual structure:**

1. **Panel arrangement:**
   - Horizontal strip (left-to-right)
   - 2x2 grid
   - Vertical stack

2. **Panel sizing:**
   - Equal sizes (standard)
   - Varied sizes (emphasis on key panel)
   - Wide final panel (for payoff)

3. **Character style:**
   - Simple stick figures
   - Basic shapes with faces
   - Slightly more detailed sketches

**Output:**
```
LAYOUT: [Horizontal strip / 2x2 grid / Vertical]

PANEL SIZES:
- Panel 1: [Standard / Large / Small]
- Panel 2: [Standard / Large / Small]
- Panel 3: [Standard / Large / Small]
- Panel 4: [Standard / Large / Small] (if applicable)

CHARACTER STYLE:
- Type: [Stick figures / Simple shapes / Sketched people]
- Protagonist: [Description, teal accent]
- Antagonist/Other: [Description, orange accent]

PANEL BORDERS:
- Style: [Hand-drawn wobbly / Clean / No borders]
- Gutters: [Space between panels]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn editorial comic strip in Excalidraw sketch style on warm cream background (#F7F4EA).

STYLE REFERENCE: New Yorker cartoon, editorial comic, xkcd simplicity, hand-drawn web comic

BACKGROUND: Warm Cream #F7F4EA — uniform across panels

AESTHETIC:
- Simple sketchy characters (stick figures or basic shapes)
- Hand-drawn panel borders (slightly wobbly)
- Clean speech bubbles with hand-lettered text
- Minimal detail, focus on story clarity
- Editorial illustration quality

COMIC STRUCTURE: [Number]-PANEL [Layout type]

PANEL LAYOUT:
- Arrangement: [Horizontal strip / 2x2 grid / Vertical]
- Panel borders: Hand-drawn charcoal lines
- Gutters: [Width] between panels

CHARACTERS:
- [Character A]: [Simple description] — Teal #1A6B6B accent
- [Character B]: [Simple description] — Orange #C85A2A accent (if applicable)

PANEL 1:
- Scene: [What's shown]
- Character position: [Where they are]
- Expression/action: [What they're doing]
- Text: "[Dialogue]" in speech bubble
  OR Caption: "[Narration]" at top/bottom
- Background: [Simple setting elements]

PANEL 2:
- Scene: [What's shown]
- Character position: [Where they are]
- Expression/action: [What they're doing]
- Text: "[Dialogue]"
- Visual change: [What's different from Panel 1]

PANEL 3:
- Scene: [What's shown]
- Character position: [Where they are]
- Expression/action: [What they're doing]
- Text: "[Dialogue]" — PAYOFF LINE
- Visual emphasis: [How payoff is highlighted]

PANEL 4: (if applicable)
- Scene: [What's shown]
- Text: "[Resolution dialogue/caption]"

TEXT TREATMENT:
- Speech bubbles: White fill, charcoal outline, hand-lettered text
- Captions: Charcoal text, no bubble
- All text: Readable, hand-drawn quality

COLOR USAGE:
- Panel backgrounds: Warm Cream #F7F4EA
- Lines and text: Charcoal #2D2D2D
- Character A accent: Teal #1A6B6B
- Character B accent: Orange #C85A2A
- Speech bubbles: White fill

LAYOUT:
- Clear left-to-right (or top-to-bottom) reading order
- Consistent character positioning
- Visual flow guides the eye through sequence
- 15-20% margins around comic

CRITICAL REQUIREMENTS:
- Clear panel sequence (obvious reading order)
- Simple characters (don't overdetail)
- Readable text in all bubbles/captions
- Hand-drawn quality throughout
- Story makes sense without extra explanation
- Payoff lands in final panel
```

---

### Step 4: Determine Aspect Ratio

| Comic Layout | Aspect Ratio | Reasoning |
|--------------|--------------|-----------|
| 3-panel horizontal | 21:9 or 3:1 | Wide strip format |
| 4-panel horizontal | 4:1 or 21:9 | Extended strip |
| 2x2 grid | 1:1 | Square, social-friendly |
| Vertical stack | 9:16 | Mobile/story format |

**Default: 21:9** — Classic comic strip proportions

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 21:9 \
  --output /path/to/comic.png
```

**Model:** Nano Banana 2 (default). Add `--thinking high` for 4-panel layouts.

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Clear sequence** — Obvious panel reading order
- [ ] **Readable text** — All dialogue/captions legible
- [ ] **Simple characters** — Not overdetailed
- [ ] **Hand-drawn quality** — Sketchy, organic feel
- [ ] **Story lands** — Payoff clear in final panel
- [ ] **Visual consistency** — Same characters across panels

#### Must NOT Have
- [ ] Confusing reading order
- [ ] Illegible text
- [ ] Overly complex drawings
- [ ] Missing payoff
- [ ] Inconsistent character appearance

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Sequence unclear | Number panels or add clear reading direction |
| Text illegible | Increase bubble size, simplify text |
| Too detailed | "Simple stick figures, minimal detail, xkcd style" |
| Story confusing | Simplify to essential beats only |
| Payoff weak | Strengthen final panel visually and textually |

---

## Example Use Cases

### Example 1: "The AI Adoption Journey"
- **Panel 1:** Person skeptical at computer ("AI can't do my job")
- **Panel 2:** Person trying AI, surprised ("Wait, that's actually useful")
- **Panel 3:** Person and AI working together ("We make a good team")
- **Payoff:** Partnership, not replacement

### Example 2: "Inbox Zero Fantasy vs Reality"
- **Panel 1:** Fantasy — empty inbox, peaceful face
- **Panel 2:** Reality — 1000 unread, stressed face
- **Panel 3:** Compromise — filters working, manageable inbox
- **Payoff:** Systems beat willpower

### Example 3: "The Meeting That Could've Been an Email"
- **Panel 1:** Calendar notification: "Sync meeting 2pm"
- **Panel 2:** Five people in meeting: "So... any updates?"
- **Panel 3:** Slack message: "No updates" from all
- **Payoff:** Comedy of corporate waste

---

## Quick Reference

**The Formula:**
```
1. Develop the story (concept, structure, sequence, payoff)
2. Design panel layout (arrangement, sizing, character style)
3. Construct prompt with panel-by-panel detail
4. Choose aspect ratio (usually 21:9 for strips)
5. Generate image (add --thinking high for complex layouts)
6. Validate sequence clarity and story landing
```

**Story Structure Quick Reference:**
```
3-Panel: Setup → Complication → Payoff
4-Panel: Setup → Rising → Climax → Resolution
Before/After: Problem panels → Solution panels
```

---

**The workflow: Develop → Design → Construct → Generate → Validate → Complete**
