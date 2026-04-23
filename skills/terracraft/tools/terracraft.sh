#!/usr/bin/env bash
# TerraCraft - Generate Minecraft worlds from real-world locations
# Agent-driven headless pipeline. No UI required.
set -euo pipefail

ARNIS_BIN="${ARNIS_BIN:-/usr/local/bin/arnis}"
OUTPUT_BASE="${TERRACRAFT_OUTPUT:-/tmp/terracraft-worlds}"
# Resolve through symlinks to find the actual skill directory
SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
PIPELINE_DIR="$(cd "$(dirname "$SCRIPT_PATH")/../pipeline" 2>/dev/null && pwd || echo "/home/devuser/.claude/skills/terracraft/pipeline")"

usage() {
    cat <<'EOF'
Usage: terracraft <command> [options]

Commands:
  generate <lat1,lng1,lat2,lng2> [options]  Generate a Minecraft world
  geocode <place-name>                       Look up coordinates for a location
  osm-fetch <lat1,lng1,lat2,lng2> <output>  Fetch OSM data only
  elevation <lat1,lng1,lat2,lng2> <output>  Fetch elevation data only
  info                                       Show tool versions and status

Options for generate:
  --scale <1|2|4|10>     Block scale (default: 1)
  --ground <int>         Minecraft Y ground level (default: -10)
  --output <dir>         Output directory
  --enrich               Enable LLM building enrichment (uses Z.AI)
  --spawn <lat,lng>      Set spawn point coordinates

Examples:
  terracraft generate 40.756,-73.988,40.760,-73.983  # Times Square
  terracraft generate 51.500,-0.127,51.504,-0.120    # Westminster
  terracraft geocode "Eiffel Tower, Paris"
EOF
}

cmd_info() {
    echo "=== TerraCraft Status ==="
    if command -v "$ARNIS_BIN" &>/dev/null; then
        echo "[INSTALLED] arnis Minecraft world generator"
    else
        echo "[NOT INSTALLED] arnis - build with: cd /tmp && git clone https://github.com/louis-e/arnis.git && cd arnis && cargo build --release"
    fi
    if command -v gdalinfo &>/dev/null; then
        echo "[INSTALLED] GDAL $(gdalinfo --version 2>&1 | head -1)"
    else
        echo "[NOT INSTALLED] GDAL"
    fi
    command -v ogr2ogr &>/dev/null && echo "[INSTALLED] ogr2ogr (vector conversion)"
    command -v zip &>/dev/null && echo "[INSTALLED] zip (packaging)"
    if command -v node &>/dev/null; then
        echo "[INSTALLED] Node.js $(node --version)"
    else
        echo "[NOT INSTALLED] Node.js"
    fi
    echo "Output directory: ${OUTPUT_BASE}"
    echo "Pipeline directory: ${PIPELINE_DIR}"
}

cmd_geocode() {
    local place="$1"
    echo "Geocoding: ${place}"
    # Use Nominatim for geocoding
    local encoded
    encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$place'))")
    local result
    result=$(curl -sS "https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1" \
        -H "User-Agent: terracraft-skill/1.0")

    local lat lng name
    lat=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['lat'] if d else 'NOT_FOUND')")
    lng=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['lon'] if d else 'NOT_FOUND')")
    name=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('display_name','') if d else '')")

    if [[ "$lat" == "NOT_FOUND" ]]; then
        echo "ERROR: Location not found: ${place}"
        return 1
    fi

    # Generate a reasonable bounding box (~500m around centre)
    local offset="0.003"
    local min_lat max_lat min_lng max_lng
    min_lat=$(python3 -c "print(float('$lat') - $offset)")
    max_lat=$(python3 -c "print(float('$lat') + $offset)")
    min_lng=$(python3 -c "print(float('$lng') - $offset)")
    max_lng=$(python3 -c "print(float('$lng') + $offset)")

    echo "Location: ${name}"
    echo "Centre: ${lat}, ${lng}"
    echo "Bounding box: ${min_lat},${min_lng},${max_lat},${max_lng}"
    echo ""
    echo "To generate: terracraft generate ${min_lat},${min_lng},${max_lat},${max_lng}"
}

cmd_osm_fetch() {
    local bbox="$1"
    local output="${2:-/tmp/osm_data.json}"
    local lat1 lng1 lat2 lng2
    IFS=',' read -r lat1 lng1 lat2 lng2 <<< "$bbox"
    local output_dir
    output_dir="$(dirname "$output")"
    echo "Fetching OSM data for bbox: ${bbox}"
    node -e "
      const {fetchOsmData} = require('${PIPELINE_DIR}/osm.js');
      fetchOsmData($lat1, $lng1, $lat2, $lng2, '${output_dir}', console.log)
        .then(r => console.log('Done:', JSON.stringify(r)))
        .catch(e => { console.error(e.message); process.exit(1); });
    "
}

