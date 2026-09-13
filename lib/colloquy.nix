# lib/colloquy.nix
#
# Nix derivation for the `colloquy` workspace — the cq shared-agent-learning
# model, clean-room in Rust (ADR-2085/ADR-2086). Four crates, one binary:
#
#   colloquy-mcp   the six verbs (query, propose, confirm, flag, reflect,
#                  status) as an MCP server over stdio, serving the LOCAL tier
#
# The shared and public tiers are libraries, not binaries: they need RuVector
# and relay transports that belong to the management API, which already holds
# those connections. Wiring a second copy into a stdio child would duplicate
# configuration that is the manifest's business.
#
# `colloquy-core` is the publishable half — pure, no clock, no I/O, Apache-2.0
# to match upstream cq, and it also builds for wasm32 so the same confidence
# arithmetic can run in the Cloudflare workers. Nothing here depends on that
# target; it is checked in CI, not baked.
#
# Like lib/nostr-pod-bridge.nix, this path-deps a sibling DreamLab-AI repo that
# is deliberately unpublished (nostr-rust-forum → crates/nostr-bbs-core, for the
# event types colloquy-nostr binds to). The sandbox has no network, so the repo
# is fetched as a fixed-output derivation and the on-disk layout the relative
# path-deps expect is reassembled around the source.
#
# **forumRev/forumHash must stay in step with lib/nostr-pod-bridge.nix.** Both
# consume nostr-bbs-core; two revisions in one image would mean two definitions
# of NostrEvent. Bump them together, and regenerate this workspace's Cargo.lock
# when you do. Refresh procedure is documented in lib/nostr-pod-bridge.nix.
#
# Licence: colloquy-core is Apache-2.0; the other three crates are
# AGPL-3.0-only, and the shipped binary aggregates AGPL — same handling as the
# other first-party daemons in docs/developer/licensing.md.

{ lib, pkgs }:

let
  version = "0.1.0";

  # Keep in step with lib/nostr-pod-bridge.nix — see the header.
  forumRev  = "c4a94d17d85fa458f28c663739b28efb1b77c9d6";
  forumHash = "sha256-+y77RdQBaQ3glm2KWPiV4ar7oJvphEUlP/bCRgnkAhs=";

  forumSrc = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "nostr-rust-forum";
    rev   = forumRev;
    hash  = forumHash;
  };

  colloquySrc = lib.cleanSourceWith {
    src    = ../crates/colloquy;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

  # The crates resolve nostr-bbs-core at ../../../../../nostr-rust-forum, i.e.
  # five levels above crates/colloquy/<crate>/. Reassemble that layout so cargo
  # finds it without editing any Cargo.toml.
  workspace = pkgs.runCommand "colloquy-workspace" { } ''
    mkdir -p $out/a/b/c/project/agentbox/crates
    cp -r ${colloquySrc}  $out/a/b/c/project/agentbox/crates/colloquy
    cp -r ${forumSrc}     $out/a/b/c/nostr-rust-forum
    chmod -R u+w $out
  '';

in
pkgs.rustPlatform.buildRustPackage {
  pname = "colloquy";
  inherit version;

  src = workspace;
  sourceRoot = "colloquy-workspace/a/b/c/project/agentbox/crates/colloquy";

  cargoLock = {
    lockFile = ../crates/colloquy/Cargo.lock;
    # nostr-bbs-core arrives by path, not by git, so it needs no output hash
    # entry here — the fetchFromGitHub above is the fixed-output boundary.
  };

  # 162 tests, all hermetic: no network, no clock (every time-dependent function
  # takes `now` as an argument), no database. The cq interoperability fixture
  # runs here too, so a build fails if a schema change breaks round-tripping
  # cq's own published example unit.
  doCheck = true;

  meta = with lib; {
    description = "Colloquy — cq shared-agent-learning knowledge units, ladder, and diversity-weighted confidence";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ asl20 agpl3Only ];
    platforms   = platforms.linux;
  };
}
