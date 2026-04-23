# Taxonomies Workflow

**Hand-drawn classification grids that organize concepts into categories.**

Creates **VISUAL CLASSIFICATION SYSTEMS** — grids, matrices, and organized lists that show how concepts relate and categorize.

---

## Purpose

Taxonomies help audiences understand how things fit together. Unlike simple lists, visual taxonomies show relationships, hierarchies, and categorical boundaries.

**Use this workflow for:**
- Classification systems
- Category breakdowns
- Organized lists with visual structure
- Concept mapping by type
- "Types of X" content

---

## Visual Aesthetic: Organized Clarity

**Think:** Hand-drawn grid on a whiteboard organizing post-it notes

### Core Characteristics
1. **Grid structure** — Clear rows/columns or categorical regions
2. **Hand-drawn cells** — Wobbly borders, sketchy divisions
3. **Visual categorization** — Each category has distinct treatment
4. **Scannable layout** — Easy to find and compare items
5. **Label hierarchy** — Category headers, item labels, descriptions

---

## Color System

### Structure
```
Charcoal        #2D2D2D   (grid lines, text)
Dark Gray       #4A4A4A   (secondary text, borders)
Light Gray      #E5E7EB   (grid background variation)
```

### Category Coding
```
Deep Teal       #1A6B6B   (primary category accent)
Bright Teal     #2B9B9B   (secondary category)
Burnt Orange    #C85A2A   (highlight category)
Coral Orange    #E07B4F   (secondary highlight)
```

### Background
```
Warm Cream      #F7F4EA   (primary)
Pure White      #FFFFFF   (alternative)
```

### Color Strategy
- Use color to differentiate categories (not just decoration)
- 2-4 distinct category colors maximum
- Maintain charcoal for all text
- Subtle backgrounds for grid cells

---

## MANDATORY WORKFLOW STEPS

### Step 1: Define Taxonomy Structure

**Analyze the classification:**

1. **What's being classified?** [Subject domain]
2. **Categories:** [2-6 main categories]
3. **Items per category:** [List items]
4. **Hierarchy depth:** [1-3 levels]
5. **Relationships:** [How do categories relate?]

**Output:**
```
SUBJECT: [What's being classified]

CATEGORIES:
1. [Category A]: [Items...]
2. [Category B]: [Items...]
3. [Category C]: [Items...]
...

STRUCTURE: [Grid / Tree / Nested / Matrix]
HIERARCHY: [Levels deep]
```

---

### Step 2: Design Grid Layout

**Choose the structure:**

| Structure | Use When |
|-----------|----------|
| Grid (rows/cols) | Categories have comparable items |
| Tree | Hierarchical parent-child relationships |
| Nested boxes | Categories within categories |
| Radial | Central concept with surrounding types |

