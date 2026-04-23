---
name: architecture-studio
description: >
  AEC (Architecture, Engineering, Construction) studio with 36 skills and 7 specialist agents.
  Single entry point via /studio [task]. Covers site planning, NYC zoning/due diligence,
  workplace programming, sustainability (EPD/GWP), materials research, FF&E schedules,
  specifications (CSI), and presentations. From AlpacaLabsLLC/skills-for-architects.
version: 1.0.0
author: AlpacaLabs LLC
tags:
  - architecture
  - aec
  - zoning
  - sustainability
  - materials
  - construction
  - site-planning
  - epd
  - ffe
---

# Architecture Studio

**36 skills, 7 agents** — AEC (Architecture, Engineering, Construction) intelligence. Single entry point: `/studio [your task]` or call any skill directly.

## When to Use This Skill

- **Site analysis**: environmental, mobility, demographics, history for any address
- **NYC property**: zoning, DOB permits/violations, landmarks, ACRIS, HPD, BSA
- **Workplace programming**: headcount to space program, occupancy calculator
- **Sustainability**: EPD research, GWP comparison, LEED eligibility, embodied carbon
- **Materials research**: product search, spec extraction from PDFs/URLs, alternatives
- **FF&E**: schedules from messy data, room packages, SIF export/import
- **Specifications**: CSI outline specs from materials lists
- **Presentations**: HTML slide decks, colour palettes

## When Not to Use

- For software architecture decisions — use `renaissance-architecture` or `human-architect-mindset`
- For general UI/UX design — use `ui-ux-pro-max-skill` or the bencium designers
- For 3D modelling/rendering — use `blender`
- For geospatial GIS analysis — use `qgis` (complementary for site data)
- For game world generation — use `terracraft`

## Entry Points

### `/studio [task]` — Smart Router (recommended)
Describe your task; the dispatcher routes to the right agent or skill.

```
/studio 123 Main St, Brooklyn NY
/studio I need a space program for 200 people, 3 days hybrid
/studio task chair, mesh back, under $800
/studio parse this EPD
```

### Direct Skill Invocation
Call any skill directly by name — see full list below.

## Agents

| Agent | Role |
|-------|------|
| **Site Planner** | Full site brief — climate, transit, demographics, neighbourhood context |
| **NYC Zoning Expert** | Property + zoning — due diligence, FAR, buildable envelope |
| **Workplace Strategist** | Space programs — headcount to occupancy compliance |
| **Product & Materials Researcher** | Find products from brief, extract specs, find alternatives |
| **FF&E Designer** | Build schedules, compose room packages, QA, export |
| **Sustainability Specialist** | EPD research, GWP comparison, LEED eligibility |
| **Brand Manager** | Presentations, colour palettes, visual consistency |

## Skills by Domain

### Site & Due Diligence (11)
| Skill | Description |
|-------|-------------|
| `environmental-analysis` | Climate, flood, seismic, soil for any address |
| `mobility-analysis` | Transit, walk score, bike, pedestrian access |
| `demographics-analysis` | Population, income, housing, employment |
| `history` | Neighbourhood context, landmarks, commercial activity |
| `nyc-landmarks` | LPC landmark and historic district check |
| `nyc-dob-permits` | DOB permit and filing history |
| `nyc-dob-violations` | DOB and ECB violations |
| `nyc-acris` | Property transaction records |
| `nyc-hpd` | HPD violations and complaints (residential) |
| `nyc-bsa` | BSA variances and special permits |
| `nyc-property-report` | Combined NYC report (all 6 above) |

### Zoning (3)
| Skill | Description |
|-------|-------------|
| `zoning-analysis-nyc` | NYC buildable envelope from PLUTO data |
| `zoning-analysis-uruguay` | Maldonado, Uruguay lot analysis |
| `zoning-envelope` | Interactive 3D zoning envelope viewer |

### Programming (2)
| Skill | Description |
|-------|-------------|
| `occupancy-calculator` | IBC occupancy loads, egress, plumbing |
| `workplace-programmer` | Space programs from headcount and work style |

### Specifications (1)
| Skill | Description |
|-------|-------------|
| `spec-writer` | CSI outline specs from a materials list |

### Sustainability (4)
| Skill | Description |
|-------|-------------|
| `epd-research` | Search for EPDs by material or category |
| `epd-parser` | Extract data from an EPD PDF |
| `epd-compare` | Side-by-side environmental impact comparison |
| `epd-to-spec` | CSI specs with EPD requirements and GWP thresholds |

### Materials Research (11)
| Skill | Description |
|-------|-------------|
| `product-research` | Find products from a design brief |
| `product-spec-bulk-fetch` | Extract specs from product URLs |
| `product-spec-pdf-parser` | Extract specs from PDF catalogues |
| `product-spec-bulk-cleanup` | Normalise a messy FF&E schedule |
| `product-enrich` | Auto-tag products with categories, colours, materials |
| `product-match` | Find similar products |
| `product-pair` | Suggest complementary products |
| `product-image-processor` | Download, resize, remove backgrounds |
| `ffe-schedule` | Format raw product data into a schedule |
| `csv-to-sif` | Convert CSV to dealer format |
| `sif-to-csv` | Convert dealer format to CSV |

### Presentations (2)
| Skill | Description |
|-------|-------------|
| `slide-deck-generator` | HTML slide deck with editorial layout |
| `color-palette-generator` | Colour palettes from descriptions or images |

## Rules (Built-in Quality)

The suite includes 8 professional rules automatically applied:
- CSI formatting for specifications
- Code citations for sources
- Professional disclaimers
- Output formatting standards
- Terminology consistency
- Transparency requirements
- Units and measurements standards

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| `qgis` | GIS data feeds into site analysis |
| `blender` | 3D visualisation of zoning envelopes |
| `report-builder` | LaTeX reports from architecture analysis |
| `wardley-maps` | Strategic mapping of construction technology |
| `perplexity-research` | Web research for site context enrichment |

## Attribution

Skills for Architects by AlpacaLabs LLC. MIT License.
