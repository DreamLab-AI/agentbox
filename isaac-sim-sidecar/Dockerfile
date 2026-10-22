# Isaac Sim sidecar (ADR-2149). Thin layer over NVIDIA's image: the vendor runtime stays
# Ubuntu-based and isolated from the Nix image and from the Blender/ComfyUI sidecars.
#
# Build from the HOST shell (bind paths resolve on the host):
#   docker compose --project-name agentbox -f docker-compose.isaac-sim.yml build
#
# The digest below was observed on 2026-10-22 from the NGC manifest for linux/amd64 and MUST be
# re-checked against the registry at build time (docs/developer/isaac-sim.md, "Pin verification").
ARG ISAAC_SIM_IMAGE=nvcr.io/nvidia/isaac-sim@sha256:bcb96e0b87c28ad446a2a6a2f0fdb7d82b9867f18b96a94c796912c61f07337f
FROM ${ISAAC_SIM_IMAGE}

ARG ISAAC_SIM_VERSION=6.2.0
ARG ISAAC_LAB_TAG=v3.0.0
ARG ISAAC_LAB_COMMIT=e3f7d9ff1f5d7f8280de3ece9000b7117f66bcf4

USER root

# Isaac Lab, pinned to an exact commit and verified after checkout. The build fails if the tag
# has moved. Stage B controllers (ProtoMotions, MimicKit) are deliberately NOT installed here:
# ProtoMotions pins a Lab revision built for Sim 6.0 (see ADR-2149).
RUN git clone --filter=blob:none https://github.com/isaac-sim/IsaacLab.git /opt/IsaacLab \
 && git -C /opt/IsaacLab checkout --detach "${ISAAC_LAB_COMMIT}" \
 && test "$(git -C /opt/IsaacLab rev-parse HEAD)" = "${ISAAC_LAB_COMMIT}" \
 && ln -sfn /isaac-sim /opt/IsaacLab/_isaac_sim \
 && cd /opt/IsaacLab && ./isaaclab.sh --install none \
 && rm -rf /opt/IsaacLab/.git

# An empty named volume mounted here inherits this ownership, so the non-root runtime user can write HOME.
RUN mkdir -p /isaac-cache/home && chown -R 1000:1000 /isaac-cache

COPY isaac-sim-sidecar/runner/isaac_runner.py /opt/isaac-runner/isaac_runner.py
COPY isaac-sim-sidecar/fixtures /opt/isaac-sim-assets/fixtures
COPY isaac-sim-sidecar/lib /opt/isaac-sim-assets/lib
COPY isaac-sim-sidecar/entrypoint.sh isaac-sim-sidecar/healthcheck.sh /opt/isaac-runner/

RUN printf '{"image":"nvcr.io/nvidia/isaac-sim","sim_version":"%s","lab_tag":"%s","lab_commit":"%s","arch":"%s"}\n' \
      "${ISAAC_SIM_VERSION}" "${ISAAC_LAB_TAG}" "${ISAAC_LAB_COMMIT}" "$(uname -m)" > /etc/isaac-sim-versions.json \
 && chmod 0755 /opt/isaac-runner/*.sh

# Vendor-required licence acceptance; optional telemetry stays off unless the operator opts in.
ENV ACCEPT_EULA=Y PRIVACY_CONSENT=N OMNI_KIT_ACCEPT_EULA=YES
ENTRYPOINT []
CMD ["/opt/isaac-runner/entrypoint.sh"]
