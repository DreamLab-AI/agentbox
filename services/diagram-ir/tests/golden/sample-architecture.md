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
| mobile | Mobile App | rect | 1 | edgeGroup | 0/1 | 60,140 120×40 |
| coreGroup | Core Services | swimlane | 0 | 1 | 0/0 | 320,40 240×200 |
| gw | API Gateway | rect | 1 | coreGroup | 3/3 | 340,80 120×40 |
| auth | Auth Service | ellipse | 1 | coreGroup | 1/1 | 340,140 120×40 |
| decide | Token valid? | rhombus | 1 | coreGroup | 1/1 | 340,190 120×40 |
| pg | Postgres | cylinder | 0 | 1 | 2/0 | 620,60 80×60 |
| s3 | Object Store | icon:aws | 0 | 1 | 1/0 | 620,160 80×60 |
| note1 | Legacy path, to be retired | note | 0 | 1 | 0/0 | 620,260 120×60 |
| floating | just a caption | text | 0 | 1 | 0/0 | 40,300 100×20 |
| linked | Docs portal | rect | 0 | 1 | 0/0 | 40,360 120×40 |

### Edges

| source | target | label | style |
|---|---|---|---|
| Web App | API Gateway | - | - |
| Mobile App | API Gateway | login / via ⏎ TLS | - |
| API Gateway | Token valid? | - | dashed undirected |
| Token valid? | Auth Service | - | bidir |
| API Gateway | Postgres | - | - |
| API Gateway | Object Store | - | - |
| Auth Service | API Gateway | - | - |
| ? | Postgres | - | - |
