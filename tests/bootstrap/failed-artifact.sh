#!/usr/bin/env bash
# tests/bootstrap/failed-artifact.sh — synthetic missing-artifact failure test.
#
# Bind-mounts /bin/false over a required binary, starts a container, and
# asserts supervisord exits non-zero within 30s with MissingArtifactDetected
# in the logs.
#
# TAP skip-77 when Docker is unavailable.
#
# Environment:
#   AGENTBOX_IMAGE       — image to test (default: agentbox:latest)
#   FAILED_ARTIFACT_BIN  — host path to bind-mount over (default: uses management-api entrypoint)
#   FAILURE_TIMEOUT      — seconds to wait for container exit (default: 30)

set -euo pipefail

AGENTBOX_IMAGE="${AGENTBOX_IMAGE:-agentbox:latest}"
# The entrypoint for the management-api capability — required_for_readiness=true.
TARGET_BIN="${FAILED_ARTIFACT_BIN:-/opt/agentbox/management-api/index.js}"
FAILURE_TIMEOUT="${FAILURE_TIMEOUT:-30}"

echo "TAP version 13"
echo "1..3"

# Skip-77: Docker required.
if ! command -v docker >/dev/null 2>&1; then
  echo "ok 1 # SKIP Docker not available"
  echo "ok 2 # SKIP Docker not available"
  echo "ok 3 # SKIP Docker not available"
  exit 77
fi

# Check the image exists locally.
if ! docker image inspect "$AGENTBOX_IMAGE" >/dev/null 2>&1; then
  echo "ok 1 # SKIP image ${AGENTBOX_IMAGE} not found locally (build first with: nix build .#image)"
  echo "ok 2 # SKIP image not available"
  echo "ok 3 # SKIP image not available"
  exit 77
fi

# Start a container with /bin/false bind-mounted over the required binary.
# --rm ensures cleanup; capture logs via --log-driver json-file or stdout capture.
CID=$(docker run \
  --rm \
  --detach \
  --mount "type=bind,source=/bin/false,target=${TARGET_BIN},readonly" \
  "$AGENTBOX_IMAGE" \
  2>/dev/null)

if [ -z "$CID" ]; then
  echo "not ok 1 - failed to start container with bind-mount"
  echo "ok 2 # SKIP container did not start"
  echo "ok 3 # SKIP container did not start"
  exit 1
fi

echo "# Started container: ${CID} (bind-mount: /bin/false -> ${TARGET_BIN})"

# Poll for container exit within timeout.
elapsed=0
POLL=2
exited=0
while [ "$elapsed" -lt "$FAILURE_TIMEOUT" ]; do
  state=$(docker inspect --format '{{.State.Status}}' "$CID" 2>/dev/null || echo "gone")
  if [ "$state" = "exited" ] || [ "$state" = "gone" ]; then
    exited=1
    break
  fi
  sleep "$POLL"
  elapsed=$(( elapsed + POLL ))
done

if [ "$exited" -eq 0 ]; then
  echo "not ok 1 - container did not exit within ${FAILURE_TIMEOUT}s (expected fatal bootstrap failure)"
  docker stop "$CID" >/dev/null 2>&1 || true
  exit 1
fi

echo "ok 1 - container exited within ${elapsed}s"

# Assert non-zero exit code.
exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$CID" 2>/dev/null || echo "0")
if [ "$exit_code" -ne 0 ]; then
  echo "ok 2 - container exited non-zero (exit code: ${exit_code})"
else
  echo "not ok 2 - container exited 0 (expected non-zero for missing required artifact)"
  exit 1
fi

# Assert MissingArtifactDetected event in logs.
logs=$(docker logs "$CID" 2>&1 || true)
if echo "$logs" | grep -q "MissingArtifactDetected"; then
  echo "ok 3 - MissingArtifactDetected event present in container logs"
else
  echo "not ok 3 - MissingArtifactDetected event NOT found in container logs"
  echo "# Tail of logs:"
  echo "$logs" | tail -20 | sed 's/^/# /'
  exit 1
fi