cmd_generate() {
    local bbox="$1"
    shift

    local scale=1
    local ground=-10
    local output_dir=""
    local enrich=false
    local spawn_lat=""
    local spawn_lng=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --scale) scale="$2"; shift 2 ;;
            --ground) ground="$2"; shift 2 ;;
            --output) output_dir="$2"; shift 2 ;;
            --enrich) enrich=true; shift ;;
            --spawn) IFS=',' read -r spawn_lat spawn_lng <<< "$2"; shift 2 ;;
            *) echo "Unknown option: $1"; exit 1 ;;
        esac
    done

    local lat1 lng1 lat2 lng2
    IFS=',' read -r lat1 lng1 lat2 lng2 <<< "$bbox"

    if [[ -z "$output_dir" ]]; then
        output_dir="${OUTPUT_BASE}/$(date +%Y%m%d-%H%M%S)"
    fi
    mkdir -p "$output_dir"

    echo "=== TerraCraft World Generation ==="
    echo "Bounding box: ${bbox}"
    echo "Scale: ${scale}:1"
    echo "Ground level: ${ground}"
    echo "Output: ${output_dir}"
    echo ""

    # Step 1: Fetch OSM data
    echo "[1/4] Fetching OpenStreetMap data..."
    node -e "
      const {fetchOsmData} = require('${PIPELINE_DIR}/osm.js');
      fetchOsmData($lat1, $lng1, $lat2, $lng2, '$output_dir', console.log)
        .then(r => console.log(JSON.stringify(r)))
        .catch(e => { console.error(e.message); process.exit(1); });
    "

    # Step 2: Elevation (arnis handles this internally)
    echo "[2/4] Elevation data will be fetched by arnis (AWS Terrarium)..."

    # Step 3: LLM enrichment (optional)
    if [[ "$enrich" == "true" ]]; then
        echo "[3/4] Enriching buildings with Z.AI..."
        node -e "
          const {enrichBuildings} = require('${PIPELINE_DIR}/enrich.js');
          enrichBuildings('${output_dir}/osm_data.json', [$lat1,$lng1,$lat2,$lng2],
            {llmKey: 'zai-internal', llmProvider: 'zai'}, console.log)
            .then(r => console.log(JSON.stringify(r)))
            .catch(e => console.error('Enrichment skipped:', e.message));
        "
    else
        echo "[3/4] Skipping LLM enrichment (use --enrich to enable)"
    fi

    # Step 4: Generate Minecraft world
    echo "[4/4] Generating Minecraft world with arnis..."
    local arnis_args="--bbox ${bbox} --file ${output_dir}/osm_data.json --output-dir ${output_dir} --scale ${scale} --ground-level ${ground} --terrain --fillground --city-boundaries=false"

    if [[ -n "$spawn_lat" ]] && [[ -n "$spawn_lng" ]]; then
        arnis_args="$arnis_args --spawn-lat $spawn_lat --spawn-lng $spawn_lng"
    fi

    if ! command -v "$ARNIS_BIN" &>/dev/null; then
        echo "ERROR: arnis binary not found at ${ARNIS_BIN}"
        echo "Build it with: cd /tmp && git clone https://github.com/louis-e/arnis.git && cd arnis && cargo build --release && cp target/release/arnis /usr/local/bin/"
        echo ""
        echo "OSM data has been saved to: ${output_dir}/osm_data.json"
        echo "You can run arnis manually once installed."
        exit 1
    fi

    $ARNIS_BIN $arnis_args 2>&1

    # Package
    echo ""
    echo "=== Generation Complete ==="
    echo "World directory: ${output_dir}"

    # Find the generated world
    local world_dir
    world_dir=$(find "${output_dir}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    if [[ -n "$world_dir" ]]; then
        echo "Minecraft world: ${world_dir}"
        echo ""
        echo "To use:"
        echo "  1. zip -r world.zip ${world_dir}"
        echo "  2. Copy to Minecraft saves/ folder"
    fi
}

case "${1:-}" in
    generate)    cmd_generate "${2:?Bounding box required (lat1,lng1,lat2,lng2)}" "${@:3}" ;;
    geocode)     cmd_geocode "${2:?Place name required}" ;;
    osm-fetch)   cmd_osm_fetch "${2:?Bounding box required}" "${3:-}" ;;
    elevation)   echo "Elevation is handled by arnis internally. For custom GeoTIFF, use GDAL: gdalwarp -te lng1 lat1 lng2 lat2 input.tif output.tif" ;;
    info)        cmd_info ;;
    *)           usage; exit 1 ;;
esac
