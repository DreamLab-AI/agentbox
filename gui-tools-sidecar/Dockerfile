# gui-tools-service — GPU-accelerated FHS sidecar for Blender + QGIS.
#
# WHY THIS EXISTS: agentbox's main image is nix-built; nix binaries carry nix-store
# RPATHs and do NOT search /usr/lib, where the nvidia-container-runtime injects the
# driver libraries (libcuda, libGLX_nvidia, libEGL_nvidia). So GPU compute AND GL are
# invisible to nix Blender/QGIS. This container is Arch (FHS): /usr/lib IS the loader
# path, so the injected NVIDIA userspace Just Works — the same reason the browser
# sidecar gets full GPU acceleration. Blender's viewport uses GLX; VirtualGL's EGL
# backend routes that onto the GPU without needing a hardware X server (Xvfb is
# software-GLX only), mirroring how the browser uses Vulkan/ANGLE to bypass X GLX.
FROM archlinux:base@sha256:e43f1fd80e073992c5f173efbbbf65144170bf60aeb7369940087d63eacea8f4
ARG DCC_MCP_BLENDER_VERSION=0.2.23
ARG DCC_MCP_CORE_VERSION=0.20.46
ARG DCC_MCP_SERVER_VERSION=0.20.46
ARG RHUBARB_VERSION=1.14.0
ARG RHUBARB_SHA256=a9a9074862cff47b2d59b8bf399a678a3b0b74f9452ad6ad94cb292913dd8667

ENV DISPLAY=:2 \
    LANG=C.UTF-8 \
    HOME=/home/devuser \
    XDG_RUNTIME_DIR=/tmp/xdg-runtime \
    # glvnd routes GLX/EGL to the injected NVIDIA vendor libs
    __GLX_VENDOR_LIBRARY_NAME=nvidia \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics \
    # VirtualGL renders on the GPU via EGL, no hardware X server required
    VGL_DISPLAY=egl

