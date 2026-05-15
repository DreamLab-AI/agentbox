FROM archlinux:base

ENV DISPLAY=:2 \
    LANG=C.UTF-8

# Arch packages: Chromium, Xvfb, VNC, Vulkan, Node.js, supervisord
# CachyOS host uses Arch packages — matching base ensures glibc and
# NVIDIA driver library paths align with the NVIDIA Container Toolkit mount.
RUN pacman -Syu --noconfirm && pacman -S --noconfirm --needed \
        chromium \
        xorg-server-xvfb \
        x11vnc \
        python-supervisor \
        vulkan-tools \
        vulkan-icd-loader \
        libxcomposite \
        libxdamage \
        libxrandr \
        libxss \
        libxtst \
        nss \
        at-spi2-core \
        libdrm \
        mesa \
        ttf-liberation \
        dbus \
        nodejs \
        npm \
        curl \
        iproute2 \
    && pacman -Scc --noconfirm \
    && rm -rf /var/cache/pacman/pkg/* /root/.npm /tmp/*

# Create devuser matching agentbox uid/gid
RUN groupadd -g 1000 devuser \
    && useradd -m -u 1000 -g 1000 -s /bin/bash devuser \
    && mkdir -p /opt/browsercontainer /tmp/playwright-mcp \
    && chown -R devuser:devuser /opt/browsercontainer /tmp/playwright-mcp

COPY --chown=devuser:devuser package.json /opt/browsercontainer/package.json
RUN cd /opt/browsercontainer && npm install --omit=dev && rm -rf /root/.npm
COPY --chown=devuser:devuser server.js /opt/browsercontainer/server.js
COPY supervisord.conf /etc/supervisord.conf
COPY --chown=devuser:devuser healthcheck.sh /opt/browsercontainer/healthcheck.sh
RUN chmod +x /opt/browsercontainer/healthcheck.sh

EXPOSE 5903 8931 9222

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD /opt/browsercontainer/healthcheck.sh

CMD ["supervisord", "-n", "-c", "/etc/supervisord.conf"]
