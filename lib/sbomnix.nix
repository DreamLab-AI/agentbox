# Compatibility fixes for the pinned host-only SBOM toolchain.
{ pkgs }:
let
  inherit (pkgs) lib;
  python3 = import ./sbomnix-python.nix { inherit pkgs; };
in
(pkgs.sbomnix.override { inherit python3; }).overridePythonAttrs (old: {
  # sbomnix 1.9.0 supplies one shell fragment in an argument array. The
  # structured-attrs wrapper hook requires four separate arguments instead.
  # Fail on a changed upstream shape so future pins get reviewed explicitly.
  makeWrapperArgs =
    let
      prefix = "--prefix PATH : ";
      args = old.makeWrapperArgs;
    in
    assert builtins.length args == 1 && lib.hasPrefix prefix (builtins.head args);
    [ "--prefix" "PATH" ":" (lib.removePrefix prefix (builtins.head args)) ];
})
