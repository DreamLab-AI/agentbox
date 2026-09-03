# Mermaid IR — sample-sequence.mmd

1 diagram(s): [0] sequenceDiagram (3n/14e)

## Diagram 0 — sequenceDiagram

- source layout: none (Mermaid is layout-free); direction: LR
- nodes: 3 total / 3 drawable / 0 containers, depth 0
- edges: 14 (14 labeled, 0 dangling), cycle: True
- shapes: {'lifeline': 2, 'actor': 1}
- type candidates: sequence
- budget: nodes ok (max 9), edges OVER (max 12)
- fragments: alt(is sick), opt(Extra response), loop(Every minute), par(one), critical(connect), break(oops)
- notes: A note with "quotes"
- hubs (focal candidates): Alice Smith(14), Bob(12), C(2)
- terminals: C

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| A | Alice Smith | lifeline | 0 | - | 5/9 | - |
| B | Bob | actor | 0 | - | 7/5 | - |
| C | C | lifeline | 0 | - | 2/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| Alice Smith | Bob | Hello Bob, how are you? | solid arrow |
| Bob | Alice Smith | Fine ⏎ thanks | dashed arrow |
| Alice Smith | C | async ping | solid async |
| Bob | Alice Smith | cancelled | dashed cross |
| Alice Smith | Bob | sync both ways | solid arrow bidir |
| Bob | Alice Smith | Not so good :\( | solid arrow |
| Bob | Alice Smith | Feeling fresh like a daisy | solid arrow |
| Bob | Alice Smith | Thanks for asking | solid arrow |
| Alice Smith | Bob | ping | solid arrow |
| Alice Smith | Bob | p1 | solid arrow |
| Alice Smith | C | p2 | solid arrow |
| Alice Smith | Bob | c | solid arrow |
| Alice Smith | Bob | t | solid arrow |
| Alice Smith | Bob | b | solid arrow |
