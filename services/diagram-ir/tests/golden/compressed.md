# draw.io IR — compressed\.drawio

1 page(s): [0] Compressed (3n/3e)

## Page 0 — Compressed

- source canvas: 460×60 px (aspect 7.67)
- nodes: 3 total / 3 drawable / 0 containers, depth 0
- edges: 3 (1 labeled, 0 dangling), cycle: True
- shapes: {'rect': 1, 'ellipse': 1, 'cylinder': 1}
- type candidates: architecture
- budget: nodes ok (max 9), edges ok (max 12)
- hubs (focal candidates): Ingress(2), Service &amp; Queue(2), Store(2)

### Nodes

| id | label | shape | depth | parent | deg | box |
|---|---|---|---|---|---|---|
| a | Ingress | rect | 0 | 1 | 1/1 | 10,20 120×40 |
| b | Service &amp; Queue | ellipse | 0 | 1 | 1/1 | 200,20 120×40 |
| c | Store | cylinder | 0 | 1 | 1/1 | 390,20 80×60 |

### Edges

| source | target | label | style |
|---|---|---|---|
| Ingress | Service &amp; Queue | enqueue | - |
| Service &amp; Queue | Store | - | - |
| Store | Ingress | - | - |
