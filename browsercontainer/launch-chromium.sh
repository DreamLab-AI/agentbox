#!/bin/bash
# Persistent Chrome with hardware-accelerated WebGPU + WebGL via Vulkan/ANGLE
# Launched by supervisord; MCP server attaches via CDP on port 9222
# cdp-proxy.js on 9223 exposes CDP to the docker network and the host (ADR-2207 D3)
#
# Display (ADR-2207 D1): one window on one 16:9 display. display-env.sh is the
# single definition of the size (BROWSER_DISPLAY_SIZE); an invalid value stops
# here before Chrome starts. openbox (supervisord) maximises the window and
# removes decorations; the flags below give the same geometry without it.
# Saved zoom and window placement are removed from the profile on every start
# (reset-view-state.js), so the profile volume cannot carry a 125 % zoom or a
# 500x584 window into the next session.
# Prefers google-chrome-beta (149+, WebMCP), falls back to chromium
#
# Podkey (W9, owner rule 2026-10-03): the pinned Podkey CI artefact is unpacked
# at $PODKEY_EXT_DIR at image build (scripts/fetch-podkey.sh). How it is loaded
# depends on the browser, and this script records which in $RUN_DIR/podkey-mode
# for podkey-ctl.js (supervisord program podkey-loader):
#   Chromium      --load-extension + --disable-extensions-except      mode=flag
#   Google Chrome  branded Chrome 137+ ignores --load-extension, and on 151
#                  --disable-extensions-except disables even a CDP-loaded
#                  extension, so neither flag is passed; podkey-loader calls
#                  Extensions.loadUnpacked (needs
#                  --enable-unsafe-extension-debugging); the managed policy
#                  policies/podkey-only.json allowlists only Podkey      mode=cdp
#   no extension dir  Chrome starts without Podkey (fail-open)            mode=none
# The profile ($CHROME_PROFILE_DIR) is the named volume browsercontainer-profile,
# so Podkey's chrome.storage.local (encrypted vault, pubkey, grants) survives
# container recreation.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=display-env.sh
. "$HERE/display-env.sh"

SECURE_ORIGINS="${TREAT_AS_SECURE:-http://the model host:3001,http://the model host:3000,http://host.docker.internal:3001,http://host.docker.internal:3000}"

CHROME_BIN="${CHROME_BIN:-}"
if [ -z "$CHROME_BIN" ]; then
  for candidate in /opt/google/chrome-beta/chrome /usr/bin/chromium /opt/google/chrome/chrome; do
    if [ -x "$candidate" ]; then
      CHROME_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$CHROME_BIN" ]; then
  echo "[launch-chromium] FATAL: no Chrome/Chromium binary found" >&2
  exit 1
fi

PROFILE_DIR="${CHROME_PROFILE_DIR:-/home/devuser/chrome-profile}"
PODKEY_EXT_DIR="${PODKEY_EXT_DIR:-/opt/browsercontainer/extensions/podkey}"
RUN_DIR="${BROWSERCONTAINER_RUN_DIR:-/tmp/browsercontainer}"

echo "[launch-chromium] Using: $CHROME_BIN" >&2
echo "[launch-chromium] TREAT_AS_SECURE: $SECURE_ORIGINS" >&2
echo "[launch-chromium] Display: ${BROWSER_DISPLAY_W}x${BROWSER_DISPLAY_H}" >&2

# Chrome's --unsafely-treat-insecure-origin-as-secure accepts EITHER repeated
# flag entries OR a single comma-separated value, but the single-value form is
# what the docs canonically describe and what propagates reliably across all
# Chrome 100+ versions. Earlier per-origin form left isSecureContext=false
# on Chrome 149 even though SharedArrayBuffer worked. Use the single-flag
# comma form.

# The profile survives container recreation; a Singleton* left by the previous
# container (same hostname, dead pid) would make Chrome refuse the profile as
# "in use". Only this script starts Chrome in this container, so they are stale.
mkdir -p "$PROFILE_DIR" "$RUN_DIR"
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonSocket" "$PROFILE_DIR/SingletonCookie"

# Fail-open: a failed reset is logged and Chrome still starts.
node "$HERE/reset-view-state.js" "$PROFILE_DIR/Default/Preferences" \
  || echo "[launch-chromium] WARN: view-state reset failed; starting Chrome anyway" >&2

EXTENSION_ARGS=()
PODKEY_MODE=none
if [ -f "$PODKEY_EXT_DIR/manifest.json" ]; then
  case "$("$CHROME_BIN" --version 2>/dev/null)" in
    "Google Chrome"*)
      PODKEY_MODE=cdp
      EXTENSION_ARGS=(--enable-unsafe-extension-debugging)
      ;;
    *)
      PODKEY_MODE=flag
      EXTENSION_ARGS=(--load-extension="$PODKEY_EXT_DIR" --disable-extensions-except="$PODKEY_EXT_DIR")
      ;;
  esac
else
  echo "[launch-chromium] WARN: no Podkey at $PODKEY_EXT_DIR; starting without it" >&2
fi
echo "$PODKEY_MODE" >"$RUN_DIR/podkey-mode" || true
echo "[launch-chromium] Podkey load mode: $PODKEY_MODE" >&2

exec "$CHROME_BIN" \
    --user-data-dir="$PROFILE_DIR" \
    "${EXTENSION_ARGS[@]}" \
    --no-first-run \
    --no-default-browser-check \
    --no-sandbox \
    --disable-setuid-sandbox \
    --disable-dev-shm-usage \
    --disable-breakpad \
    --test-type \
    --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,UseSkiaRenderer,SharedArrayBuffer,WebGPU \
    --enable-unsafe-webgpu \
    --use-angle=vulkan \
    --ignore-gpu-blocklist \
    --enable-gpu-rasterization \
    --disable-gpu-sandbox \
    --enable-vulkan \
    --allow-insecure-localhost \
    --remote-debugging-port=9222 \
    --remote-debugging-address=0.0.0.0 \
    --remote-allow-origins=* \
    --crash-dumps-dir=/tmp/chromium-crashes \
    --disable-features=CrashReporting \
    --unsafely-treat-insecure-origin-as-secure="$SECURE_ORIGINS" \
    --window-position=0,0 \
    --window-size="${BROWSER_DISPLAY_W},${BROWSER_DISPLAY_H}" \
    --start-maximized \
    --force-device-scale-factor=1 \
    about:blank
