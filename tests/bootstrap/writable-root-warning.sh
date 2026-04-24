#!/usr/bin/env bash
# tests/bootstrap/writable-root-warning.sh — assert ImmutableRootWritable warning
# when /opt/agentbox is mounted writable (defensive test).
#
# TAP skip-77 when Docker is unavailable.
#
# Environment:
#   AGENTBOX_IMAGE           — image to test (default: agentbox:latest)
#   WRITABLE_ROOT_TIMEOUT    — max seconds to wait for readiness (default: 30)

set -euo pipefail

AGENTBOX_IMAGE="${AGENTBOX_IMAGE:-agentbox:latest}"
READINESS_TIMEOUT="${WRITABLE_ROOT_TIMEOUT:-30}"
POLL_INTERVAL=2

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

# Create a temporary writable directory to bind-mount as /opt/agentbox:rw
TMPDIR=$(mktemp -d)
trap "rm -rf '$TMPDIR'" EXIT

# Copy /opt/agentbox contents into tmpdir for bind-mount (simple copy via docker exec won't work;
# we use a volume from a builder or fetch from image). For this test, we'll use a bind-mount
# of an empty or minimalist directory; the key is that it's writable.
mkdir -p "$TMPDIR/opt-agentbox"

# Start a container with /opt/agentbox mounted as writable (rw flag).
# The bootstrap should succeed (warning is non-fatal) but emit ImmutableRootWritable.
CID=$(docker run \
  --rm \
  --detach \
  --volume "${TMPDIR}/opt-agentbox:/opt/agentbox:rw" \
  "$AGENTBOX_IMAGE" \
  2>/dev/null)

if [ -z "$CID" ]; then
  echo "not ok 1 - failed to start container with writable /opt/agentbox mount"
  echo "ok 2 # SKIP container did not start"
  exit 1
fi

echo "# Started container: ${CID} (writable /opt/agentbox mount)"

# Poll for bootstrap.done sentinel — it SHOULD appear (warning is non-fatal).
elapsed=0
sentinel_found=0

while [ "$elapsed" -lt "$READINESS_TIMEOUT" ]; do
  if docker exec "$CID" test -f /run/agentbox/bootstrap.done 2>/dev/null; then
    sentinel_found=1
    break
  fi
  sleep "$POLL_INTERVAL"
  elapsed=$(( elapsed + POLL_INTERVAL ))
done

if [ "$sentinel_found" -eq 1 ]; then
  echo "ok 1 - bootstrap completed successfully (sentinel present within ${elapsed}s, warning is non-fatal)"
else
  echo "not ok 1 - bootstrap did not complete within ${READINESS_TIMEOUT}s (sentinel not found)"
  docker stop "$CID" >/dev/null 2>&1 || true
  exit 1
fi

# Assert ImmutableRootWritable warning event in logs.
logs=$(docker logs "$CID" 2>&1 || true)
if echo "$logs" | grep -q "ImmutableRootWritable"; then
  echo "ok 2 - ImmutableRootWritable warning event present in container logs"
  docker stop "$CID" >/dev/null 2>&1 || true
  exit 0
else
  echo "not ok 2 - ImmutableRootWritable warning event NOT found in container logs"
  echo "# Tail of logs:"
  echo "$logs" | tail -20 | sed 's/^/# /'
  docker stop "$CID" >/dev/null 2>&1 || true
  exit 1
fi
