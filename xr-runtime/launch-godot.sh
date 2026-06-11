#!/bin/bash
# Build (once) and run the VisionClaw XR Godot project against Monado.
#
# Boot sequence:
#   1. build the gdext cdylib if it isn't cached in the target volume
#   2. wait for Monado's IPC socket so OpenXR session creation can succeed
#   3. import project resources once (builds .godot/ cache)
#   4. run the configured scene with OpenXR live
set -euo pipefail

export DISPLAY="${DISPLAY:-:3}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
export HOME="${HOME:-/home/devuser}"
export XR_RUNTIME_JSON="${XR_RUNTIME_JSON:-/usr/share/openxr/1/openxr_monado.json}"

PROJECT_DIR=/workspace/xr-client
SO="$PROJECT_DIR/rust/target/release/libvisionclaw_xr_gdext.so"
SCENE="${XR_GODOT_SCENE:-res://scenes/XRBoot.tscn}"

if [[ ! -d "$PROJECT_DIR" ]]; then
    echo "[godot] FATAL: $PROJECT_DIR not mounted — bind the XR project in." >&2
    exit 1
fi

# 1. GDExtension cdylib — build on first boot, reuse from the cache volume after.
if [[ ! -f "$SO" ]]; then
    echo "[godot] gdext cdylib missing — building (first boot, ~5-10 min cold)"
    /opt/xr-runtime/build-gdext.sh
fi
if [[ ! -f "$SO" ]]; then
    echo "[godot] FATAL: gdext build did not produce $SO" >&2
    exit 1
fi

# 2. Monado IPC socket — OpenXR xrCreateSession needs the runtime up first.
SOCK="$XDG_RUNTIME_DIR/monado_comp_ipc"
for _ in $(seq 1 60); do
    [[ -S "$SOCK" ]] && break
    sleep 1
done
if [[ ! -S "$SOCK" ]]; then
    echo "[godot] WARN: Monado IPC socket $SOCK absent after 60s — OpenXR init may fail." >&2
fi

# 3. Import resources headlessly so the runtime start isn't blocked on first import.
echo "[godot] importing project resources (one-shot)…"
godot --headless --path "$PROJECT_DIR" --import >/dev/null 2>&1 || true

# 4. Run. --verbose surfaces the OpenXR session bring-up and gdext load in logs.
#
# Godot 4.3's `mobile` renderer (required to match Quest) invokes the desktop
# post-process tonemapper against Monado's XR multiview swapchain, but the
# multiview tonemap shader variant isn't in the mobile shader set — so it logs
# the same four benign lines every frame (~2k/min, unbounded), drowning real
# signal and bloating the logs that are this sidecar's whole debug surface.
# Godot guards the missing shader (early-return), so the session is unaffected.
#
# Filter ONLY that exact tonemapper signature out of stderr. This is targeted,
# not a blanket mute: a different shader failure keeps its distinct `at:` line
# (a non-tonemapper location), so nothing real is hidden. To see the raw flood
# for engine debugging, comment out the `2> >(grep …)` redirect below.
echo "[godot] launching $SCENE against Monado ($XR_RUNTIME_JSON)"
TONEMAP_SPAM='Condition "shader\.is_null\(\)" is true|Condition "!variants_enabled\[p_variant\]" is true|effects/tone_mapper\.cpp:249|shader_rd\.h:163'
exec godot --path "$PROJECT_DIR" --verbose "$SCENE" \
    2> >(grep --line-buffered -vE "$TONEMAP_SPAM" >&2)
