#!/usr/bin/env bash
# RC-002-02 — Artifact probes per feature matrix (PRD-002 §6 AC-5)
#
# For each probe script under tests/artifact-probes/ runs it via `docker exec`
# against a running agentbox container.  Also asserts that no NEW node_modules
# directory was created under /opt/agentbox at runtime (spot-check against a
# known sentinel path that must NOT exist post-boot).
#
# The test assumes the container is already running.  If AGENTBOX_CONTAINER is
# unset, it defaults to "agentbox".  Set AGENTBOX_IMAGE_REF + AGENTBOX_START=1
# to have this test start and stop a container automatically.
#
# Exit codes
#   0  — all required probes passed, no runtime node_modules created
#   1  — one or more assertions failed
#   77 — skip (no Docker socket or named container not running)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PROBES_DIR="${REPO_ROOT}/tests/artifact-probes"
CONTAINER="${AGENTBOX_CONTAINER:-agentbox}"
IMAGE_REF="${AGENTBOX_IMAGE_REF:-agentbox:runtime-x86_64-linux}"
MGMT_PORT=9090
POLL_TIMEOUT=60

TAP_N=0
TAP_FAIL=0
STARTED_CONTAINER=0

_tap_ok()     { TAP_N=$(( TAP_N + 1 )); echo "ok ${TAP_N} - $1"; }
_tap_not_ok() { TAP_N=$(( TAP_N + 1 )); echo "not ok ${TAP_N} - $1"; TAP_FAIL=$(( TAP_FAIL + 1 )); }

cleanup() {
    if [ "$STARTED_CONTAINER" -eq 1 ]; then
        docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

# ── skip guards ───────────────────────────────────────────────────────────────
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ]; then
    echo "ok 1 # SKIP RC-002-02: no Docker socket available"
    echo "1..1"
    exit 77
fi

if ! docker info >/dev/null 2>&1; then
    echo "ok 1 # SKIP RC-002-02: Docker daemon not reachable"
    echo "1..1"
    exit 77
fi

# ── optionally start the container ───────────────────────────────────────────
if [ "${AGENTBOX_START:-0}" = "1" ]; then
    if ! docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
        echo "ok 1 # SKIP RC-002-02: image '${IMAGE_REF}' not loaded"
        echo "1..1"
        exit 77
    fi
    docker run -d \
        --name "${CONTAINER}" \
        --tmpfs /tmp \
        --tmpfs /run \
        --tmpfs /var/run \
        "${IMAGE_REF}" >/dev/null
    STARTED_CONTAINER=1

    # Wait for readiness before probing
    deadline=$(( $(date +%s) + POLL_TIMEOUT ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        st=$(docker exec "${CONTAINER}" \
            curl -so /dev/null -w '%{http_code}' \
            "http://localhost:${MGMT_PORT}/ready" 2>/dev/null || true)
        [ "$st" = "200" ] && break
        sleep 2
    done
fi

# Skip if the container is not running
if ! docker inspect --format '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -q '^true$'; then
    echo "ok 1 # SKIP RC-002-02: container '${CONTAINER}' is not running (set AGENTBOX_START=1 to auto-start)"
    echo "1..1"
    exit 77
fi

# ── record node_modules snapshot before probes ───────────────────────────────
nm_before=$(docker exec "${CONTAINER}" \
    find /opt/agentbox -maxdepth 3 -name node_modules -type d 2>/dev/null \
    | sort || true)

# ── run each probe via docker exec ───────────────────────────────────────────
probe_scripts=()
while IFS= read -r -d '' f; do
    probe_scripts+=("$f")
done < <(find "${PROBES_DIR}" -maxdepth 1 -name '*-probe.sh' -print0 | sort -z)

if [ "${#probe_scripts[@]}" -eq 0 ]; then
    _tap_not_ok "at least one probe script found in ${PROBES_DIR}"
else
    _tap_ok "probe scripts found in ${PROBES_DIR} (count: ${#probe_scripts[@]})"
fi

for probe in "${probe_scripts[@]}"; do
    probe_name="$(basename "$probe" .sh)"
    # Copy the probe into the container and run it
    docker cp "${probe}" "${CONTAINER}:/tmp/${probe_name}.sh" >/dev/null 2>&1
    exit_code=0
    output=$(docker exec "${CONTAINER}" bash "/tmp/${probe_name}.sh" 2>&1) || exit_code=$?
    if [ "$exit_code" -eq 0 ]; then
        _tap_ok "${probe_name}: probe exited 0"
    elif [ "$exit_code" -eq 77 ]; then
        TAP_N=$(( TAP_N + 1 ))
        echo "ok ${TAP_N} # SKIP ${probe_name}: probe skipped (feature disabled or optional)"
    else
        _tap_not_ok "${probe_name}: probe exited ${exit_code}"
        echo "# probe output:" >&2
        echo "$output" | sed 's/^/#   /' >&2
    fi
done

# ── assert no NEW node_modules created under /opt/agentbox at runtime ─────────
nm_after=$(docker exec "${CONTAINER}" \
    find /opt/agentbox -maxdepth 3 -name node_modules -type d 2>/dev/null \
    | sort || true)

new_nm=$(comm -13 <(echo "$nm_before") <(echo "$nm_after") || true)
if [ -z "$new_nm" ]; then
    _tap_ok "no new node_modules directories created under /opt/agentbox during probe phase"
else
    _tap_not_ok "no new node_modules directories created under /opt/agentbox during probe phase"
    echo "# newly created node_modules paths:" >&2
    echo "$new_nm" | sed 's/^/#   /' >&2
fi

# ── spot-check: runtime-created sentinel must not exist ──────────────────────
sentinel="/opt/agentbox/management-api/node_modules/@runtime-created"
if docker exec "${CONTAINER}" test ! -d "${sentinel}" 2>/dev/null; then
    _tap_ok "sentinel ${sentinel} does not exist (no runtime npm installs)"
else
    _tap_not_ok "sentinel ${sentinel} must not exist (runtime npm install detected)"
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo "1..${TAP_N}"
[ "$TAP_FAIL" -eq 0 ] && exit 0 || exit 1
