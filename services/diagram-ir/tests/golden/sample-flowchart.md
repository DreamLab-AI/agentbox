# Mermaid IR — sample-flowchart.mmd

1 diagram(s): [0] flowchart (10n/8e)

## Diagram 0 — flowchart

- source layout: none (Mermaid is layout-free); direction: LR
- nodes: 10 total / 8 drawable / 2 containers, depth 1
- edges: 8 (3 labeled, 0 dangling), cycle: True
- shapes: {'container': 2, 'cylinder': 2, 'rect': 2, 'asymmetric': 1, 'hexagon': 1, 'rhombus': 1, 'stadium': 1}
- type candidates: flowchart, architecture
- budget: nodes ok (max 9), edges ok (max 12)
- discarded: 2 style directives, 1 click handlers
- hubs (focal candidates): API Gateway(7), Token valid?(3), Auth(2), Web App(1), Mobile App(1)
- entry points: Web App, Mobile App
- terminals: Postgres, Redis
- unconnected: Legacy note — unconnected
- collapsible groups (simplify here first):
  - Core Services — 3 children: API Gateway, Auth, Token valid?
  - Edge — 2 children: Web App, Mobile App

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| Edge | Edge | container | 0 | - | 0/0 | - |
| Web | Web App | rect | 1 | Edge | 0/1 | - |
| Mobile | Mobile App | rect | 1 | Edge | 0/1 | - |
| subgraph\-2 | Core Services | container | 0 | - | 0/0 | - |
| GW | API Gateway | hexagon | 1 | subgraph-2 | 4/3 | - |
| Auth | Auth | stadium | 1 | subgraph-2 | 1/1 | - |
| Decide | Token valid? | rhombus | 1 | subgraph-2 | 1/2 | - |
| DB | Postgres | cylinder | 0 | - | 1/0 | - |
| Cache | Redis | cylinder | 0 | - | 1/0 | - |
| Legacy | Legacy note — unconnected | asymmetric | 0 | - | 0/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| Web App | API Gateway | - | solid arrow |
| Mobile App | API Gateway | - | solid arrow |
| API Gateway | Token valid? | - | solid arrow |
| Token valid? | Auth | yes | solid arrow |
| Token valid? | API Gateway | no | solid arrow |
| Auth | API Gateway | retry | dashed arrow |
| API Gateway | Postgres | - | thick arrow |
| API Gateway | Redis | - | thick arrow |
