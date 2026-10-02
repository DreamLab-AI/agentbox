# lib/factrail.nix
#
# Nix derivation for factrail (DreamLab-AI/factrail): fact-keeping context
# compaction judged by Jev, in Rust. It replaces the vendored TypeScript plugin
# config/claude-plugins/jev-compaction (ADR-2121). Agentbox
# bakes it under [features.jev_compaction].
#
# One pinned commit supplies both halves, so they can never disagree on the
# hook protocol (factrail docs/protocol.md):
#   bin/factrail                 the binary every hook runs; linked at the stable
#                                path /opt/agentbox/bin/factrail, which is what the
#                                entrypoint projects as the plugin's `binary` option
#   share/factrail/plugin/       the Claude Code function-hook shim; baked into the
#                                `agentbox` directory marketplace as
#                                /opt/agentbox/config/claude-plugins/factrail
#
# Baked, not built in the workspace: a workspace `cargo build` links against the
# image's glibc store path, which the next rebuild collects (see
# lib/sidestr-agent.nix for how that broke the interim faucet).
#
# factrail is a self-contained [workspace] with every dependency on crates.io
# (no git sources), so the vendored lockfile needs no outputHashes. TLS is
# rustls on ring: no openssl, no pkg-config, no runtime CA bundle.
#
# To bump: move `rev` to a pushed factrail commit, refresh `hash` (the NAR
# sha256 of the commit tarball: nix-prefetch-url --unpack, then `nix hash
# convert --to sri`), and copy that commit's Cargo.lock to
# lib/lockfiles/factrail-<first 8 of rev>.Cargo.lock.
#
# Licence: MIT OR Apache-2.0; NOTICE credits the MIT sources it re-implements.

{ lib, pkgs }:

let
  version = "0.1.0";
  rev = "57ac25b59d4b5975bbed1f066eb6ec294b38116a";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo  = "factrail";
    inherit rev;
    hash  = "sha256-BnBsGMRJJWirmaJMCpJM08W2iXBuAwm9AggQDgLln5k=";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "factrail";
  inherit version src;

  # The commit's lockfile, vendored so evaluation never reads from the fetched
  # tree (no import-from-derivation). Byte-identical to Cargo.lock at `rev`.
  cargoLock.lockFile = ./lockfiles/factrail-${builtins.substring 0 8 rev}.Cargo.lock;

  # Build the binary; test the whole workspace (every crate's unit, integration
  # and doc tests, including the end-to-end hook protocol tests that drive the
  # built binary). The tests write only under temporary directories, but the
  # sandbox's HOME is unwritable, so give them one.
  cargoBuildFlags = [ "-p" "factrail" ];
  cargoTestFlags  = [ "--workspace" ];
  doCheck = true;
  preCheck = ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
  '';

  # The shim the marketplace serves: manifest, hooks and README, plus the
  # licence files the manifest's `license` refers to. Its tests, tsconfig and
  # npm files are development-only and stay in the repository.
  postInstall = ''
    plugin=$out/share/factrail/plugin
    mkdir -p $plugin
    cp -r plugin/.claude-plugin plugin/hooks plugin/README.md $plugin/
    cp LICENSE-MIT LICENSE-APACHE NOTICE $plugin/
  '';

  meta = with lib; {
    description = "Fact-keeping context compaction for coding agents: a Jev judge with fact rails";
    homepage    = "https://github.com/DreamLab-AI/factrail";
    license     = with licenses; [ mit asl20 ];
    mainProgram = "factrail";
    platforms   = platforms.linux;
  };
}
