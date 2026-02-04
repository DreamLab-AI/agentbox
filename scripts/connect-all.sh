#!/bin/bash
# Connect to all Agentbox services via SSH tunnel
# Tunnels: VNC (5901), code-server (8080), API (9090), Chrome DevTools (9222)

set -euo pipefail

AGENTBOX_IP="${AGENTBOX_IP:-}"
AGENTBOX_USER="${AGENTBOX_USER:-opc}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/agentbox_key}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [[ -z "$AGENTBOX_IP" ]]; then
    if [[ -f /tmp/agentbox-ip.txt ]]; then
        AGENTBOX_IP=$(cat /tmp/agentbox-ip.txt)
    else
        echo -e "${RED}Error: AGENTBOX_IP not set${NC}"
        echo "Usage: AGENTBOX_IP=x.x.x.x $0"
        echo "   or: $0 x.x.x.x"
        exit 1
    fi
fi

# Allow IP as first argument
[[ $# -ge 1 ]] && AGENTBOX_IP="$1"

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Agentbox SSH Tunnel - All Services     ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Target: ${GREEN}${AGENTBOX_USER}@${AGENTBOX_IP}${NC}"
echo ""
echo -e "${YELLOW}Services available after connection:${NC}"
echo -e "  ${GREEN}VNC Desktop:${NC}        vnc://localhost:5901"
echo -e "  ${GREEN}code-server:${NC}        http://localhost:8080"
echo -e "  ${GREEN}Management API:${NC}     http://localhost:9090"
echo -e "  ${GREEN}Chrome DevTools:${NC}    http://localhost:9222"
echo ""
echo -e "${YELLOW}Browser automation:${NC}"
echo -e "  agent-browser open https://example.com"
echo -e "  agent-browser snapshot -i"
echo ""
echo "Press Ctrl+C to disconnect all tunnels"
echo ""

ssh -i "$SSH_KEY" \
    -o StrictHostKeyChecking=accept-new \
    -N \
    -L 5901:localhost:5901 \
    -L 8080:localhost:8080 \
    -L 9090:localhost:9090 \
    -L 9222:localhost:9222 \
    "${AGENTBOX_USER}@${AGENTBOX_IP}"
