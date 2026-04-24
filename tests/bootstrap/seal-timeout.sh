#!/usr/bin/env bash
# tests/bootstrap/seal-timeout.sh — assert BootstrapSealTimeout event when required
# programs fail to transition to RUNNING within the timeout window.
#
# TAP skip-77 when Docker is unavailable.
#
# Environment:
#   AGENTBOX_IMAGE             — image to test (default: agentbox:latest)
#   BOOTSTRAP_SEAL_TIMEOUT     — timeout in seconds (default: 5 for this test)
#   SEAL_TEST_CONTAINER_TIMEOUT — max seconds to wait for seal failure (default: 15)

set -euo pipefail

AGENTBOX_IMAGE="${AGENTBOX_IMAGE:-agentbox:latest}"
SEAL_TIMEOUT="${BOOTSTRAP_SEAL_TIMEOUT:-5}"
CONTAINER_TIMEOUT="${SEAL_TEST_CONTAINER_TIMEOUT:-15}"

echo "TAP version 13"
echo "1..2"

# Skip-77: Docker required.
if ! command -v docker >/dev/null 2>&1; then
  echo "ok 1 # SKIP Docker not available"
  echo "ok 2 # SKIP Docker not available"
  exit 77
fi

# Check the image exists locally.
if ! docker image inspect "$AGENTBOX_IMAGE" >/dev/null 2>&1; then
  echo "ok 1 # SKIP image ${AGENTBOX_IMAGE} not found locally"
  echo "ok 2 # SKIP image not available"
  exit 77
fi

# Start a container with BOOTSTRAP_SEAL_TIMEOUT set to 5 seconds and a supervisor
# program command replaced with 'sleep infinity' so it never reaches RUNNING.
# We use a wrapper entrypoint that modifies the supervisord config to force
# the bootstrap program into a non-RUNNING state.
CID=$(docker run \
  --rm \
  --detach \
  --env "BOOTSTRAP_SEAL_TIMEOUT=${SEAL_TIMEOUT}" \
  --env "AGENTBOX_BOOTSTRAP_STAGE=A" \
  "$AGENTBOX_IMAGE" \
  sh -c 'supervisord -c <(echo "[supervisord]" >&1; cat /etc/supervisord.conf | sed "s|command=.*management-api|command=/bin/sh -c \"sleep infinity\"|" ) 2>&1 || sleep 30' \
  2>/dev/null)

if [ -z "$CID" ]; then
  echo "not ok 1 - failed to start container with modified supervisor config"
  echo "ok 2 # SKIP container did not start"
  exit 1
fi

echo "# Started container: ${CID}"

# Poll for bootstrap.done sentinel — it should NOT appear within CONTAINER_TIMEOUT.
elapsed=0
POLL=2
sentinel_found=0

while [ "$elapsed" -lt "$CONTAINER_TIMEOUT" ]; do
  if docker exec "$CID" test -f /run/agentbox/bootstrap.done 2>/dev/null; then
    sentinel_found=1
    break
  fi
  sleep "$POLL"
  elapsed=$(( elapsed + POLL ))
done

if [ "$sentinel_found" -eq 0 ]; then
  echo "ok 1 - sentinel /run/agentbox/bootstrap.done NOT created within ${CONTAINER_TIMEOUT}s"
else
  echo "not ok 1 - sentinel /run/agentbox/bootstrap.done was created (expected timeout, not completion)"
  docker stop "$CID" >/dev/null 2>&1 || true
  exit 1
fi

# Assert BootstrapSealTimeout event in logs.
logs=$(docker logs "$CID" 2>&1 || true)
if echo "$logs" | grep -q "BootstrapSealTimeout"; then
  echo "ok 2 - BootstrapSealTimeout event present in container logs"
  docker stop "$CID" >/dev/null 2>&1 || true
  exit 0
else
  echo "not ok 2 - BootstrapSealTimeout event NOT found in container logs"
  echo "# Tail of logs:"
  echo "$logs" | tail -20 | sed 's/^/# /'
  docker stop "$CID" >/dev/null 2>&1 || true
  exit 1
fi
