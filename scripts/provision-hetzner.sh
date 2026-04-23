#!/bin/bash
# Target: Hetzner Cloud
# TODO: implement Hetzner Cloud API launch flow
#
# This provisioner stub exits 77 (ENOTSUP) until the implementation is complete.
# See docs/guides/provisioning.md for the provisioner contract.
#
# Skeleton hcloud server create command (flags not yet validated):
#
#   hcloud server create \
#     --name agentbox \
#     --type cax31 \           # ARM64, 8 vCPU, 16 GB RAM
#     --image ubuntu-24.04 \
#     --location nbg1 \
#     --ssh-key "${HCLOUD_SSH_KEY_NAME:-agentbox}" \
#     --user-data-from-file scripts/cloud-init.yaml
#
# Required env vars (set in .env or Hetzner project secrets):
#   HCLOUD_TOKEN         — Hetzner Cloud API token
#   HCLOUD_SSH_KEY_NAME  — name of an SSH key already uploaded to Hetzner
#
# Post-launch steps (TODO):
#   1. Poll server status until running.
#   2. Write public IP to /tmp/agentbox-ip.txt.
#   3. Update AGENTBOX_IP in agentbox.sh (same pattern as provision-oci.sh).
#
# To implement:
#   1. Replace skeleton with working hcloud invocations.
#   2. Add floating IP assignment if static IP is needed.
#   3. Remove the exit 77 below.
#   4. Update docs/guides/provisioning.md target matrix.

set -euo pipefail

echo "provision-hetzner.sh: Hetzner Cloud provisioner is not yet implemented." >&2
echo "See docs/guides/provisioning.md for the provisioner contract." >&2
exit 77
