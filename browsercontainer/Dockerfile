FROM archlinux:base

ENV DISPLAY=:2 \
    LANG=C.UTF-8 \
    HOME=/home/devuser

# Core packages: Chromium, Xvfb, VNC, Vulkan, Node.js, supervisord, build tools
RUN pacman -Syu --noconfirm && pacman -S --noconfirm --needed \
        chromium \
        xorg-server-xvfb \
        x11vnc \
        supervisor \
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
        socat \
        iproute2 \
        base-devel \
        git \
        sudo \
    && pacman -Scc --noconfirm \
    && rm -rf /var/cache/pacman/pkg/* /root/.npm /tmp/*

# Create devuser with sudo for AUR builds
RUN groupadd -g 1000 devuser \
    && useradd -m -u 1000 -g 1000 -s /bin/bash devuser \
    && echo 'devuser ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

# Install yay (AUR helper) as devuser
RUN mkdir -p /tmp/yay-build && chown devuser:devuser /tmp/yay-build \
    && cd /tmp/yay-build \
    && sudo -u devuser git clone https://aur.archlinux.org/yay-bin.git \
    && cd yay-bin \
    && sudo -u devuser makepkg -si --noconfirm \
    && rm -rf /tmp/yay-build

# Install Chrome beta (149+) from AUR for WebMCP support
RUN sudo -u devuser yay -S --noconfirm --needed google-chrome-beta \
    && sudo -u devuser yay -Scc --noconfirm \
    && rm -rf /home/devuser/.cache/yay /tmp/*

# Application directory
RUN mkdir -p /opt/browsercontainer /tmp/xdg-runtime /tmp/chromium-crashes /tmp/chrome-profile \
    && chown -R devuser:devuser /opt/browsercontainer /tmp/xdg-runtime /tmp/chromium-crashes /tmp/chrome-profile

# Install chrome-devtools-mcp and ws (CDP diagnostics) globally
RUN npm install -g chrome-devtools-mcp@latest ws && rm -rf /root/.npm

COPY --chown=devuser:devuser package.json /opt/browsercontainer/package.json
COPY --chown=devuser:devuser server.js /opt/browsercontainer/server.js
COPY --chown=devuser:devuser launch-chromium.sh /opt/browsercontainer/launch-chromium.sh
COPY --chown=devuser:devuser cdp-diagnose.js /opt/browsercontainer/cdp-diagnose.js
COPY supervisord.conf /etc/supervisord.conf
COPY --chown=devuser:devuser healthcheck.sh /opt/browsercontainer/healthcheck.sh
RUN chmod +x /opt/browsercontainer/healthcheck.sh /opt/browsercontainer/launch-chromium.sh

# 5903: VNC  |  8931: MCP SSE  |  9222: Chrome CDP (internal)  |  9223: socat CDP proxy (external)
EXPOSE 5903 8931 9222 9223

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD /opt/browsercontainer/healthcheck.sh

CMD ["supervisord", "-n", "-c", "/etc/supervisord.conf"]
