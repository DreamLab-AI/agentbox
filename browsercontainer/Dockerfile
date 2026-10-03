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
        unzip \
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
# /home/devuser/chrome-profile is the mount point of the named volume
# browsercontainer-profile (W9); creating it here owned by devuser means a fresh
# volume is initialised with devuser ownership.
RUN mkdir -p /opt/browsercontainer /tmp/xdg-runtime /tmp/chromium-crashes /tmp/browsercontainer /home/devuser/chrome-profile /home/devuser/exchange \
    && chown -R devuser:devuser /opt/browsercontainer /tmp/xdg-runtime /tmp/chromium-crashes /tmp/browsercontainer /home/devuser/chrome-profile /home/devuser/exchange

# Install chrome-devtools-mcp and ws globally (runtime uses Chrome Beta from AUR)
RUN npm install -g chrome-devtools-mcp@latest ws && rm -rf /root/.npm

# Mermaid diagram rendering — mmdc uses puppeteer which needs Chrome.
# PUPPETEER_SKIP_DOWNLOAD avoids a second Chrome download (system chromium is already installed).
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install -g @mermaid-js/mermaid-cli@11.16.0 && rm -rf /root/.npm

COPY --chown=devuser:devuser package.json /opt/browsercontainer/package.json
RUN cd /opt/browsercontainer && npm install ws && chown -R devuser:devuser node_modules
COPY --chown=devuser:devuser server.js /opt/browsercontainer/server.js
COPY --chown=devuser:devuser launch-chromium.sh /opt/browsercontainer/launch-chromium.sh
COPY --chown=devuser:devuser cdp-diagnose.js /opt/browsercontainer/cdp-diagnose.js
COPY --chown=devuser:devuser puppeteer-mermaid.json /opt/browsercontainer/puppeteer-mermaid.json
COPY --chown=devuser:devuser podkey-ctl.js /opt/browsercontainer/podkey-ctl.js

# Podkey (W9, owner rule 2026-10-03): the published `podkey-extension` CI artefact
# of JavaScriptSolidServer/podkey, named exactly by podkey.pin. The zip is fetched
# on the host before the build (`agentbox.sh browsercontainer up|rebuild` runs
# scripts/fetch-podkey.sh fetch), so no token enters the build; here it is only
# verified against the pin and unpacked. Never built from source, never a fork zip.
COPY --chown=devuser:devuser podkey.pin /opt/browsercontainer/podkey.pin
COPY --chown=devuser:devuser scripts/fetch-podkey.sh /opt/browsercontainer/scripts/fetch-podkey.sh
COPY vendor/podkey-extension.zip /tmp/podkey-extension.zip
RUN bash /opt/browsercontainer/scripts/fetch-podkey.sh install --pin /opt/browsercontainer/podkey.pin \
        --zip /tmp/podkey-extension.zip --dest /opt/browsercontainer/extensions/podkey \
    && rm -f /tmp/podkey-extension.zip
# Managed policy: block every extension except Podkey (id derived from the path
# above; podkey-ctl.js `id`). Branded Chrome reads /etc/opt/chrome, Chromium /etc/chromium.
COPY policies/podkey-only.json /etc/opt/chrome/policies/managed/podkey-only.json
RUN install -D -m 0644 /etc/opt/chrome/policies/managed/podkey-only.json /etc/chromium/policies/managed/podkey-only.json

COPY supervisord.conf /etc/supervisord.conf
COPY --chown=devuser:devuser healthcheck.sh /opt/browsercontainer/healthcheck.sh
RUN chmod +x /opt/browsercontainer/healthcheck.sh /opt/browsercontainer/launch-chromium.sh

# 5903: VNC  |  8931: MCP SSE  |  9222: Chrome CDP (internal)  |  9223: socat CDP proxy (external)
EXPOSE 5903 8931 9222 9223

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD /opt/browsercontainer/healthcheck.sh

CMD ["supervisord", "-n", "-c", "/etc/supervisord.conf"]
