#!/usr/bin/env bash
# Post-build check for the ADR-2175 image-to-splat stage in the ComfyUI sidecar. Run from the host shell:
#   docker exec -i <comfyui-container> bash -s < comfyui-sidecar/verify-splatkit.sh
# ComfyUI must already be serving on localhost:8188 for the /object_info checks. Model presence is the
# probe's job (skills/comfyui/manifests/splatkit.json), not this script's.
set -u
fail=0
ok()  { echo "PASS  $*"; }
bad() { echo "FAIL  $*"; fail=1; }
cd /opt/ComfyUI || exit 2
nodes=/opt/ComfyUI/custom_nodes

# 1. Packs at their pinned revisions, unmodified.
for pin in "ComfyUI-SplatKit 47c93ee95c345314b0b3b0a998a80788fc984207" \
           "ComfyUI-Mickmumpitz-Nodes 270afbd7659aec81ba40cd54c65cd4d872394ee4" \
           "ComfyUI-Krea2-Ostris-Edit 7756566160c4a1b24bb1bd9f0ff3ced1a83d7547" \
           "ComfyUI_UltimateSDUpscale 627c871f14532b164331f08d0eebfbf7404161ee"; do
  set -- $pin
  head=$(git -C "$nodes/$1" rev-parse HEAD 2>/dev/null)
  dirty=$(git -C "$nodes/$1" status --porcelain --untracked-files=no 2>/dev/null)
  if [ "$head" = "$2" ] && [ -z "$dirty" ]; then ok "$1 @ ${2:0:12}, clean"; else bad "$1 at ${head:-missing} (want $2) dirty=[${dirty}]"; fi
done

# 2. SphereSfM bundle baked (the node's first-use download path must never run).
if "$nodes/ComfyUI-SplatKit/bin/colmap_sphere" help 2>/dev/null | grep -q "COLMAP 3.8"; then
  ok "colmap_sphere (SphereSfM) runs"
else bad "colmap_sphere missing or broken"; fi

# 3. Node registration via /object_info (python urllib: the image has no curl).
python - <<'PY'
import json, sys, urllib.request
try:
    info = json.load(urllib.request.urlopen("http://localhost:8188/object_info", timeout=60))
except Exception as exc:
    print("FAIL  /object_info unreachable:", exc); sys.exit(1)
want = ["SplatKit_CameraPlotSceneReference", "SplatKit_CameraPlotRenderControlGeo", "SplatKit_DatasetProject",
        "SplatKit_WanI2VMaskedConditioning", "SplatKit_HiResComposite", "SplatKit_SphereSfMDatasetDualRes",
        "MickmumpitzPanoWarp", "MickmumpitzPanoKrea2Reference", "MickmumpitzPanoHarmonizeBoundary",
        "MickmumpitzPanoSeamMask", "MickmumpitzPanoRollHorizontal", "TextEncodeKrea2OstrisEdit",
        "Krea2OstrisEditModelPatch", "UltimateSDUpscaleNoUpscale", "AgentboxSplatDatasetExport"]
missing = [k for k in want if k not in info]
print(("PASS  " if not missing else "FAIL  ") + f"splat node classes registered ({len(want) - len(missing)}/{len(want)}; missing {missing})")
sys.exit(1 if missing else 0)
PY
[ $? -eq 0 ] || fail=1

# 4. Exactly one OpenCV distribution, headless; filtered requirements stayed out.
dists=$(pip list --format=freeze 2>/dev/null | grep -i '^opencv' || true)
if [ "$(echo "$dists" | grep -c .)" = "1" ] && echo "$dists" | grep -qi '^opencv-python-headless=='; then
  ok "single headless OpenCV ($dists)"
else bad "OpenCV distributions: [$dists]"; fi
if pip show ultralytics >/dev/null 2>&1; then bad "ultralytics installed (filtered requirement)"; else ok "ultralytics absent"; fi
if [ -d "$nodes/ComfyUI-SplatKit/bin/splat_backend" ]; then  # core/splatting/runtime.py BACKEND
  bad "SplatKit managed training environment present"
else ok "no SplatKit managed training environment"; fi

# 5. torch hub cache on the models volume (RAFT weights come from the splat-dataset profile).
if [ "${TORCH_HOME:-}" = "/opt/ComfyUI/models/torch_hub" ]; then ok "TORCH_HOME=$TORCH_HOME"; else bad "TORCH_HOME=${TORCH_HOME:-unset}"; fi

[ "$fail" -eq 0 ] && echo "verify-splatkit: ALL PASS" || echo "verify-splatkit: FAILURES"
exit "$fail"
