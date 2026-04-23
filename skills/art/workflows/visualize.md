# Adaptive Visualization Workflow

**Intelligent orchestrator that analyzes content and selects optimal visualization approach.**

This workflow serves as a **meta-orchestrator** — it doesn't create visuals directly but rather analyzes content to determine which specialized workflow (or combination) best communicates the message.

---

## Purpose

Not all content fits neatly into one visualization type. This workflow:
1. Analyzes the content structure and communication goals
2. Recommends single or hybrid visualization approach
3. Routes to appropriate specialized workflow(s)
4. Handles complex compositions requiring multiple elements

**Use this workflow when:**
- Unsure which visualization type fits best
- Content has multiple dimensions to communicate
- Need sophisticated hybrid compositions
- Want AI-driven format selection

---

## Decision Framework

### Content Analysis Dimensions

Before selecting visualization type, analyze:

1. **Content Type**
   - Process/flow → Technical Diagrams, Recipe Cards
   - Comparison → Comparisons, Frameworks
   - Hierarchy/taxonomy → Taxonomies
   - Temporal → Timelines
   - Spatial/conceptual → Maps
   - Single point → Stats, Aphorisms
   - Narrative → Comics
   - Abstract concept → Editorial (workflow.md)

2. **Communication Goal**
   - Explain how → Technical Diagrams, Recipe Cards
   - Compare options → Comparisons, Frameworks
   - Organize categories → Taxonomies
   - Show change → Timelines
   - Explore territory → Maps
   - Highlight insight → Stats, Aphorisms
   - Tell story → Comics
   - Evoke feeling → Editorial

3. **Complexity Level**
   - Simple (1-2 concepts) → Single workflow
   - Medium (3-4 concepts) → Single or hybrid
   - Complex (5+ concepts) → Hybrid or multi-panel

4. **Audience Context**
   - Technical → Mermaid, Technical Diagrams
   - Business → Frameworks, Stats
   - General → Editorial, Comparisons
   - Educational → Recipe Cards, Taxonomies

---

## Visualization Selection Matrix

| Content Pattern | Primary Workflow | Hybrid Option |
|----------------|------------------|---------------|
| How does X work? | Technical Diagrams | + Stats for key metrics |
| X vs Y | Comparisons | + Framework for dimensions |
| Categories of X | Taxonomies | + Stats for category sizes |
| Evolution of X | Timelines | + Editorial for era metaphors |
| Key insight about X | Stats | + Editorial for context |
| Memorable quote | Aphorisms | + Editorial for visual metaphor |
| Step-by-step process | Recipe Cards | + Technical for complex steps |
| Conceptual landscape | Maps | + Taxonomies for regions |
| Story/narrative | Comics | + Stats for punchline |
| System architecture | Mermaid | + Technical for details |

---

## MANDATORY WORKFLOW STEPS

### Step 1: Content Analysis

**Use extended thinking to analyze:**

```
CONTENT ANALYSIS:

Subject: [What is being visualized]

Structure Analysis:
- Type: [process/comparison/hierarchy/temporal/spatial/narrative/concept]
- Complexity: [simple/medium/complex]
- Key elements: [list main components]

Communication Goals:
- Primary: [main message]
- Secondary: [supporting messages]
- Audience: [who will see this]

Constraints:
- Format: [web/print/social]
- Aspect ratio: [if specified]
- Brand requirements: [default aesthetic]
```

---

### Step 2: Select Visualization Mode

Based on analysis, choose one of:

#### Single Mode
Use when content maps cleanly to one workflow type.

```
SELECTION: Single Mode
WORKFLOW: [workflow name]
RATIONALE: [why this fits]
```

#### Hybrid Composition
Combine 2-3 visualization types in one image.

```
SELECTION: Hybrid Mode
PRIMARY: [main workflow]
SECONDARY: [supporting workflow]
COMPOSITION: [how they combine]
RATIONALE: [why hybrid needed]
```

#### Multi-Panel Infographic
Dashboard-style with multiple distinct sections.

```
SELECTION: Multi-Panel Mode
PANELS:
1. [workflow] - [purpose]
2. [workflow] - [purpose]
3. [workflow] - [purpose]
LAYOUT: [grid/stack/flow]
RATIONALE: [why multiple panels needed]
```

---

