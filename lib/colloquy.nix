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
# Exactly ONE crate here still path-deps a sibling DreamLab-AI repo:
# colloquy-backends needs nostr-rust-forum → crates/nostr-bbs-core for audited
# BIP-340 signing and verification. The other five are free of it —
# colloquy-nostr owns the NIP-01 structs, which were never library-specific, and
# that is what made core/view/nostr/store publishable. The sandbox has no
# network, so the repo is fetched as a fixed-output derivation and the on-disk
# layout the relative path-dep expects is reassembled around the source.
#
# **This pin is AHEAD of lib/nostr-pod-bridge.nix, deliberately and verifiably.**
# colloquy is pinned to fcb6b16 (forum HEAD); the bridge is still on c4a94d17 because its Cargo.lock was generated
# against that tree and advancing it needs a `cargo generate-lockfile` plus a
# build, which is host-side work.
#
# Two revisions in one image would be a problem if a SINGLE binary saw two
# definitions of NostrEvent — it does not: these are separate binaries with
# separate closures. The shared surface that could still bite is the event
# contract itself, and that is VERIFIED identical:
#
#   git diff c4a94d17..fcb6b16 -- crates/nostr-bbs-core/src/event.rs   # empty
#
# so both binaries hash event ids and verify signatures the same way. The drift
# is confined to keys.rs and the crate's Cargo.toml, neither of which colloquy
# uses (it takes SigningKey from k256 directly and signing from event.rs).
# Advance the bridge on the next host rebuild and the two converge again.
#
# Hash refresh: `nix-prefetch-url --unpack --type sha256 \
#   https://github.com/DreamLab-AI/nostr-rust-forum/archive/<rev>.tar.gz`
# then `nix hash convert --hash-algo sha256 --to sri <base32>`.
#
# Licence: colloquy-core is Apache-2.0; the other three crates are
# AGPL-3.0-only, and the shipped binary aggregates AGPL — same handling as the
# other first-party daemons in docs/developer/licensing.md.

{ lib, pkgs }:

let
  version = "0.1.0";

  # Ahead of lib/nostr-pod-bridge.nix on purpose — see the header for why that
  # is safe here and what closes the gap.
  forumRev  = "fcb6b160c42b06b4053a55a772abed3650bcaabc";
  forumHash = "sha256-W8X5ZbIJJEjBHF0D/rEYO3V1n8VfYhlpqkaGSY/aKdQ=";

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
