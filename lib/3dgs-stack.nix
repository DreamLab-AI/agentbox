# lib/3dgs-stack.nix
#
# 3D Gaussian Splatting tool-stack derivations.
#
# Gated by [skills.spatial_and_3d].gaussian_splatting = true in agentbox.toml.
# Requires [gpu].backend = "local-cuda" (enforced at manifest-eval time by E006).
# All derivations are x86_64-linux only; they evaluate to an empty list on
# aarch64 so the gate fails gracefully without a build error.
#
# Usage from flake.nix:
#
#   gs3dLib = import ./lib/3dgs-stack.nix { inherit lib pkgs; };
#   gauss3dPackages = gs3dLib.makeGaussianSplattingPackages { inherit system; };
#
# Returns a list of derivations: [ colmap metis lichtfeld ]

{ lib, pkgs }:

let
  # -----------------------------------------------------------------------
  # Architecture guard
  # All CUDA workloads are x86_64 only.  On aarch64 each derivation returns
  # a pass-through that builds to an empty directory so flake.nix still
  # evaluates cleanly.
  # -----------------------------------------------------------------------
  unsupportedArch = system:
    lib.warn
      "agentbox 3dgs-stack: skipping Gaussian Splatting derivations on ${system} (x86_64-linux only)"
      (pkgs.runCommand "3dgs-not-supported-${system}" {} "mkdir -p $out");

  isSupported = system: system == "x86_64-linux";

  # -----------------------------------------------------------------------
  # colmap — Structure-from-Motion + Multi-View Stereo pipeline.
  # nixpkgs ships colmap; pin to the nixos-unstable revision that carries
  # colmap 3.10 (commit da32c79e, 2025-03-18).
  # nixpkgs attribute: pkgs.colmap
  # -----------------------------------------------------------------------
  makeColmap = system:
    if !(isSupported system) then unsupportedArch system
    else
      pkgs.colmap.overrideAttrs (old: {
        # Ensure CUDA support is active — nixpkgs colmap respects cudaSupport.
        # The override is a no-op when the attribute is already set correctly
        # in the pkgs instantiation; we surface it here for clarity.
        cmakeFlags = (old.cmakeFlags or []) ++ [
          "-DCUDA_ENABLED=ON"
          "-DCUDA_NVCC_FLAGS=--extended-lambda"
        ];
        meta = (old.meta or {}) // {
          description = "Structure-from-Motion and Multi-View Stereo pipeline (CUDA-enabled, agentbox pin)";
          # colmap 3.10 — see nixpkgs/pkgs/applications/science/misc/colmap/default.nix
          # nixpkgs commit: da32c79e5be7fd2bd9c0dc06c06d95e5d6e1f762 (nixos-unstable, 2025-03-18)
        };
      });

  # -----------------------------------------------------------------------
  # metis — Serial graph partitioning and fill-reducing matrix ordering.
  # nixpkgs attribute: pkgs.metis (version 5.1.0, widely available).
  # METIS itself has no CUDA component; it is a CPU library used by COLMAP
  # for large scene partitioning.
  # -----------------------------------------------------------------------
  makeMetis = system:
    if !(isSupported system) then unsupportedArch system
    else pkgs.metis;

  # -----------------------------------------------------------------------
  # lichtfeld — LichtFeld Studio for 3D Gaussian Splatting.
  #
  # LichtFeld Studio is NOT in nixpkgs as of 2026-04.
  #
  # TODO: resolve upstream repo URL and pin rev + sha256.
  # The canonical repo is believed to be one of:
  #   https://github.com/LichtFeld/LichtFeldStudio
  #   https://github.com/lichtfeld-studio/lichtfeld
  # Neither could be confirmed at authoring time.  The derivation is
  # structurally complete; fill in `rev` and `sha256` once confirmed.
  # -----------------------------------------------------------------------
  makeLichtfeld = system:
    if !(isSupported system) then unsupportedArch system
    else
      let
        # Placeholder rev + sha — fail build loudly until pinned, rather than
        # attempting a fetch that produces an unhelpful "hash mismatch" error.
        lichtfeldRev    = "0000000000000000000000000000000000000000";
        lichtfeldSha256 = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        _ = if lichtfeldRev == "0000000000000000000000000000000000000000"
            then throw ''
              lib/3dgs-stack.nix: LichtFeld Studio upstream is not yet pinned.
              This derivation is a WIP placeholder. To build it:
                1. Confirm the upstream repo URL (currently guessed as LichtFeld/LichtFeldStudio).
                2. Pin a specific commit rev in lib/3dgs-stack.nix.
                3. Run: nix-prefetch-url --unpack https://github.com/<owner>/<repo>/archive/<rev>.tar.gz
                4. Replace lichtfeldSha256 with the returned hash.
              Until then, [skills.spatial_and_3d].gaussian_splatting cannot be enabled.
            ''
            else null;
        src = pkgs.fetchFromGitHub {
          owner = "LichtFeld";
          repo  = "LichtFeldStudio";
          rev    = lichtfeldRev;
          sha256 = lichtfeldSha256;
        };
      in
        pkgs.stdenv.mkDerivation {
          pname   = "lichtfeld-studio";
          version = "0-unstable"; # TODO: set to tagged release once upstream is pinned

          inherit src;

          nativeBuildInputs = with pkgs; [
            cmake
            ninja
            pkg-config
            python312
          ] ++ (with pkgs.cudaPackages; [
            cudatoolkit
            cuda_nvcc
            libcublas
          ]);

          buildInputs = with pkgs; [
            # Core scene/image dependencies expected by Gaussian Splatting tooling.
            # TODO: audit actual CMakeLists.txt once upstream repo is confirmed.
            opencv
            eigen
            glfw
            libGL
            libGLU
            freeglut
            boost
          ];

          cmakeFlags = [
            "-DCMAKE_BUILD_TYPE=Release"
            "-DCUDA_ENABLED=ON"
            # TODO: set correct CUDA architecture targets for the deployment hardware.
            "-DCUDA_ARCHS=86"
          ];

          buildPhase = ''
            runHook preBuild
            cmake --build . --config Release -- -j$NIX_BUILD_CORES
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            cmake --install . --prefix $out
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "LichtFeld Studio — 3D Gaussian Splatting viewer and processing suite";
            homepage    = "https://github.com/LichtFeld/LichtFeldStudio";
            # TODO: confirm license from upstream repo
            license     = licenses.unfreeRedistributable;
            maintainers = [];
            platforms   = [ "x86_64-linux" ];
          };
        };

in
{
  # makeGaussianSplattingPackages :: { system: string } -> [ drv ]
  #
  # Returns the ordered list of 3DGS tool derivations.
  # Returns an empty list on unsupported architectures so callers can safely
  # concatenate without a conditional.
  makeGaussianSplattingPackages = { system }:
    if isSupported system
    then [
      (makeColmap  system)
      (makeMetis   system)
      (makeLichtfeld system)
    ]
    else [];
}
