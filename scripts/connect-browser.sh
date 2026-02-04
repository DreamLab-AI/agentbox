#!/bin/bash
# Connect to Agentbox browser automation via SSH tunnel
# Tunnels Chrome DevTools Protocol for agent-browser

set -euo pipefail

AGENTBOX_IP="${AGENTBOX_IP:-}"
AGENTBOX_USER="${AGENTBOX_USER:-opc}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/agentbox_key}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

if [[ -z "$AGENTBOX_IP" ]]; then
    if [[ -f /tmp/agentbox-ip.txt ]]; then
        AGENTBOX_IP=$(cat /tmp/agentbox-ip.txt)
    else
        echo -e "${RED}Error: AGENTBOX_IP not set${NC}"
        echo "Usage: AGENTBOX_IP=x.x.x.x $0"
        exit 1
    fi
fi

[[ $# -ge 1 ]] && AGENTBOX_IP="$1"

echo -e "${CYAN}Starting browser automation tunnel...${NC}"
echo -e "Target: ${GREEN}${AGENTBOX_USER}@${AGENTBOX_IP}${NC}"
echo ""
echo -e "${GREEN}Chrome DevTools available at: http://localhost:9222${NC}"
echo ""
echo "Usage with agent-browser:"
echo "  CHROME_CDP_URL=http://localhost:9222 agent-browser open https://example.com"
echo ""
echo "Press Ctrl+C to disconnect"

ssh -i "$SSH_KEY" \
    -o StrictHostKeyChecking=accept-new \
    -N \
    -L 9222:localhost:9222 \
    -L 5901:localhost:5901 \
    "${AGENTBOX_USER}@${AGENTBOX_IP}"