RUN pacman -Syu --noconfirm && pacman -S --noconfirm --needed \
        blender \
        qgis \
        python \
        python-pip \
        python-cattrs \
        xorg-server-xvfb \
        xorg-xdpyinfo \
        x11vnc \
        supervisor \
        vulkan-icd-loader \
        vulkan-tools \
        libglvnd \
        mesa \
        mesa-utils \
        libdrm \
        nodejs \
        npm \
        dbus \
        ttf-liberation \
        curl \
        unzip \
        socat \
        iproute2 \
        base-devel \
        git \
        sudo \
    && pacman -Scc --noconfirm \
    && rm -rf /var/cache/pacman/pkg/* /root/.npm /tmp/*

# devuser with passwordless sudo (needed for AUR builds)
RUN groupadd -g 1000 devuser \
    && useradd -m -u 1000 -g 1000 -s /bin/bash devuser \
    && echo 'devuser ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

# yay (AUR helper) for VirtualGL, which is not in the core repos
RUN mkdir -p /tmp/yay-build && chown devuser:devuser /tmp/yay-build \
    && cd /tmp/yay-build \
    && sudo -u devuser git clone https://aur.archlinux.org/yay-bin.git \
    && cd yay-bin && sudo -u devuser makepkg -si --noconfirm \
    && rm -rf /tmp/yay-build

# VirtualGL (EGL backend) — routes app GLX onto the GPU
RUN sudo -u devuser yay -S --noconfirm --needed virtualgl \
    && sudo -u devuser yay -Scc --noconfirm \
    && rm -rf /home/devuser/.cache/yay /tmp/*

# Solar compute stack (pinned venv — the "bake it in" path for deps nix can't cleanly
# package: quartz-solar-forecast is a PyPI ML pkg that pulls model weights at runtime,
# opendssdirect vendors a compiled OpenDSS engine). FHS + pip here is reproducible via
# these pins. Isolated in /opt/solar-venv so it never touches the system python.
# uk-solar-planner calls these for generation forecasting + DNO grid feasibility.
#
# The Arch rolling base ships a Python NEWER than quartz's transitive constraint:
# quartz-solar-forecast -> pv-site-prediction, whose every release pins
# Requires-Python >=3.10,<3.12. Building the venv on the system interpreter therefore
# fails to resolve (No matching distribution for pv-site-prediction). We build the venv
# on a uv-managed CPython 3.11 instead, decoupling it from whatever /usr/bin/python the
# rolling base happens to be. `--seed` keeps pip/setuptools inside the venv;
# forecast_quartz.py keeps using /opt/solar-venv/bin/python unchanged.
#
# numpy<2: quartz's forecast path (via xarray==2022.12.0 / pvlib) still uses `np.unicode_`,
# which NumPy 2.0 removed. The stack is pre-NumPy-2 (note the pinned Dec-2022 xarray), so we
# hold numpy on the compatible 1.x line. Without this the resolver pulls numpy 2.x and the
# forecast fails at run_forecast() with "`np.unicode_` was removed in the NumPy 2.0 release".
RUN pacman -S --noconfirm --needed uv \
    && pacman -Scc --noconfirm \
    && uv venv --seed --python 3.11 /opt/solar-venv \
    && uv pip install --python /opt/solar-venv/bin/python --no-cache \
        "numpy<2" \
        "quartz-solar-forecast==1.2.11" \
    && chown -R devuser:devuser /opt/solar-venv
# opendss-mcp-server (EPRI OpenDSS via MCP — DNO connection feasibility, MIT).
# OpenDSS's current MCP dependencies require newer Pydantic/Starlette than Quartz.
# Resolve them in a separate environment so neither install corrupts the other.
RUN git clone --depth 1 https://github.com/ahmedelshazly27/opendss-mcp-server /opt/opendss-mcp \
    && uv venv --seed --python /opt/solar-venv/bin/python /opt/opendss-venv \
    && uv pip install --python /opt/opendss-venv/bin/python --no-cache "numpy<2" -e /opt/opendss-mcp \
    && /opt/solar-venv/bin/python -m pip check \
    && /opt/opendss-venv/bin/python -m pip check \
    && chown -R devuser:devuser /opt/opendss-mcp /opt/opendss-venv

RUN mkdir -p /opt/gui-tools /tmp/xdg-runtime /home/devuser/.config \
    && chown -R devuser:devuser /opt/gui-tools /tmp/xdg-runtime /home/devuser

# Typed Streamable HTTP/REST control plane, isolated from Arch's Python packages.
RUN python -m pip install --no-cache-dir --target /opt/gui-tools/dcc-python \
    "dcc-mcp-blender==${DCC_MCP_BLENDER_VERSION}" \
    "dcc-mcp-core==${DCC_MCP_CORE_VERSION}" \
    "dcc-mcp-server==${DCC_MCP_SERVER_VERSION}"

# BlenderMCP addon (Siddharth Ahuja, MIT) + launchers + MCP bridges
RUN curl --fail --location --retry 3 \
      "https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v${RHUBARB_VERSION}/Rhubarb-Lip-Sync-${RHUBARB_VERSION}-Linux.zip" \
      -o /tmp/rhubarb.zip \
    && echo "${RHUBARB_SHA256}  /tmp/rhubarb.zip" | sha256sum -c - \
    && unzip -q /tmp/rhubarb.zip -d /opt/gui-tools \
    && mv "/opt/gui-tools/Rhubarb-Lip-Sync-${RHUBARB_VERSION}-Linux" /opt/gui-tools/rhubarb \
    && chmod +x /opt/gui-tools/rhubarb/rhubarb \
    && ln -s /opt/gui-tools/rhubarb/rhubarb /usr/local/bin/rhubarb \
    && rm /tmp/rhubarb.zip

COPY --chown=devuser:devuser blendermcp-addon.py /opt/gui-tools/blendermcp-addon.py
COPY --chown=devuser:devuser launch-blender.py /opt/gui-tools/launch-blender.py
COPY --chown=devuser:devuser launch-blender.sh /opt/gui-tools/launch-blender.sh
COPY --chown=devuser:devuser launch-qgis.sh /opt/gui-tools/launch-qgis.sh
# Real headless QGIS MCP server (QgsApplication + qgis_mcp_plugin QgisMCPServer) —
# replaces the old HTTP placeholder stub qgis-mcp-server.py — plus the plugin it runs,
# installed into the default QGIS profile so `import qgis_mcp_plugin` resolves.
COPY --chown=devuser:devuser qgis-mcp-headless.py /opt/gui-tools/qgis-mcp-headless.py
COPY --chown=devuser:devuser qgis_mcp_plugin /home/devuser/.local/share/QGIS/QGIS3/profiles/default/python/plugins/qgis_mcp_plugin
COPY --chown=devuser:devuser forecast_quartz.py /opt/gui-tools/forecast_quartz.py
COPY --chown=devuser:devuser healthcheck.sh /opt/gui-tools/healthcheck.sh
COPY supervisord.conf /etc/supervisord.conf
RUN chmod +x /opt/gui-tools/launch-blender.sh /opt/gui-tools/launch-qgis.sh /opt/gui-tools/healthcheck.sh \
    && ln -s /opt/gui-tools/dcc-python/bin/dcc-mcp-server /usr/local/bin/dcc-mcp-server \
    && dcc-mcp-server --version

# 5905: VNC  |  9876: BlenderMCP socket  |  9877: QGIS MCP socket
EXPOSE 5905 9876 9877

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD /opt/gui-tools/healthcheck.sh

CMD ["supervisord", "-n", "-c", "/etc/supervisord.conf"]
