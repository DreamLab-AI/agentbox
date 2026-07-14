#!/usr/bin/env bash
# Headless GPU-accelerated Blender batch runner for agentbox-main (nix image).
#
# WHY: nix-built Blender's RPATH excludes /usr/lib, where the nvidia-container-runtime
# injects libcuda.so and the GL driver libs — so out of the box Cycles CUDA fails to
# initialise ("CUEW initialization failed") and silently falls back to CPU. Prepending
# /usr/lib to the loader path lets Blender find the injected driver, enabling GPU
# rendering. Verified: with LD_LIBRARY_PATH=/usr/lib, Cycles enumerates all GPUs.
#
# This is the standalone headless render path (no GL context / socket server needed).
# For interactive BlenderMCP, use the GPU sidecar (gui-tools-service) instead.
#
# Usage:
#   blender-batch.sh script.py [args...]          # run a bpy script on the GPU
#   blender-batch.sh --render file.blend out.png  # render a .blend to an image
set -euo pipefail

export LD_LIBRARY_PATH="/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

if [[ "${1:-}" == "--render" ]]; then
  blendfile="$2"; out="$3"
  exec blender --background --factory-startup "$blendfile" \
    --python-expr "import bpy; s=bpy.context.scene; p=bpy.context.preferences.addons['cycles'].preferences; p.compute_device_type='CUDA'; p.refresh_devices(); [setattr(d,'use',True) for d in p.devices if d.type=='CUDA']; s.render.engine='CYCLES'; s.cycles.device='GPU'; bpy.ops.render.render(write_still=True)" \
    -o "$out" -f 1
fi

# Otherwise treat the first arg as a bpy script to run headless.
script="$1"; shift || true
exec blender --background --factory-startup --python "$script" -- "$@"
