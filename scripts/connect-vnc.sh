#!/bin/bash
# Connect to Agentbox VNC via SSH tunnel
# VNC is bound to localhost only for security - SSH tunnel required

set -euo pipefail

AGENTBOX_IP="${AGENTBOX_IP:-}"
AGENTBOX_USER="${AGENTBOX_USER:-opc}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/agentbox_key}"
LOCAL_VNC_PORT="${LOCAL_VNC_PORT:-5901}"

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
        echo "   or: $0 x.x.x.x"
        exit 1
    fi
fi

# Allow IP as first argument
[[ $# -ge 1 ]] && AGENTBOX_IP="$1"

echo -e "${CYAN}Starting SSH tunnel to Agentbox VNC...${NC}"
echo -e "Target: ${GREEN}${AGENTBOX_USER}@${AGENTBOX_IP}${NC}"
echo ""
echo -e "${GREEN}VNC will be available at: vnc://localhost:${LOCAL_VNC_PORT}${NC}"
echo ""
echo "Press Ctrl+C to disconnect"
echo ""

ssh -i "$SSH_KEY" \
    -o StrictHostKeyChecking=accept-new \
    -N -L "${LOCAL_VNC_PORT}:localhost:5901" \
    "${AGENTBOX_USER}@${AGENTBOX_IP}"
