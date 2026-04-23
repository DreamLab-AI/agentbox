#!/bin/bash
# Target: bare-metal host
# Prepares a bare-metal Linux host to run the agentbox Docker stack.
# Performs: SSH key setup, Docker presence check, Nix install suggestion.
#
# Usage: ./provision-bare.sh [--host USER@HOST] [--key PATH]

set -euo pipefail

BARE_HOST="${BARE_HOST:-}"
SSH_KEY="${BARE_SSH_KEY:-$HOME/.ssh/agentbox_key}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --host) BARE_HOST="$2"; shift 2 ;;
        --key)  SSH_KEY="$2";   shift 2 ;;
        --help)
            echo "Usage: $0 [--host USER@HOST] [--key PATH]"
            echo "  --host  SSH target, e.g. ubuntu@192.168.1.10"
            echo "  --key   SSH private key (default: ~/.ssh/agentbox_key)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ -z "$BARE_HOST" ]]; then
    echo "Error: --host USER@HOST is required for bare-metal provisioning." >&2
    echo "Run: $0 --host ubuntu@<ip>" >&2
    exit 1
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ---------------------------------------------------------------------------
# 1. SSH key setup — ensure the key pair exists locally
# ---------------------------------------------------------------------------
if [[ ! -f "${SSH_KEY}" ]]; then
    log "Generating SSH key pair at ${SSH_KEY}..."
    ssh-keygen -t ed25519 -f "${SSH_KEY}" -N "" -C "agentbox-bare"
fi

log "Copying SSH public key to ${BARE_HOST}..."
ssh-copy-id -i "${SSH_KEY}.pub" -o StrictHostKeyChecking=accept-new "${BARE_HOST}" || {
    log "ssh-copy-id failed. Ensure password-based SSH is enabled for the first run."
    exit 1
}

# ---------------------------------------------------------------------------
# 2. Remote checks and setup
# ---------------------------------------------------------------------------
log "Connecting to ${BARE_HOST} for remote checks..."
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${BARE_HOST}" bash <<'REMOTE'
set -euo pipefail

# --- Docker ---
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "[OK] Docker + Compose found: $(docker --version)"
else
    echo "[WARN] Docker or Docker Compose not found."
    echo "  Install Docker: https://docs.docker.com/engine/install/"
    echo "  Then add your user to the docker group: sudo usermod -aG docker \$USER"
    exit 1
fi

# --- Nix ---
if command -v nix >/dev/null 2>&1; then
    echo "[OK] Nix found: $(nix --version)"
else
    echo "[INFO] Nix not found. Agentbox image builds require Nix with flakes."
    echo "  Recommended install:"
    echo "    curl --proto '=https' --tlsv1.2 -sSf https://install.determinate.systems/nix | sh -s -- install"
    echo "  Then enable flakes in ~/.config/nix/nix.conf:"
    echo "    experimental-features = nix-command flakes"
fi

echo "[OK] Bare-metal host checks complete."
REMOTE

log "SSH public key: ${SSH_KEY}.pub"
log "Add this key to agentbox.sh AGENTBOX_IP / AGENTBOX_USER as needed."
log "Then run: ./agentbox.sh up"
