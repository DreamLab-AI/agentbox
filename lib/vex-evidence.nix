# Enumerate the actual nix2container payload, rather than its builder closure.
# The SBOM root must be separate from the evidence directory: image.json also
# refers to layer metadata/build tools, which are not shipped in the container.
{ pkgs, image, metadata }:
let
  payload = pkgs.runCommand "agentbox-security-payload-${metadata.variant}" {
    nativeBuildInputs = [ pkgs.jq ];
  } ''
    mkdir -p "$out"
    jq -er '[.layers[].paths[].path] | unique | .[]' ${image} > paths.txt
    while IFS= read -r path; do
      case "$path" in /nix/store/*) ;; *) echo "Invalid image payload path" >&2; exit 1 ;; esac
      test -e "$path"
      ln -s "$path" "$out/$(basename "$path")"
    done < paths.txt
  '';
  metadataFile = pkgs.writeText "agentbox-security-metadata.json" (builtins.toJSON
    (metadata // { schema_version = 1; payload_path = toString payload; }));
in
pkgs.runCommand "agentbox-security-evidence-${metadata.variant}" { } ''
  mkdir -p "$out"
  ln -s ${payload} "$out/payload"
  cp ${image} "$out/image.json"
  cp ${metadataFile} "$out/metadata.json"
''
