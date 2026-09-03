# Mermaid IR — sample-state.mmd

1 diagram(s): [0] stateDiagram-v2 (12n/9e)

## Diagram 0 — stateDiagram-v2

- source layout: none (Mermaid is layout-free); direction: LR
- nodes: 12 total / 11 drawable / 1 containers, depth 1
- edges: 9 (3 labeled, 0 dangling), cycle: True
- shapes: {'state': 7, 'end': 2, 'start': 2, 'choice': 1}
- type candidates: state machine
- budget: nodes OVER (max 9), edges ok (max 12)
- hubs (focal candidates): Working(4), fork\_state(2), Paused(2), the idle description(2), join\_state(1)
- entry points: \[start\], \[start\]
- terminals: \[end\], join\_state, \[end\]
- unconnected: pick, Lonely
- collapsible groups (simplify here first):
  - Running — 4 children: \[start\], Working, Paused, \[end\]

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| \_\_start\_1 | \[start\] | start | 0 | - | 0/1 | - |
| Idle | the idle description | state | 0 | - | 1/1 | - |
| Running | Running | state | 0 | - | 1/2 | - |
| \_\_start\_2 | \[start\] | start | 1 | Running | 0/1 | - |
| Working | Working | state | 1 | Running | 2/2 | - |
| Paused | Paused | state | 1 | Running | 1/1 | - |
| \_\_end\_1 | \[end\] | end | 1 | Running | 1/0 | - |
| fork\_state | fork\_state | state | 0 | - | 1/1 | - |
| join\_state | join\_state | state | 0 | - | 1/0 | - |
| pick | pick | choice | 0 | - | 0/0 | - |
| \_\_end\_2 | \[end\] | end | 0 | - | 1/0 | - |
| Lonely | Lonely | state | 0 | - | 0/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| \[start\] | the idle description | - | solid arrow |
| the idle description | Running | start | solid arrow |
| \[start\] | Working | - | solid arrow |
| Working | Paused | pause | solid arrow |
| Paused | Working | resume | solid arrow |
| Working | \[end\] | - | solid arrow |
| Running | fork\_state | - | solid arrow |
| fork\_state | join\_state | - | solid arrow |
| Running | \[end\] | - | solid arrow |
