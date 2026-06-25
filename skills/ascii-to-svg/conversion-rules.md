# SVG Conversion Rules

## Style: Minimal (Default)

Conservative, clean appearance suitable for any documentation.

### Color Palette
```
Background:    transparent
Box fill:      #f8f9fa (very light gray)
Box stroke:    #333333 (dark gray)
Text:          #1a1a1a (near black)
Arrows/lines:  #555555 (medium gray)
Accent:        #4a90d9 (muted blue, use sparingly)
```

### Typography
```
Font family:   system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
Font size:     14px (primary labels)
               12px (secondary/annotations)
Font weight:   500 (primary labels)
               400 (secondary text)
Text anchor:   middle (centered in boxes)
```

### Box Dimensions
```
Padding:       16px horizontal, 10px vertical
Corner radius: 4px
Stroke width:  1.5px
Min width:     80px
Min height:    36px
```

### Spacing
```
Horizontal gap between elements: 60px
Vertical gap between elements:   50px
Diagram padding (all sides):     24px
```

### Arrows
```
Stroke width:  1.5px
Head size:     8px width, 6px height
Style:         Simple triangle, filled
```

### Effects
None. No gradients, shadows, or filters in minimal style.

---

## Style: Blueprint (Optional)

Technical drawing aesthetic.

### Color Palette
```
Background:    #1a365d (dark blue)
Grid:          #2a4a7a (lighter blue), 1px stroke, 20px spacing
Box fill:      transparent
Box stroke:    #ffffff (white), 1.5px
Text:          #ffffff
Arrows:        #63b3ed (light blue)
```

### Additional Elements
- Background grid pattern
- Slightly rounded corners (2px)
- Dashed lines for optional connections

---

## Style: Dark-Mode-Aware (Optional)

Adapts to user's system preference.

### Implementation
```xml
<defs>
  <style>
    .box { fill: #f8f9fa; stroke: #333333; }
    .label { fill: #1a1a1a; }
    .arrow { stroke: #555555; }
    
    @media (prefers-color-scheme: dark) {
      .box { fill: #2d333b; stroke: #768390; }
      .label { fill: #e6edf3; }
      .arrow { stroke: #768390; }
    }
  </style>
</defs>
```

---

## SVG Structure Template

```xml
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="0 0 {WIDTH} {HEIGHT}"
     width="{WIDTH}" 
     height="{HEIGHT}">
  
  <defs>
    <!-- Arrow marker -->
    <marker id="arrowhead" 
            markerWidth="8" 
            markerHeight="6" 
            refX="8" 
            refY="3" 
            orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#555555"/>
    </marker>
    
    <!-- Styles (if using classes) -->
    <style>
      .box { fill: #f8f9fa; stroke: #333333; stroke-width: 1.5px; }
      .label { font-family: system-ui, sans-serif; font-size: 14px; fill: #1a1a1a; }
      .arrow { stroke: #555555; stroke-width: 1.5px; }
    </style>
  </defs>
  
  <!-- Diagram elements here -->
  
</svg>
```

---

## Element Templates

### Rectangle Box
```xml
<g class="node">
  <rect class="box" 
        x="{X}" y="{Y}" 
        width="{W}" height="{H}" 
        rx="4"/>
  <text class="label" 
        x="{CENTER_X}" y="{CENTER_Y}" 
        text-anchor="middle" 
        dominant-baseline="middle">{LABEL}</text>
</g>
```

### Diamond (Decision)
```xml
<g class="node decision">
  <polygon class="box" 
           points="{CX},{TOP} {RIGHT},{CY} {CX},{BOTTOM} {LEFT},{CY}"/>
  <text class="label" 
        x="{CX}" y="{CY}" 
        text-anchor="middle" 
        dominant-baseline="middle">{LABEL}</text>
</g>
```

### Cylinder (Database)
```xml
<g class="node database">
  <path class="box" d="
    M {X} {Y+RY}
    A {RX} {RY} 0 0 1 {X+W} {Y+RY}
    L {X+W} {Y+H-RY}
    A {RX} {RY} 0 0 1 {X} {Y+H-RY}
    Z
  "/>
  <ellipse class="box" cx="{CX}" cy="{Y+RY}" rx="{RX}" ry="{RY}"/>
  <text class="label" x="{CX}" y="{CY}" text-anchor="middle" 
        dominant-baseline="middle">{LABEL}</text>
</g>
```

### Horizontal Arrow
```xml
<line class="arrow" 
      x1="{X1}" y1="{Y1}" 
      x2="{X2}" y2="{Y2}" 
      marker-end="url(#arrowhead)"/>
```

### Labeled Arrow
```xml
<g class="connection">
  <line class="arrow" x1="{X1}" y1="{Y1}" x2="{X2}" y2="{Y2}" 
        marker-end="url(#arrowhead)"/>
  <text class="label annotation" x="{MID_X}" y="{MID_Y - 8}" 
        text-anchor="middle" font-size="12">{LABEL}</text>
</g>
```

