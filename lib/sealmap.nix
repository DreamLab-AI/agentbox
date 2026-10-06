# lib/sealmap.nix
#
# Builds only the `sealmap` binary (package `sealmap`, from the DreamLab-AI/sealmap
# v0.2.1 tag) and puts it on PATH in the image. Why: it is a Rust code lens for agents
# (`sealmap dense` / `sealmap generate` show the real call tree around a symbol); see
# skills/sealmap-review/references/evidence.md. Pure-Rust closure, no native inputs.
#
# Same shape as lib/diagram-ir.nix: fetchFromGitHub at the tag, with the tag's lockfile
# vendored in lib/lockfiles so evaluation never reads from the fetched tree.
#
# To bump: move `rev`/`version` to the new tag, refresh `hash`, and copy the tag's
# Cargo.lock to lib/lockfiles/sealmap-<version>.Cargo.lock.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.2.1";
in
pkgs.rustPlatform.buildRustPackage {
  pname = "sealmap";
  inherit version;

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "sealmap";
    rev   = "v${version}"; # commit a7ce8cd254191b029503517b03abe81a8ab295b8
    hash  = "sha256-2Z4LJf/YyqQEnRaua63pu/VtpynMJyt3R8kCTTjZqGI=";
  };

  # Byte-identical to Cargo.lock at the tag; needs no hash.
  cargoLock.lockFile = ./lockfiles/sealmap-${version}.Cargo.lock;

  # Build and install only the CLI package, not the workspace's bench member.
  cargoBuildFlags = [ "-p" "sealmap" ];
  cargoTestFlags  = [ "-p" "sealmap" ];

  # Upstream runs its suite at the tag; the image only needs the binary.
  doCheck = false;

  meta = with lib; {
    description = "Deterministic Rust code lens: call trees, dense views and generated diagrams";
    homepage    = "https://github.com/DreamLab-AI/sealmap";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "sealmap";
    platforms   = platforms.linux;
  };
}
