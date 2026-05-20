#!/bin/bash
# Wrapper for cdp.mjs that creates a DevToolsActivePort file for direct port connection
# Usage: cdp-connect.sh [host:]port [command] [args...]
#
# Supports both local and remote Chrome instances:
#   cdp-connect.sh 9222 list                      # local Chrome
#   cdp-connect.sh browsercontainer:9222 list      # sidecar Chrome
#   cdp-connect.sh list                            # auto-detect (BROWSER_CDP_HOST or localhost:9222)

# Parse first arg: if it looks like a command (no digits/colons), use defaults
if [[ "${1:-}" =~ ^[a-z] ]] && ! [[ "${1:-}" =~ : ]]; then
  CDP_HOST="${BROWSER_CDP_HOST:-127.0.0.1}"
  CDP_PORT="${BROWSER_CDP_PORT:-9222}"
else
  HOSTPORT="${1:-${BROWSER_CDP_HOST:-127.0.0.1}:${BROWSER_CDP_PORT:-9222}}"
  shift
  if [[ "$HOSTPORT" =~ : ]]; then
    CDP_HOST="${HOSTPORT%%:*}"
    CDP_PORT="${HOSTPORT##*:}"
  else
    CDP_HOST="127.0.0.1"
    CDP_PORT="$HOSTPORT"
  fi
fi

# Create a temporary DevToolsActivePort file
CHROME_CONFIG_DIR="${HOME}/.config/chromium"
mkdir -p "${CHROME_CONFIG_DIR}"
PORT_FILE="${CHROME_CONFIG_DIR}/DevToolsActivePort"

# Get the websocket path from the CDP endpoint
WS_PATH=$(curl -s "http://${CDP_HOST}:${CDP_PORT}/json/version" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['webSocketDebuggerUrl'].split('/',3)[-1])" 2>/dev/null)

if [ -z "$WS_PATH" ]; then
  echo "Error: Cannot connect to CDP at ${CDP_HOST}:${CDP_PORT}" >&2
  echo "For sidecar: agentbox.sh browsercontainer up" >&2
  echo "For local:   chromium --remote-debugging-port=${CDP_PORT} --no-sandbox &" >&2
  exit 1
fi

# Write the port file in Chrome's expected format
printf '%s\n/%s\n' "${CDP_PORT}" "${WS_PATH}" > "${PORT_FILE}"

# Run cdp.mjs with the port file and host available
CDP_PORT_FILE="${PORT_FILE}" CDP_HOST="${CDP_HOST}" exec node "$(dirname "$0")/cdp.mjs" "$@"
