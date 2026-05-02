# scripts/_get-nodemods-hash.nix
#
# Minimal expression to build a single npm-cli node_modules FOD.
# Avoids pulling in the full runtime (CUDA etc).  System-agnostic.
#
# Usage (build-time hash mismatch prints the real hash):
#   nix build --impure -L \
#     -f scripts/_get-nodemods-hash.nix \
#     --argstr pkgName ruvector \
#     --argstr version 0.2.25 \
#     --argstr sha256 "sha256-CPzy..." \
#     --no-link
#
{ pkgName, version, sha256, bin ? pkgName }:

let
  # Resolve the flake from the repo root (parent of this script's dir).
  # builtins.getFlake requires a non-relative path; toString converts a
  # Nix path value (which is absolute) to a string without copying to store.
  repoRoot    = toString (builtins.path { path = ./..; name = "agentbox"; });
  flake       = builtins.getFlake "path:${repoRoot}";
  pkgs        = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
  lib         = pkgs.lib;
  npmCliLib   = import ../lib/npm-cli.nix { inherit lib pkgs; };
in
  (npmCliLib.makeNpmCli {
    inherit pkgName version sha256 bin;
    nodeModulesHash = lib.fakeHash;
  }).passthru.packageWithDeps