### Step 3: Route to Workflow(s)

#### For Single Mode
- Read the selected workflow file
- Follow its mandatory steps completely
- Apply default aesthetic throughout

#### For Hybrid Mode
- Combine prompts from multiple workflows
- Ensure consistent aesthetic across elements
- Define spatial relationship between elements

#### For Multi-Panel Mode
- Generate each panel separately
- Maintain consistent style across panels
- Consider final composition layout

---

### Step 4: Construct Unified Prompt (Hybrid/Multi-Panel)

For hybrid compositions, merge workflow prompts:

```
Hand-drawn editorial infographic combining [type1] and [type2] in Excalidraw sketch style on warm cream background (#F7F4EA).

OVERALL COMPOSITION:
- [Describe spatial arrangement]
- [Define visual hierarchy]
- [Specify connecting elements]

ELEMENT 1 ([workflow type]):
[Adapted prompt from workflow 1]

ELEMENT 2 ([workflow type]):
[Adapted prompt from workflow 2]

VISUAL UNITY:
- Consistent hand-drawn sketch style throughout
- Shared color palette (Charcoal, Teal, Orange)
- Unified typography hierarchy
- Coherent negative space treatment

CRITICAL REQUIREMENTS:
- All elements feel like one cohesive illustration
- Hand-drawn imperfect quality throughout
- Clear visual hierarchy between elements
- Generous breathing room (40% negative space)
```

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio [selected ratio] \
  --output /path/to/output.png
```

**Model Selection:**
- **nano-banana-2** (default) — Best for most tasks, fast iteration, web search grounding
- **nano-banana-pro** — Maximum reasoning for complex multi-turn compositions

---

### Step 6: Validation

#### Single Mode Validation
- Follow validation checklist from selected workflow

#### Hybrid Mode Validation
- [ ] Elements feel unified (same hand-drawn style)
- [ ] Clear visual hierarchy between components
- [ ] Color usage consistent across elements
- [ ] Negative space balanced throughout
- [ ] Overall composition reads as one piece

#### Multi-Panel Validation
- [ ] Each panel stands alone but relates to others
- [ ] Consistent style across all panels
- [ ] Clear reading order/flow
- [ ] Unified color and typography treatment

---

## Example Decisions

### Example 1: "The AI Hype Cycle"
**Analysis:** Temporal progression + key milestones + emotional arc
**Selection:** Hybrid Mode
- PRIMARY: Timelines (chronological structure)
- SECONDARY: Editorial (metaphors for each era)
**Result:** Timeline with illustrated milestone metaphors

### Example 2: "Comparing RAG vs Fine-Tuning"
**Analysis:** Two options + multiple comparison dimensions
**Selection:** Hybrid Mode
- PRIMARY: Comparisons (side-by-side split)
- SECONDARY: Framework (comparison dimensions as 2x2)
**Result:** Split comparison with mini-framework callout

### Example 3: "State of AI Newsletter Dashboard"
**Analysis:** Multiple metrics + categories + key quote
**Selection:** Multi-Panel Mode
- Panel 1: Stats (subscriber growth)
- Panel 2: Taxonomies (content categories)
- Panel 3: Aphorisms (key insight quote)
**Result:** Three-panel infographic dashboard

---

## Quick Reference

**Decision Tree:**
```
Is content single-dimensional?
├─ Yes → Single Mode (select appropriate workflow)
└─ No → Does it need 2-3 elements combined?
         ├─ Yes → Hybrid Mode (merge workflows)
         └─ No → Multi-Panel Mode (dashboard approach)
```

**Workflow Quick Reference:**
| Workflow | Best For |
|----------|----------|
| workflow.md | Abstract concepts, blog headers |
| technical-diagrams.md | System architecture, processes |
| mermaid.md | Flowcharts, sequences, state diagrams |
| taxonomies.md | Categories, classification grids |
| timelines.md | Evolution, chronological progression |
| frameworks.md | 2x2 matrices, mental models |
| comparisons.md | X vs Y, side-by-side |
| recipe-cards.md | Step-by-step processes |
| aphorisms.md | Quote cards, key insights |
| maps.md | Conceptual territories |
| stats.md | Single striking numbers |
| comics.md | Narrative, sequential story |

---

**The workflow: Analyze → Select Mode → Route → Construct → Generate → Validate**
