# TerraCraft CLI Reference

All commands are accessed via the `terracraft` wrapper script.

## generate

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

## geocode

```bash
terracraft geocode "place name"
```

Looks up coordinates via Nominatim and returns a bounding box (~500m around
the centre). Use this when the user provides a place name instead of coordinates.

## osm-fetch

```bash
terracraft osm-fetch <lat1,lng1,lat2,lng2> [output-file]
```

Fetch OSM data only, without running arnis. Useful for inspection or feeding
into QGIS for analysis before generation.

## elevation

```bash
terracraft elevation <lat1,lng1,lat2,lng2> [output-file]
```

Prints guidance on using GDAL for custom elevation data. Arnis handles
standard elevation internally.

## info

```bash
terracraft info
```

Shows installed tool versions (arnis, GDAL, ogr2ogr, Node.js, zip) and
configuration paths.
