# FossFLOW Diagram Formats

Two supported input formats: **compact** (LLM-optimised, token-efficient) and **verbose** (full features — zones, labels, styling).

## 1. Compact Format (LLM-Optimised)

Token-efficient format (70-90% reduction) designed for LLM generation:

```json
{
  "t": "Diagram Title",
  "i": [
    ["Item Name", "icon_name", "Description (max 100 chars)"],
    ["Database", "storage", "PostgreSQL primary server"]
  ],
  "v": [
    [
      [[0, 0, 0], [1, 4, 2]],
      [[0, 1]]
    ]
  ],
  "_": { "f": "compact", "v": "1.0" }
}
```

**Keys:**
- `t`: Title (max 40 chars)
- `i`: Items array - each is `["Name (max 30)", "icon", "Description (max 100)"]`
- `v`: Views - contains `[[positions], [connections]]`
  - Positions: `[itemIndex, x, y]` (indices 0 to n-1)
  - Connections: `[fromIndex, toIndex]`
- `_`: Metadata - **MUST be exactly** `{"f": "compact", "v": "1.0"}`

## 2. Verbose Format (Full Features)

Full-featured format with zones, labels, and styling:

```json
{
  "title": "Diagram Title",
  "description": "Optional description",
  "fitToScreen": true,
  "items": [
    {
      "id": "server1",
      "name": "Web Server",
      "description": "Nginx proxy",
      "icon": "server",
      "position": { "x": 0, "y": 0 }
    }
  ],
  "connectors": [
    {
      "id": "c1",
      "from": "server1",
      "to": "database",
      "color": "blue",
      "showArrow": true,
      "style": "SOLID",
      "width": 1,
      "labels": [
        { "id": "l1", "text": "TCP/5432", "position": 50 }
      ]
    }
  ],
  "colors": [
    { "id": "blue", "value": "#4A90D9" }
  ],
  "rectangles": [
    { "id": "zone1", "from": { "x": -1, "y": -1 }, "to": { "x": 5, "y": 3 }, "color": "blue" }
  ],
  "textBoxes": [
    { "id": "t1", "text": "Zone Label", "position": { "x": 2, "y": -2 } }
  ],
  "icons": []
}
```

## Connector Properties (Verbose)

| Property | Values |
|----------|--------|
| `style` | `SOLID` (default), `DASHED`, `DOTTED` |
| `showArrow` | `true`, `false` |
| `width` | 1-5 |
| `color` | Reference to color ID |
| `labels` | Array: `[{ id, text, position: 0-100 }]` |

## Positioning System

- Grid-based coordinates (x, y)
- Range: typically -20 to +20
- Spacing: 3-5 units between items
- X: horizontal (negative=left, positive=right)
- Y: vertical (negative=up, positive=down)

## Standard Color Palette

```json
"colors": [
  { "id": "blue", "value": "#4A90D9" },
  { "id": "green", "value": "#7CB342" },
  { "id": "orange", "value": "#FF9800" },
  { "id": "red", "value": "#E53935" },
  { "id": "purple", "value": "#9C27B0" },
  { "id": "teal", "value": "#00ACC1" },
  { "id": "gray", "value": "#78909C" },
  { "id": "cyan", "value": "#26C6DA" }
]
```
