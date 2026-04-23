#!/usr/bin/env bash
# tests/flake/skills-input.sh
# Smoke test: verify that flake.nix declares a "skills" input.
#
# Tests:
#   1. `nix flake metadata` lists the "skills" input.
#   2. The skills input resolves to a path-type store entry.
#   3. The skills input is marked flake=false (plain source tree).
#
# Exit code: 0 = all passed, 1 = any failure.
# Skip code: 77 = nix not available in this environment.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# ── prerequisite check ────────────────────────────────────────────────────────
if ! command -v nix &>/dev/null; then
  echo "nix not found — skipping skills-input tests (exit 77)"
  exit 77
fi

# ── test 1: metadata lists "skills" input ─────────────────────────────────────
META=$(nix flake metadata --json "$REPO_ROOT" 2>/dev/null || echo "{}")
if echo "$META" | grep -q '"skills"'; then
  pass "nix flake metadata lists skills input"
else
  fail "nix flake metadata does not list skills input"
fi

# ── test 2: skills input resolves to a path in the Nix store ─────────────────
SKILLS_PATH=$(echo "$META" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); \
  print(d.get('locks',{}).get('nodes',{}).get('skills',{}).get('locked',{}).get('type','MISSING'))" \
  2>/dev/null || echo "MISSING")
if [ "$SKILLS_PATH" = "path" ]; then
  pass "skills input locked type is path"
else
  fail "skills input locked type expected 'path', got '$SKILLS_PATH'"
fi

# ── test 3: flake.nix declares flake=false for skills ─────────────────────────
if grep -q 'flake = false' "$REPO_ROOT/flake.nix"; then
  pass "flake.nix declares flake = false for skills input"
else
  fail "flake.nix missing 'flake = false' for skills input"
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
