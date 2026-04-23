# Mermaid-Style Diagrams Workflow

**Hand-drawn technical diagrams following Mermaid.js conventions with Excalidraw sketch aesthetic.**

Creates **STRUCTURED TECHNICAL DIAGRAMS** — flowcharts, sequence diagrams, state machines, and other standard diagram types with hand-drawn warmth.

---

## Purpose

Mermaid diagrams provide structured visualization for technical concepts. This workflow combines Mermaid's diagram grammar conventions with Excalidraw's hand-drawn aesthetic and a warm color palette.

**Use this workflow for:**
- Flowcharts with decision logic
- Sequence diagrams (temporal interactions)
- State diagrams (lifecycle transitions)
- Class/ER diagrams (relationships)
- Process flows with defined paths

---

## Diagram Type Selection

### Flowchart
**Use when:** Showing decision logic, process branches, conditional paths
```
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
```

### Sequence Diagram
**Use when:** Showing temporal interactions between entities
```
sequenceDiagram
    User->>System: Request
    System->>Database: Query
    Database-->>System: Response
```

### State Diagram
**Use when:** Showing lifecycle states and transitions
```
stateDiagram
    [*] --> Draft
    Draft --> Review
    Review --> Published
    Published --> [*]
```

### Class/ER Diagram
**Use when:** Showing relationships between entities
```
classDiagram
    Class1 --|> Class2
    Class1 : +attribute
    Class2 : +method()
```

---

## Visual Aesthetic: Sketchy Structure

**Think:** Whiteboard diagram drawn quickly by an expert

### Core Characteristics
1. **Hand-drawn nodes** — Wobbly rectangles, imperfect circles
2. **Sketchy connectors** — Arrows with slight curves, not ruler-straight
3. **Organic imperfection** — Like drawn on whiteboard in a meeting
4. **Strategic highlights** — Teal on critical path, orange on key decisions
5. **Clear labels** — Readable text despite sketch aesthetic

---

## Color System

### Structure
```
Charcoal        #2D2D2D   (primary lines and text)
Dark Gray       #4A4A4A   (secondary lines)
```

### Emphasis
```
Deep Teal       #1A6B6B   (critical path, primary nodes)
Burnt Orange    #C85A2A   (decision points, key transitions)
```

### Background
```
Warm Cream      #F7F4EA   (primary)
Pure White      #FFFFFF   (alternative)
```

### Color Strategy
- Most nodes and edges in charcoal (80%)
- Critical path highlighted in teal (10-15%)
- Decision points or key moments in orange (5-10%)

---

## MANDATORY WORKFLOW STEPS

### Step 1: Analyze Content Structure

**Identify the diagram type needed:**

1. **What's being shown?** (process, interaction, states, relationships)
2. **What's the critical path?** (most important flow)
3. **Where are decision points?** (branches, conditions)
4. **How many entities/nodes?** (keep minimal — 5-10 ideal)

**Output:**
```
DIAGRAM TYPE: [flowchart/sequence/state/class]
CRITICAL PATH: [the main flow to highlight]
DECISION POINTS: [where branches occur]
NODE COUNT: [number of elements]
```

---

### Step 2: Define Diagram Structure

**Map out the diagram elements:**

For **Flowcharts:**
```
START: [entry point]
NODES:
1. [Node name] — [purpose] — [shape: rect/diamond/circle]
2. [Node name] — [purpose] — [shape]
...
EDGES:
- [From] → [To]: [label]
- [From] → [To]: [label]
CRITICAL PATH: [Node1 → Node2 → Node3]
```

For **Sequence Diagrams:**
```
PARTICIPANTS: [Entity1, Entity2, Entity3]
INTERACTIONS:
1. [From] → [To]: [message]
2. [From] ← [To]: [response]
...
KEY INTERACTION: [which one to highlight]
```

