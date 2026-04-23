# Technical Diagrams Workflow

**Hand-drawn engineering sketches for system architecture, processes, and technical explanations.**

Creates **LABELED TECHNICAL ILLUSTRATIONS** — diagrams that show actual structure and relationships with encouraged text usage, like an engineer's notebook sketch.

---

## Purpose

Technical diagrams explain how things work. Unlike editorial illustrations (abstract metaphors) or mermaid diagrams (structured conventions), technical diagrams are freeform explanatory sketches with extensive labeling.

**Use this workflow for:**
- System architecture diagrams
- Infrastructure layouts
- Component relationships
- Process explanations
- Technical documentation visuals

---

## Visual Aesthetic: Engineering Notebook

**Think:** Expert's whiteboard sketch explaining a system

### Core Characteristics
1. **Functional structure** — Shows real components and relationships
2. **Extensive labeling** — Text explains what each part does
3. **Hand-drawn quality** — Wobbly boxes, sketchy arrows
4. **Annotation style** — Notes and callouts like margin comments
5. **Technical clarity** — Accurate representation despite sketch aesthetic

---

## Typography System (3-Tier Functional)

### Tier 1: WHAT (Title)
- **Purpose:** States what the diagram shows
- **Style:** Bold, hand-lettered, all-caps
- **Size:** Largest text in diagram
- **Color:** Charcoal #2D2D2D
- **Example:** "AUTHENTICATION FLOW"

### Tier 2: HOW (Component Labels)
- **Purpose:** Names the parts and their roles
- **Style:** Clean, readable sans-serif
- **Size:** Medium, clearly visible
- **Color:** Charcoal #2D2D2D (or Teal for critical)
- **Example:** "API Gateway", "Auth Service", "User Database"

### Tier 3: WHY (Annotations)
- **Purpose:** Explains reasoning, notes, insights
- **Style:** Italic, handwritten feel
- **Size:** Smaller, supporting
- **Color:** Dark Gray #4A4A4A
- **Example:** "*validates JWT before routing*", "*caches for 5 min*"

---

## Color System

### Structure
```
Charcoal        #2D2D2D   (all primary lines and labels)
Dark Gray       #4A4A4A   (annotations, secondary lines)
Light Gray      #9CA3AF   (background elements, dotted lines)
```

### Emphasis
```
Deep Teal       #1A6B6B   (critical components, 1-3 max)
Burnt Orange    #C85A2A   (key data flows, highlights)
```

### Background
```
Warm Cream      #F7F4EA   (primary)
Pure White      #FFFFFF   (alternative)
```

### Color Strategy
- 80% of diagram in charcoal/gray (structural)
- Deep Teal on 1-3 critical components only
- Burnt Orange on key data flows or action points
- Never color everything — restraint is key

---

## MANDATORY WORKFLOW STEPS

### Step 1: Define Technical Content

**Analyze what needs to be shown:**

1. **System being diagrammed:** [Name/description]
2. **Components:** [List all parts]
3. **Relationships:** [How parts connect]
4. **Critical path:** [Most important flow]
5. **Key insight:** [What should viewer understand]

**Output:**
```
SYSTEM: [What this diagram explains]

COMPONENTS:
1. [Name] — [Function]
2. [Name] — [Function]
...

RELATIONSHIPS:
- [A] → [B]: [What flows between them]
- [A] ↔ [B]: [Bidirectional relationship]
...

CRITICAL COMPONENTS: [1-3 most important]
KEY DATA FLOW: [The main path to highlight]
```

---

### Step 2: Design Layout

**Plan the visual structure:**

1. **Layout pattern:**
   - Left-to-right flow (sequential processes)
   - Top-to-bottom hierarchy (layered systems)
   - Hub-and-spoke (centralized systems)
   - Network/mesh (distributed systems)

2. **Grouping:**
   - What components cluster together?
   - Where are the boundaries?

3. **Annotations placement:**
   - Where do explanatory notes go?
   - What needs clarification?

