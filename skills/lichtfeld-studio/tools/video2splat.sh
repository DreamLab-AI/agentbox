#!/usr/bin/env bash
# video2splat - Full pipeline: video -> COLMAP -> LichtFeld training
# Usage: video2splat <video_path> <output_dir> [fps] [max_iterations] [strategy]
set -euo pipefail

VIDEO="${1:?Usage: video2splat <video> <output_dir> [fps] [max_iter] [strategy]}"
OUTPUT="${2:?Usage: video2splat <video> <output_dir> [fps] [max_iter] [strategy]}"
FPS="${3:-1.0}"
MAX_ITER="${4:-30000}"
STRATEGY="${5:-mcmc}"

PLUGIN_DIR="$HOME/.lichtfeld/plugins/splat_ready"
CONFIG="/tmp/splatready_$(date +%s).json"

echo "=== video2splat ==="
echo "Video:      $VIDEO"
echo "Output:     $OUTPUT"
echo "FPS:        $FPS"
echo "Max iter:   $MAX_ITER"
echo "Strategy:   $STRATEGY"
echo ""

# Stage 1+2: SplatReady pipeline (frames + COLMAP)
cat > "$CONFIG" << EOF
{
  "video_path": "$VIDEO",
  "base_output_folder": "$OUTPUT",
  "frame_rate": $FPS,
  "skip_extraction": false,
  "reconstruction_method": "colmap",
  "colmap_exe_path": "/usr/local/bin/colmap",
  "use_fisheye": false,
  "max_image_size": 2000,
  "min_scale": 0.5,
  "skip_reconstruction": false
}
EOF

echo "=== Stage 1+2: SplatReady (frames + COLMAP) ==="
python3 "$PLUGIN_DIR/core/runner.py" "$CONFIG"

DATASET="$OUTPUT/colmap/undistorted"
if [ ! -d "$DATASET" ]; then
    echo "ERROR: COLMAP output not found at $DATASET"
    exit 1
fi

echo ""
echo "=== Stage 3: LichtFeld Training ==="
echo "Dataset: $DATASET"
echo "Output:  $OUTPUT/model"

LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}:/home/devuser/workspace/gaussians/LichtFeld-Studio/build" \
    /home/devuser/workspace/gaussians/LichtFeld-Studio/build/LichtFeld-Studio \
    --headless \
    --data-path "$DATASET" \
    --output-path "$OUTPUT/model" \
    --iter "$MAX_ITER" \
    --strategy "$STRATEGY"

echo ""
echo "=== Done ==="
echo "Model output: $OUTPUT/model"
