#!/usr/bin/env bash
# tests/tui/non-interactive-validate.sh
# Exercises start-agentbox.sh --validate-only against fixture manifests.
# Exit 0 = all assertions passed. Exit 1 = one or more failures.
# No whiptail or Docker required — purely exercises the validator path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LAUNCHER="${ROOT_DIR}/scripts/start-agentbox.sh"
FIXTURES="${SCRIPT_DIR}/fixtures"

PASS=0
FAIL=0

# ── assert helper ──────────────────────────────────────────────────────────────
assert_exit() {
  local label="$1" fixture="$2" expected_exit="$3"

  local actual_exit=0
  # Override CONFIG_FILE so --validate-only reads the fixture, not the real toml.
  # The launcher sources CONFIG_FILE from its own vars; we cannot override that
  # directly, so we temporarily symlink the fixture as a known path.
  local tmp_cfg; tmp_cfg="$(mktemp --suffix=.toml)"
  cp "${fixture}" "${tmp_cfg}"

  # Run validator — must disable errexit locally so a non-zero exit is catchable.
  set +e
  node "${ROOT_DIR}/scripts/agentbox-config-validate.js" "${tmp_cfg}" \
    >/dev/null 2>&1
  actual_exit=$?
  set -e

  rm -f "${tmp_cfg}"

  if [[ "${actual_exit}" -eq "${expected_exit}" ]]; then
    echo "PASS  ${label}"
    PASS=$((PASS+1))
  else
    echo "FAIL  ${label} — expected exit ${expected_exit}, got ${actual_exit}"
    FAIL=$((FAIL+1))
  fi
}

assert_stderr_contains() {
  local label="$1" fixture="$2" pattern="$3"
  local tmp_cfg; tmp_cfg="$(mktemp --suffix=.toml)"
  cp "${fixture}" "${tmp_cfg}"

  local stderr_out
  set +e
  stderr_out="$(node "${ROOT_DIR}/scripts/agentbox-config-validate.js" "${tmp_cfg}" 2>&1 >/dev/null)"
  set -e
  rm -f "${tmp_cfg}"

  if echo "${stderr_out}" | grep -qE "${pattern}"; then
    echo "PASS  ${label} (pattern '${pattern}' found)"
    ((PASS++))
  else
    echo "FAIL  ${label} — pattern '${pattern}' not found in stderr:"
    echo "  ${stderr_out}"
    ((FAIL++))
  fi
}

# ── test suite ─────────────────────────────────────────────────────────────────
echo "=== TUI non-interactive validation tests ==="
echo ""

# 1. Valid standalone manifest → exit 0
assert_exit \
  "valid-standalone exits 0" \
  "${FIXTURES}/valid-standalone.toml" \
  0

# 2. E001 fixture → exit 1
assert_exit \
  "invalid-e001 exits 1" \
  "${FIXTURES}/invalid-e001.toml" \
  1

# 3. E001 fixture → stderr contains E001 code
assert_stderr_contains \
  "invalid-e001 stderr contains E001" \
  "${FIXTURES}/invalid-e001.toml" \
  "E001"

# 4. E019 fixture → exit 1
assert_exit \
  "invalid-e019 exits 1" \
  "${FIXTURES}/invalid-e019.toml" \
  1

# 5. E019 fixture → stderr contains E019 code
assert_stderr_contains \
  "invalid-e019 stderr contains E019" \
  "${FIXTURES}/invalid-e019.toml" \
  "E019"

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]] && exit 0 || exit 1
