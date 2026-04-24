#!/usr/bin/env bash
# RC-002-04 — Legal-write boundary (PRD-002 §6 AC-4)
#
# Starts the container with /opt/agentbox bind-mounted read-only (making the
# immutability contract explicit at the Docker layer).  Asserts:
#   1. Boot reaches /ready HTTP 200 within 120 s.
#   2. docker logs contains no "Read-only file system" errors (boot did not
#      attempt to write into the read-only app tree).
#   3. Writable runtime outputs that MUST exist post-boot are present:
#        /workspace/README.agentbox.md
#        /etc/profile.d/agentbox-runtime.sh
#
# Exit codes
#   0  — all assertions pass
#   1  — one or more assertions failed
#   77 — skip (no Docker socket or image not loaded)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

IMAGE_REF="${AGENTBOX_IMAGE_REF:-agentbox:runtime-x86_64-linux}"
CONTAINER_NAME="agentbox-rc002-04"
MGMT_PORT=9090
POLL_TIMEOUT=120

TAP_N=0
TAP_FAIL=0

_tap_ok()     { TAP_N=$(( TAP_N + 1 )); echo "ok ${TAP_N} - $1"; }
_tap_not_ok() { TAP_N=$(( TAP_N + 1 )); echo "not ok ${TAP_N} - $1"; TAP_FAIL=$(( TAP_FAIL + 1 )); }

cleanup() {
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── skip guards ───────────────────────────────────────────────────────────────
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ]; then
    echo "ok 1 # SKIP RC-002-04: no Docker socket available"
    echo "1..1"
    exit 77
fi

if ! docker info >/dev/null 2>&1; then
    echo "ok 1 # SKIP RC-002-04: Docker daemon not reachable"
    echo "1..1"
    exit 77
fi

if ! docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
    echo "ok 1 # SKIP RC-002-04: image '${IMAGE_REF}' not loaded (set AGENTBOX_IMAGE_REF to override)"
    echo "1..1"
    exit 77
fi

# ── start container with /opt/agentbox read-only bind-mount ──────────────────
# We use a named volume for /workspace so the container can write there,
# and tmpfs mounts for the other writable paths.
docker run -d \
    --name "${CONTAINER_NAME}" \
    -v /opt/agentbox:/opt/agentbox:ro \
    --tmpfs /tmp \
    --tmpfs /run \
    --tmpfs /var/run \
    --tmpfs /workspace \
    --tmpfs /etc/profile.d \
    "${IMAGE_REF}" >/dev/null

# ── assertion 1: readiness within 120 s ──────────────────────────────────────
http_status=""
deadline=$(( $(date +%s) + POLL_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    http_status=$(docker exec "${CONTAINER_NAME}" \
        curl -so /dev/null -w '%{http_code}' \
        "http://localhost:${MGMT_PORT}/ready" 2>/dev/null || true)
    [ "$http_status" = "200" ] && break
    sleep 2
done

if [ "$http_status" = "200" ]; then
    _tap_ok "GET /ready returns 200 within ${POLL_TIMEOUT}s with /opt/agentbox read-only"
else
    _tap_not_ok "GET /ready returns 200 within ${POLL_TIMEOUT}s with /opt/agentbox read-only (got: '${http_status}')"
    docker logs "${CONTAINER_NAME}" 2>&1 | tail -40 >&2
fi

# ── assertion 2: no Read-only file system errors in docker logs ───────────────
rofs_errors=$(docker logs "${CONTAINER_NAME}" 2>&1 \
    | grep -i 'Read-only file system' || true)

if [ -z "$rofs_errors" ]; then
    _tap_ok "docker logs contain no 'Read-only file system' errors"
else
    _tap_not_ok "docker logs contain no 'Read-only file system' errors"
    echo "# offending log lines:" >&2
    echo "$rofs_errors" | sed 's/^/#   /' >&2
fi

# ── assertion 3a: /workspace/README.agentbox.md written at boot ──────────────
if docker exec "${CONTAINER_NAME}" test -f /workspace/README.agentbox.md 2>/dev/null; then
    _tap_ok "/workspace/README.agentbox.md created by bootstrap"
else
    _tap_not_ok "/workspace/README.agentbox.md created by bootstrap (writable /workspace required)"
fi

# ── assertion 3b: /etc/profile.d/agentbox-runtime.sh written at boot ─────────
if docker exec "${CONTAINER_NAME}" test -f /etc/profile.d/agentbox-runtime.sh 2>/dev/null; then
    _tap_ok "/etc/profile.d/agentbox-runtime.sh created by bootstrap"
else
    _tap_not_ok "/etc/profile.d/agentbox-runtime.sh created by bootstrap (writable /etc/profile.d required)"
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo "1..${TAP_N}"
[ "$TAP_FAIL" -eq 0 ] && exit 0 || exit 1
