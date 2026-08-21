---
skill: terracraft
name: terracraft
version: 1.0.0
description: >-
  Generate Minecraft Java Edition worlds from real-world geographic data.
  Converts OpenStreetMap buildings, roads, water, and terrain into playable
  Minecraft worlds using the arnis Rust engine. Integrates with QGIS for
  geospatial analysis, Blender for 3D terrain preview, ImageMagick for
  elevation processing, and perplexity-research for location enrichment.
  Use when converting a real place (city, landmark, campus) into a Minecraft
  world, geocoding a location to a bounding box, fetching OSM features for
  an area, or building test/educational voxel worlds from geography. Triggers:
  "make a Minecraft world of <place>", "OSM to Minecraft", "arnis", "generate
  a voxel world from coordinates". NOT for fictional world-building with no
  geographic basis (use /game-dev), non-Minecraft engines, or live GIS
  analysis (use /qgis directly).
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
author: DreamLab-AI (ported by agentbox)
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

```bash
terracraft geocode "Edinburgh Castle"          # place name -> bounding box
terracraft generate <lat1,lng1,lat2,lng2> --scale 1 --enrich
```

## References

Load on demand -- deep detail lives here, not in this file:

- [references/cli-reference.md](references/cli-reference.md) -- Full CLI: `generate`, `geocode`, `osm-fetch`, `elevation`, `info` with every option.
- [references/arnis-and-elevation.md](references/arnis-and-elevation.md) -- Building arnis from source, the full flag table, and AWS Terrarium vs GDAL GeoTIFF elevation sources.
- [references/enrichment-and-output.md](references/enrichment-and-output.md) -- Z.AI building enrichment tags/behaviour and the Minecraft world output format plus install steps.
- [references/skill-integration.md](references/skill-integration.md) -- Pairing with QGIS, Blender, ImageMagick, perplexity-research, game-dev, and the recommended end-to-end agent workflow.
