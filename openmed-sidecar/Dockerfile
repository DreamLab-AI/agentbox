# OpenMed clinical-PHI redaction sidecar (optional, gated, default-off).
#
# Provisions the ONNX runtime that agentbox lacks (the gap PRD-016 deferred), plus
# the fail-closed prerequisite gate. The clinical model + the helix pipeline
# (helix-openmed / helix-wasm / openmedkit-web) are NOT vendored here — helix is
# pre-release with an unresolved licence, so vendoring is blocked until the operator
# resolves it. This image is the runtime substrate the operator drops that pipeline
# into once license_acknowledged + governance_acknowledged are set.
FROM node:22-slim

ENV HOME=/home/devuser \
    OPENMED_PORT=9093

RUN groupadd -g 1000 devuser \
    && useradd -m -u 1000 -g 1000 -s /bin/bash devuser \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/openmed

# ONNX runtime for Node (the missing runtime agentbox does not otherwise package).
# Pinned; the model itself is provisioned at deploy, not baked.
RUN npm install --omit=dev onnxruntime-node@1.19.2 \
    && chown -R devuser:devuser /opt/openmed /home/devuser

COPY --chown=devuser:devuser prereq-check.sh /opt/openmed/prereq-check.sh
COPY --chown=devuser:devuser healthcheck.sh /opt/openmed/healthcheck.sh
COPY --chown=devuser:devuser entrypoint.sh /opt/openmed/entrypoint.sh
RUN chmod +x /opt/openmed/*.sh

USER devuser
EXPOSE 9093

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD bash /opt/openmed/healthcheck.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/openmed/entrypoint.sh"]
