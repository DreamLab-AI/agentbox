# SystemScape — DreamLab's 3D telemetry ridges and agent-activity city.
#
# Pin source and Cargo dependencies so the monitor is part of the immutable
# Agentbox runtime rather than depending on a mutable workspace checkout.
{ lib, pkgs }:

pkgs.rustPlatform.buildRustPackage rec {
  pname = "systemscape";
  version = "0.3.0";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo = "systemscape";
    rev = "a123d8b0f09c681576c6e556b182537e9ea577ed";
    hash = "sha256-Dr1qiXF3ntAm/MI0RDptUiKZzGZ4pH392VmSyDIa3Bk=";
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
