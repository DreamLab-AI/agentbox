#!/usr/bin/env bash
# RC-003-06 — configurable image reference (PRD-003 §5.1 / ADR-007 Decision 1)
#
# Two cases:
#   Case A: local build image  — AGENTBOX_IMAGE_REF=agentbox:runtime-x86_64-linux
#   Case B: registry image     — AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest
#
# Each case starts the compose stack with that image ref, polls /ready for HTTP 200,
# then tears the stack down.
#
# Exit codes
#   0  — both cases passed
#   1  — assertion failed
#   77 — skip (no Docker socket, or registry image not published)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
READY_URL="http://localhost:9090/ready"
POLL_TIMEOUT=60   # seconds per case
CONTAINER_NAME="agentbox-rc003-06"

# ── Skip guard: Docker socket ───────────────────────────────────────────────
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ]; then
    echo "SKIP: no Docker socket available"
    exit 77
fi

if ! docker info >/dev/null 2>&1; then
    echo "SKIP: Docker daemon not reachable"
    exit 77
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
    echo "SKIP: docker-compose.yml not found at ${COMPOSE_FILE}"
    exit 77
fi

# ── Helper: poll /ready ─────────────────────────────────────────────────────
poll_ready() {
    local deadline=$(( $(date +%s) + POLL_TIMEOUT ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        local status
        status=$(curl -so /dev/null -w '%{http_code}' "${READY_URL}" 2>/dev/null || true)
        if [ "$status" = "200" ]; then
            return 0
        fi
        sleep 2
    done
    return 1
}

# ── Helper: bring the stack down on exit ────────────────────────────────────
teardown() {
    AGENTBOX_IMAGE_REF="${_teardown_ref:-}" \
        docker compose -f "${COMPOSE_FILE}" \
            -p rc003-06 \
            down --remove-orphans --volumes 2>/dev/null || true
}

# ── Case A: local build image ───────────────────────────────────────────────
run_case_a() {
    local image_ref="agentbox:runtime-x86_64-linux"

    # Skip if the local image has not been built/loaded
    if ! docker image inspect "${image_ref}" >/dev/null 2>&1; then
        echo "SKIP (case A): local image '${image_ref}' not loaded into Docker"
        return 77
    fi

    echo "--- RC-003-06 case A: local image (${image_ref})"
    _teardown_ref="${image_ref}"
    trap teardown EXIT

    AGENTBOX_IMAGE_REF="${image_ref}" \
        docker compose -f "${COMPOSE_FILE}" \
            -p rc003-06 \
            up -d 2>&1

    if poll_ready; then
        echo "PASS case A: GET /ready => 200 (image: ${image_ref})"
    else
        echo "FAIL case A: /ready did not return 200 within ${POLL_TIMEOUT}s (image: ${image_ref})"
        AGENTBOX_IMAGE_REF="${image_ref}" \
            docker compose -f "${COMPOSE_FILE}" -p rc003-06 logs --tail 40 2>/dev/null || true
        teardown
        trap - EXIT
        return 1
    fi

    teardown
    trap - EXIT
    return 0
}

# ── Case B: registry image ───────────────────────────────────────────────────
run_case_b() {
    local image_ref="ghcr.io/dreamlab-ai/agentbox:latest"

    # Skip if the registry image has not been published or is unreachable
    if ! docker manifest inspect "${image_ref}" >/dev/null 2>&1; then
        echo "SKIP (case B): registry image '${image_ref}' not accessible (not published or no network)"
        return 77
    fi

    echo "--- RC-003-06 case B: registry image (${image_ref})"
    _teardown_ref="${image_ref}"
    trap teardown EXIT

    # Pull before compose to make the skip check deterministic
    docker pull "${image_ref}" 2>&1

    AGENTBOX_IMAGE_REF="${image_ref}" \
        docker compose -f "${COMPOSE_FILE}" \
            -p rc003-06 \
            up -d 2>&1

    if poll_ready; then
        echo "PASS case B: GET /ready => 200 (image: ${image_ref})"
    else
        echo "FAIL case B: /ready did not return 200 within ${POLL_TIMEOUT}s (image: ${image_ref})"
        AGENTBOX_IMAGE_REF="${image_ref}" \
            docker compose -f "${COMPOSE_FILE}" -p rc003-06 logs --tail 40 2>/dev/null || true
        teardown
        trap - EXIT
        return 1
    fi

    teardown
    trap - EXIT
    return 0
}

# ── Also verify docker compose config resolves the image correctly ───────────
verify_compose_config() {
    local image_ref="$1"
    local resolved
    resolved=$(AGENTBOX_IMAGE_REF="${image_ref}" \
               docker compose -f "${COMPOSE_FILE}" -p rc003-06 config 2>/dev/null \
               | grep -E '^\s+image:' | head -1 | sed 's/.*image:[[:space:]]*//' || true)

    if [ "${resolved}" = "${image_ref}" ]; then
        echo "PASS compose config: image resolved to '${resolved}'"
        return 0
    else
        echo "FAIL compose config: expected '${image_ref}', got '${resolved}'"
        return 1
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
overall=0
skip_a=0
skip_b=0

# Case A
case_a_rc=0
run_case_a || case_a_rc=$?
if [ "$case_a_rc" -eq 77 ]; then
    skip_a=1
elif [ "$case_a_rc" -ne 0 ]; then
    overall=1
else
    verify_compose_config "agentbox:runtime-x86_64-linux" || overall=1
fi

# Case B
case_b_rc=0
run_case_b || case_b_rc=$?
if [ "$case_b_rc" -eq 77 ]; then
    skip_b=1
elif [ "$case_b_rc" -ne 0 ]; then
    overall=1
else
    verify_compose_config "ghcr.io/dreamlab-ai/agentbox:latest" || overall=1
fi

# If both cases were skipped, propagate skip
if [ "$skip_a" -eq 1 ] && [ "$skip_b" -eq 1 ]; then
    echo "SKIP RC-003-06: both cases skipped (no local image and registry image not accessible)"
    exit 77
fi

if [ "$overall" -eq 0 ]; then
    echo "PASS RC-003-06"
fi

exit "$overall"