**Output:**
```
LAYOUT: [Pattern chosen]
GROUPS:
- [Group 1]: [Components]
- [Group 2]: [Components]

ANNOTATIONS:
- Near [Component]: "[Annotation text]"
- Near [Connection]: "[Annotation text]"
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn technical diagram in engineering notebook sketch style on warm cream background (#F7F4EA).

STYLE REFERENCE: Engineering whiteboard sketch, technical documentation illustration, system architecture diagram, hand-drawn with extensive labels

BACKGROUND: Warm Cream #F7F4EA — clean, flat

AESTHETIC:
- Hand-drawn boxes with slightly wobbly edges
- Sketchy arrows with organic curves
- Variable line weight (thicker outlines, thinner connectors)
- Engineering notebook quality (not polished corporate)
- Extensive labeling and annotations

DIAGRAM: [Name of system/process]

3-TIER TYPOGRAPHY:

TIER 1 - TITLE:
- "[DIAGRAM TITLE]"
- Bold hand-lettered all-caps
- Charcoal #2D2D2D
- Top of diagram

TIER 2 - COMPONENT LABELS:
- Clear readable text inside/beside each component
- Charcoal #2D2D2D
- Examples: "[Component 1]", "[Component 2]"

TIER 3 - ANNOTATIONS:
- Italic handwritten notes explaining key details
- Dark Gray #4A4A4A
- Small arrows pointing to relevant parts
- Examples: "*[annotation 1]*", "*[annotation 2]*"

COMPONENTS TO DRAW:
1. [Component 1]: [Shape - rectangle/cylinder/cloud/etc]
   - Label: "[Name]"
   - Style: [Charcoal outline / Teal fill for critical]
   - Annotation: "*[Why note if needed]*"

2. [Component 2]: [Shape]
   - Label: "[Name]"
   - Style: [Color treatment]
   - Annotation: "*[Why note if needed]*"

[Continue for all components...]

CONNECTIONS:
- [From] → [To]: "[Label]" — [charcoal line / orange highlight]
- [From] ↔ [To]: "[Label]" — [line style]

LAYOUT:
- [Layout pattern]: [Specific arrangement]
- Groups: [How components cluster]
- Flow direction: [Left-to-right / Top-to-bottom]
- 30-40% negative space

COLOR USAGE:
- Charcoal (#2D2D2D) for 80% of structure
- Deep Teal (#1A6B6B) fill/outline on [critical components - 1-3 max]
- Burnt Orange (#C85A2A) on [key data flows]
- Dark Gray (#4A4A4A) for all annotations

CRITICAL REQUIREMENTS:
- Hand-drawn imperfect quality (engineering sketch, not corporate)
- Extensive readable labels (this is a teaching diagram)
- Clear 3-tier typography hierarchy
- Strategic color on critical elements only
- Technical accuracy with approachable warmth
```

---

### Step 4: Determine Aspect Ratio

| System Type | Aspect Ratio | Reasoning |
|-------------|--------------|-----------|
| Sequential process | 16:9 or 21:9 | Wide horizontal flow |
| Layered architecture | 9:16 or 4:5 | Vertical stack |
| Hub-and-spoke | 1:1 | Balanced radial |
| Complex mesh | 1:1 or 4:3 | Room for connections |
| Documentation | 4:3 | Standard doc format |

**Default: 16:9** — Works for most architectural diagrams

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 16:9 \
  --output /path/to/diagram.png
```

**Model:** Nano Banana 2 (default). Add `--thinking high` for complex multi-component diagrams.

**Immediately Open:**
```bash
open /path/to/diagram.png
```

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Hand-drawn quality** — Wobbly boxes, sketchy arrows
- [ ] **Readable labels** — All component names clear
- [ ] **3-tier typography** — Title, labels, annotations visible
- [ ] **Strategic color** — Only 1-3 critical items highlighted
- [ ] **Technical accuracy** — Relationships make sense
- [ ] **Annotations present** — Why-level explanations included

#### Must NOT Have
- [ ] Perfect rectangles and straight lines
- [ ] Illegible text
- [ ] Everything colored (no hierarchy)
- [ ] Missing labels on key components
- [ ] Corporate polished aesthetic

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Too polished | "Engineering notebook sketch, whiteboard quality, wobbly hand-drawn edges" |
| Text unreadable | Reduce component count, increase spacing, simplify labels |
| No visual hierarchy | Explicitly define "teal ONLY on [X], orange ONLY on [Y]" |
| Missing annotations | Add specific annotation text in prompt for key components |
| Looks generic | Add specific technical details to labels and annotations |

---

## Example Use Cases

### Example 1: Microservices Architecture
- **Components:** API Gateway, Auth Service, User Service, Order Service, Database
- **Critical:** Auth Service (teal) — security boundary
- **Key flow:** Request path through gateway (orange)
- **Annotations:** "*validates JWT*", "*rate limited*", "*async queue*"

### Example 2: CI/CD Pipeline
- **Components:** Git, Build, Test, Stage, Deploy, Monitor
- **Critical:** Test stage (teal) — quality gate
- **Key flow:** Main deployment path (orange)
- **Annotations:** "*runs on PR*", "*manual approval*", "*rollback enabled*"

### Example 3: Data Pipeline
- **Components:** Sources, Ingestion, Transform, Storage, Analytics
- **Critical:** Transform layer (teal) — business logic
- **Key flow:** Real-time path (orange)
- **Annotations:** "*batch: hourly*", "*stream: <100ms*", "*partitioned by date*"

---

## Quick Reference

**The Formula:**
```
1. Define technical content (components, relationships, critical path)
2. Design layout (pattern, grouping, annotations)
3. Construct prompt with 3-tier typography
4. Choose aspect ratio for layout
5. Generate image (add --thinking high for complex layouts)
6. Validate readability and technical accuracy
```

**Typography Quick Reference:**
- Tier 1 (WHAT): Title — Bold, large, charcoal
- Tier 2 (HOW): Labels — Clear, medium, charcoal
- Tier 3 (WHY): Annotations — Italic, small, gray

**Color Quick Reference:**
- Structure: Charcoal #2D2D2D
- Critical (1-3): Deep Teal #1A6B6B
- Key flows: Burnt Orange #C85A2A
- Annotations: Dark Gray #4A4A4A

---

**The workflow: Define → Design → Construct → Generate → Validate → Complete**
