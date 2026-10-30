#!/usr/bin/env bash
# Post-build check for the ComfyUI sidecar (ComfyUI-SpEdE + gsplat). Run from the host shell:
#   docker exec -i <comfyui-container> bash -s < comfyui-sidecar/verify-spede.sh
# Optional GPU smoke (needs the GPU and ~1 min): SPEDE_GPU_SMOKE=1 docker exec -i -e SPEDE_GPU_SMOKE=1 ...
# ComfyUI must already be serving on localhost:8188 for the /object_info checks.
set -u
fail=0
ok()  { echo "PASS  $*"; }
bad() { echo "FAIL  $*"; fail=1; }
cd /opt/ComfyUI || exit 2

# 1. gsplat: prebuilt extension (no JIT) and the symbol SpEdE needs; torch untouched.
if python - <<'PY'
import torch, gsplat.csrc as csrc
from gsplat.cuda._backend import _C
assert _C is csrc and _C.__name__ == "gsplat.csrc", _C
assert csrc.__file__.endswith(".so"), csrc.__file__
from gsplat import rasterize_to_indices_in_range  # noqa: F401
assert torch.__version__ == "2.14.0+cu130", torch.__version__
print("gsplat prebuilt:", csrc.__file__, "| torch", torch.__version__, "| cuda", torch.version.cuda)
PY
then ok "gsplat prebuilt extension, rasterize_to_indices_in_range, torch 2.14.0+cu130"
else bad "gsplat prebuilt import"; fi

# 2. Node registration via /object_info (python urllib: the image has no curl).
python - <<'PY'
import json, sys, urllib.request
try:
    info = json.load(urllib.request.urlopen("http://localhost:8188/object_info", timeout=60))
except Exception as exc:
    print("FAIL  /object_info unreachable:", exc); sys.exit(1)
spede = sorted(k for k in info if k.startswith("SpEdE_"))
video = ["AgentboxIdentityScore", "AgentboxOpeningFrameChooser", "AgentboxRelayPrepare", "AgentboxRetakePrep",
         "AgentboxTrackMask", "AgentboxLoadLatentVerified", "AgentboxSaveLatentVerified", "AgentboxSaveImageVerified"]
missing = [k for k in video if k not in info]
core = [k for k in ("SAM3_Detect", "QwenImage21Cache", "TextEncodeQwenImage21", "LoadMoGeModel", "TripoSplatConditioning") if k not in info]
bad = False
for label, cond, detail in (("SpEdE nodes registered", len(spede) >= 30, f"{len(spede)} SpEdE_* classes"),
                            ("agentbox_video nodes loaded", not missing, f"missing {missing}"),
                            ("ComfyUI core classes SpEdE needs", not core, f"missing {core}")):
    print(("PASS  " if cond else "FAIL  ") + label + " (" + detail + ")")
    bad = bad or not cond
sys.exit(1 if bad else 0)
PY
[ $? -eq 0 ] || fail=1

# 3. Exactly one OpenCV distribution, headless.
dists=$(pip list --format=freeze 2>/dev/null | grep -i '^opencv' || true)
echo "$dists"
if echo "$dists" | grep -qi '^opencv-python=='; then bad "GUI opencv-python is installed"; else ok "GUI opencv-python absent"; fi
if echo "$dists" | grep -qi '^opencv-python-headless=='; then ok "opencv-python-headless present"; else bad "opencv-python-headless missing"; fi

# 4. Optional GPU smoke (SpEdE's own fixture and gsplat render; writes only under /tmp).
if [ "${SPEDE_GPU_SMOKE:-0}" = "1" ]; then
  d=/opt/ComfyUI/custom_nodes/ComfyUI-SpEdE
  if (cd "$d" && python examples/make_demo_fixture.py --out /tmp/spede-fixture \
      && python gpu_smoke.py --source-ply /tmp/spede-fixture/synthetic_scene.ply \
           --camera-targets /tmp/spede-fixture/cameras.npz --out /tmp/spede-gpu-smoke); then
    ok "gpu_smoke.py"
  else bad "gpu_smoke.py"; fi
else
  echo "SKIP  gpu_smoke.py (set SPEDE_GPU_SMOKE=1 to run)"
fi
[ "$fail" -eq 0 ] && echo "verify-spede: ALL PASS" || echo "verify-spede: FAILURES"
exit "$fail"
