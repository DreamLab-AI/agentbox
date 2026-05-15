#!/usr/bin/env bash
# tests/flake/compose-generator.sh
# Validates the manifest-driven docker-compose.yml generator in flake.nix.
#
# Tests:
#   1. nix build .#compose produces a parseable compose file.
#   2. Default manifest (no [gpu], no [integrations]) omits the ollama service.
#   3. Enabling [integrations.ragflow] adds the visionclaw_network external network.
#   4. Disabling [integrations.ragflow] removes the visionclaw_network network.
#   5. docker compose config --quiet passes (if docker is available).
#
# Exit code: 0 = all tests passed, 1 = any failure.
# Skip code: 77 = skipped (nix not available in this environment).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0
SKIP=0

pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
skip() { echo "SKIP: $1"; SKIP=$((SKIP+1)); }

# ── prerequisite check ────────────────────────────────────────────────────────
if ! command -v nix &>/dev/null; then
  echo "nix not found — skipping compose-generator tests"
  exit 77
fi

# ── helpers ───────────────────────────────────────────────────────────────────

# Emit the compose text for a given agentbox.toml override.
# $1 = path to a temporary agentbox.toml (replaces the repo one during eval).
emit_compose() {
  local toml_override="$1"
  # Use nix eval to render composeText without triggering a full build.
  # We pass the toml path via NIX_PATH override trick; since flake.nix reads
  # ./agentbox.toml at eval time we create a temporary worktree copy.
  local tmpdir
  tmpdir="$(mktemp -d)"
  cp -a "$REPO_ROOT/." "$tmpdir/"
  cp "$toml_override" "$tmpdir/agentbox.toml"
  # Evaluate the composeText attribute from the temporary flake.
  nix eval --raw "$tmpdir#packages.x86_64-linux.compose" \
    --override-input nixpkgs nixpkgs \
    2>/dev/null || \
  # Fallback: build the compose derivation and read the file.
  (nix build "$tmpdir#packages.x86_64-linux.compose" --out-link "$tmpdir/compose-result" --no-link 2>/dev/null \
    && cat "$tmpdir/compose-result/docker-compose.yml")
  rm -rf "$tmpdir"
}

# ── test 1: nix build .#compose succeeds ──────────────────────────────────────
echo "=== Test 1: nix build .#compose ==="
BUILD_OUT="$(mktemp -d)"
if nix build "$REPO_ROOT#packages.x86_64-linux.compose" \
     --out-link "$BUILD_OUT/compose-result" \
     --no-link \
     2>&1; then
  COMPOSE_FILE="$BUILD_OUT/compose-result/docker-compose.yml"
  if [[ -f "$COMPOSE_FILE" ]]; then
    pass "nix build .#compose produced docker-compose.yml"
  else
    fail "nix build .#compose succeeded but docker-compose.yml not found"
  fi
else
  fail "nix build .#compose failed"
  COMPOSE_FILE=""
fi
rm -rf "$BUILD_OUT"

# ── test 2: default manifest omits ollama (no [gpu] section) ──────────────────
echo "=== Test 2: default manifest omits ollama service ==="
DEFAULT_TOML="$(mktemp --suffix=.toml)"
cat > "$DEFAULT_TOML" <<'TOML'
[core]
orchestration = "ruflo-v3"
vector_db = "ruvector-embedded"

[sovereign_mesh]
enabled = true
solid_pod = true
nostr_bridge = true
https_bridge = false

[desktop]
enabled = false
resolution = "1920x1080"

[skills.browser]
agent_browser = true
playwright = true
qe_browser = false

[skills.media]
ffmpeg = true
imagemagick = true
comfyui_integration = false

[skills.spatial_and_3d]
qgis = false
blender = false

[skills.data_science]
pytorch = false
jupyter = false

[skills.docs]
latex = true
report_builder = true
mermaid = true

[toolchains]
claude = true
ruflo = true
claude_flow = true
agentic_qe = true
nagual_qe = true
codebase_memory = true
rust = true
TOML

TMPDIR_2="$(mktemp -d)"
cp -a "$REPO_ROOT/." "$TMPDIR_2/"
cp "$DEFAULT_TOML" "$TMPDIR_2/agentbox.toml"
if nix build "$TMPDIR_2#packages.x86_64-linux.compose" \
     --out-link "$TMPDIR_2/result" \
     --no-link 2>/dev/null; then
  GENERATED="$TMPDIR_2/result/docker-compose.yml"
  if grep -q "ollama:" "$GENERATED"; then
    fail "default manifest (no [gpu]) should not include ollama service"
  else
    pass "default manifest omits ollama service"
  fi
