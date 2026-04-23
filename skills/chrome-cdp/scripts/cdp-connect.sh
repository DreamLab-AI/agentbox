#!/bin/bash
# Wrapper for cdp.mjs that creates a DevToolsActivePort file for direct port connection
# Usage: cdp-connect.sh [port] [command] [args...]
#
# In our container, Chromium is started with --remote-debugging-port=XXXX
# but cdp.mjs expects a DevToolsActivePort file. This wrapper bridges the gap.

CDP_PORT="${1:-9222}"
shift

# Create a temporary DevToolsActivePort file
CHROME_CONFIG_DIR="${HOME}/.config/chromium"
mkdir -p "${CHROME_CONFIG_DIR}"
PORT_FILE="${CHROME_CONFIG_DIR}/DevToolsActivePort"

# Get the websocket path from the CDP endpoint
WS_PATH=$(curl -s "http://localhost:${CDP_PORT}/json/version" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['webSocketDebuggerUrl'].split('/',3)[-1])" 2>/dev/null)

if [ -z "$WS_PATH" ]; then
  echo "Error: Cannot connect to CDP on port ${CDP_PORT}" >&2
  echo "Start Chromium with: chromium --remote-debugging-port=${CDP_PORT} --no-sandbox --headless &" >&2
  exit 1
fi

# Write the port file in Chrome's expected format
printf '%s\n/%s\n' "${CDP_PORT}" "${WS_PATH}" > "${PORT_FILE}"

# Run cdp.mjs with the port file available
CDP_PORT_FILE="${PORT_FILE}" exec node "$(dirname "$0")/cdp.mjs" "$@"
