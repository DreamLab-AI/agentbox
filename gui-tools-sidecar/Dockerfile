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
FROM archlinux:base

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
RUN python -m venv /opt/solar-venv \
    && /opt/solar-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/solar-venv/bin/pip install --no-cache-dir \
        "quartz-solar-forecast==1.2.11" \
    && chown -R devuser:devuser /opt/solar-venv
# opendss-mcp-server (EPRI OpenDSS via MCP — DNO connection feasibility, MIT).
# Its own install pulls opendssdirect.py (the vendored compiled engine); pinned by
# the repo's requirements, so no separate pin here (avoids clashing with quartz's).
RUN git clone --depth 1 https://github.com/ahmedelshazly27/opendss-mcp-server /opt/opendss-mcp \
    && /opt/solar-venv/bin/pip install --no-cache-dir -e /opt/opendss-mcp \
    && chown -R devuser:devuser /opt/opendss-mcp

RUN mkdir -p /opt/gui-tools /tmp/xdg-runtime /home/devuser/.config \
    && chown -R devuser:devuser /opt/gui-tools /tmp/xdg-runtime /home/devuser

# BlenderMCP addon (Siddharth Ahuja, MIT) + launchers + MCP bridges
COPY --chown=devuser:devuser blendermcp-addon.py /opt/gui-tools/blendermcp-addon.py
COPY --chown=devuser:devuser launch-blender.py /opt/gui-tools/launch-blender.py
COPY --chown=devuser:devuser launch-blender.sh /opt/gui-tools/launch-blender.sh
COPY --chown=devuser:devuser launch-qgis.sh /opt/gui-tools/launch-qgis.sh
COPY --chown=devuser:devuser qgis-mcp-server.py /opt/gui-tools/qgis-mcp-server.py
COPY --chown=devuser:devuser forecast_quartz.py /opt/gui-tools/forecast_quartz.py
COPY --chown=devuser:devuser healthcheck.sh /opt/gui-tools/healthcheck.sh
COPY supervisord.conf /etc/supervisord.conf
RUN chmod +x /opt/gui-tools/launch-blender.sh /opt/gui-tools/launch-qgis.sh /opt/gui-tools/healthcheck.sh

# 5905: VNC  |  9876: BlenderMCP socket  |  9877: QGIS MCP socket
EXPOSE 5905 9876 9877

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD /opt/gui-tools/healthcheck.sh

CMD ["supervisord", "-n", "-c", "/etc/supervisord.conf"]
