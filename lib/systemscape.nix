# SystemScape — DreamLab's ANSI 3D telemetry history renderer.
#
# Pin source and Cargo dependencies so the monitor is part of the immutable
# Agentbox runtime rather than depending on a mutable workspace checkout.
{ lib, pkgs }:

pkgs.rustPlatform.buildRustPackage rec {
  pname = "systemscape";
  version = "0.1.0-2026-08-01";

  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo = "thermal3d";
    rev = "780847146edf7a0becd8275114031afb4f58828b";
    hash = "sha256-HcSmGMDL17EimpnKqeaYet69Qx17g8S4PxUkIAupX7Y=";
  };

  cargoHash = "sha256-12O6r2Gdxz+7holc2nuw9ZJQ00XIL2UM6VySy39Z3Wc=";
  doCheck = true;

  meta = {
    description = "Scrolling 3D telemetry history for true-colour terminals";
    homepage = "https://github.com/DreamLab-AI/thermal3d";
    license = lib.licenses.asl20;
    mainProgram = "systemscape";
    platforms = lib.platforms.linux;
  };
}
