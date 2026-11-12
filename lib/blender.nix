# Use the same upstream build as the GUI sidecar, including bundled Python modules.
# Other platforms retain nixpkgs' native package; the official Linux archive is x64.
{ pkgs }:
let
  release = builtins.fromJSON (builtins.readFile ./blender-release.json);
in
if pkgs.stdenv.hostPlatform.system != "x86_64-linux" then pkgs.blender else
pkgs.stdenvNoCC.mkDerivation {
  pname = "blender";
  inherit (release) version;
  src = pkgs.fetchurl {
    inherit (release) url sha256;
  };
  nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.makeWrapper ];
  buildInputs = with pkgs; [
    stdenv.cc.cc.lib zlib libGL libglvnd libx11 libxi libxxf86vm libxfixes
    libxrender libxext libxt libsm libice libxkbcommon wayland libdecor dbus
    libxcursor libxrandr libxinerama
    ncurses util-linux.lib
  ];
  # Supplied by the NVIDIA runtime on GPU hosts, absent on CPU-only builders.
  autoPatchelfIgnoreMissingDeps = [
    "libcuda.so.1" "libnvidia-ml.so.1"
    # Optional HIP/oneAPI plugins; this package's tested GPU backend is OptiX.
    "libamdhip64.so.7" "libze_loader.so.1"
  ];
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/blender" "$out/bin" "$out/share/applications"
    cp -a . "$out/lib/blender/"
    makeWrapper "$out/lib/blender/blender" "$out/bin/blender"
    cp blender.desktop "$out/share/applications/"
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    export HOME="$TMPDIR/blender-home"
    mkdir -p "$HOME"
    "$out/bin/blender" --background --factory-startup --python-exit-code 1 \
      --python-expr 'import bpy, OpenEXR, opentimelineio; assert bpy.app.version_string == "${release.version}"; print("BLENDER_RELEASE_OK", bpy.app.version_string)'
    runHook postInstallCheck
  '';
  meta = {
    description = "Blender 3D creation suite (official release, shared with GUI sidecar)";
    homepage = "https://www.blender.org/";
    license = pkgs.lib.licenses.gpl3Plus;
    platforms = [ "x86_64-linux" ];
    mainProgram = "blender";
  };
}
