# SystemScape — DreamLab's 3D telemetry ridges and agent-activity city.
#
# Pin source and Cargo dependencies so the monitor is part of the immutable
# Agentbox runtime rather than depending on a mutable workspace checkout.
{ lib, pkgs }:

pkgs.rustPlatform.buildRustPackage rec {
  pname = "systemscape";
  version = "0.4.0";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo = "systemscape";
    rev = "fbd780511de2c3d264d53b8cb097f983b8ec156c";
    hash = "sha256-hvAQpf+9SfBfSvHL70wmDyfD3YxTgvKxSVwwUCTapko=";
  };

  # Exact upstream lock, copied locally to avoid fetching source during evaluation.
  # Registry checksums in this lock supply the fixed-output dependency hashes.
  cargoLock.lockFile = ./systemscape-Cargo.lock;
  doCheck = true;

  meta = {
    description = "Interactive 3D telemetry and local agent work history for terminals";
    homepage = "https://github.com/DreamLab-AI/systemscape";
    license = lib.licenses.asl20;
    mainProgram = "systemscape";
    platforms = lib.platforms.linux;
  };
}
