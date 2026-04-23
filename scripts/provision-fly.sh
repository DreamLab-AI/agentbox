#!/bin/bash
# Target: fly.io
# TODO: implement fly.io launch flow
#
# This provisioner stub exits 77 (ENOTSUP) until the implementation is complete.
# See docs/guides/provisioning.md for the provisioner contract.
#
# Skeleton fly launch command (flags not yet validated):
#
#   fly launch \
#     --name agentbox \
#     --image ghcr.io/dreamlab-ai/agentbox:latest \
#     --region lhr \
#     --vm-memory 4096 \
#     --vm-cpus 2 \
#     --port 9090:http \
#     --port 22:tcp \
#     --env WORKSPACE=/workspace \
#     --env AGENTBOX_AGENT_ID="${AGENTBOX_AGENT_ID:-agentbox}" \
#     --volume agentbox_ruvector:/var/lib/ruvector \
#     --volume agentbox_solid:/var/lib/solid \
#     --no-deploy        # remove to actually deploy
#
# Required env vars (set in .env or fly secrets):
#   FLY_API_TOKEN      — personal access token from fly.io dashboard
#   AGENTBOX_AGENT_ID  — agent identity name
#   ANTHROPIC_API_KEY  — (optional) Claude API key
#
# To implement:
#   1. Replace the skeleton above with a working fly launch invocation.
#   2. Add fly volumes create calls for ruvector and solid data.
#   3. Set fly secrets from the common .env.template.common variables.
#   4. Remove the exit 77 below.
#   5. Update docs/guides/provisioning.md target matrix.

set -euo pipefail

echo "provision-fly.sh: fly.io provisioner is not yet implemented." >&2
echo "See docs/guides/provisioning.md for the provisioner contract." >&2
exit 77
