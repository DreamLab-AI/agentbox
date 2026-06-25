# Architecture Box Conversion Example

## Two-Layer Architecture

### ASCII Input

```
┌─────────────────────────────────────────────┐
│                 Frontend                     │
│  ┌─────────────┐         ┌───────────────┐  │
│  │    React    │         │    Nginx      │  │
│  │     App     │         │   (static)    │  │
│  └─────────────┘         └───────────────┘  │
└─────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│                  Backend                     │
│  ┌─────────────┐         ┌───────────────┐  │
│  │   Node.js   │────────▶│  PostgreSQL   │  │
│  │     API     │         │      DB       │  │
│  └─────────────┘         └───────────────┘  │
└─────────────────────────────────────────────┘
```

### Converted SVG

See: `architecture-two-layer.svg`

### Markdown Output

```markdown
![Application architecture showing frontend and backend layers](assets/diagrams/architecture.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

\`\`\`
┌─────────────────────────────────────────────┐
│                 Frontend                     │
│  ┌─────────────┐         ┌───────────────┐  │
│  │    React    │         │    Nginx      │  │
│  │     App     │         │   (static)    │  │
│  └─────────────┘         └───────────────┘  │
└─────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│                  Backend                     │
│  ┌─────────────┐         ┌───────────────┐  │
│  │   Node.js   │────────▶│  PostgreSQL   │  │
│  │     API     │         │      DB       │  │
│  └─────────────┘         └───────────────┘  │
└─────────────────────────────────────────────┘
\`\`\`

</details>
```

## Key Conversion Notes

1. **Nested boxes** require careful z-ordering (containers first, inner boxes on top)
2. **Container titles** positioned near the top of the container
3. **Unicode box characters** (`┌┐└┘│─`) map directly to rectangle elements
4. **Multi-line labels** use multiple `<text>` elements or `<tspan>`
5. **Layer separation** maintained through vertical spacing and connecting arrows
