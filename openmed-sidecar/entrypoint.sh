#!/usr/bin/env bash
# OpenMed sidecar entrypoint: gate on prerequisites, then serve.
set -euo pipefail

# Fail-closed: refuse to serve unless all three prerequisites are acknowledged
# and the model artifact verifies against its lock.
bash /opt/openmed/prereq-check.sh

# The redaction server is the operator-provisioned helix pipeline
# (helix-openmed + helix-wasm + openmedkit-web). It is not vendored in this
# image (licence-gated). Once dropped into /opt/openmed/server and configured,
# it is launched here. Until then, prereq-check.sh has already exited non-zero,
# so this line is unreachable with the default (all-false) gates.
SERVER="${OPENMED_SERVER_ENTRY:-/opt/openmed/server/index.js}"
if [[ -f "${SERVER}" ]]; then
  exec node "${SERVER}"
fi
echo "[openmed] prerequisites passed but no server at ${SERVER} — provision the helix pipeline." >&2
exit 1
