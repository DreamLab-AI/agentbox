# Sequence Diagram Conversion Example

## Client-Server-Database Flow

### ASCII Input

```
Client          Server          Database
  │                │                │
  │  1. Request    │                │
  │───────────────>│                │
  │                │  2. Query      │
  │                │───────────────>│
  │                │                │
  │                │  3. Results    │
  │                │<───────────────│
  │  4. Response   │                │
  │<───────────────│                │
  │                │                │
```

### Converted SVG

See: `sequence-client-server.svg`

### Markdown Output

```markdown
![Sequence diagram showing client-server-database communication](assets/diagrams/sequence.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

\`\`\`
Client          Server          Database
  │                │                │
  │  1. Request    │                │
  │───────────────>│                │
  │                │  2. Query      │
  │                │───────────────>│
  │                │                │
  │                │  3. Results    │
  │                │<───────────────│
  │  4. Response   │                │
  │<───────────────│                │
  │                │                │
\`\`\`

</details>
```

## Key Conversion Notes

1. **Participants** are boxes at the top with names
2. **Lifelines** are dashed vertical lines extending downward
3. **Messages** are horizontal arrows with labels above them
4. **Return messages** use reverse arrowhead markers (pointing left)
5. **Numbering** preserved in message labels
6. **Spacing** between messages should be consistent for readability
