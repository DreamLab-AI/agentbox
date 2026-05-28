#!/bin/bash
# Persistent Chrome with hardware-accelerated WebGPU + WebGL via Vulkan/ANGLE
# Launched by supervisord; MCP server attaches via CDP on port 9222
# socat proxy on 9223 exposes CDP to the Docker host
# Prefers google-chrome-beta (149+, WebMCP), falls back to chromium

SECURE_ORIGINS="${TREAT_AS_SECURE:-http://192.168.2.132:3001,http://192.168.2.132:3000,http://host.docker.internal:3001,http://host.docker.internal:3000}"

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

echo "[launch-chromium] Using: $CHROME_BIN" >&2
echo "[launch-chromium] TREAT_AS_SECURE: $SECURE_ORIGINS" >&2

# Chrome's --unsafely-treat-insecure-origin-as-secure accepts EITHER repeated
# flag entries OR a single comma-separated value, but the single-value form is
# what the docs canonically describe and what propagates reliably across all
# Chrome 100+ versions. Earlier per-origin form left isSecureContext=false
# on Chrome 149 even though SharedArrayBuffer worked. Use the single-flag
# comma form.

exec "$CHROME_BIN" \
    --user-data-dir=/tmp/chrome-profile \
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
    about:blank