**Plan the layout:**
```
LAYOUT TYPE: [Grid / Tree / Nested / Radial]

ARRANGEMENT:
- [How categories are positioned]
- [How items are arranged within]
- [Visual grouping approach]

HEADERS:
- Category headers: [Position and style]
- Item labels: [Position and style]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn taxonomy grid in Excalidraw sketch style on warm cream background (#F7F4EA).

STYLE REFERENCE: Visual classification chart, hand-drawn category grid, whiteboard taxonomy, organized post-it arrangement

BACKGROUND: Warm Cream #F7F4EA — clean, flat

AESTHETIC:
- Hand-drawn grid lines (wobbly, not ruler-straight)
- Sketchy cell borders with organic imperfection
- Category regions clearly delineated
- Variable stroke weight for hierarchy
- Editorial illustration meets information design

TAXONOMY: [Subject being classified]

STRUCTURE: [Grid with X columns / Tree with X levels / etc.]

3-TIER TYPOGRAPHY:

TIER 1 - TITLE:
- "[TAXONOMY TITLE]"
- Bold hand-lettered all-caps
- Charcoal #2D2D2D
- Top of diagram

TIER 2 - CATEGORY HEADERS:
- "[Category A]", "[Category B]", etc.
- Medium bold, readable
- Each category gets distinct color accent
- Examples: Teal header, Orange header, etc.

TIER 3 - ITEM LABELS:
- Individual items within categories
- Smaller, regular weight
- Charcoal #2D2D2D
- Brief descriptions in italic if needed

CATEGORIES TO SHOW:

CATEGORY 1: [Name]
- Header: [Style — Teal #1A6B6B accent]
- Items:
  * [Item 1]
  * [Item 2]
  * [Item 3]

CATEGORY 2: [Name]
- Header: [Style — Orange #C85A2A accent]
- Items:
  * [Item 1]
  * [Item 2]
  * [Item 3]

[Continue for all categories...]

COLOR CODING:
- Category 1: Deep Teal (#1A6B6B) header/accent
- Category 2: Burnt Orange (#C85A2A) header/accent
- Category 3: Bright Teal (#2B9B9B) header/accent
- Category 4: Coral (#E07B4F) header/accent
- All item text: Charcoal (#2D2D2D)

LAYOUT:
- [Specific arrangement]
- Clear separation between categories
- Items aligned within categories
- 30-40% negative space
- Easy scanning left-to-right, top-to-bottom

CRITICAL REQUIREMENTS:
- Hand-drawn grid quality (NOT spreadsheet)
- Clear category differentiation through color
- Readable item labels
- Scannable organization
- Visual hierarchy (categories > items)
```

---

### Step 4: Determine Aspect Ratio

| Taxonomy Type | Aspect Ratio | Reasoning |
|---------------|--------------|-----------|
| 2-3 column grid | 16:9 | Wide horizontal categories |
| 4+ column grid | 21:9 | Extra width for columns |
| Vertical tree | 9:16 | Tall hierarchy |
| Square matrix | 1:1 | Balanced rows/columns |
| Nested boxes | 4:3 | Flexible space |

**Default: 16:9** — Works for most category grids

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 16:9 \
  --output /path/to/taxonomy.png
```

**Model:** Nano Banana 2 (default). Add `--thinking high` for grids with 4+ categories.

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Clear categories** — Distinct regions/columns
- [ ] **Readable labels** — All text legible
- [ ] **Color coding** — Categories differentiated by color
- [ ] **Hand-drawn quality** — Wobbly lines, sketchy borders
- [ ] **Scannable** — Easy to find items

#### Must NOT Have
- [ ] Spreadsheet/table aesthetic
- [ ] Perfect straight lines
- [ ] Illegible text
- [ ] Too many categories (>6)
- [ ] Missing category headers

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Too spreadsheet-like | "Hand-drawn grid, wobbly lines, organic borders, whiteboard sketch" |
| Categories unclear | Strengthen color coding, add visual separators |
| Text unreadable | Reduce items per category, increase spacing |
| Too busy | Limit to 4-5 categories, fewer items each |

---

## Example Use Cases

### Example 1: "Types of AI Tools"
- **Categories:** Generators, Analyzers, Assistants, Automators
- **Items:** 3-5 examples per category
- **Color:** Teal for technical, orange for creative

### Example 2: "Content Formats by Effort"
- **Categories:** Low Effort, Medium Effort, High Effort
- **Items:** Content types in each
- **Color:** Gradient from green to orange to deep

### Example 3: "Security Controls Taxonomy"
- **Categories:** Preventive, Detective, Corrective, Deterrent
- **Items:** Example controls per type
- **Color:** Each category distinct

---

## Quick Reference

**The Formula:**
```
1. Define taxonomy structure (categories, items, hierarchy)
2. Design grid layout (structure type, arrangement)
3. Construct prompt with color-coded categories
4. Choose aspect ratio for layout
5. Generate image (add --thinking high for complex layouts)
6. Validate category clarity and readability
```

**Structure Decision:**
```
How do categories relate?
├─ Side-by-side comparison → Grid (columns)
├─ Parent-child hierarchy → Tree
├─ Nested containment → Nested boxes
└─ Central with types → Radial
```

---

**The workflow: Define → Design → Construct → Generate → Validate → Complete**
