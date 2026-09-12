# SystemScape — DreamLab's 3D telemetry and agent-activity flying tour.
#
# Pin source and Cargo dependencies so the monitor is part of the immutable
# Agentbox runtime rather than depending on a mutable workspace checkout.
{ lib, pkgs }:

pkgs.rustPlatform.buildRustPackage rec {
  pname = "systemscape";
  version = "0.2.0";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo = "systemscape";
    rev = "975608a892a9cf8dbfce03c522b63fe5e1b9511a";
    hash = "sha256-nsJVxBUuFYSdWMQolftPpHQrKa0VhpFgmGcqNvKNj80=";
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
