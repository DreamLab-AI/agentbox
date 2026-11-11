---
skill: terracraft
name: terracraft
version: 1.0.0
description: "Generates Minecraft Java Edition worlds from real geography: OpenStreetMap buildings, roads, water and elevation converted by the arnis Rust engine. Use for 'make a Minecraft world of <place>', 'OSM to Minecraft', arnis, geocoding a place to a bounding box, or educational voxel worlds from real coordinates. Not for fictional worlds (game-dev), other game engines, or live GIS analysis (qgis)."
tags:
  - minecraft
  - geospatial
  - terrain-generation
  - openstreetmap
  - elevation
  - world-building
  - game-assets
  - procedural-generation
mcp_server: false
compatibility:
  - gdal >= 3.0
  - rust >= 1.70
dependencies:
  - gdal
  - rust
  - nodejs
  - zip
author: dreamlab-AI (ported by agentbox)
---

# TerraCraft

Agent-driven Minecraft world generation from real-world geography. No frontend,
no web server -- agents specify locations in natural language and the pipeline
runs headlessly, producing Minecraft Java Edition region files.

## Overview

TerraCraft converts real-world geographic data into playable Minecraft worlds.
The pipeline fetches OpenStreetMap features (buildings, roads, water, railways,
trees, landuse), retrieves elevation data from AWS Terrarium tiles, optionally
enriches building metadata with an LLM, then feeds everything into the `arnis`
Rust binary which produces Minecraft region files.

## When to Use This Skill

- Creating Minecraft game levels from real places (cities, landmarks, campuses)
- Geospatial visualisation rendered as a walkable Minecraft world
- Educational terrain models -- geography, urban planning, architecture
- Prototyping game environments from real-world data before custom design
- Generating test worlds for Minecraft mod development

## When NOT to Use This Skill

- Pure fictional world building with no geographic basis (use `/game-dev`)
- Non-Minecraft game engines (use Blender or engine-specific tools)
- Tasks unrelated to geospatial-to-game conversion
- Real-time mapping or GIS analysis (use `/qgis` directly)

## Pipeline

The generation pipeline runs in five sequential steps:

1. **OSM Fetch** -- Queries the Overpass API for all buildings, highways,
   waterways, landuse, natural features, railways, barriers, trees, amenities,
   and leisure areas within the bounding box. Saves raw JSON.

2. **Elevation** -- By default, arnis fetches AWS Terrarium PNG tiles internally
   when `--terrain` is set. For advanced use, GDAL can pre-process a GeoTIFF
   DEM which arnis reads via `--elevation-file`.

3. **LLM Enrichment** (optional) -- Sends building summaries to Z.AI in batches
   of 50, adding realistic architectural tags to buildings that lack them.

4. **arnis Generation** -- The Rust binary reads the OSM JSON and elevation
   data, then writes Minecraft region files. Supports configurable block scale,
   ground level, spawn point, terrain fill, and city boundary clipping.

5. **Package** -- The output directory contains a complete Minecraft world
   folder. Zip it and copy to a Minecraft `saves/` directory to play.

## Quick Start

`terracraft` is not on `$PATH`; invoke the skill-relative script directly. The
`arnis` engine and GDAL are baked into the image and on PATH (see
[references/arnis-and-elevation.md](references/arnis-and-elevation.md)).

```bash
tools/terracraft.sh geocode "Edinburgh Castle"          # place name -> bounding box
tools/terracraft.sh generate <lat1,lng1,lat2,lng2> --scale 1 --enrich
```

## References

Load on demand -- deep detail lives here, not in this file:

- [references/cli-reference.md](references/cli-reference.md) -- Full CLI: `generate`, `geocode`, `osm-fetch`, `elevation`, `info` with every option.
- [references/arnis-and-elevation.md](references/arnis-and-elevation.md) -- Building arnis from source, the full flag table, and AWS Terrarium vs GDAL GeoTIFF elevation sources.
- [references/enrichment-and-output.md](references/enrichment-and-output.md) -- Z.AI building enrichment tags/behaviour and the Minecraft world output format plus install steps.
- [references/skill-integration.md](references/skill-integration.md) -- Pairing with QGIS, Blender, ImageMagick, perplexity-research, game-dev, and the recommended end-to-end agent workflow.
