# lib/gpu-wrap.nix
#
# nixGL-style GPU library-path wrapper (C-9 / GPU-1 / GPU-2).
#
# WHY THIS EXISTS
# ---------------
# agentbox's main image is nix-built. Nix binaries carry absolute nix-store
# RUNPATHs and never search /usr/lib — which is exactly where the
# nvidia-container-toolkit injects the host userspace driver libraries
# (libcuda.so.1, libGLX_nvidia, libEGL_nvidia, libnvcuvid, …; confirmed at
# runtime by NVIDIA_CTK_LIBCUDA_DIR=/usr/lib). Consequence: every nix GPU
# binary fails to dlopen libcuda and *silently falls back to CPU* — Blender
# Cycles reports "CUEW initialization failed", ffmpeg reports "Cannot load
# libcuda.so.1", COLMAP drops to CPU SfM. Only FHS binaries (nvidia-smi in
# /usr/bin, the Arch gui-tools sidecar Blender under vglrun) saw the GPU,
# because /usr/lib *is* their loader path.
#
# THE FIX (mirrors the existing start-xorg-nvidia.sh precedent, which already
# does `LD_LIBRARY_PATH=/usr/lib:/usr/lib/x86_64-linux-gnu … Xorg …`):
# wrap each nix GPU binary so it appends the host driver dirs to
# LD_LIBRARY_PATH, and point glvnd/EGL/Vulkan at the NVIDIA vendor ICDs.
#
#   --suffix (append), NOT --prefix: dlopen("libcuda.so.1") scans the whole
#   LD_LIBRARY_PATH regardless of position, so appending still resolves the
#   driver libs, while keeping nix's own libstdc++/libc authoritative ahead of
#   any host copy — this avoids ABI shadowing that a prefix would risk.
#
# Proven live (2026-08-31, RTX A6000 + 2×RTX 6000 Ada):
#   blender  bare → CUDA: []            wrapped → CUDA: [3 GPUs + CPU]
#   ffmpeg   bare → "Cannot load libcuda.so.1"   wrapped → h264_nvenc inits
#
# Usage from flake.nix:
#
#   gpuWrap = import ./lib/gpu-wrap.nix { inherit lib pkgs; };
#   gpuWrap.wrapGpuBins { pkg = pkgs.blender; bins = [ "blender" ]; }
#
# Returns a symlinkJoin that is a drop-in replacement for `pkg` (same
# $out/bin, $out/share, … layout; only the named bins are wrapped, everything
# else is symlinked through untouched).

{ lib, pkgs }:

let
  # Host driver injection dirs, in the order the nvidia-container-toolkit and
  # the Xorg precedent use them. Literal runtime paths, never nix-store paths.
  driverLibDirs = [
    "/usr/lib"
    "/usr/lib/x86_64-linux-gnu"
    "/run/opengl-driver/lib"   # NixOS-host convention; harmless when empty
  ];
  driverLibPath = lib.concatStringsSep ":" driverLibDirs;

  # glvnd/EGL/Vulkan vendor selection so GLX/EGL/Vulkan entry points route to
  # the injected NVIDIA vendor libs rather than the nix mesa fallback.
  gpuEnvArgs = [
    "--suffix" "LD_LIBRARY_PATH" ":" driverLibPath
    "--set-default" "__GLX_VENDOR_LIBRARY_NAME" "nvidia"
    "--set-default" "__EGL_VENDOR_LIBRARY_FILENAMES"
      "/usr/share/glvnd/egl_vendor.d/10_nvidia.json"
    # VK_ICD_FILENAMES is normally provisioned by the container toolkit
    # (NVIDIA_DRIVER_CAPABILITIES=graphics). Set a default so a wrapped binary
    # still finds the ICD if the runtime did not export one, without clobbering
    # an explicit value.
    "--set-default" "VK_ICD_FILENAMES"
      "/run/opengl-driver/share/vulkan/icd.d/nvidia_icd.x86_64.json"
  ];

in
rec {
  inherit driverLibDirs driverLibPath gpuEnvArgs;

  # wrapGpuBins :: { pkg, bins ? all bins in pkg, name ? … } -> derivation
  #
  # Wraps each named binary in $out/bin with the GPU library-path env.
  # Binaries that are absent (optional build outputs) are skipped, not an error.
  wrapGpuBins = { pkg, bins, name ? "${pkg.name or "pkg"}-gpuwrapped" }:
    pkgs.symlinkJoin {
      inherit name;
      paths = [ pkg ];
      nativeBuildInputs = [ pkgs.makeWrapper ];
      postBuild = ''
        for b in ${lib.concatStringsSep " " bins}; do
          target="$out/bin/$b"
          if [ -L "$target" ] || [ -e "$target" ]; then
            # symlinkJoin leaves $out/bin/$b as a symlink into the original
            # store path; wrapProgram resolves and rewraps it in place.
            wrapProgram "$target" ${lib.escapeShellArgs gpuEnvArgs}
          fi
        done
      '';
      # Preserve passthru (e.g. pkg.python, pkg.tests) and meta so downstream
      # references that reach through the package keep working.
      meta = (pkg.meta or {}) // {
        description = (pkg.meta.description or name)
          + " (agentbox GPU library-path wrapped, C-9)";
      };
    };

  # wrapGpuBinsAll :: { pkg, name ? … } -> derivation
  #
  # As wrapGpuBins but wraps *every* regular executable under $out/bin. Use
  # when the binary set is unknown or upstream-versioned (e.g. the 3DGS tools
  # colmap / lichtfeld-studio, whose bin names are not pinned here).
  wrapGpuBinsAll = { pkg, name ? "${pkg.name or "pkg"}-gpuwrapped" }:
    pkgs.symlinkJoin {
      inherit name;
      paths = [ pkg ];
      nativeBuildInputs = [ pkgs.makeWrapper ];
      postBuild = ''
        if [ -d "$out/bin" ]; then
          for target in "$out"/bin/*; do
            # Skip non-executables and dangling links defensively.
            if [ -e "$target" ] && { [ -x "$target" ] || [ -L "$target" ]; }; then
              wrapProgram "$target" ${lib.escapeShellArgs gpuEnvArgs}
            fi
          done
        fi
      '';
      meta = (pkg.meta or {}) // {
        description = (pkg.meta.description or name)
          + " (agentbox GPU library-path wrapped, C-9)";
      };
    };
}
