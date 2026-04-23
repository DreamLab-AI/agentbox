#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo "  AGENTBOX"
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

# Auto-generate management key if unset or still the legacy sentinel value
MGMT_KEY_FILE="$WORKSPACE/profiles/default/mgmt-key"
_legacy_sentinel="change-this-secret-key"
if [ -z "${MANAGEMENT_API_KEY:-}" ] || [ "${MANAGEMENT_API_KEY:-}" = "$_legacy_sentinel" ]; then
  if [ -f "$MGMT_KEY_FILE" ]; then
    MANAGEMENT_API_KEY="$(cat "$MGMT_KEY_FILE")"
  else
    mkdir -p "$(dirname "$MGMT_KEY_FILE")"
    if command -v openssl >/dev/null 2>&1; then
      MANAGEMENT_API_KEY="$(openssl rand -hex 32)"
    else
      MANAGEMENT_API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    printf '%s' "$MANAGEMENT_API_KEY" > "$MGMT_KEY_FILE"
    chmod 0600 "$MGMT_KEY_FILE"
    echo "[bootstrap] Generated management API key -> $MGMT_KEY_FILE"
  fi
  export MANAGEMENT_API_KEY
fi
unset _legacy_sentinel

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

# Shell profile setup
if [ -f /etc/bash.bashrc ]; then
  if ! grep -q "source.*agentbox-aliases" /etc/bash.bashrc 2>/dev/null; then
    echo "source /opt/agentbox/config/agentbox-aliases.sh" >> /etc/bash.bashrc
  fi
fi
if [ -f /etc/zsh/zshrc ]; then
  if ! grep -q "source.*agentbox-aliases" /etc/zsh/zshrc 2>/dev/null; then
    echo "source /opt/agentbox/config/agentbox-aliases.sh" >> /etc/zsh/zshrc
  fi
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
