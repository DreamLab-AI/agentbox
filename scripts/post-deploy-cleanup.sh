#!/bin/bash
# post-deploy-cleanup.sh — Run after a successful agentbox deploy
# Cleans old Docker images, dangling layers, and Nix store garbage
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}=== Post-Deploy Cleanup ===${NC}"

# 1. Remove old agentbox images (keep only the current one)
CURRENT_ID=$(docker inspect agentbox --format '{{.Image}}' 2>/dev/null | sed 's/sha256://' | head -c 12)
if [ -n "$CURRENT_ID" ]; then
    echo -e "${CYAN}[1/4] Pruning old agentbox images (keeping ${CURRENT_ID})...${NC}"
    docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' 2>/dev/null | grep agentbox | while read id tag; do
        short_id=$(echo "$id" | head -c 12)
        if [ "$short_id" != "$CURRENT_ID" ]; then
            echo "  Removing: $tag ($short_id)"
            docker rmi "$id" 2>/dev/null || true
        fi
    done
else
    echo -e "${YELLOW}[1/4] No running agentbox container — skipping image prune${NC}"
fi

# 2. Docker system prune (dangling images, stopped containers, unused networks)
echo -e "${CYAN}[2/4] Docker system prune...${NC}"
RECLAIMED=$(docker system prune -f 2>/dev/null | grep "reclaimed" || echo "0B reclaimed")
echo "  $RECLAIMED"

# 3. Nix garbage collection (keep current build + 1 previous)
echo -e "${CYAN}[3/4] Nix store garbage collection...${NC}"
if command -v nix >/dev/null 2>&1; then
    BEFORE=$(df -h / 2>/dev/null | tail -1 | awk '{print $4}')
    nix store gc 2>/dev/null || sudo /nix/var/nix/profiles/default/bin/nix store gc 2>/dev/null || echo "  gc requires root"
    AFTER=$(df -h / 2>/dev/null | tail -1 | awk '{print $4}')
    echo "  Free space: ${BEFORE} → ${AFTER}"
else
    echo "  nix not on PATH — skipping"
fi

# 4. Clean tmp files from build
echo -e "${CYAN}[4/4] Cleaning temp files...${NC}"
rm -rf /mnt/mldata/tmp/container_images_* 2>/dev/null || true
rm -rf /tmp/nix-build*.log /tmp/xkb* /tmp/build*.log 2>/dev/null || true
echo "  Done"

# Summary
echo ""
echo -e "${GREEN}=== Cleanup Complete ===${NC}"
echo -e "  Docker images: $(docker images --format '{{.Size}}' 2>/dev/null | paste -sd+ | bc 2>/dev/null || docker system df 2>/dev/null | grep Images | awk '{print $3}')"
echo -e "  Root disk:     $(df -h / 2>/dev/null | tail -1 | awk '{print $4 " free (" $5 " used)"}')"
