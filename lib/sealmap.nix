# lib/sealmap.nix
#
# Nix derivation for the `sealmap` CLI — deterministic code maps, sealed
# diagram contracts and dense Mermaid views. It is baked on PATH as a code
# lens: `sealmap dense` / `sealmap generate` around a suspect Rust symbol show
# the call tree, and the sealmap-review skill uses the same corpus format.
#
# Only the `sealmap` package is built (`-p sealmap`); the workspace's bench
# member is not compiled. Pure-Rust dependency closure, no native inputs.
#
# Source is fetched as the GitHub tarball of the pinned commit with
# `fetchurl`, whose sha256 is a plain hex digest (`sha256sum` of the tarball),
# so it was computed without Nix. The lockfile is vendored in
# lib/lockfiles so evaluation never reads from the fetched tree.
#
# To bump: set `rev` to the new commit and `version`, re-run `sha256sum` on
# https://github.com/DreamLab-AI/sealmap/archive/<rev>.tar.gz, and copy the
# tag's Cargo.lock to lib/lockfiles/sealmap-<version>.Cargo.lock.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.2.1";
  rev = "a7ce8cd254191b029503517b03abe81a8ab295b8"; # tag v0.2.1
in
pkgs.rustPlatform.buildRustPackage {
  pname = "sealmap";
  inherit version;

  src = pkgs.fetchurl {
    name   = "sealmap-${version}.tar.gz";
    url    = "https://github.com/DreamLab-AI/sealmap/archive/${rev}.tar.gz";
    sha256 = "228cc7d5199b695a24f69e38cab5ab32c8e6be0c06ec36e8c450034454fc74f5";
  };
  sourceRoot = "sealmap-${rev}";

  cargoLock.lockFile = ./lockfiles/sealmap-${version}.Cargo.lock;

  # Build and install only the CLI package.
  cargoBuildFlags = [ "-p" "sealmap" ];
  cargoTestFlags  = [ "-p" "sealmap" ];

  # The test suite is run upstream at the tag; the image only needs the binary.
  doCheck = false;

  meta = with lib; {
    description = "Deterministic code maps and sealed diagram contracts; code lens for agentbox";
    homepage    = "https://github.com/DreamLab-AI/sealmap";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "sealmap";
    platforms   = platforms.linux;
  };
}
