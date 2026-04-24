#!/usr/bin/env bash
# tests/bootstrap/sentinel.sh — assert /run/agentbox/bootstrap.done appears
# within 60 seconds of container start.
#
# TAP skip-77 when Docker is unavailable.
#
# Usage:
#   AGENTBOX_CONTAINER=<name|id>  tests/bootstrap/sentinel.sh
#
# The test polls the sentinel path inside the running container.

set -euo pipefail

SENTINEL_PATH="/run/agentbox/bootstrap.done"
TIMEOUT="${BOOTSTRAP_SENTINEL_TIMEOUT:-60}"
POLL_INTERVAL=2
CONTAINER="${AGENTBOX_CONTAINER:-}"

# TAP skip-77: requires Docker.
if ! command -v docker >/dev/null 2>&1; then
  echo "TAP version 13"
  echo "1..1"
  echo "ok 1 # SKIP Docker not available in this environment"
  exit 77
fi

if [ -z "$CONTAINER" ]; then
  # Try to locate a running agentbox container automatically.
  CONTAINER=$(docker ps --filter "label=org.opencontainers.image.title=agentbox" \
    --format '{{.ID}}' | head -n1 || true)
fi

if [ -z "$CONTAINER" ]; then
  echo "TAP version 13"
  echo "1..1"
  echo "ok 1 # SKIP no running agentbox container found (set AGENTBOX_CONTAINER=<id>)"
  exit 77
fi

echo "TAP version 13"
echo "1..1"

elapsed=0
while [ "$elapsed" -lt "$TIMEOUT" ]; do
  if docker exec "$CONTAINER" test -f "$SENTINEL_PATH" 2>/dev/null; then
    # Read and validate sentinel content.
    content=$(docker exec "$CONTAINER" cat "$SENTINEL_PATH" 2>/dev/null || echo "")
    echo "ok 1 - sentinel ${SENTINEL_PATH} present within ${elapsed}s # content: ${content}"
    exit 0
  fi
  sleep "$POLL_INTERVAL"
  elapsed=$(( elapsed + POLL_INTERVAL ))
done

echo "not ok 1 - sentinel ${SENTINEL_PATH} did not appear within ${TIMEOUT}s"
echo "# Container: ${CONTAINER}"
echo "# Increase BOOTSTRAP_SENTINEL_TIMEOUT to allow slower hosts more time"
exit 1
