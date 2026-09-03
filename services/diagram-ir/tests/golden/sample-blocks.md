# Mermaid IR — sample-blocks.md

2 diagram(s): [0] flowchart (8n/9e), [1] sequenceDiagram (2n/1e)

## Diagram 0 — flowchart

- source layout: none (Mermaid is layout-free); direction: TD
- nodes: 8 total / 8 drawable / 0 containers, depth 0
- edges: 9 (1 labeled, 0 dangling), cycle: False
- shapes: {'circle': 1, 'cylinder': 1, 'hexagon': 1, 'parallelogram': 1, 'round': 1, 'stadium': 1, 'subroutine': 1, 'trapezoid': 1}
- type candidates: architecture
- budget: nodes ok (max 9), edges ok (max 12)
- hubs (focal candidates): Round(3), Start here(3), Hex(2), Trap(2), Lean(2)
- entry points: Start here
- terminals: Hex

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| A | Start here | round | 0 | - | 0/3 | - |
| B | Store | cylinder | 0 | - | 1/1 | - |
| C | Round | circle | 0 | - | 2/1 | - |
| D | Stadium | stadium | 0 | - | 1/1 | - |
| E | Sub | subroutine | 0 | - | 1/1 | - |
| F | Lean | parallelogram | 0 | - | 1/1 | - |
| G | Trap | trapezoid | 0 | - | 1/1 | - |
| H | Hex | hexagon | 0 | - | 2/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| Start here | Store | - | solid arrow |
| Store | Round | - | solid circle |
| Round | Stadium | - | solid arrow undirected |
| Stadium | Sub | - | thick arrow |
| Sub | Lean | - | solid arrow |
| Lean | Trap | - | solid arrow |
| Trap | Hex | - | solid arrow |
| Start here | Hex | - | solid cross bidir |
| Start here | Round | multi word label | solid arrow |

## Diagram 1 — sequenceDiagram

- source layout: none (Mermaid is layout-free); direction: LR
- nodes: 2 total / 2 drawable / 0 containers, depth 0
- edges: 1 (1 labeled, 0 dangling), cycle: False
- shapes: {'lifeline': 2}
- type candidates: sequence
- budget: nodes ok (max 9), edges ok (max 12)
- hubs (focal candidates): Bob(1), Alice(1)
- entry points: Alice
- terminals: Bob

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| Alice | Alice | lifeline | 0 | - | 0/1 | - |
| Bob | Bob | lifeline | 0 | - | 1/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| Alice | Bob | hi | solid arrow |