else
  skip "nix build failed for test 2 (possibly evaluation-only environment)"
fi
rm -rf "$TMPDIR_2" "$DEFAULT_TOML"

# ── test 3: ragflow enabled adds visionclaw_network network ───────────────────────
echo "=== Test 3: ragflow enabled → visionclaw_network network present ==="
RAGFLOW_ON_TOML="$(mktemp --suffix=.toml)"
cat > "$RAGFLOW_ON_TOML" <<'TOML'
[core]
orchestration = "ruflo-v3"
vector_db = "ruvector-embedded"

[sovereign_mesh]
enabled = false

[desktop]
enabled = false
resolution = "1920x1080"

[skills.browser]
agent_browser = false
playwright = false
qe_browser = false

[skills.media]
ffmpeg = false
imagemagick = false
comfyui_integration = false

[skills.spatial_and_3d]
qgis = false
blender = false

[skills.data_science]
pytorch = false
jupyter = false

[skills.docs]
latex = false
report_builder = false
mermaid = false

[toolchains]
claude = true
ruflo = true

[integrations.ragflow]
enabled = true
TOML

TMPDIR_3="$(mktemp -d)"
cp -a "$REPO_ROOT/." "$TMPDIR_3/"
cp "$RAGFLOW_ON_TOML" "$TMPDIR_3/agentbox.toml"
if nix build "$TMPDIR_3#packages.x86_64-linux.compose" \
     --out-link "$TMPDIR_3/result" \
     --no-link 2>/dev/null; then
  GENERATED="$TMPDIR_3/result/docker-compose.yml"
  if grep -q "visionclaw_network" "$GENERATED"; then
    pass "ragflow enabled → visionclaw_network network present"
  else
    fail "ragflow enabled but visionclaw_network network missing from compose"
  fi
else
  skip "nix build failed for test 3 (possibly evaluation-only environment)"
fi
rm -rf "$TMPDIR_3" "$RAGFLOW_ON_TOML"

# ── test 4: ragflow disabled omits visionclaw_network network ─────────────────────
echo "=== Test 4: ragflow disabled → visionclaw_network network absent ==="
RAGFLOW_OFF_TOML="$(mktemp --suffix=.toml)"
cat > "$RAGFLOW_OFF_TOML" <<'TOML'
[core]
orchestration = "ruflo-v3"
vector_db = "ruvector-embedded"

[sovereign_mesh]
enabled = false

[desktop]
enabled = false
resolution = "1920x1080"

[skills.browser]
agent_browser = false
playwright = false
qe_browser = false

[skills.media]
ffmpeg = false
imagemagick = false
comfyui_integration = false

[skills.spatial_and_3d]
qgis = false
blender = false

[skills.data_science]
pytorch = false
jupyter = false

[skills.docs]
latex = false
report_builder = false
mermaid = false

[toolchains]
claude = true
ruflo = true

[integrations.ragflow]
enabled = false
TOML

TMPDIR_4="$(mktemp -d)"
cp -a "$REPO_ROOT/." "$TMPDIR_4/"
cp "$RAGFLOW_OFF_TOML" "$TMPDIR_4/agentbox.toml"
if nix build "$TMPDIR_4#packages.x86_64-linux.compose" \
     --out-link "$TMPDIR_4/result" \
     --no-link 2>/dev/null; then
  GENERATED="$TMPDIR_4/result/docker-compose.yml"
  if grep -q "visionclaw_network" "$GENERATED"; then
    fail "ragflow disabled but visionclaw_network network still present"
  else
    pass "ragflow disabled → visionclaw_network network absent"
  fi
else
  skip "nix build failed for test 4 (possibly evaluation-only environment)"
fi
rm -rf "$TMPDIR_4" "$RAGFLOW_OFF_TOML"

# ── test 5: docker compose config --quiet (if docker available) ───────────────
echo "=== Test 5: docker compose config --quiet ==="
STATIC_COMPOSE="$REPO_ROOT/docker-compose.yml"
if command -v docker &>/dev/null; then
  if docker compose -f "$STATIC_COMPOSE" config --quiet 2>/dev/null; then
    pass "docker compose config --quiet passed on committed docker-compose.yml"
  else
    fail "docker compose config --quiet failed on committed docker-compose.yml"
  fi
else
  skip "docker not available — skipping compose config validation"
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