For **State Diagrams:**
```
STATES: [State1, State2, State3]
TRANSITIONS:
- [From] → [To]: [trigger]
- [From] → [To]: [trigger]
CRITICAL TRANSITION: [which one matters most]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn [DIAGRAM TYPE] diagram in Excalidraw whiteboard sketch style on warm cream background (#F7F4EA).

STYLE REFERENCE: Whiteboard diagram, engineering sketch, hand-drawn flowchart, Excalidraw aesthetic

BACKGROUND: Warm Cream #F7F4EA — clean, flat

AESTHETIC:
- Hand-drawn nodes (wobbly rectangles, imperfect circles, sketchy diamonds)
- Sketchy arrows with slight organic curves
- Variable stroke weight (thicker outlines, thinner connectors)
- Multiple overlapping strokes on important elements
- Hand-lettered labels (casual but readable)
- Engineering notebook quality, not polished corporate

DIAGRAM STRUCTURE:
[Describe the specific diagram layout]

NODES TO DRAW:
1. [Node 1]: [Shape] — [Description]
   - Style: [Charcoal outline / Teal fill / Orange accent]
2. [Node 2]: [Shape] — [Description]
   - Style: [Color treatment]
...

CONNECTIONS:
- [From] → [To]: [Label] — [Style: charcoal line / teal highlight]
...

TYPOGRAPHY:
- Node labels: Hand-drawn casual text, readable
- Edge labels: Smaller, italic style
- All text in Charcoal #2D2D2D

COLOR USAGE:
- Charcoal (#2D2D2D) for most nodes and all text (80%)
- Deep Teal (#1A6B6B) highlight on [critical path nodes/edges]
- Burnt Orange (#C85A2A) accent on [decision points]
- Subtle soft shadows on nodes for depth

LAYOUT:
- Clear left-to-right or top-to-bottom flow
- Generous spacing between nodes
- 30-40% negative space
- Logical grouping of related elements

CRITICAL REQUIREMENTS:
- Hand-drawn imperfect quality (NOT smooth vectors)
- Sketchy arrows and wobbly shapes (whiteboard aesthetic)
- Clear readable labels despite sketch style
- Strategic color on critical path only
- Professional but approachable diagram
```

---

### Step 4: Determine Aspect Ratio

| Diagram Type | Aspect Ratio | Reasoning |
|--------------|--------------|-----------|
| Flowchart (horizontal) | 16:9 | Wide flow left-to-right |
| Flowchart (vertical) | 9:16 | Tall flow top-to-bottom |
| Sequence diagram | 9:16 or 1:1 | Vertical timeline |
| State diagram | 1:1 or 16:9 | Depends on state count |
| Class/ER diagram | 1:1 | Balanced relationships |

**Default: 16:9** — Most versatile for technical diagrams

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 16:9 \
  --output /path/to/diagram.png
```

**Model:** Nano Banana 2 (default) (best for text rendering on diagrams)

**Immediately Open:**
```bash
open /path/to/diagram.png
```

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Hand-drawn quality** — Wobbly shapes, sketchy lines
- [ ] **Clear structure** — Logical flow, readable organization
- [ ] **Readable labels** — All text legible
- [ ] **Strategic color** — Teal on critical path, orange on decisions
- [ ] **Appropriate spacing** — Nodes not cramped

#### Must NOT Have
- [ ] Perfect geometric shapes
- [ ] Ruler-straight lines
- [ ] Excessive color (everything highlighted)
- [ ] Illegible text
- [ ] Corporate polished look

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Too polished | "Hand-drawn on whiteboard, wobbly edges, organic imperfection, quick sketch" |
| Text unreadable | Increase node size, simplify labels, reduce node count |
| No visual hierarchy | Reinforce "critical path in teal, decisions in orange" |
| Too cramped | Reduce nodes to 5-8, increase spacing |
| Wrong diagram type | Reconsider structure — maybe sequence instead of flowchart? |

---

## Example Use Cases

### Example 1: API Request Flow
**Type:** Sequence diagram
**Participants:** Client, API Gateway, Auth Service, Database
**Critical:** Auth check highlighted in teal
**Decision:** Auth failure path in orange

### Example 2: Content Publishing Workflow
**Type:** Flowchart
**Nodes:** Draft, Review, Revise, Approve, Publish
**Critical path:** Draft → Review → Approve → Publish (teal)
**Decisions:** Review outcome diamond (orange)

### Example 3: User Account States
**Type:** State diagram
**States:** Anonymous, Registered, Verified, Suspended, Deleted
**Critical:** Registration and verification path (teal)
**Key transition:** Suspension trigger (orange)

---

## Quick Reference

**Diagram Type Decision:**
```
What are you showing?
├─ Decision logic, branching → Flowchart
├─ Entity interactions over time → Sequence
├─ Lifecycle, state changes → State
└─ Entity relationships → Class/ER
```

**Color Quick Reference:**
- Most elements: Charcoal #2D2D2D
- Critical path: Deep Teal #1A6B6B
- Decision points: Burnt Orange #C85A2A
- Background: Warm Cream #F7F4EA

---

**The workflow: Analyze → Define Structure → Construct → Generate → Validate → Complete**
