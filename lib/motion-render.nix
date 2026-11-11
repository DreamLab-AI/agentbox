# lib/motion-render.nix
#
# Nix derivation for `motion-render` — the frame-exact renderer of the
# `motion-designer` skill (ADR-2194). It replaces the skill's Node script
# scripts/render.mjs, which stays in the skill only until the image that carries
# this binary is live.
#
#   motion-render   freeze an HTML page at exact times in the browser sidecar over
#                   raw CDP and write frames, stills, a determinism verdict or a
#                   probe chart; encodes with the image's ffmpeg
#
# Its own crate, not a binary of skill-tools: that derivation runs its tests in
# the build, so a failure here would take the unrelated skill tools down with it.
#
# Synchronous by design: tungstenite over a plain TcpStream (the sidecar's CDP
# port is ws://), a std TcpListener file server, no tokio, no TLS, so there is
# NO openssl/pkg-config buildInput. All deps are on crates.io.
#
# Licence: MIT OR Apache-2.0.

{ lib, pkgs }:

let
  version = "0.1.0";

  motionRenderSrc = lib.cleanSourceWith {
    src    = ../services/motion-render;
    filter = path: _type: baseNameOf (toString path) != "target";
  };

in
pkgs.rustPlatform.buildRustPackage {
  pname = "motion-render";
  inherit version;
  src = motionRenderSrc;

  cargoLock.lockFile = ../services/motion-render/Cargo.lock;

  # Hermetic tests: frame arithmetic, PNG diff thresholds, lock recovery in a
  # temp dir, and the file server and a stand-in /json/version endpoint on
  # 127.0.0.1 only. Nothing reaches a browser or the network.
  doCheck = true;

  meta = with lib; {
    description = "Frame-exact HTML motion film renderer for the agentbox motion-designer skill, driving the browser sidecar over CDP";
    homepage    = "https://github.com/DreamLab-AI/agentbox";
    license     = with licenses; [ mit asl20 ];
    platforms   = platforms.linux;
    mainProgram = "motion-render";
  };
}
