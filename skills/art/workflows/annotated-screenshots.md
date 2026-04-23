# Annotated Screenshots Workflow

**Hand-drawn overlays on real screenshots for tutorials, explanations, and documentation.**

Creates **MARKED-UP SCREENSHOTS** — actual interface screenshots with hand-drawn annotations, callouts, and explanations layered on top.

---

## Purpose

Annotated screenshots bridge abstract concepts with concrete UI. Unlike pure illustrations, these use real screenshots as a base and add hand-drawn explanatory elements.

**Use this workflow for:**
- Software tutorials
- UI/UX explanations
- Documentation visuals
- Feature walkthroughs
- Bug reports with context
- Step-by-step guides

---

## Visual Aesthetic: Tutorial Overlay

**Think:** Screenshot with whiteboard markers drawn on top

### Core Characteristics
1. **Real screenshot base** — Actual interface, not illustrated
2. **Hand-drawn overlays** — Circles, arrows, callouts in sketch style
3. **Numbered steps** — Clear sequence for multi-step tutorials
4. **Callout boxes** — Explanatory notes connected to elements
5. **Highlight areas** — Circles/boxes drawing attention to key UI

---

## Annotation Types

### Circle Highlights
- Hand-drawn circles around UI elements
- Wobbly, not perfect ovals
- Teal for primary focus, orange for secondary

### Arrow Pointers
- Sketchy arrows pointing to elements
- Curved, organic paths
- Variable line weight

### Numbered Steps
- Hand-drawn circled numbers
- Sequential flow indication
- Connected by dotted lines if needed

### Callout Boxes
- Hand-drawn rectangles with text
- Lines connecting to UI elements
- Brief explanatory text

### Highlight Zones
- Semi-transparent colored overlays
- Show regions of interest
- Don't obscure underlying content

---

## Color System

### Annotation Colors
```
Deep Teal       #1A6B6B   (primary annotations, step 1)
Burnt Orange    #C85A2A   (secondary annotations, warnings)
Charcoal        #2D2D2D   (text, arrows, connectors)
```

### Overlay Colors
```
Teal Overlay    #1A6B6B at 20% opacity (highlight zones)
Orange Overlay  #C85A2A at 20% opacity (warning zones)
```

### Text
```
Charcoal        #2D2D2D   (all annotation text)
White           #FFFFFF   (text on dark backgrounds if needed)
```

---

## MANDATORY WORKFLOW STEPS

### Step 1: Capture Screenshot

**Get the base image:**

1. **Capture the interface** using screenshot tools
2. **Crop appropriately** — include context but not clutter
3. **Save at high resolution** — 2x for clarity

**Screenshot guidelines:**
- Include enough context for understanding
- Remove sensitive/personal information
- Ensure UI state shows what you're explaining
- Use consistent window size across a series

---

### Step 2: Plan Annotations

**Identify what needs highlighting:**

1. **Key elements:** What UI parts need attention?
2. **Sequence:** Is there a numbered order?
3. **Explanations:** What text accompanies each callout?
4. **Flow:** How does the eye move through annotations?

