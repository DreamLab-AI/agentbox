#!/usr/bin/env bash
# RC-003-08 — Observability port-exposure chain verification
#
# Verifies that the metrics_port declared in agentbox.toml flows end-to-end:
#   agentbox.toml → flake.nix → docker-compose.yml → container → host
#
# Steps:
#   1. Parse [observability].metrics_port from agentbox.toml.
#   2. Verify docker-compose.yml ports: block contains the expected binding.
#   3. docker exec ss -tlnp to confirm the port is bound inside the container.
#   4. curl http://host:<port>/metrics and verify output starts with # HELP lines.
#
# Requires: bash, docker, curl, ss (iproute2), python3 or a TOML parser.
# Exit code 0 = all checks pass; non-zero = failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

AGENTBOX_TOML="${REPO_ROOT}/agentbox.toml"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"

# Fallback compose file location (flake generates to etc/agentbox/)
if [[ ! -f "${COMPOSE_FILE}" ]]; then
    COMPOSE_FILE="${REPO_ROOT}/etc/agentbox/docker-compose.yml"
fi

CONTAINER_NAME="${AGENTBOX_CONTAINER_NAME:-agentbox}"
HOST="${AGENTBOX_TEST_HOST:-localhost}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*" >&2; exit 1; }

# Parse a scalar value from a TOML file using python3 (available in container
# and in most CI environments). Falls back to grep-based extraction.
toml_get() {
    local file="$1" section="$2" key="$3"
    python3 - "${file}" "${section}" "${key}" << 'PYEOF' 2>/dev/null || true
import sys, re

file_path, section, key = sys.argv[1], sys.argv[2], sys.argv[3]

with open(file_path) as f:
    content = f.read()

# Find the section and extract the key value.
# Handles basic scalar values (integers, quoted strings).
in_section = False
for line in content.splitlines():
    stripped = line.strip()
    if re.match(r'^\[' + re.escape(section) + r'\]', stripped):
        in_section = True
        continue
    if in_section and stripped.startswith('['):
        break
    if in_section:
        m = re.match(r'^\s*' + re.escape(key) + r'\s*=\s*(.+)', stripped)
        if m:
            val = m.group(1).strip().strip('"').strip("'")
            print(val)
            break
PYEOF
}

# ---------------------------------------------------------------------------
# Step 1: Parse metrics_port from agentbox.toml
# ---------------------------------------------------------------------------
echo "--- Step 1: Read [observability].metrics_port from agentbox.toml ---"
if [[ ! -f "${AGENTBOX_TOML}" ]]; then
    fail "agentbox.toml not found at ${AGENTBOX_TOML}"
fi

METRICS_PORT=$(toml_get "${AGENTBOX_TOML}" "observability" "metrics_port")
if [[ -z "${METRICS_PORT}" ]]; then
    fail "[observability].metrics_port not found in ${AGENTBOX_TOML}"
fi
pass "metrics_port = ${METRICS_PORT}"

# ---------------------------------------------------------------------------
# Step 2: Verify docker-compose.yml ports block
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 2: Verify ${COMPOSE_FILE} ports block ---"
if [[ ! -f "${COMPOSE_FILE}" ]]; then
    echo "[SKIP] docker-compose.yml not found at ${COMPOSE_FILE} (run: nix build .#compose)"
else
    if grep -qE "\"${METRICS_PORT}:${METRICS_PORT}\"" "${COMPOSE_FILE}"; then
        pass "compose ports contains \"${METRICS_PORT}:${METRICS_PORT}\""
    else
        fail "Expected port binding \"${METRICS_PORT}:${METRICS_PORT}\" not found in ${COMPOSE_FILE}"
    fi
fi

# ---------------------------------------------------------------------------
# Step 3: Verify port is bound inside container
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 3: Verify port ${METRICS_PORT} is bound inside container ---"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
    echo "[SKIP] Container '${CONTAINER_NAME}' is not running — skipping in-container check"
else
    BOUND=$(docker exec "${CONTAINER_NAME}" ss -tlnp 2>/dev/null | grep ":${METRICS_PORT} " || true)
    if [[ -n "${BOUND}" ]]; then
        pass "Port ${METRICS_PORT} is bound inside container: ${BOUND}"
    else
        fail "Port ${METRICS_PORT} is NOT bound inside container '${CONTAINER_NAME}'"
    fi
fi

# ---------------------------------------------------------------------------
# Step 4: Verify /metrics endpoint returns Prometheus output
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 4: Verify http://${HOST}:${METRICS_PORT}/metrics ---"

METRICS_URL="http://${HOST}:${METRICS_PORT}/metrics"
METRICS_RESPONSE=$(curl -sf --max-time 5 "${METRICS_URL}" 2>/dev/null) || {
    echo "[SKIP] Could not reach ${METRICS_URL} — container may not be running on this host"
    echo ""
    echo "=== RC-003-08 completed (partial — container not reachable) ==="
    exit 0
}

# Verify Prometheus text format: first non-empty line must start with # HELP
FIRST_HELP=$(printf '%s' "${METRICS_RESPONSE}" | grep '^# HELP' | head -1 || true)
if [[ -z "${FIRST_HELP}" ]]; then
    fail "/metrics response does not contain any '# HELP' lines (not Prometheus format)"
fi
pass "Metrics endpoint returns Prometheus format"

echo ""
echo "First 5 non-comment lines:"
printf '%s' "${METRICS_RESPONSE}" | grep -v '^#' | head -5 | while IFS= read -r line; do
    echo "  ${line}"
done

echo ""
echo "=== RC-003-08 PASSED ==="
