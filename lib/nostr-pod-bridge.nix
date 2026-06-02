# lib/nostr-pod-bridge.nix
#
# Nix derivation for agentbox's first-party `nostr-pod-bridge` daemon — the
# drop-in replacement for the third-party `nostr-rs-relay` process in the
# relay slot. It binds an in-process Nostr relay (NIP-01/11/16 via
# solid-pod-rs-nostr), unwraps inbound NIP-59 gift wraps (kind 1059) with the
# NIP-44/26 crypto from nostr-bbs-core, and persists every accepted event to
# the Solid pod inbox. Durability lives in the pod, not in the relay ring
# buffer — so there is no SQLite/WAL on this path.
#
# The crate source is in-repo (services/nostr-pod-bridge) but it path-deps two
# sibling DreamLab-AI repos that are NOT published to crates.io (deliberately —
# we consume the crates locally, we do not publish). To build hermetically in
# the Nix sandbox we fetch those two repos as fixed-output derivations and
# reassemble the on-disk workspace layout the crate's relative path-deps expect
# (../../../../<repo>), so cargo resolves them without us editing Cargo.toml.
#
# Both sibling fetches pin the development revs the in-repo Cargo.lock was
# generated against. They ship with `lib.fakeHash` placeholders; Nix surfaces
# the correct SRI hash at realisation (the same pattern as lib/solid-pod-rs.nix).
#
# Hash-refresh procedure (run on the host build shell — tmux tab 6 — when a rev
# bumps, or to fill the initial placeholders):
#   nix-prefetch-url --unpack --type sha256 \
#     https://github.com/DreamLab-AI/nostr-rust-forum/archive/<forumRev>.tar.gz
#   nix-prefetch-url --unpack --type sha256 \
#     https://github.com/DreamLab-AI/solid-pod-rs/archive/<solidRev>.tar.gz
#   nix hash convert --hash-algo sha256 --to sri <base32>   # for each
#   # then re-run the bridge Cargo.lock if either rev moved:
#   #   cd services/nostr-pod-bridge && cargo generate-lockfile
#
# Licence: the bridge crate is MIT OR Apache-2.0; it links solid-pod-rs-nostr
# (AGPL-3.0-only) at build time, so the shipped binary aggregates AGPL — handled
# the same way as the solid-pod-rs server in docs/developer/licensing.md.

{ lib, pkgs }:

let
  version = "0.1.0";

  # ── Sibling crate sources (consumed via path-deps, never published) ────────
  # nostr-rust-forum → crates/nostr-bbs-core (NIP-44/26/59 crypto).
  forumRev  = "adde24d732778a013e852349d09d98fede53ced2";
  forumHash = "sha256-M9uJmoEagsUPBtUhLBSloE+ASuYFXv5D5jAB1r8mEKo="; # refresh via the prefetch procedure above

  # solid-pod-rs → crates/solid-pod-rs-nostr (relay substrate) + crates/solid-pod-rs
  # (the [patch.crates-io] target). Pinned to the rev the bridge Cargo.lock was
  # locked against (0.4.0-alpha.15 line), independent of the server's pin in
  # lib/solid-pod-rs.nix so a server-rev bump cannot desync the bridge lockfile.
  solidRev  = "0cf2d61fa4b308379136cb9b8013088f984bf07e";
  solidHash = "sha256-IL6qXiKiXw+jBgshA355uSLnC+6PTZa5B5Kkiem2kVg="; # refresh via the prefetch procedure above

  forumSrc = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "nostr-rust-forum";
    rev   = forumRev;
    hash  = forumHash;
  };

  solidSrc = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "solid-pod-rs";
    rev   = solidRev;
    hash  = solidHash;
  };

  # In-repo crate, minus the local build cache.
  bridgeCrateSrc = lib.cleanSourceWith {
    src    = ../services/nostr-pod-bridge;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

  # Reassemble the workspace layout the crate's `../../../../<repo>` path-deps
  # resolve against. From the crate at
  #   $out/project/agentbox/services/nostr-pod-bridge
  # four `..` hops land on $out, where the siblings live.
  bridgeSrc = pkgs.runCommand "nostr-pod-bridge-src-${version}" { } ''
    mkdir -p $out/project/agentbox/services
    cp -r ${bridgeCrateSrc} $out/project/agentbox/services/nostr-pod-bridge
    cp -r ${forumSrc}       $out/nostr-rust-forum
    cp -r ${solidSrc}       $out/solid-pod-rs
    chmod -R u+w $out
  '';

in
pkgs.rustPlatform.buildRustPackage {
  pname = "nostr-pod-bridge";
  inherit version;
  src = bridgeSrc;

  buildAndTestSubdir = "project/agentbox/services/nostr-pod-bridge";

  # The crate is a standalone [workspace]; its checked-in lockfile already
  # reflects the [patch.crates-io] redirect of solid-pod-rs to the local copy.
  cargoLock.lockFile = ../services/nostr-pod-bridge/Cargo.lock;

  # cargoSetupPostPatchHook validates a Cargo.lock at the unpacked source root,
  # but the reassembled workspace keeps the crate's lockfile under
  # buildAndTestSubdir. Copy it to the root so the consistency check resolves
  # (same pattern as lib/solid-pod-rs.nix). The build still runs in the subdir.
  postPatch = ''
    cp ${../services/nostr-pod-bridge/Cargo.lock} Cargo.lock
  '';

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [ pkgs.openssl ];

  # Lib tests (NIP-59 unwrap, pod-write) need fixture FS state; they run in CI,
  # not in the sandbox. The agentbox-level contract is covered by the relay
  # ingress tests.
  doCheck = false;

  meta = with lib; {
    description = "Embedded Nostr relay + Solid-pod ingress bridge for agentbox (NIP-44/26/59 via nostr-bbs-core, NIP-01/11/16 via solid-pod-rs-nostr)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "nostr-pod-bridge";
    platforms   = platforms.linux;
  };
}
