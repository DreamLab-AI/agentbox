#!/bin/bash
# post-deploy-cleanup.sh — Run after a successful agentbox deploy
# Cleans old Docker images, dangling layers, and Nix store garbage
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}=== Post-Deploy Cleanup ===${NC}"

# 1. Remove old agentbox images (keep only the current one)
CURRENT_ID=$(docker inspect agentbox --format '{{.Image}}' 2>/dev/null | sed 's/sha256://' | head -c 12)
if [ -n "$CURRENT_ID" ]; then
    echo -e "${CYAN}[1/5] Pruning old agentbox images (keeping ${CURRENT_ID})...${NC}"
    # Match only the runtime image repo "agentbox" exactly — sidecar images
    # (agentbox-gui-tools-service, agentbox-xr-runtime, agentbox-browsercontainer)
    # must never be pruned here.
    docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' 2>/dev/null | grep ' agentbox:' | while read id tag; do
        short_id=$(echo "$id" | head -c 12)
        if [ "$short_id" != "$CURRENT_ID" ]; then
            echo "  Removing: $tag ($short_id)"
            docker rmi "$id" 2>/dev/null || true
        fi
    done
else
    echo -e "${YELLOW}[1/5] No running agentbox container — skipping image prune${NC}"
fi

# 2. Docker system prune (dangling images, stopped containers, unused networks)
echo -e "${CYAN}[2/5] Docker system prune...${NC}"
RECLAIMED=$(docker system prune -f 2>/dev/null | grep "reclaimed" || echo "0B reclaimed")
echo "  $RECLAIMED"

# 3. Nix garbage collection (keep current build + 1 previous)
echo -e "${CYAN}[3/5] Nix store garbage collection...${NC}"
if command -v nix >/dev/null 2>&1; then
    BEFORE=$(df -h / 2>/dev/null | tail -1 | awk '{print $4}')
    nix store gc 2>/dev/null || sudo /nix/var/nix/profiles/default/bin/nix store gc 2>/dev/null || echo "  gc requires root"
    AFTER=$(df -h / 2>/dev/null | tail -1 | awk '{print $4}')
    echo "  Free space: ${BEFORE} → ${AFTER}"
else
    echo "  nix not on PATH — skipping"
fi

# 4. Clean tmp files from build
echo -e "${CYAN}[4/5] Cleaning temp files...${NC}"
rm -rf /mnt/mldata/tmp/container_images_* 2>/dev/null || true
rm -rf /tmp/nix-build*.log /tmp/xkb* /tmp/build*.log 2>/dev/null || true
echo "  Done"

# 5. Reap runaway / stale Rust target caches inside the workspace volume.
#    (the workspace lives in the container, so we run the reaper there via exec)
echo -e "${CYAN}[5/5] Reaping runaway/stale cargo target dirs...${NC}"
if [ "${AGENTBOX_REAP_CARGO:-1}" != "1" ]; then
    echo "  disabled (AGENTBOX_REAP_CARGO=0) — skipping"
elif docker inspect agentbox >/dev/null 2>&1; then
    docker exec -i \
        -e AGENTBOX_CARGO_REAP_ROOT="${AGENTBOX_CARGO_REAP_ROOT:-/home/devuser/workspace}" \
        -e AGENTBOX_CARGO_REAP_MAX_GB="${AGENTBOX_CARGO_REAP_MAX_GB:-50}" \
        -e AGENTBOX_CARGO_REAP_STALE_DAYS="${AGENTBOX_CARGO_REAP_STALE_DAYS:-14}" \
        -e AGENTBOX_CARGO_REAP_DRYRUN="${AGENTBOX_CARGO_REAP_DRYRUN:-0}" \
        agentbox bash -s < "${SELF_DIR}/reap-cargo-targets.sh" \
        || echo -e "${YELLOW}  reap step failed (non-fatal) — skipping${NC}"
else
    echo -e "${YELLOW}  agentbox container not running — skipping target reap${NC}"
fi

# Summary
echo ""
echo -e "${GREEN}=== Cleanup Complete ===${NC}"
echo -e "  Docker images: $(docker images --format '{{.Size}}' 2>/dev/null | paste -sd+ | bc 2>/dev/null || docker system df 2>/dev/null | grep Images | awk '{print $3}')"
echo -e "  Root disk:     $(df -h / 2>/dev/null | tail -1 | awk '{print $4 " free (" $5 " used)"}')"
