#!/usr/bin/env bash
set -euo pipefail

echo "=== Agentbox Runtime Bootstrap ==="
echo "Date: $(date -Iseconds)"

export WORKSPACE="${WORKSPACE:-/workspace}"
export SHARED_PROJECTS_ROOT="${SHARED_PROJECTS_ROOT:-/projects}"
export RUVECTOR_DATA_DIR="${RUVECTOR_DATA_DIR:-/var/lib/ruvector}"
export RUVECTOR_PORT="${RUVECTOR_PORT:-9700}"

mkdir -p "$WORKSPACE" "$RUVECTOR_DATA_DIR" "$WORKSPACE/.cache/ms-playwright"
mkdir -p "$SHARED_PROJECTS_ROOT"
chmod 755 "$RUVECTOR_DATA_DIR"

install_node_deps() {
  local dir="$1"
  if [ -f "$dir/package.json" ] && [ ! -d "$dir/node_modules" ]; then
    echo "Installing Node dependencies in $dir"
    npm install --prefix "$dir" --omit=dev >/dev/null 2>&1 || true
  fi
}

echo "[1/3] Installing service dependencies..."
install_node_deps /opt/agentbox/management-api
install_node_deps /opt/agentbox/mcp
install_node_deps /opt/agentbox/skills/openai-codex/mcp-server
install_node_deps /opt/agentbox/skills/lazy-fetch/mcp-server
if [ "${ENABLE_PLAYWRIGHT:-false}" = "true" ]; then
  install_node_deps /opt/agentbox/skills/playwright/mcp-server
fi

echo "[2/3] Installing runtime CLI tools..."
npx --yes ruvector --version >/dev/null 2>&1 || npm install -g ruvector >/dev/null 2>&1 || true

if [ "${ENABLE_CLAUDE_FLOW:-false}" = "true" ]; then
  npm install -g @claude-flow/cli >/dev/null 2>&1 || true
fi

if [ "${ENABLE_RUFLO:-false}" = "true" ]; then
  npm install -g ruflo >/dev/null 2>&1 || true
fi

if [ "${ENABLE_AGENTIC_QE:-false}" = "true" ]; then
  npm install -g agentic-qe >/dev/null 2>&1 || true
  aqe init --auto >/dev/null 2>&1 || true
fi

if [ "${ENABLE_NAGUAL_QE:-false}" = "true" ]; then
  npm install -g nagual-qe >/dev/null 2>&1 || true
fi

if [ "${ENABLE_CODEBASE_MEMORY:-false}" = "true" ]; then
  npm install -g codebase-memory-mcp >/dev/null 2>&1 || true
fi

if [ "${ENABLE_AGENT_BROWSER:-false}" = "true" ]; then
  npx --yes agent-browser --help >/dev/null 2>&1 || npm install -g agent-browser >/dev/null 2>&1 || true
fi

if [ "${ENABLE_PLAYWRIGHT:-false}" = "true" ]; then
  npm install -g playwright >/dev/null 2>&1 || true
  npx playwright install chromium >/dev/null 2>&1 || true
fi

if [ "${ENABLE_MERMAID:-false}" = "true" ]; then
  npm install -g @mermaid-js/mermaid-cli >/dev/null 2>&1 || true
fi

echo "[3/3] Publishing environment hints..."
cat > /etc/profile.d/agentbox-runtime.sh <<EOF
export WORKSPACE="$WORKSPACE"
export RUVECTOR_DATA_DIR="$RUVECTOR_DATA_DIR"
export RUVECTOR_PORT="$RUVECTOR_PORT"
export SOLID_POD_ROOT="${SOLID_POD_ROOT:-/var/lib/solid}"
export AGENTBOX_CONFIG="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
export SKILLS_TREE="${SKILLS_TREE:-/opt/agentbox/skills}"
export SHARED_PROJECTS_ROOT="${SHARED_PROJECTS_ROOT:-/projects}"
EOF

echo "Runtime bootstrap complete"
