# LLM Enrichment & Output Format

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