### Bidirectional Arrow
```xml
<line class="arrow" 
      x1="{X1}" y1="{Y1}" 
      x2="{X2}" y2="{Y2}" 
      marker-start="url(#arrowhead-reverse)"
      marker-end="url(#arrowhead)"/>
```

---

## Conversion Process

### Step 1: Parse ASCII Structure

Map the ASCII art to a grid:
- Each character = 1 cell
- Identify box boundaries (corner characters)
- Identify text content (characters inside boxes)
- Identify connections (arrow characters between boxes)

### Step 2: Extract Elements

For each detected box:
```
{
  type: "box" | "diamond" | "cylinder",
  label: "extracted text",
  gridPosition: { row, col, width, height },
  connections: [{ to: elementId, direction: "right" | "down" | ... }]
}
```

### Step 3: Calculate Pixel Positions

Scale factors:
```
CHAR_WIDTH  = 10px   (horizontal scale)
CHAR_HEIGHT = 20px   (vertical scale)
PADDING     = 24px   (diagram margin)
```

Element position:
```
x = (gridCol * CHAR_WIDTH) + PADDING
y = (gridRow * CHAR_HEIGHT) + PADDING
width = gridWidth * CHAR_WIDTH
height = gridHeight * CHAR_HEIGHT
```

### Step 4: Adjust for Aesthetics

- Ensure minimum box dimensions
- Center text within boxes
- Align arrows to box edges (not centers)
- Add appropriate gaps between elements

### Step 5: Generate SVG

1. Calculate total viewBox dimensions
2. Create defs (markers, styles)
3. Render elements in order: boxes first, then arrows
4. Set width/height attributes to match viewBox

### Step 6: Validate

```bash
xmllint --noout output.svg
```

If validation fails:
- Check for unescaped entities in text
- Verify all tags are closed
- Ensure attribute values are quoted

---

## Entity Escaping Reference

Always escape these in text content:

| Character | Entity | Example |
|-----------|--------|---------|
| `&` | `&amp;` | `R&D` → `R&amp;D` |
| `<` | `&lt;` | `<init>` → `&lt;init&gt;` |
| `>` | `&gt;` | `->` in text → `-&gt;` |
| `"` | `&quot;` | Only in attributes |

---

## Quality Checklist

Before saving SVG:
- [ ] Root element has `xmlns`, `viewBox`, `width`, `height`
- [ ] All text content is entity-escaped
- [ ] Passes `xmllint --noout`
- [ ] Text is readable (adequate contrast)
- [ ] Boxes don't overlap
- [ ] Arrows connect logically
- [ ] Sufficient padding around edges


---

## Default visual style — "polished" (v2.2)

The default style is **polished**, a designed look (not flat boxes). Generated
SVGs should use this system unless the user asks for `minimal`, `blueprint`, or
`dark-mode-aware`. No `<style>` blocks — use presentation attributes and unique
per-diagram `id`s so multiple SVGs can be inlined on one page without collisions.

### Color language (encode node *type*, don't just decorate)
| Role | Fill | Stroke / accent | Text |
|---|---|---|---|
| Entry / terminal (Start) | teal gradient `#16A6B1`→`#0E7C86` | none | `#FFFFFF` |
| Process / app node | `#FFFFFF` | `#0E7C86` (2px) | `#0E7C86` |
| Plain node | `#FFFFFF` | `#CFD8E0` (1.5px) | `#14202B` |
| Infrastructure (cache, proxy) | `#EBEFF4` | `#51647A` | `#37475A` |
| Data store (DB) | `#E9ECFA` | `#3B58B8` | `#2B3F8C` |
| Decision (diamond) | `#FAEFD6` | `#B9791A` | `#8A5A12` |
| Reject / error | `#FBE7EC` | `#B14E68` | `#8E3A50` |
| Yes edge / No edge | — | `#2E8B57` / `#B14E68` | matching pill labels |

### Tokens
- **Type:** `Inter, system-ui, sans-serif`; labels 15px/600, sublabels 12.5px/500, container titles 15px/700.
- **Radius:** nodes 13px (pills 28px), containers 18px.
- **Depth:** one soft drop shadow — `feDropShadow dx=0 dy=1.5 stdDeviation=2.4 flood-opacity=0.14`.
- **Connectors:** 2px lines, refined arrowhead marker, neutral `#7C8B99` (or the semantic edge color).
- **Containers (architecture):** rounded panel, tinted header bar (`#F5F9FB`→`#ECF3F5`), title in teal.
- **Sequence:** dashed lifelines (`2 6`), message labels in white rounded pills, request/response colored by participant.
- **Tree:** folder chips with a tab (teal tint), file chips with a corner fold; light elbow connectors.

The `examples/` folder ships reference renders in exactly this style — they are
the canonical "after" and the quality bar for generated output.
