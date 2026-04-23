# Conceptual Maps Workflow

**Hand-drawn territory maps visualizing idea landscapes and concept relationships.**

Creates **ILLUSTRATED IDEA TERRITORIES** — maps that show conceptual space as geographic terrain, with regions, paths, and landmarks representing abstract concepts.

---

## Purpose

Conceptual maps externalize mental landscapes. Unlike taxonomies (which categorize) or frameworks (which position on axes), maps show concepts as **navigable territory** with geography, boundaries, and paths.

**Use this workflow for:**
- Idea landscape visualization
- Knowledge domain mapping
- Conceptual territory exploration
- "Map of X" content
- Field/discipline overviews
- Journey/exploration metaphors

---

## Visual Aesthetic: Illustrated Territory

**Think:** Hand-drawn fantasy map meets concept visualization

### Core Characteristics
1. **Geographic metaphor** — Ideas as terrain features
2. **Hand-drawn cartography** — Sketchy map aesthetic
3. **Labeled regions** — Named territories/domains
4. **Paths and connections** — Routes between concepts
5. **Landmarks** — Key concepts as notable features
6. **Exploration feel** — Invites discovery

---

## Map Elements

### Terrain Types
- **Mountains** — Major concepts, difficult challenges
- **Valleys** — Established knowledge, well-trodden areas
- **Rivers** — Connections, flows between areas
- **Forests** — Dense/complex topics
- **Plains** — Accessible, foundational concepts
- **Islands** — Isolated/specialized topics

### Features
- **Cities/Towns** — Major concepts (labeled points)
- **Roads/Paths** — Connections between concepts
- **Borders** — Domain boundaries
- **Compass** — Orientation (optional)
- **Sea/Ocean** — Unknown/unexplored areas

---

## Color System

### Land/Terrain
```
Warm Cream      #F7F4EA   (base land color)
Light Teal      #E6F3F3   (water, low areas)
Sand/Tan        #E8DCC8   (desert, plains)
```

### Features
```
Deep Teal       #1A6B6B   (water, rivers, important paths)
Burnt Orange    #C85A2A   (landmarks, cities, key points)
Charcoal        #2D2D2D   (borders, labels, terrain lines)
```

### Text
```
Charcoal        #2D2D2D   (region names, labels)
Dark Gray       #4A4A4A   (secondary labels)
```

### Color Strategy
- Warm cream as primary land
- Teal for water features and important routes
- Orange for key landmarks/concepts
- Charcoal for all linework and labels

---

## MANDATORY WORKFLOW STEPS

### Step 1: Define the Territory

**Map out the conceptual landscape:**

1. **What domain?** [The field/topic being mapped]
2. **Major regions?** [3-6 main territories]
3. **Key landmarks?** [Notable concepts/points]
4. **Connections?** [How regions relate]
5. **Boundaries?** [Where domains separate]
6. **Unexplored areas?** [Edges of knowledge]

**Output:**
```
DOMAIN: [What this map covers]

REGIONS:
1. [Region name] — [What it represents]
   - Terrain type: [Mountains / Valley / Forest / etc.]
   - Key landmarks: [Important points within]

2. [Region name] — [What it represents]
   - Terrain type: [Type]
   - Key landmarks: [Points]

3. [Region name] — [What it represents]
   ...

CONNECTIONS:
- [Region A] ↔ [Region B]: [River / Road / Bridge]
- [Region B] ↔ [Region C]: [Connection type]
...

KEY LANDMARKS (Orange highlights):
- [Landmark 1]: [Concept it represents]
- [Landmark 2]: [Concept it represents]

BOUNDARIES:
- [Where regions meet and why]

UNEXPLORED: [What lies at the edges]
```

---

### Step 2: Design Map Layout

**Plan the cartographic structure:**

1. **Overall shape:**
   - Island (bounded, complete)
   - Continent (extends beyond view)
   - Region (portion of larger territory)

2. **Region placement:**
   - How territories arrange spatially
   - What's central vs peripheral
   - Logical geographic flow

3. **Visual hierarchy:**
   - Which regions are prominent
   - What landmarks stand out
   - Where the eye is drawn

**Output:**
```
MAP SHAPE: [Island / Continent / Region]

SPATIAL ARRANGEMENT:
- Center: [What's in the middle]
- North: [What's at top]
- South: [What's at bottom]
- East/West: [Side regions]
- Edges: [What's at boundaries]

VISUAL EMPHASIS:
- Most prominent: [Region or landmark]
- Key routes: [Important connections]
- Discovery points: [Inviting areas to explore]

CARTOGRAPHIC ELEMENTS:
- Compass: [Yes/No, position]
- Title banner: [Style and position]
- Legend: [If needed]
- Sea/borders: [How edges are handled]
```

---

### Step 3: Construct Prompt

### Prompt Template

