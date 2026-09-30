# lib/sidestr-agent.nix
#
# Nix derivation for `sidestr-agent`, the Rust economic engine for sidestr
# sidechains (DreamLab-AI/sidestr-rs, published to crates.io). Agentbox bakes
# it for [program:sidestr-faucet] (gate: [sidechain].faucet), which answers
# kind-23501 faucet requests on sidestr:dreamlab for the forum's member wallets
# (dreamlab-ai-website, forum ADR-2015).
#
# Why baked and not run from a workspace checkout: a `cargo build` inside the
# container links against the image's glibc store path, and the next rebuild
# garbage-collects that path, so a workspace binary stops executing ("required
# file not found") after every image rebuild. That is how the interim tmux
# faucet died on 2026-09-25.
#
# sidestr-rs is a self-contained [workspace] with every dependency on crates.io
# (no git sources), so the checked-in lockfile needs no outputHashes. TLS is
# rustls + webpki-roots: no openssl, no pkg-config, no runtime CA bundle.
#
# To bump: move `rev` to a pushed sidestr-rs commit, refresh `hash`
# (nix-prefetch-url --unpack on the commit tarball, then `nix hash convert
# --to sri`), and copy that commit's Cargo.lock to
# lib/lockfiles/sidestr-rs-<short rev>.Cargo.lock.
#
# Licence: AGPL-3.0-only, the same as agentbox.

{ lib, pkgs }:

let
  version = "0.3.2";
  rev = "d68880bf90c2c61699389b9e0b313c9a57d043d2";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "sidestr-rs";
    inherit rev;
    hash  = "sha256-KDMVBdiYynDoLYEv43iE3VdJnMC1mUkjPbkIbSgK4ZA=";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "sidestr-agent";
  inherit version src;

  # The commit's lockfile, vendored so evaluation never reads from the fetched
  # tree (no import-from-derivation). Byte-identical to Cargo.lock at `rev`.
  cargoLock.lockFile = ./lockfiles/sidestr-rs-${builtins.substring 0 8 rev}.Cargo.lock;

  # Build and test only the agent; the workspace's siding-oracle parity job
  # needs the upstream JS checkouts and runs in sidestr-rs CI instead.
  cargoBuildFlags = [ "-p" "sidestr-agent" ];
  cargoTestFlags  = [ "-p" "sidestr-agent" ];
  doCheck = true;

  meta = with lib; {
    description = "Economic engine for sidestr sidechains: faucet, pegs and transfers over Nostr";
    homepage    = "https://github.com/DreamLab-AI/sidestr-rs";
    license     = licenses.agpl3Only;
    mainProgram = "sidestr-agent";
    platforms   = platforms.linux;
  };
}
