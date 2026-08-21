# arnis Binary & Elevation Sources

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
