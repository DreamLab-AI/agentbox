# Host build tooling only. This project-specific assessor is not in the image.
{ lib, pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "agentbox-vex";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ../services/agentbox-vex;
    filter = path: _type: baseNameOf (toString path) != "target";
  };
  cargoLock.lockFile = ../services/agentbox-vex/Cargo.lock;
  doCheck = true;
  meta = {
    description = "Agentbox image-scoped OpenVEX assessor and evidence verifier";
    license = with lib.licenses; [ mit asl20 ];
    mainProgram = "agentbox-vex";
    platforms = lib.platforms.linux;
  };
}
