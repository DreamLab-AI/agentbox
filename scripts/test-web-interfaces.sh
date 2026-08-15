#!/usr/bin/env bash
set -euo pipefail

# chrome-devtools-mcp deliberately binds Chrome CDP to loopback inside the
# browsercontainer. Expose a test-only port on that container's private Docker
# network for the duration of this run; it is not published to the host.
if ! docker exec browsercontainer sh -lc 'ss -ltn 2>/dev/null | grep -q ":9224 "'; then
  docker exec -d browsercontainer socat TCP-LISTEN:9224,fork,reuseaddr TCP:127.0.0.1:9222
  for _attempt in 1 2 3 4 5; do
    docker exec browsercontainer sh -lc 'ss -ltn 2>/dev/null | grep -q ":9224 "' && break
    sleep 0.2
  done
fi

if [[ -z "${BROWSER_CDP_URL:-}" ]]; then
  browser_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' browsercontainer)"
  browser_ws="$(docker exec browsercontainer sh -lc 'curl -s http://127.0.0.1:9222/json/version' \
    | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).webSocketDebuggerUrl))')"
  export BROWSER_CDP_URL="${browser_ws/\/\/127.0.0.1:9222/\/\/${browser_ip}:9224}"
fi

exec npx playwright test --config playwright.config.js "$@"
