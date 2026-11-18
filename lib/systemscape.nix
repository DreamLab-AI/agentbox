# SystemScape — DreamLab's 3D telemetry ridges and agent-activity city.
#
# Pin source and Cargo dependencies so the monitor is part of the immutable
# Agentbox runtime rather than depending on a mutable workspace checkout.
{ lib, pkgs }:

pkgs.rustPlatform.buildRustPackage rec {
  pname = "systemscape";
  version = "0.5.0";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo = "systemscape";
    rev = "7faffcd29a13f5d0d217434a6e7fafe8407492a1";
    hash = "sha256-t+7REjvDMzmAzQhJJB6VxDn/ni0BRHR0e2Ti7V8bA/Q=";
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
