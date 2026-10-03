# lib/poker-citizen.nix
#
# Nix derivation for `nostr-bbs-poker-citizen`, the forum poker table's house
# seat (DreamLab-AI/nostr-rust-forum, forum ADR-2020). Agentbox bakes it for
# [program:poker-citizen] (gate: [poker_citizen].enabled), which deals DREAM
# hands to forum members over the forum relay and settles them on
# sidestr:dreamlab through the local producer.
#
# Baked, not built from a workspace checkout, for the reason lib/sidestr-agent.nix
# gives: a workspace cargo build stops executing after every image rebuild.
#
# The kit workspace has every dependency on crates.io (no git sources), so the
# checked-in lockfile needs no outputHashes. TLS is rustls + webpki-roots.
#
# To bump: move `rev` to the website's KIT_REF (the two must agree so the
# house seat and the forum client speak the same protocol VERSION), refresh
# `hash` (nix-prefetch-url --unpack on the commit tarball, then `nix hash
# convert --to sri`), and copy that commit's Cargo.lock to
# lib/lockfiles/nostr-rust-forum-<short rev>.Cargo.lock.
#
# Licence: AGPL-3.0-only, the same as agentbox.

{ lib, pkgs }:

let
  version = "1.0.0-beta.13";
  rev = "d67370884b02fc9f0586cc8d6078d80aca69e9ef";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "nostr-rust-forum";
    inherit rev;
    hash  = "sha256-z9efv3bkuGPU7wB9opCn5ezG7of5iwj9570rtUuBCIs=";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "nostr-bbs-poker-citizen";
  inherit version src;

  # The commit's lockfile, vendored so evaluation never reads from the fetched
  # tree (no import-from-derivation). Byte-identical to Cargo.lock at `rev`.
  cargoLock.lockFile = ./lockfiles/nostr-rust-forum-${builtins.substring 0 8 rev}.Cargo.lock;

  # Build and test only the house seat and the poker crate it is built on; the
  # rest of the workspace is the forum's workers and clients.
  cargoBuildFlags = [ "-p" "nostr-bbs-poker-citizen" ];
  cargoTestFlags  = [ "-p" "nostr-bbs-poker-citizen" "-p" "nostr-bbs-poker" ];
  doCheck = true;

  meta = with lib; {
    description = "The nostr-bbs poker table's house seat: deals committed DREAM hands over the forum relay and settles them on sidestr:dreamlab";
    homepage    = "https://github.com/DreamLab-AI/nostr-rust-forum";
    license     = licenses.agpl3Only;
    mainProgram = "nostr-bbs-poker-citizen";
    platforms   = platforms.linux;
  };
}
