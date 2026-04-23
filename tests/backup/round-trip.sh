#!/usr/bin/env bash
# Round-trip smoke test for agentbox.sh backup/restore.
# Exit 77 = skip (docker unavailable).  Exit 0 = pass.  Non-zero = fail.

set -euo pipefail

SKIP_EXIT=77
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTBOX="${SCRIPT_DIR}/agentbox.sh"

# ---------------------------------------------------------------------------
# Skip if docker is not available
# ---------------------------------------------------------------------------
if ! command -v docker &>/dev/null || ! docker info &>/dev/null 2>&1; then
    echo "SKIP: docker not available"
    exit "${SKIP_EXIT}"
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
TEST_VOLUME="agentbox-test-roundtrip-$$"
TMP_DIR="$(mktemp -d)"
BACKUP_DIR="${TMP_DIR}/backups"
mkdir -p "${BACKUP_DIR}"

cleanup() {
    docker volume rm "${TEST_VOLUME}" 2>/dev/null || true
    rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "=== agentbox backup/restore round-trip ==="

# ---------------------------------------------------------------------------
# 1. Create and seed a test volume with known content
# ---------------------------------------------------------------------------
echo "--- Seeding test volume: ${TEST_VOLUME}"
docker volume create "${TEST_VOLUME}"

docker run --rm \
    -v "${TEST_VOLUME}:/data" \
    alpine:3.20 \
    sh -c '
        echo "hello-agentbox" > /data/canary.txt
        mkdir -p /data/subdir
        echo "nested-content"  > /data/subdir/nested.txt
        md5sum /data/canary.txt /data/subdir/nested.txt > /data/checksums.md5
    '

# Capture the original checksums
ORIGINAL_MD5=$(docker run --rm \
    -v "${TEST_VOLUME}:/data:ro" \
    alpine:3.20 \
    sh -c 'cat /data/checksums.md5')

# ---------------------------------------------------------------------------
# 2. Manually invoke backup logic against the test volume
#    We call the internal _volume_tar helper by sourcing agentbox.sh in a
#    sub-shell that overrides the real volume names to our test volume.
# ---------------------------------------------------------------------------
echo "--- Backing up test volume"
STAGE_DIR="${TMP_DIR}/stage"
mkdir -p "${STAGE_DIR}/volumes/ruvector-data"

# Source only the helper functions (skip main dispatch)
(
    # Provide stubs so the file can be sourced without side-effects
    check_ip() { :; }
    cmd_ssh()  { :; }
    # Override docker compose to no-op during source
    docker() {
        if [[ "${1:-}" == "compose" ]]; then return 0; fi
        command docker "$@"
    }

    # shellcheck source=/dev/null
    source "${AGENTBOX}"

    # Dump test volume into stage
    _volume_tar "${TEST_VOLUME}" | tar -C "${STAGE_DIR}/volumes/ruvector-data" -xf -

    # Write a minimal manifest
    cat > "${STAGE_DIR}/MANIFEST.json" <<EOF
{
  "version": "1",
  "timestamp": "$(date -u +%Y%m%dT%H%M%SZ)",
  "include_secrets": 0,
  "solid_included": 0,
  "contents": {
    "ruvector_data": true,
    "solid_data": false,
    "sovereign_identities": false,
    "agentbox_toml": false,
    "supervisord_conf": false,
    "profiles": false
  },
  "exclusions": {
    "default": ["*.key","*.pem","*.env","mgmt-key","sovereign-identities"],
    "secrets_flag_required": ["sovereign-identities","mgmt-key"]
  }
}
EOF

    tar -C "${STAGE_DIR}" -czf "${BACKUP_DIR}/test-backup.tgz" .
) 2>/dev/null

if [[ ! -f "${BACKUP_DIR}/test-backup.tgz" ]]; then
    echo "FAIL: backup archive was not created"
    exit 1
fi
echo "    backup archive: ${BACKUP_DIR}/test-backup.tgz"

# ---------------------------------------------------------------------------
# 3. Destroy the test volume
# ---------------------------------------------------------------------------
echo "--- Destroying test volume"
docker volume rm "${TEST_VOLUME}"

# ---------------------------------------------------------------------------
# 4. Restore using internal _volume_untar helper
# ---------------------------------------------------------------------------
echo "--- Restoring test volume"
RESTORE_DIR="${TMP_DIR}/restore-stage"
mkdir -p "${RESTORE_DIR}"
tar -C "${RESTORE_DIR}" -xzf "${BACKUP_DIR}/test-backup.tgz"

if [[ ! -f "${RESTORE_DIR}/MANIFEST.json" ]]; then
    echo "FAIL: MANIFEST.json missing from archive"
    exit 1
fi

docker volume create "${TEST_VOLUME}"

(
    check_ip() { :; }
    docker() {
        if [[ "${1:-}" == "compose" ]]; then return 0; fi
        command docker "$@"
    }
    # shellcheck source=/dev/null
    source "${AGENTBOX}"
    tar -C "${RESTORE_DIR}/volumes/ruvector-data" -cf - . | _volume_untar "${TEST_VOLUME}"
) 2>/dev/null

# ---------------------------------------------------------------------------
# 5. Verify checksums match
# ---------------------------------------------------------------------------
echo "--- Verifying checksums"
RESTORED_MD5=$(docker run --rm \
    -v "${TEST_VOLUME}:/data:ro" \
    alpine:3.20 \
    sh -c 'cat /data/checksums.md5')

if [[ "${ORIGINAL_MD5}" != "${RESTORED_MD5}" ]]; then
    echo "FAIL: checksum mismatch after restore"
    echo "  original : ${ORIGINAL_MD5}"
    echo "  restored : ${RESTORED_MD5}"
    exit 1
fi

# Also verify the canary file content directly
CANARY=$(docker run --rm \
    -v "${TEST_VOLUME}:/data:ro" \
    alpine:3.20 cat /data/canary.txt)

if [[ "${CANARY}" != "hello-agentbox" ]]; then
    echo "FAIL: canary content mismatch: got '${CANARY}'"
    exit 1
fi

echo "=== PASS: round-trip backup/restore verified ==="
exit 0
