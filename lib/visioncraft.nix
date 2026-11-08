# One immutable release supplies the CLI, Cargo.lock and portable skill payload.
# config/visioncraft-source.json is generated only from a validated upstream
# release. The image build compares its skill bytes with that same fetched tree.
{ lib, pkgs }:
let
  pin = builtins.fromJSON (builtins.readFile ../config/visioncraft-source.json);
in pkgs.rustPlatform.buildRustPackage {
  pname = "visioncraft";
  inherit (pin) version;
  src = pkgs.fetchFromGitHub {
    owner = "DreamLab-AI";
    repo = "visioncraft";
    rev = pin.revision;
    hash = pin.source_hash;
  };
  cargoLock.lockFile = ./lockfiles + "/visioncraft-${pin.version}.Cargo.lock";
  passthru.sourceLockFile = ./lockfiles + "/visioncraft-${pin.version}.Cargo.lock";
  cargoBuildFlags = [ "-p" "visioncraft" ];
  cargoTestFlags = [ "-p" "visioncraft" ];
  # The release gates execute upstream's complete offline suite.
  doCheck = false;
  meta = with lib; {
    description = "Portable quality plans, evidence validation and bounded security review";
    homepage = "https://github.com/DreamLab-AI/visioncraft";
    license = with licenses; [ mit asl20 ];
    mainProgram = "visioncraft";
    platforms = platforms.linux;
  };
}
