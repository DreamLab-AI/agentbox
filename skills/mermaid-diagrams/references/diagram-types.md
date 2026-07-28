# Supported Diagram Types (25)

Pick the diagram type from the keyword that starts the `.mmd` file.

## Core Diagrams

| Type | Keyword | Best For |
|------|---------|----------|
| **Flowchart** | `flowchart TD/LR` | Process flows, decision trees, system architecture |
| **Sequence** | `sequenceDiagram` | API calls, message passing, protocol flows |
| **Class** | `classDiagram` | Object-oriented design, data models |
| **State** | `stateDiagram-v2` | State machines, lifecycle management |
| **ER** | `erDiagram` | Database schema, data relationships |

## Planning & Management

| Type | Keyword | Best For |
|------|---------|----------|
| **Gantt** | `gantt` | Project timelines, sprint planning |
| **Journey** | `journey` | User experience mapping, customer journeys |
| **Timeline** | `timeline` | Historical events, roadmaps, milestones |
| **Kanban** | `kanban` | Task boards, workflow status |
| **Requirement** | `requirementDiagram` | Requirements traceability |

## Architecture & Systems

| Type | Keyword | Best For |
|------|---------|----------|
| **Architecture** | `architecture-beta` | Infrastructure layouts, cloud architecture |
| **C4 Context** | `C4Context` | System context, container, component views |
| **Block** | `block-beta` | Block diagrams, system decomposition |
| **Mindmap** | `mindmap` | Brainstorming, knowledge maps, topic hierarchies |

## Data & Metrics

| Type | Keyword | Best For |
|------|---------|----------|
| **Pie** | `pie` | Proportional data, budget allocation |
| **XY Chart** | `xychart-beta` | Line/bar charts from data |
| **Sankey** | `sankey-beta` | Flow quantities, resource distribution |
| **Quadrant** | `quadrantChart` | Priority matrices, competitive analysis |
| **Radar** | `radar-beta` | Multi-dimensional comparison |

## Development

| Type | Keyword | Best For |
|------|---------|----------|
| **GitGraph** | `gitGraph` | Branch strategies, release flows |
| **Packet** | `packet-beta` | Network packet structure |
| **ZenUML** | `zenuml` | UML sequence (alternative syntax) |

## Strategy

| Type | Keyword | Best For |
|------|---------|----------|
| **Wardley** | `wardley-beta` | Value-chain + evolution maps (Simon Wardley). Requires mmdc 11.14.0+; 11.15.0 needed for hyphenated names and de-sanitised labels. See the `wardley-maps` skill for input-to-map orchestration. |

### Wardley quick example

```mermaid
wardley-beta
title Example -- AI assistant
size [900, 600]
evolution genesis / concept -> custom / emerging -> product / converging -> commodity / accepted

anchor user [0.95, 0.40]

component "Chat UI" [0.85, 0.40] label [10, -8]
component "LLM API" [0.55, 0.40] label [10, -8]
component "GPU cluster" [0.20, 0.40] label [10, -8]

user -> "Chat UI"
"Chat UI" -> "LLM API"
"LLM API" -> "GPU cluster"

evolve "LLM API" 0.80
```

Render:

```bash
mmdc-sidecar.sh -i wardley.mmd -o wardley.svg
```
</content>
</invoke>
