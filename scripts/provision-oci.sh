#!/bin/bash
# Oracle Cloud ARM Instance Provisioner
# Automatically retries until capacity is available
# Usage: ./provision-oci.sh [--loop] [--interval 60]

set -euo pipefail

# Configuration from .env
source "$(dirname "$0")/../.env" 2>/dev/null || true

export SUPPRESS_LABEL_WARNING=True
OCI_CMD="${OCI_CMD:-$HOME/.local/bin/oci}"

# Instance configuration
TENANCY="${OCI_TENANCY_OCID:-ocid1.tenancy.oc1..aaaaaaaagfizw3pduwimmmcqudogkgftgwdds7l2cci5mhzjbkyn3neuxrta}"
REGION="${OCI_REGION:-uk-london-1}"
IMAGE_ID="${OCI_IMAGE_ID:-ocid1.image.oc1.uk-london-1.aaaaaaaayrzeqfjzgjbjaethpygka7teutvwxquyicyllui2m5yzbjxvpfja}"
SHAPE="VM.Standard.A1.Flex"
OCPUS="${OCI_OCPUS:-4}"
MEMORY_GB="${OCI_MEMORY_GB:-24}"
DISPLAY_NAME="${OCI_INSTANCE_NAME:-agentbox}"
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/agentbox_key.pub}"

# Network IDs (from previous setup)
VCN_ID="ocid1.vcn.oc1.uk-london-1.amaaaaaalkp6loqa25xbaqiuzy4jrbyehquaowekelwnfjzumbjbod3mwdwq"
SUBNET_ID="ocid1.subnet.oc1.uk-london-1.aaaaaaaanmyscck5pxswa4ttb6ckmcyus7nwfqwsrscuikdqfzwqwxdzc5ta"

# Availability domains to try
ADS=(
    "IglD:UK-LONDON-1-AD-1"
    "IglD:UK-LONDON-1-AD-2"
    "IglD:UK-LONDON-1-AD-3"
)

LOOP=false
INTERVAL=60

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --loop) LOOP=true; shift ;;
        --interval) INTERVAL="$2"; shift 2 ;;
        --ocpus) OCPUS="$2"; shift 2 ;;
        --memory) MEMORY_GB="$2"; shift 2 ;;
        --help)
            echo "Usage: $0 [--loop] [--interval SECONDS] [--ocpus N] [--memory GB]"
            echo "  --loop       Keep retrying until successful"
            echo "  --interval   Seconds between retries (default: 60)"
            echo "  --ocpus      Number of OCPUs (default: 4, max free: 4)"
            echo "  --memory     Memory in GB (default: 24, max free: 24)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

SSH_KEY=$(cat "$SSH_KEY_FILE")
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUD_INIT_FILE="${SCRIPT_DIR}/cloud-init.yaml"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Generate cloud-init user data
generate_user_data() {
    if [[ -f "$CLOUD_INIT_FILE" ]]; then
        base64 -w0 "$CLOUD_INIT_FILE"
    else
        # Inline minimal cloud-init if file not found
        cat << 'CLOUD_INIT' | base64 -w0
#cloud-config
package_update: true
packages: [docker, git, nodejs, npm, tmux, htop]
runcmd:
  - systemctl enable --now docker
  - usermod -aG docker opc
  - npm install -g agent-browser @claude-flow/cli
  - firewall-cmd --permanent --add-port={22,5901,8080,9090}/tcp && firewall-cmd --reload
CLOUD_INIT
    fi
}

try_launch() {
    local AD="$1"
    log "Attempting launch in $AD with ${OCPUS} OCPU, ${MEMORY_GB}GB RAM..."

    # Generate user data for cloud-init
    USER_DATA=$(generate_user_data)

    RESULT=$($OCI_CMD compute instance launch \
        --compartment-id "$TENANCY" \
        --availability-domain "$AD" \
        --shape "$SHAPE" \
        --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
        --subnet-id "$SUBNET_ID" \
        --image-id "$IMAGE_ID" \
        --display-name "$DISPLAY_NAME" \
        --assign-public-ip true \
        --metadata "{\"ssh_authorized_keys\": \"$SSH_KEY\", \"user_data\": \"$USER_DATA\"}" 2>&1) || true

    if echo "$RESULT" | grep -q '"lifecycle-state"'; then
        INSTANCE_ID=$(echo "$RESULT" | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
        log "SUCCESS! Instance launched: $INSTANCE_ID"
        echo "$RESULT" > /tmp/agentbox-instance.json
        return 0
    elif echo "$RESULT" | grep -q "Out of host capacity"; then
        log "No capacity in $AD"
        return 1
    else
        log "Error: $(echo "$RESULT" | grep -o '"message": "[^"]*"' | head -1)"
        return 1
    fi
}

wait_for_ip() {
    local INSTANCE_ID="$1"
    log "Waiting for public IP..."

    for i in {1..60}; do
        VNIC_ATTACHMENTS=$($OCI_CMD compute vnic-attachment list \
            --compartment-id "$TENANCY" \
            --instance-id "$INSTANCE_ID" 2>&1) || continue

        VNIC_ID=$(echo "$VNIC_ATTACHMENTS" | grep -o '"vnic-id": "[^"]*"' | head -1 | cut -d'"' -f4)

        if [[ -n "$VNIC_ID" ]]; then
            PUBLIC_IP=$($OCI_CMD network vnic get --vnic-id "$VNIC_ID" \
                --query "data.\"public-ip\"" --raw-output 2>&1) || continue

            if [[ -n "$PUBLIC_IP" && "$PUBLIC_IP" != "null" ]]; then
                log "Public IP: $PUBLIC_IP"
                echo "$PUBLIC_IP" > /tmp/agentbox-ip.txt

                # Update agentbox.sh
                SCRIPT_DIR="$(dirname "$0")"
                sed -i "s/AGENTBOX_IP=.*/AGENTBOX_IP=\"$PUBLIC_IP\"/" "$SCRIPT_DIR/../agentbox.sh" 2>/dev/null || true

                return 0
            fi
        fi
        sleep 5
    done

    log "Timeout waiting for IP"
    return 1
}

# Main loop
attempt=0
while true; do
    attempt=$((attempt + 1))
    log "=== Attempt $attempt ==="

    for AD in "${ADS[@]}"; do
        if try_launch "$AD"; then
            INSTANCE_ID=$(grep -o '"id": "[^"]*"' /tmp/agentbox-instance.json | head -1 | cut -d'"' -f4)
            wait_for_ip "$INSTANCE_ID"

            log "Instance ready!"
            log "SSH: ssh -i ~/.ssh/agentbox_key opc@$(cat /tmp/agentbox-ip.txt)"
            exit 0
        fi
    done

    if [[ "$LOOP" != "true" ]]; then
        log "All ADs exhausted. Run with --loop to keep retrying."
        exit 1
    fi

    log "Waiting ${INTERVAL}s before retry..."
    sleep "$INTERVAL"
done
