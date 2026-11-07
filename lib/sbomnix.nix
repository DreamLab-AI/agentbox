# Compatibility fixes for the pinned host-only SBOM toolchain.
{ pkgs }:
let
  inherit (pkgs) lib;
  python3 = import ./sbomnix-python.nix { inherit pkgs; };
in
(pkgs.sbomnix.override { inherit python3; }).overridePythonAttrs (old: {
  # The structured-attrs wrapper hook requires `--prefix PATH :` as four
  # separate arguments. sbomnix 1.9.0 in nixpkgs ships two shapes:
  #   - older pins: one shell fragment, "--prefix PATH : <bin path>", which is
  #     split here;
  #   - nixpkgs from 6b01148e2e97 (2026-10-27, "treewide: fix python
  #     makeWrapperArgs with __structuredAttrs"): already the four separate
  #     arguments, passed through unchanged.
  # Drop the first branch once flake.lock is past the upstream change.
  # Fail on a changed upstream shape so future pins get reviewed explicitly.
  makeWrapperArgs =
    let
      prefix = "--prefix PATH : ";
      args = old.makeWrapperArgs;
      isFragment = builtins.length args == 1 && lib.hasPrefix prefix (builtins.head args);
      isSplit = builtins.length args == 4
        && lib.take 3 args == [ "--prefix" "PATH" ":" ]
        && builtins.isString (builtins.elemAt args 3);
    in
    assert isFragment || isSplit;
    if isFragment
    then [ "--prefix" "PATH" ":" (lib.removePrefix prefix (builtins.head args)) ]
    else args;
})
