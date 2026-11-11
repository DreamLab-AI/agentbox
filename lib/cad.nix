# lib/cad.nix
#
# The CAD feature (ADR-2195): text-to-cad's `cad` command, pinned and offline.
#
# Upstream is 150k lines of Python that installs itself from PyPI, resolves its CAD
# kernel at first use, reports usage and updates itself. None of it is vendored or
# ported. This file bakes exactly what config/cad/wheels.lock.json names:
#
#   wheelhouse   every locked wheel as a fetchurl (sha256 from the lock, so the image
#                build verifies each one) in one folder, with the lock beside them.
#                Nothing is installed at build time: wheels are prebuilt manylinux
#                binaries, and the launcher makes the venv from this folder on first
#                use, offline, on the workspace volume.
#   launcher     `cad`: config/cad/cad-launcher.sh with the wheelhouse, a CPython 3.13
#                and the library path filled in. The script holds the policy
#                (telemetry and updates off, refused subcommands, offline, no index).
#   runtime      Xvfb, for the engine's own display. OCP's Linux wheels draw through
#                GLX alone, so a snapshot needs an X server with GLX; the engine
#                starts this Xvfb itself when it has no DISPLAY (the launcher unsets it).
#
# The wheels are foreign binaries: they look for libstdc++, libGL, libX11 and friends
# on the loader path, where a Nix image keeps nothing. libraryPath is the list measured
# in the running container on 2026-11-11 (OCP: libstdc++ libGL libX11 expat zlib;
# bpy adds libXrender libXfixes libXi libxkbcommon libSM libICE), plus Mesa for the
# software GLX the Xvfb offers.
#
# UNBUILT as of ADR-2195: written without a Nix evaluator. The launcher script and the
# lock were exercised end to end against a hand-made wheelhouse; this derivation, the
# Xvfb and the Mesa GLX path were not. tests/config/cad-launcher.test.sh has the live
# checks to run after the first build with the gate on.
#
# Licences: text-to-cad MIT; the wheels carry their own (OCP LGPL-2.1 with the OCCT
# exception, Blender's bpy GPL-3.0-or-later, KiCad GPL-3.0-or-later, CalculiX GPL-2.0-or-later).
# They are run as separate programs, never linked into agentbox code.

{ lib, pkgs }:

let
  lock = builtins.fromJSON (builtins.readFile ../config/cad/wheels.lock.json);

  wheel = w: {
    name = w.file;
    path = pkgs.fetchurl {
      name = lib.strings.sanitizeDerivationName w.file;
      inherit (w) url sha256;
    };
  };

  wheelhouse = pkgs.linkFarm "cad-wheelhouse-${lock.release}"
    (map wheel lock.wheels ++ [
      { name = "wheels.lock.json"; path = ../config/cad/wheels.lock.json; }
    ]);

  # nixpkgs renamed the X libraries to lower case; take whichever this pin has.
  x = new: old: pkgs.${new} or pkgs.xorg.${old};

  libraryPath = lib.makeLibraryPath [
    pkgs.stdenv.cc.cc.lib
    pkgs.libGL
    pkgs.mesa
    (x "libx11" "libX11")
    (x "libxext" "libXext")
    (x "libxrender" "libXrender")
    (x "libxfixes" "libXfixes")
    (x "libxi" "libXi")
    (x "libsm" "libSM")
    (x "libice" "libICE")
    pkgs.libxkbcommon
    pkgs.expat
    pkgs.zlib
    pkgs.fontconfig.lib
    pkgs.freetype
  ];

  xvfb = pkgs.xorg-server or pkgs.xorg.xorgserver;

  launcher = pkgs.writeShellScriptBin "cad" ''
    export AGENTBOX_CAD_WHEELHOUSE=${wheelhouse}
    export AGENTBOX_CAD_PYTHON=${pkgs.python313}/bin/python3.13
    export AGENTBOX_CAD_LIBPATH=${libraryPath}
    # Software GLX for the engine's Xvfb: Mesa's driver folder, and Mesa as the GLX
    # vendor so the client does not pick the host's NVIDIA GLX for a display that has none.
    export LIBGL_DRIVERS_PATH=${pkgs.mesa}/lib/dri
    export __GLX_VENDOR_LIBRARY_NAME=mesa
    export PATH=${xvfb}/bin:${pkgs.uv}/bin:${pkgs.coreutils}/bin:${pkgs.util-linux}/bin:$PATH
    exec ${pkgs.bash}/bin/bash ${../config/cad/cad-launcher.sh} "$@"
  '';

in
{
  inherit wheelhouse launcher xvfb libraryPath;
  inherit (lock) release;
}
