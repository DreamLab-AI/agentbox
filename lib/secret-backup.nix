# Operator-invoked encrypted custody tool; packaging does not rotate keys.
{ lib, pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "agentbox-secret-backup";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ../services/secret-backup;
    filter = path: _type: baseNameOf (toString path) != "target";
  };
  cargoLock.lockFile = ../services/secret-backup/Cargo.lock;
  doCheck = true;
  meta = with lib; {
    description = "Age-encrypted Agentbox secret backup and restore";
    license = licenses.agpl3Only;
    mainProgram = "agentbox-secret-backup";
    platforms = platforms.linux;
  };
}
