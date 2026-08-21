# Integration with Existing Skills

## QGIS (`/qgis`)

Use QGIS MCP tools for advanced geospatial analysis before generation:
- Load a DEM layer and clip it to the target bounding box
- Analyse building density to estimate generation time
- Extract custom vector layers (e.g. only residential buildings) as GeoJSON,
  then convert to OSM format with ogr2ogr before feeding to arnis
- Visualise the area on a map to verify the bounding box covers the intended region

## Blender (`/blender`)

Preview terrain in 3D before committing to Minecraft generation:
- Import the elevation GeoTIFF as a displacement map on a plane
- Visualise building footprints as extruded polygons
- After generation, import the Minecraft world into Blender with a
  voxel importer for rendering or further editing

## ImageMagick (`/imagemagick`)

Process elevation heightmaps and raster data:
- Resize terrain tiles to match arnis expected dimensions
- Convert between raster formats (PNG, TIFF, BMP)
- Apply contrast adjustments to heightmaps for flatter or more dramatic terrain
- Composite multiple elevation tiles into a single image

## perplexity-research (`/perplexity-research`)

Research real-world locations to find interesting areas:
- Look up notable landmarks and their coordinates
- Find the geographic extent of a campus, park, or district
- Research architectural styles for a region to verify LLM enrichment accuracy
- Discover lesser-known locations that would make interesting Minecraft worlds

## game-dev (`/game-dev`)

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
