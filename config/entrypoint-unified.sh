#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo "  AGENTBOX 2.0"
echo "  Modular Sovereign Agent Environment"
echo "========================================"
echo ""

export WORKSPACE="${WORKSPACE:-/workspace}"
export AGENTBOX_CONFIG="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
export RUVECTOR_DATA_DIR="${RUVECTOR_DATA_DIR:-/var/lib/ruvector}"
export SOLID_POD_ROOT="${SOLID_POD_ROOT:-/var/lib/solid}"
export MANAGEMENT_API_PORT="${MANAGEMENT_API_PORT:-9090}"
export RUVECTOR_PORT="${RUVECTOR_PORT:-9700}"
export SOLID_POD_PORT="${SOLID_POD_PORT:-8484}"
export SHARED_PROJECTS_ROOT="${SHARED_PROJECTS_ROOT:-/projects}"

echo "[1/5] Preparing runtime directories..."
mkdir -p \
  "$WORKSPACE" \
  "$SHARED_PROJECTS_ROOT" \
  "$RUVECTOR_DATA_DIR" \
  "$SOLID_POD_ROOT" \
  /var/lib/agentbox/identities \
  /var/log/supervisor \
  /var/run \
  /tmp/screenshots

if [ "${ENABLE_DESKTOP:-false}" = "true" ]; then
  mkdir -p /tmp/.X11-unix
  chmod 1777 /tmp/.X11-unix
fi

echo "[2/5] Bootstrapping sovereign mesh identity..."
python3 /opt/agentbox/scripts/sovereign-bootstrap.py

echo "[3/5] Ensuring workspace defaults..."
if [ ! -d "$WORKSPACE/agents" ]; then
  mkdir -p "$WORKSPACE/agents"
fi

mkdir -p "$WORKSPACE/.config/zellij"
if [ ! -f "$WORKSPACE/.config/zellij/config.kdl" ]; then
  cp /opt/agentbox/config/zellij.kdl "$WORKSPACE/.config/zellij/config.kdl"
fi
mkdir -p "$WORKSPACE/.config/zellij/layouts"
for layout in /opt/agentbox/config/zellij/layouts/*.kdl; do
  target="$WORKSPACE/.config/zellij/layouts/$(basename "$layout")"
  if [ ! -f "$target" ]; then
    cp "$layout" "$target"
  fi
done

echo "[4/5] Provisioning agent stacks..."
python3 /opt/agentbox/scripts/provision-agent-stacks.py

if [ ! -f "$WORKSPACE/README.agentbox.md" ]; then
  cat > "$WORKSPACE/README.agentbox.md" <<'EOF'
# Agentbox Workspace

Runtime state is mounted under:
- `/workspace`
- `/var/lib/ruvector`
- `/var/lib/solid`
- `/var/lib/agentbox/identities`
EOF
fi

echo "[5/5] Starting supervisord..."
exec supervisord -c /etc/supervisord.conf -n
