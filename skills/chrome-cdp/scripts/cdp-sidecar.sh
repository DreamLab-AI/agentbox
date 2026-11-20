#!/bin/bash
# Connect cdp.mjs to the browsercontainer GPU sidecar
# Usage: cdp-sidecar.sh [command] [args...]
#
# The sidecar runs Chrome Beta 149+ with NVIDIA Vulkan/ANGLE on visionclaw_network.
# CDP is exposed by name via cdp-proxy.js on :9223 (ADR-2207): it rewrites Host
# for Chrome and returns ws:// URLs for the host you used.
#
# From inside Docker network: browsercontainer:9223
# From host machine:          localhost:9222 (mapped to the proxy's :9223)

SIDECAR_HOST="${BROWSER_CDP_HOST:-browsercontainer}"
SIDECAR_PORT="${BROWSER_CDP_PORT:-9223}"

# Detect if we're inside Docker (agentbox) or on the host
if [ -f /.dockerenv ] || grep -q docker /proc/1/cgroup 2>/dev/null; then
  CDP_ENDPOINT="${SIDECAR_HOST}:${SIDECAR_PORT}"
else
  CDP_ENDPOINT="localhost:9222"
fi

exec "$(dirname "$0")/cdp-connect.sh" "${CDP_ENDPOINT}" "$@"
