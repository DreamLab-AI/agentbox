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
# Returns a list of derivations: [ colmap metis ]. LichtFeld Studio was a
# placeholder that failed the build on purpose; it was removed with its skill
# (ADR-2196), so the switch now bakes COLMAP and METIS only.

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
    ]
    else [];
}
