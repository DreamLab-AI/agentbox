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
# generated against. BLD-002/R-026: the placeholders are RESOLVED — forumHash
# and solidHash below carry real SRI hashes, so this builds reproducibly. If a
# rev bumps, set the moved hash back to lib.fakeHash and re-resolve it via the
# prefetch procedure below (Nix surfaces the correct SRI at realisation).
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
  # nostr-rust-forum → crates/nostr-bbs-core (NIP-44/59 crypto, NIP-98).
  # Upstream commit 5bfd9815 (2026-06-11) removed NIP-26 delegation in favour
  # of the ADR-099 device-key registry. The bridge tracked that removal — its
  # authorize() is now allowlist-only. Same rev as lib/colloquy.nix (forum
  # HEAD fe36bf36, 2026-09-30); the two pins move together.
  forumRev  = "fe36bf365b7027337dde03368f8a52e1218c2f6c";
  forumHash = "sha256-9HooIa4vyu0Iw47VPr7RkMDyKrEazcElR2xPIe0njvE=";

  # solid-pod-rs → crates/solid-pod-rs-nostr (relay substrate) + crates/solid-pod-rs
  # (the [patch.crates-io] target). Pinned to the v0.5.0-alpha.9 tag
  # (2026-09-06), the same revision lib/solid-pod-rs.nix builds the standalone
  # server from, so the bridge and the server compile one upstream snapshot
  # (register G-20 closed). services/nostr-pod-bridge/Cargo.lock resolves
  # solid-pod-rs-nostr 0.5.0-alpha.9 to match. Bump both files together;
  # the hash is the SRI of the tag tarball (procedure above / lib/solid-pod-rs.nix).
  solidRev  = "1d9da527076e733d6a5571f474a573c16e5a6047";
  solidHash = "sha256-0/iDL8E9J5SGFnnJQwR3wP/qAjl9AHiKyKxU1U6qRfc="; # v0.5.0-alpha.9

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
    mkdir -p $out/project/agentbox/tests/fixtures
    cp ${../tests/fixtures/egress-redaction.v1.json} \
      $out/project/agentbox/tests/fixtures/egress-redaction.v1.json
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
  # (The forum rev now carries the nostr 0.44.8 error-variant mappings upstream,
  # so the old substituteInPlace shim is gone — re-adding it would only inject
  # duplicate, unreachable match arms.)
  postPatch = ''
    cp ${../services/nostr-pod-bridge/Cargo.lock} Cargo.lock
  '';

  nativeBuildInputs = [ pkgs.pkg-config ];
  nativeCheckInputs = [ pkgs.git ];
  buildInputs = [ pkgs.openssl ];

  # The cross-language redaction fixture is included in the source layout
  # above. Other filesystem and relay tests use temporary state/loopback.
  doCheck = true;

  meta = with lib; {
    description = "Embedded Nostr relay + Solid-pod ingress bridge for agentbox (NIP-44/26/59 via nostr-bbs-core, NIP-01/11/16 via solid-pod-rs-nostr)";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = licenses.agpl3Only;
    mainProgram = "nostr-pod-bridge";
    platforms   = platforms.linux;
  };
}
