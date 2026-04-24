#!/usr/bin/env bash
# RC-002-01 — No-network boot (PRD-002 §6 AC-2)
#
# Verifies that a container started with --network none reaches readiness
# within 60 s, proving boot does not require outbound network access.
#
# Strategy: because --network none also blocks host-to-container TCP, the
# /ready poll is driven through `docker exec` rather than a host-side curl.
#
# Exit codes
#   0  — /ready returned HTTP 200 with valid JSON shape within 60 s
#   1  — assertion failed
#   77 — skip (no Docker socket, image not loaded)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

IMAGE_REF="${AGENTBOX_IMAGE_REF:-agentbox:runtime-x86_64-linux}"
CONTAINER_NAME="agentbox-rc002-01"
MGMT_PORT=9090
POLL_TIMEOUT=60
TAP_N=0
TAP_FAIL=0

# ── helpers ──────────────────────────────────────────────────────────────────
_tap_ok()     { TAP_N=$(( TAP_N + 1 )); echo "ok ${TAP_N} - $1"; }
_tap_not_ok() { TAP_N=$(( TAP_N + 1 )); echo "not ok ${TAP_N} - $1"; TAP_FAIL=$(( TAP_FAIL + 1 )); }

cleanup() {
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── skip guards ───────────────────────────────────────────────────────────────
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ]; then
    echo "ok 1 # SKIP RC-002-01: no Docker socket available"
    echo "1..1"
    exit 77
fi

if ! docker info >/dev/null 2>&1; then
    echo "ok 1 # SKIP RC-002-01: Docker daemon not reachable"
    echo "1..1"
    exit 77
fi

if ! docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
    echo "ok 1 # SKIP RC-002-01: image '${IMAGE_REF}' not loaded (set AGENTBOX_IMAGE_REF to override)"
    echo "1..1"
    exit 77
fi

# ── start container with no network ──────────────────────────────────────────
docker run -d \
    --name "${CONTAINER_NAME}" \
    --network none \
    --read-only \
    --tmpfs /tmp \
    --tmpfs /run \
    --tmpfs /var/run \
    "${IMAGE_REF}" >/dev/null

# ── poll /ready via docker exec ───────────────────────────────────────────────
deadline=$(( $(date +%s) + POLL_TIMEOUT ))
http_status=""
while [ "$(date +%s)" -lt "$deadline" ]; do
    http_status=$(docker exec "${CONTAINER_NAME}" \
        curl -so /dev/null -w '%{http_code}' \
        "http://localhost:${MGMT_PORT}/ready" 2>/dev/null || true)
    [ "$http_status" = "200" ] && break
    sleep 2
done

# ── assertion 1: HTTP 200 within timeout ──────────────────────────────────────
if [ "$http_status" = "200" ]; then
    _tap_ok "GET /ready returns HTTP 200 with --network none within ${POLL_TIMEOUT}s"
else
    _tap_not_ok "GET /ready returns HTTP 200 with --network none within ${POLL_TIMEOUT}s (got: '${http_status}')"
    docker logs "${CONTAINER_NAME}" 2>&1 | tail -30 >&2
fi

# ── assertion 2: JSON shape {"ready":true,"since":"...","requirements":[...]} ─
if [ "$http_status" = "200" ]; then
    body=$(docker exec "${CONTAINER_NAME}" \
        curl -sf "http://localhost:${MGMT_PORT}/ready" 2>/dev/null || true)

    ready_val=$(echo "$body" | docker exec -i "${CONTAINER_NAME}" \
        sh -c 'jq -r ".ready // empty" 2>/dev/null' 2>/dev/null || true)
    since_val=$(echo "$body" | docker exec -i "${CONTAINER_NAME}" \
        sh -c 'jq -r ".since // empty" 2>/dev/null' 2>/dev/null || true)
    reqs_type=$(echo "$body" | docker exec -i "${CONTAINER_NAME}" \
        sh -c 'jq -r "(.requirements | type) // empty" 2>/dev/null' 2>/dev/null || true)

    if [ "$ready_val" = "true" ] && [ -n "$since_val" ] && [ "$reqs_type" = "array" ]; then
        _tap_ok "response body has shape {ready:true, since:\"...\", requirements:[...]}"
    else
        _tap_not_ok "response body has shape {ready:true, since:\"...\", requirements:[...]} (body: ${body})"
    fi
else
    _tap_not_ok "response body has shape {ready:true, since:\"...\", requirements:[...]} (skipped: no 200)"
fi

# ── assertion 3: no outbound DNS or TCP attempts logged ───────────────────────
# A best-effort check: container logs should not mention npm/registry/github download
install_noise=$(docker logs "${CONTAINER_NAME}" 2>&1 \
    | grep -Ei 'npm install|pip install|playwright install|Downloading|registry\.npmjs|pypi\.org' \
    | grep -v '^#' || true)
if [ -z "$install_noise" ]; then
    _tap_ok "container logs contain no package-manager download activity"
else
    _tap_not_ok "container logs contain no package-manager download activity"
    echo "# offending log lines:" >&2
    echo "$install_noise" >&2
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo "1..${TAP_N}"
[ "$TAP_FAIL" -eq 0 ] && exit 0 || exit 1
