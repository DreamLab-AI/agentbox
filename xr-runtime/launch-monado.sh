#!/bin/bash
# Start the Monado OpenXR desktop runtime with a simulated 6DoF HMD.
#
# No physical headset is present, so the `qwerty` driver synthesises a headset +
# two controllers driven by keyboard/mouse: focus the Monado window over VNC,
# then WASD to translate and click-drag to look. The OpenXR loader points apps
# at this service via XR_RUNTIME_JSON (set in the compose env).
set -euo pipefail

export DISPLAY="${DISPLAY:-:3}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"

# Input driver. The simulated HMD is the reliable default: it always registers a
# stereo head device (view count 2), which is what lets the Vulkan XCB compositor
# and the OpenXR session come up with no hardware present. The qwerty driver
# (keyboard/mouse 6DoF) is EXPERIMENTAL here — in this Monado build it produces no
# head device and segfaults the compositor, so it is strictly opt-in.
DRIVER="${XR_INPUT_DRIVER:-simulated}"
if [[ "$DRIVER" == "qwerty" ]]; then
    export QWERTY_ENABLE=1
    export SIMULATED_ENABLE=0
    echo "[monado] input driver: qwerty (EXPERIMENTAL — may fail to create a head)"
else
    export SIMULATED_ENABLE=1
    export QWERTY_ENABLE=0
    echo "[monado] input driver: simulated stereo HMD (static head)"
fi
# Keep the runtime alive across Godot reconnects (editor restarts, scene reloads).
export IPC_EXIT_ON_DISCONNECT=0

if [[ "${XR_RUNTIME_HEADLESS:-0}" == "1" ]]; then
    echo "[monado] headless mode — no compositor window (protocol/lifecycle only)"
    # Best-effort: ask the compositor not to open an XCB window. Headless on
    # NVIDIA proprietary is experimental; the supported visual path is below.
    export XRT_COMPOSITOR_FORCE_XCB_WINDOW=0
else
    echo "[monado] visual mode — XCB window on $DISPLAY (mirrored to VNC :5904)"
    export XRT_COMPOSITOR_FORCE_XCB_WINDOW=1
fi

# Wait for the X server socket (display :3 → /tmp/.X11-unix/X3) before the
# compositor tries to open its window.
for _ in $(seq 1 30); do
    [[ -S /tmp/.X11-unix/X3 ]] && break
    sleep 1
done

# Monado's IPC mainloop adds stdin to an epoll set so the service exits when its
# launching terminal closes. Under supervisord stdin is a closed/non-pollable fd
# and epoll_ctl(stdin) fails fatally (XRT_ERROR_IPC_MAINLOOP_FAILED_TO_INIT), so
# feed monado a pollable pipe that never carries data and never EOFs.
echo "[monado] starting monado-service (driver=$DRIVER, headless=${XR_RUNTIME_HEADLESS:-0})"
exec monado-service < <(tail -f /dev/null)
