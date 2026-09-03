# draw.io IR — sample\-architecture\.drawio

2 page(s): [0] Architecture (12n/8e), [1] Data Model (2n/1e)

## Page 0 — Architecture

- source canvas: 700×360 px (aspect 1.94)
- nodes: 12 total / 11 drawable / 2 containers, depth 1
- edges: 8 (1 labeled, 1 dangling), cycle: True
- shapes: {'rect': 4, 'swimlane': 2, 'ellipse': 1, 'rhombus': 1, 'cylinder': 1, 'aws': 1, 'note': 1, 'text': 1}
- type candidates: swimlane, flowchart, architecture
- budget: nodes OVER (max 9), edges ok (max 12)
- hubs (focal candidates): API Gateway(6), Auth Service(2), Token valid?(2), Postgres(2), Web App · browser(1)
- entry points: Web App · browser, Mobile App
- terminals: Postgres, Object Store
- unconnected: Legacy path, to be retired, just a caption, Docs portal
- collapsible groups (simplify here first):
  - Core Services — 3 children: API Gateway, Auth Service, Token valid?
  - Edge — 2 children: Web App · browser, Mobile App

### Nodes

| id | label | shape | depth | parent | deg | box |
|---|---|---|---|---|---|---|
| edgeGroup | Edge | swimlane | 0 | 1 | 0/0 | 40,40 240×200 |
| web | Web App ⏎ browser | rect | 1 | edgeGroup | 0/1 | 60,80 120×40 |
| … | +10 more (use --json) | | | | | |

### Edges

| source | target | label | style |
|---|---|---|---|
| Web App | API Gateway | - | - |
| Mobile App | API Gateway | login / via ⏎ TLS | - |
| … | +6 more (use --json) | | |
