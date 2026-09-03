# Mermaid IR — multiline-label.mmd

1 diagram(s): [0] flowchart (6n/7e)

## Diagram 0 — flowchart

- source layout: none (Mermaid is layout-free); direction: TD
- nodes: 6 total / 6 drawable / 0 containers, depth 0
- edges: 7 (1 labeled, 0 dangling), cycle: False
- shapes: {'rect': 6}
- type candidates: architecture
- budget: nodes ok (max 9), edges ok (max 12)
- hubs (focal candidates): E(4), emph and bold and star(3), D(2), entity &amp; and A and "q"(2), A label · that spans lines(2)
- entry points: A label · that spans lines
- terminals: F

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| A | A label ⏎ that spans lines | rect | 0 | - | 0/2 | - |
| B | emph and bold and star | rect | 0 | - | 1/2 | - |
| C | entity &amp; and A and "q" | rect | 0 | - | 1/1 | - |
| D | D | rect | 0 | - | 1/1 | - |
| E | E | rect | 0 | - | 3/1 | - |
| F | F | rect | 0 | - | 1/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| A label | emph and bold and star | - | solid arrow |
| emph and bold and star | entity &amp; and A and "q" | - | solid arrow |
| entity &amp; and A and "q" | D | piped label | solid arrow |
| A label | E | - | solid arrow |
| emph and bold and star | E | - | solid arrow |
| D | E | - | solid arrow |
| E | F | - | solid arrow |
