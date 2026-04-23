---
skill: terracraft
name: terracraft
version: 1.0.0
description: >-
  Generate Minecraft Java Edition worlds from real-world geographic data.
  Converts OpenStreetMap buildings, roads, water, and terrain into playable
  Minecraft worlds using the arnis Rust engine. Integrates with QGIS for
  advanced geospatial analysis, Blender for 3D terrain preview, ImageMagick
  for elevation processing, and perplexity-research for location enrichment.
  Agent-driven headless pipeline -- no UI required.
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

3. **LLM Enrichment** (optional) -- Sends building summaries to Z.AI (port
   9600) in batches of 50. The LLM adds `building:levels`, `building:material`,
   `roof:shape`, and `roof:material` tags to buildings that lack them. This
   produces more realistic multi-storey structures in the generated world.

4. **arnis Generation** -- The Rust binary reads the OSM JSON and elevation
   data, then writes Minecraft region files. Supports configurable block scale,
   ground level, spawn point, terrain fill, and city boundary clipping.

5. **Package** -- The output directory contains a complete Minecraft world
   folder. Zip it and copy to a Minecraft `saves/` directory to play.

## CLI Commands

All commands are accessed via the `terracraft` wrapper script.

### generate

```bash
terracraft generate <lat1,lng1,lat2,lng2> [options]
```

Full pipeline: OSM fetch, optional enrichment, arnis generation.

Options:
- `--scale <1|2|4|10>` -- Block scale. 1 = one real metre per Minecraft block.
  Higher values increase detail but also world size. Default: 1.
- `--ground <int>` -- Minecraft Y coordinate for ground level. Default: -10.
- `--output <dir>` -- Output directory. Default: `/tmp/terracraft-worlds/<timestamp>`.
- `--enrich` -- Enable LLM building enrichment via Z.AI.
- `--spawn <lat,lng>` -- Set the player spawn point within the bounding box.

### geocode

```bash
terracraft geocode "place name"
```

Looks up coordinates via Nominatim and returns a bounding box (~500m around
the centre). Use this when the user provides a place name instead of coordinates.

### osm-fetch

```bash
terracraft osm-fetch <lat1,lng1,lat2,lng2> [output-file]
```

Fetch OSM data only, without running arnis. Useful for inspection or feeding
into QGIS for analysis before generation.

### elevation

```bash
terracraft elevation <lat1,lng1,lat2,lng2> [output-file]
```

Prints guidance on using GDAL for custom elevation data. Arnis handles
standard elevation internally.

### info

```bash
terracraft info
```

Shows installed tool versions (arnis, GDAL, ogr2ogr, Node.js, zip) and
configuration paths.

## Integration with Existing Skills

### QGIS (`/qgis`)

Use QGIS MCP tools for advanced geospatial analysis before generation:
- Load a DEM layer and clip it to the target bounding box
- Analyse building density to estimate generation time
- Extract custom vector layers (e.g. only residential buildings) as GeoJSON,
  then convert to OSM format with ogr2ogr before feeding to arnis
- Visualise the area on a map to verify the bounding box covers the intended region

### Blender (`/blender`)

Preview terrain in 3D before committing to Minecraft generation:
- Import the elevation GeoTIFF as a displacement map on a plane
- Visualise building footprints as extruded polygons
- After generation, import the Minecraft world into Blender with a
  voxel importer for rendering or further editing

### ImageMagick (`/imagemagick`)

Process elevation heightmaps and raster data:
- Resize terrain tiles to match arnis expected dimensions
- Convert between raster formats (PNG, TIFF, BMP)
- Apply contrast adjustments to heightmaps for flatter or more dramatic terrain
- Composite multiple elevation tiles into a single image

### perplexity-research (`/perplexity-research`)

Research real-world locations to find interesting areas:
- Look up notable landmarks and their coordinates
- Find the geographic extent of a campus, park, or district
- Research architectural styles for a region to verify LLM enrichment accuracy
- Discover lesser-known locations that would make interesting Minecraft worlds

### game-dev (`/game-dev`)

