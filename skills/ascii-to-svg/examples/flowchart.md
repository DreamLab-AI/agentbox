# Flowchart Conversion Example

## Simple Flowchart

### ASCII Input

```
+--------+     +----------+     +---------+
| Start  | --> | Process  | --> |   End   |
+--------+     +----------+     +---------+
```

### Converted SVG

See: `flowchart-simple.svg`

### Markdown Output

```markdown
![Simple flowchart showing Start to Process to End](assets/diagrams/flowchart-simple.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

\`\`\`
+--------+     +----------+     +---------+
| Start  | --> | Process  | --> |   End   |
+--------+     +----------+     +---------+
\`\`\`

</details>
```

---

## Decision Flowchart

### ASCII Input

```
              +-------+
              | Start |
              +-------+
                  |
                  v
            +-----------+
            | Validate? |
            +-----------+
             /         \
           Yes          No
           /             \
          v               v
    +---------+     +---------+
    | Process |     | Reject  |
    +---------+     +---------+
          |               |
          v               v
      +-------+       +-------+
      |  End  |       |  End  |
      +-------+       +-------+
```

### Converted SVG

See: `flowchart-decision.svg`

### Markdown Output

```markdown
![Decision flowchart with validation branch](assets/diagrams/flowchart-decision.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

\`\`\`
              +-------+
              | Start |
              +-------+
                  |
                  v
            +-----------+
            | Validate? |
            +-----------+
             /         \
           Yes          No
           /             \
          v               v
    +---------+     +---------+
    | Process |     | Reject  |
    +---------+     +---------+
          |               |
          v               v
      +-------+       +-------+
      |  End  |       |  End  |
      +-------+       +-------+
\`\`\`

</details>
```

## Key Conversion Notes

1. **Box corners** (`+`) become rounded rectangle corners (`rx="4"`)
2. **Arrow patterns** (`-->`) become SVG lines with arrowhead markers
3. **Branching** (`/` and `\`) becomes angled lines with labels
4. **Vertical alignment** is preserved through careful coordinate calculation
5. **Text centering** uses `text-anchor="middle"` and `dominant-baseline="middle"`
