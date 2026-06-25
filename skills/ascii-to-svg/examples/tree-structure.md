# Tree Structure Conversion Example

## Project Directory Tree

### ASCII Input

```
project/
├── src/
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── Modal.tsx
│   ├── utils/
│   │   └── helpers.ts
│   └── index.ts
├── tests/
│   └── Button.test.tsx
├── package.json
└── README.md
```

### Converted SVG

See: `tree-project.svg`

### Markdown Output

```markdown
![Project directory structure](assets/diagrams/tree-structure.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

\`\`\`
project/
├── src/
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── Modal.tsx
│   ├── utils/
│   │   └── helpers.ts
│   └── index.ts
├── tests/
│   └── Button.test.tsx
├── package.json
└── README.md
\`\`\`

</details>
```

## Key Conversion Notes

1. **Tree characters** (`├`, `└`, `│`, `─`) become SVG line elements
2. **Folders** get a folder icon (small rectangle with tab)
3. **Files** get a file icon (small rectangle)
4. **Indentation** determines x-position of each element
5. **Branch lines** connect parent to children with proper corners
6. **Last item** in a group uses `└` (corner) instead of `├` (tee)
