# Mermaid IR — sample-er.mmd

1 diagram(s): [0] erDiagram (4n/3e)

## Diagram 0 — erDiagram

- source layout: none (Mermaid is layout-free); direction: LR
- nodes: 4 total / 4 drawable / 0 containers, depth 0
- edges: 3 (3 labeled, 0 dangling), cycle: False
- shapes: {'table': 4}
- type candidates: ER / data model
- budget: nodes ok (max 9), edges ok (max 12)
- hubs (focal candidates): ORDER(2), CUSTOMER(2), LINE\_ITEM(1), DELIVERY\_ADDRESS(1)
- entry points: CUSTOMER
- terminals: LINE\_ITEM, DELIVERY\_ADDRESS

### Nodes

| id | label | shape | depth | parent | deg | fields |
|---|---|---|---|---|---|---|
| CUSTOMER | CUSTOMER | table | 0 | - | 0/2 | string name; string custNumber PK; int age |
| ORDER | ORDER | table | 0 | - | 1/1 | int orderNumber; string deliveryAddress |
| LINE\_ITEM | LINE\_ITEM | table | 0 | - | 1/0 | - |
| DELIVERY\_ADDRESS | DELIVERY\_ADDRESS | table | 0 | - | 1/0 | - |

### Edges

| source | target | label | style |
|---|---|---|---|
| CUSTOMER | ORDER | \|\| \-\- o\{ · places | solid cardinality undirected |
| ORDER | LINE\_ITEM | \|\| \-\- \|\{ · contains | solid cardinality undirected |
| CUSTOMER | DELIVERY\_ADDRESS | \}\| \.\. \|\{ · uses | dashed cardinality undirected |
