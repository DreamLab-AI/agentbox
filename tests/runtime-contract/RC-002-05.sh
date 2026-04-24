#!/usr/bin/env bash
# RC-002-05 — Startup failure when required artifact missing (PRD-002 §6 AC-3)
#
# Synthetic test: sets AGENTBOX_TEST_FORCE_MISSING=management-api so the
# artifact validator in the entrypoint recognises a simulated missing binary
# and triggers a fatal bootstrap failure.
#
# If the entrypoint does not honour AGENTBOX_TEST_FORCE_MISSING, a fallback
# approach is used: a wrapper Dockerfile is built that removes the management-api
# binary before calling the real entrypoint.
#
# Assertions:
#   1. supervisord (or the process supervisor) exits non-zero within 30 s.
#   2. docker logs contain the string "MissingArtifactDetected".
#   3. docker logs contain the string "BootstrapFailed".
#
# Exit codes
#   0  — all assertions pass (startup fails as expected)
#   1  — one or more assertions failed
#   77 — skip (no Docker socket or image not loaded)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

IMAGE_REF="${AGENTBOX_IMAGE_REF:-agentbox:runtime-x86_64-linux}"
CONTAINER_NAME="agentbox-rc002-05"
WRAPPER_IMAGE="agentbox-rc002-05-wrapper"
FAIL_TIMEOUT=30          # seconds to wait for non-zero exit

TAP_N=0
TAP_FAIL=0
BUILT_WRAPPER=0

_tap_ok()     { TAP_N=$(( TAP_N + 1 )); echo "ok ${TAP_N} - $1"; }
_tap_not_ok() { TAP_N=$(( TAP_N + 1 )); echo "not ok ${TAP_N} - $1"; TAP_FAIL=$(( TAP_FAIL + 1 )); }

cleanup() {
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    if [ "$BUILT_WRAPPER" -eq 1 ]; then
        docker rmi -f "${WRAPPER_IMAGE}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

# ── skip guards ───────────────────────────────────────────────────────────────
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ]; then
    echo "ok 1 # SKIP RC-002-05: no Docker socket available"
    echo "1..1"
    exit 77
fi

if ! docker info >/dev/null 2>&1; then
    echo "ok 1 # SKIP RC-002-05: Docker daemon not reachable"
    echo "1..1"
    exit 77
fi

if ! docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
    echo "ok 1 # SKIP RC-002-05: image '${IMAGE_REF}' not loaded (set AGENTBOX_IMAGE_REF to override)"
    echo "1..1"
    exit 77
fi

# ── choose injection strategy ─────────────────────────────────────────────────
# Strategy A: env var hook (preferred, zero build cost)
# Strategy B: wrapper image that unlinks the binary (fallback)
use_wrapper=0
# Probe whether the entrypoint honours the env var by looking at its source.
if ! grep -q 'AGENTBOX_TEST_FORCE_MISSING' "${REPO_ROOT}/config/entrypoint-unified.sh" 2>/dev/null; then
    use_wrapper=1
fi

if [ "$use_wrapper" -eq 1 ]; then
    echo "# Strategy B: building wrapper image (entrypoint does not honour AGENTBOX_TEST_FORCE_MISSING)"
    TMPDIR_WRAPPER="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR_WRAPPER"; cleanup' EXIT

    cat > "${TMPDIR_WRAPPER}/Dockerfile" <<DOCKERFILE
FROM ${IMAGE_REF}
# Remove the required binary to simulate a missing artifact.
RUN rm -f /opt/agentbox/management-api/bin/management-api \
         /opt/agentbox/management-api/server.js 2>/dev/null || true
DOCKERFILE

    docker build -t "${WRAPPER_IMAGE}" "${TMPDIR_WRAPPER}" >/dev/null 2>&1
    BUILT_WRAPPER=1
    RUN_IMAGE="${WRAPPER_IMAGE}"
else
    echo "# Strategy A: env var AGENTBOX_TEST_FORCE_MISSING=management-api"
    RUN_IMAGE="${IMAGE_REF}"
fi

# ── start the container expecting it to exit on its own ──────────────────────
if [ "$use_wrapper" -eq 1 ]; then
    docker run -d \
        --name "${CONTAINER_NAME}" \
        --tmpfs /tmp \
        --tmpfs /run \
        --tmpfs /var/run \
        "${RUN_IMAGE}" >/dev/null
else
    docker run -d \
        --name "${CONTAINER_NAME}" \
        -e AGENTBOX_TEST_FORCE_MISSING=management-api \
        --tmpfs /tmp \
        --tmpfs /run \
        --tmpfs /var/run \
        "${RUN_IMAGE}" >/dev/null
fi

# ── assertion 1: container (process supervisor) exits non-zero within 30 s ───
exited=0
deadline=$(( $(date +%s) + FAIL_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    state=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)
    if [ "$state" = "exited" ]; then
        exited=1
        break
    fi
    sleep 1
done

exit_code_val=0
if [ "$exited" -eq 1 ]; then
    exit_code_val=$(docker inspect --format '{{.State.ExitCode}}' "${CONTAINER_NAME}" 2>/dev/null || echo "0")
fi

if [ "$exited" -eq 1 ] && [ "$exit_code_val" != "0" ]; then
    _tap_ok "container exited non-zero (exit code: ${exit_code_val}) within ${FAIL_TIMEOUT}s"
else
    _tap_not_ok "container exited non-zero within ${FAIL_TIMEOUT}s (exited=${exited}, code=${exit_code_val})"
    docker logs "${CONTAINER_NAME}" 2>&1 | tail -30 >&2
fi

# ── collect logs for remaining assertions ─────────────────────────────────────
container_logs=$(docker logs "${CONTAINER_NAME}" 2>&1 || true)

# ── assertion 2: logs contain MissingArtifactDetected ────────────────────────
if echo "$container_logs" | grep -q 'MissingArtifactDetected'; then
    _tap_ok "docker logs contain 'MissingArtifactDetected'"
else
    _tap_not_ok "docker logs contain 'MissingArtifactDetected' (PRD-002 §5.6 bootstrap observability)"
    echo "$container_logs" | tail -30 | sed 's/^/#   /' >&2
fi

# ── assertion 3: logs contain BootstrapFailed ────────────────────────────────
if echo "$container_logs" | grep -q 'BootstrapFailed'; then
    _tap_ok "docker logs contain 'BootstrapFailed'"
else
    _tap_not_ok "docker logs contain 'BootstrapFailed' (PRD-002 §5.6 bootstrap observability)"
    echo "$container_logs" | tail -30 | sed 's/^/#   /' >&2
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo "1..${TAP_N}"
[ "$TAP_FAIL" -eq 0 ] && exit 0 || exit 1
