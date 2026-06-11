FROM archlinux:base

ENV DISPLAY=:3 \
    LANG=C.UTF-8 \
    HOME=/home/devuser \
    XDG_RUNTIME_DIR=/tmp/xdg-runtime \
    # bindgen (pulled in by godot-rust) needs libclang to generate the GDExtension
    # FFI bindings. Pin the search path so the gdext build never guesses wrong.
    LIBCLANG_PATH=/usr/lib \
    GODOT_VERSION=4.3-stable

# Core packages:
#   - Xvfb / x11vnc / supervisor : headless display + VNC mirror + process tree
#   - vulkan-tools / -icd-loader : Vulkan loader for the Monado compositor
#     (the NVIDIA ICD itself is injected by the container runtime, not installed)
#   - mesa / libdrm / libglvnd   : GL + DRM render-node fallback path
#   - X client libs              : Godot 4.3 desktop runtime dependencies
#   - rust / clang / llvm / base-devel : build the visionclaw-xr-gdext cdylib
#   - unzip / curl / git / sudo  : fetch the pinned Godot binary + AUR (Monado)
RUN pacman -Syu --noconfirm && pacman -S --noconfirm --needed \
        xorg-server-xvfb \
        x11vnc \
        supervisor \
        vulkan-tools \
        vulkan-icd-loader \
        mesa \
        libdrm \
        libglvnd \
        libx11 \
        libxcursor \
        libxinerama \
        libxrandr \
        libxi \
        libxext \
        libxrender \
        libxkbcommon \
        fontconfig \
        freetype2 \
        alsa-lib \
        dbus \
        rust \
        clang \
        llvm \
        cmake \
        pkgconf \
        base-devel \
        libcap \
        curl \
        unzip \
        git \
        socat \
        iproute2 \
        sudo \
    && pacman -Scc --noconfirm \
    && rm -rf /var/cache/pacman/pkg/* /tmp/*

# Create devuser with passwordless sudo for AUR builds (mirrors browsercontainer)
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

# Monado OpenXR desktop runtime from AUR. Pulls the OpenXR loader
# (libopenxr_loader.so.1) and installs the active-runtime manifest at
# /usr/share/openxr/1/openxr_monado.json. This is the long pole of the image
# build (compiles from source); everything downstream depends on it.
RUN sudo -u devuser yay -S --noconfirm --needed monado-git \
    && sudo -u devuser yay -Scc --noconfirm \
    && rm -rf /home/devuser/.cache/yay /tmp/*

# The AUR package sets cap_sys_nice on monado-service for realtime compositor
# scheduling. The container's capability bounding set won't honour file caps, so
# the kernel refuses to exec the binary (EPERM / exit 126). Strip it — Monado
# runs fine at normal priority (it just logs a benign realtime-priority warning).
RUN setcap -r /usr/bin/monado-service || true

# Pinned Godot 4.3 stable (official binary — NOT Arch's `godot` package, which
# tracks 4.4+ and would silently change engine behaviour under the project).
RUN curl -fsSL -o /tmp/godot.zip \
        "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.x86_64.zip" \
    && mkdir -p /opt/godot \
    && unzip -q /tmp/godot.zip -d /opt/godot \
    && mv /opt/godot/Godot_v${GODOT_VERSION}_linux.x86_64 /opt/godot/godot \
    && chmod +x /opt/godot/godot \
    && ln -sf /opt/godot/godot /usr/local/bin/godot \
    && rm -f /tmp/godot.zip

# Runtime dirs: app scripts, XDG runtime (Monado IPC socket lives here), and the
# mount points for the integrator's XR project + cargo cache.
# Pre-create the cargo registry dir owned by devuser so a fresh named volume
# inherits that ownership (Docker seeds an empty volume from the image path);
# the supervisord init-perms one-shot re-asserts it on every boot regardless.
RUN mkdir -p /opt/xr-runtime /tmp/xdg-runtime /workspace /home/devuser/.cargo/registry \
    && chown -R devuser:devuser /opt/xr-runtime /tmp/xdg-runtime /workspace /home/devuser/.cargo \
    && chmod 0700 /tmp/xdg-runtime

COPY --chown=devuser:devuser build-gdext.sh /opt/xr-runtime/build-gdext.sh
COPY --chown=devuser:devuser launch-monado.sh /opt/xr-runtime/launch-monado.sh
COPY --chown=devuser:devuser launch-godot.sh /opt/xr-runtime/launch-godot.sh
COPY --chown=devuser:devuser healthcheck.sh /opt/xr-runtime/healthcheck.sh
COPY supervisord.conf /etc/supervisord.conf
RUN chmod +x /opt/xr-runtime/*.sh

# 5904: VNC (Monado compositor window + Godot stereo render)
EXPOSE 5904

HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD /opt/xr-runtime/healthcheck.sh

CMD ["supervisord", "-n", "-c", "/etc/supervisord.conf"]