**Output:**
```
SCREENSHOT: [Description of what's shown]

ANNOTATIONS:
1. [Element]: [Circle/Arrow/Box] — "[Callout text]"
2. [Element]: [Annotation type] — "[Callout text]"
3. [Element]: [Annotation type] — "[Callout text]"
...

SEQUENCE: [Numbered steps / No sequence]
PRIMARY FOCUS: [Most important element]
FLOW: [Left-to-right / Top-to-bottom / Radial]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Add hand-drawn Excalidraw-style annotations to this screenshot.

STYLE: Hand-drawn whiteboard marker annotations overlaid on screenshot
- Sketchy circles (wobbly, not perfect ovals)
- Organic curved arrows
- Hand-lettered text in callouts
- Variable line weight
- Tutorial/documentation quality

ANNOTATIONS TO ADD:

1. [UI ELEMENT LOCATION]:
   - Type: [Circle / Arrow / Numbered step / Callout box]
   - Color: [Teal #1A6B6B / Orange #C85A2A]
   - Text: "[Callout text if applicable]"
   - Connected: [Where the callout points]

2. [UI ELEMENT LOCATION]:
   - Type: [Annotation type]
   - Color: [Color]
   - Text: "[Callout text]"
   ...

NUMBERED SEQUENCE: (if applicable)
- Step 1: [Location] — Teal circled "1"
- Step 2: [Location] — Teal circled "2"
- Step 3: [Location] — Teal circled "3"
- Connect with dotted arrow path

CALLOUT BOXES:
- Position: [Where callout box appears]
- Text: "[Explanation text]"
- Connect: Line to [UI element]

COLOR USAGE:
- Primary annotations: Teal #1A6B6B
- Secondary/warnings: Orange #C85A2A
- All text: Charcoal #2D2D2D
- Highlight overlays: 20% opacity of accent color

STYLE REQUIREMENTS:
- Hand-drawn imperfect quality (NOT clean vectors)
- Annotations clearly overlay screenshot
- Text readable against screenshot background
- Consistent annotation style throughout
- Professional but approachable
```

---

### Step 4: Execute Annotation

**Option A: AI Generation (for styled mockups)**

If you need to generate an annotated screenshot from scratch:

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[PROMPT describing screenshot with annotations]" \
  --size 2K \
  --aspect-ratio 16:9 \
  --output /path/to/annotated.png
```

**Option B: Manual Overlay (for real screenshots)**

For actual screenshots, use annotation tools:
- Excalidraw (import screenshot as background)
- Figma/Sketch (overlay annotation layer)
- Screenshot tools with markup features

---

### Step 5: Validation (MANDATORY)

#### Must Have
- [ ] **Readable annotations** — Text clear against screenshot
- [ ] **Hand-drawn quality** — Sketchy circles and arrows
- [ ] **Clear hierarchy** — Primary vs secondary annotations obvious
- [ ] **Logical flow** — Easy to follow sequence
- [ ] **Appropriate coverage** — Key elements highlighted, not everything

#### Must NOT Have
- [ ] Perfect geometric shapes
- [ ] Annotations obscuring critical UI
- [ ] Illegible text
- [ ] Too many annotations (overwhelming)
- [ ] Inconsistent annotation styles

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Annotations blend in | Add subtle shadow/background to callouts |
| Too cluttered | Reduce to essential annotations only |
| Flow unclear | Add numbered sequence or connecting arrows |
| Text unreadable | Use white text with dark background, or callout boxes |
| Shapes too perfect | "Hand-drawn wobbly circles and organic arrows" |

---

## Example Use Cases

### Example 1: "Setting Up API Keys"
- **Screenshot:** Settings page with API key field
- **Annotations:**
  1. Circle around API key input
  2. Arrow pointing to Save button
  3. Callout: "Paste your key here"

### Example 2: "Dashboard Overview"
- **Screenshot:** Analytics dashboard
- **Annotations:**
  - Teal circles on key metrics
  - Callout boxes explaining each section
  - No numbered sequence (exploration)

### Example 3: "Bug Report Context"
- **Screenshot:** Error state in UI
- **Annotations:**
  - Orange circle on error message
  - Callout explaining expected vs actual
  - Arrow showing where problem originated

---

## Quick Reference

**The Formula:**
```
1. Capture screenshot (high-res, cropped)
2. Plan annotations (elements, sequence, text)
3. Apply hand-drawn overlays (circles, arrows, callouts)
4. Validate readability and clarity
5. Export final annotated image
```

**Annotation Decision:**
```
What are you explaining?
├─ Single element → Circle + callout
├─ Sequential process → Numbered steps + arrows
├─ Overview/tour → Multiple callouts, no numbers
└─ Problem/bug → Orange highlight + explanation
```

**Color Quick Reference:**
- Primary focus: Teal #1A6B6B
- Secondary/warning: Orange #C85A2A
- All text: Charcoal #2D2D2D
- Highlight zones: 20% opacity

---

**The workflow: Capture → Plan → Annotate → Validate → Complete**