For Minecraft mod development alongside world generation:
- Develop custom block types or structures to place in generated worlds
- Create data packs that complement the generated terrain
- Build resource packs for more realistic textures matching the source location

## Agent Workflow

When a user requests a Minecraft world from a real location, the recommended
agent workflow is:

1. **Parse the request** -- Extract the location name or coordinates from the
   user's natural language input.

2. **Research** (if needed) -- Use `perplexity-research` to find coordinates
   and notable features of the requested area.

3. **Geocode** -- Run `terracraft geocode "<place>"` to get a bounding box.
   Adjust the box size if the user wants a larger or smaller area.

4. **Analyse** (optional) -- Use QGIS to load the area, check building density,
   and verify the bounding box is sensible.

5. **Generate** -- Run `terracraft generate <bbox> --scale 1 --enrich` with
   appropriate options.

6. **Report** -- Tell the user the output location, world size, number of OSM
   elements processed, and how to install the world in Minecraft.

## arnis Binary

The `arnis` Rust binary is the core world generator. It reads OSM JSON and
elevation data, then writes Minecraft Java Edition region files (`.mca` format).

If arnis is not installed, build from source:

```bash
cd /tmp
git clone https://github.com/louis-e/arnis.git
cd arnis
cargo build --release
cp target/release/arnis /usr/local/bin/
```

Set a custom path via the `ARNIS_BIN` environment variable.

### Key arnis flags

| Flag | Description |
|------|-------------|
| `--bbox` | Bounding box as `lat1,lng1,lat2,lng2` |
| `--file` | Path to OSM JSON data |
| `--output-dir` | Where to write the Minecraft world |
| `--scale` | Blocks per real-world metre (1, 2, 4, or 10) |
| `--ground-level` | Minecraft Y coordinate for ground (default: -10) |
| `--terrain` | Enable elevation-based terrain |
| `--fillground` | Fill below ground level with stone |
| `--elevation-file` | Custom GeoTIFF elevation file (overrides AWS Terrarium) |
| `--spawn-lat`, `--spawn-lng` | Player spawn coordinates |
| `--city-boundaries` | Clip to city boundary polygon (default: false) |

## Elevation Sources

### AWS Terrarium (default)

When `--terrain` is set, arnis automatically downloads Terrarium PNG tiles from
AWS. No configuration required. Resolution is approximately 30m per pixel at
most latitudes. Suitable for most urban and suburban areas.

### GeoTIFF via GDAL (advanced)

For higher-resolution elevation or custom DEMs:

```bash
# Clip a large DEM to the target area
gdalwarp -te <lng1> <lat1> <lng2> <lat2> -t_srs EPSG:4326 input.tif clipped.tif

# Pass to arnis
terracraft generate <bbox> --elevation-file clipped.tif
```

GDAL is installed at `/usr/bin/gdalinfo`, `/usr/bin/ogr2ogr`, `/usr/bin/gdalwarp`.

## LLM Enrichment

Building enrichment uses the Z.AI service (port 9600) to add architectural
metadata to OSM buildings that lack detail. The LLM receives building type,
name, amenity, and shop tags along with the geographic region, then returns:

- `building:levels` -- Number of floors (1-50)
- `building:material` -- brick, concrete, wood, stone, metal, glass
- `roof:shape` -- flat, gabled, hipped, pyramidal, dome, mansard, gambrel
- `roof:material` -- tiles, slate, metal, thatch, concrete, asphalt

Buildings are processed in batches of 50. Enrichment failures are non-fatal;
the pipeline continues with original OSM data.

Enable with the `--enrich` flag. Requires Z.AI service running on port 9600.

## Output Format

The generated world is compatible with Minecraft Java Edition 1.18 and later,
including PaperMC servers. The output directory contains:

- `region/` -- Anvil format `.mca` region files
- `level.dat` -- World metadata (game mode, spawn point, version)
- `playerdata/` -- Default player data

To install:
1. Zip the world directory
2. Copy to `~/.minecraft/saves/` (single player) or the server `world/` directory
3. Launch Minecraft and select the world

World size depends on the bounding box area and scale factor. A 500m x 500m
area at scale 1 produces roughly 500 x 500 blocks (about one region file).
