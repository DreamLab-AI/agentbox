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
  # Load the pinned nixpkgs from the flake.lock without copying the repo tree.
  # builtins.getFlake "path:/abs/path" works under --impure but only if the
  # path is already in (or accessible as) a Nix store path or the flake lock
  # defines the inputs.  We read flake.lock directly to extract the exact
  # nixpkgs rev so we get the same package set as the real build.
  lockFile    = builtins.fromJSON (builtins.readFile ../flake.lock);
  nixpkgsNode = lockFile.nodes.nixpkgs.locked;
  nixpkgsSrc  = fetchTarball {
    url    = "https://github.com/${nixpkgsNode.owner}/${nixpkgsNode.repo}/archive/${nixpkgsNode.rev}.tar.gz";
    sha256 = nixpkgsNode.narHash;
  };
  pkgs  = import nixpkgsSrc {
    system = builtins.currentSystem;
    config.allowUnfree = true;
    config.permittedInsecurePackages = [ "python3.12-ecdsa-0.19.1" ];
  };
  lib        = pkgs.lib;
  npmCliLib  = import ../lib/npm-cli.nix { inherit lib pkgs; };
in
  (npmCliLib.makeNpmCli {
    inherit pkgName version sha256 bin;
    nodeModulesHash = lib.fakeHash;
  }).passthru.packageWithDeps