```
Hand-drawn conceptual map in illustrated cartography style on warm cream background (#F7F4EA).

STYLE REFERENCE: Fantasy map, illustrated territory, hand-drawn cartography, concept landscape, medieval map aesthetic

BACKGROUND: Warm Cream #F7F4EA — like aged parchment

AESTHETIC:
- Hand-drawn coastlines and borders (wobbly, organic)
- Sketchy terrain features (mountains as small peaks, forests as tree clusters)
- Hand-lettered region names
- Variable line weight for depth
- Exploration/discovery feel

MAP TITLE: "[TERRITORY NAME]"
- Hand-drawn banner or cartouche
- Bold lettered, charcoal
- Top or decorative position

REGIONS TO SHOW:

REGION 1: "[Name]"
- Position: [Location on map]
- Terrain: [Mountains / Forest / Plains / etc.]
- Visual: [How to render — e.g., "small mountain peaks"]
- Label: Hand-lettered region name

REGION 2: "[Name]"
- Position: [Location]
- Terrain: [Type]
- Visual: [How to render]
...

KEY LANDMARKS (Orange #C85A2A):
- [Landmark 1]: [Position] — Small illustrated icon + label
- [Landmark 2]: [Position] — Icon + label
...

CONNECTIONS:
- River from [A] to [B]: Teal #1A6B6B flowing line
- Road from [B] to [C]: Dotted charcoal path
- Border between [A] and [C]: Dashed line

WATER FEATURES:
- [Ocean/Sea name]: Teal #1A6B6B with subtle waves
- [River name]: Teal line flowing through territory

CARTOGRAPHIC ELEMENTS:
- Compass rose: [Position, if any]
- Border: Decorative hand-drawn frame
- Title banner: [Style]

TYPOGRAPHY:
- Region names: Bold, hand-lettered, charcoal
- Landmark names: Smaller, near icons
- Water names: Italic, teal-ish
- All text: Hand-drawn quality

COLOR USAGE:
- Land: Warm Cream #F7F4EA base
- Water: Deep Teal #1A6B6B
- Key landmarks: Burnt Orange #C85A2A
- All lines and text: Charcoal #2D2D2D

LAYOUT:
- [Overall arrangement]
- 20-30% water/border areas
- Balanced region distribution
- Clear reading path for exploration

CRITICAL REQUIREMENTS:
- Hand-drawn cartography quality (NOT vector map)
- Geographic metaphor for concepts (terrain represents ideas)
- Labeled regions and landmarks
- Exploration/discovery feeling
- Readable and navigable
```

---

### Step 4: Determine Aspect Ratio

| Map Type | Aspect Ratio | Reasoning |
|----------|--------------|-----------|
| Island/complete territory | 1:1 | Balanced exploration |
| Wide landscape | 16:9 | Panoramic territory |
| Tall journey | 9:16 | Top-to-bottom progression |
| Classic map | 4:3 | Traditional cartography |

**Default: 1:1** — Best for explorable territories

---

### Step 5: Execute Generation

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[YOUR PROMPT]" \
  --size 2K \
  --aspect-ratio 1:1 \
  --output /path/to/map.png
```

**Model:** Nano Banana 2 (default). Add `--thinking high` for maps with 4+ regions.

---

### Step 6: Validation (MANDATORY)

#### Must Have
- [ ] **Geographic metaphor** — Concepts as terrain features
- [ ] **Hand-drawn cartography** — Sketchy, organic map style
- [ ] **Labeled regions** — Territory names readable
- [ ] **Visual landmarks** — Key concepts marked
- [ ] **Exploration feel** — Invites discovery

#### Must NOT Have
- [ ] Digital/vector map aesthetic
- [ ] Illegible labels
- [ ] Confusing layout
- [ ] Missing region names
- [ ] Overly literal (not conceptual)

#### If Validation Fails

| Problem | Fix |
|---------|-----|
| Too digital | "Hand-drawn cartography, wobbly coastlines, sketchy terrain features" |
| Labels unreadable | Increase label size, position outside busy areas |
| Confusing layout | Simplify to 3-4 main regions, clearer boundaries |
| No exploration feel | Add discovery elements: paths, landmarks, intriguing edges |
| Not conceptual | Ensure terrain types match concept qualities |

---

## Example Use Cases

### Example 1: "Map of AI Capabilities"
- **Regions:** Language Models (mountains), Vision (forest), Reasoning (plains), Creativity (islands)
- **Landmarks:** GPT-4 (peak), DALL-E (lighthouse), Claude (city)
- **Unexplored:** AGI (distant shore)

### Example 2: "The Productivity Landscape"
- **Regions:** Deep Work (mountains), Shallow Work (plains), Rest (valley)
- **Connections:** Energy rivers flowing between
- **Landmarks:** Flow State (peak), Burnout (swamp)

### Example 3: "Content Marketing Territory"
- **Regions:** SEO (forest), Social (archipelago), Email (river), Paid (mountains)
- **Paths:** Customer journey as road
- **Landmarks:** Viral Post (peak), Conversion (city)

---

## Quick Reference

**The Formula:**
```
1. Define the territory (domain, regions, landmarks)
2. Design map layout (shape, arrangement, hierarchy)
3. Construct prompt with cartographic elements
4. Choose aspect ratio (usually 1:1)
5. Generate image (add --thinking high for complex layouts)
6. Validate geographic metaphor and readability
```

**Terrain Metaphor Guide:**
```
Concept Quality → Terrain Type
├─ Challenging/Important → Mountains
├─ Established/Foundational → Plains
├─ Complex/Dense → Forests
├─ Flowing/Connecting → Rivers
├─ Isolated/Specialized → Islands
└─ Unknown/Future → Ocean edges
```

---

**The workflow: Define → Design → Construct → Generate → Validate → Complete**
