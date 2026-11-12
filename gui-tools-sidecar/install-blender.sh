#!/usr/bin/env bash
# Install the shared upstream pin. Also usable for a live Blender-only upgrade.
set -euo pipefail
release_file="${1:-/opt/gui-tools/blender-release.json}"
mapfile -t release < <(python - "$release_file" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
for key in ("version", "url", "sha256"):
    print(r[key])
PY
)
[[ ${#release[@]} == 3 ]] || { echo "Invalid Blender release manifest" >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo "This Blender archive requires x86_64" >&2; exit 1; }
version="${release[0]}"
install_dir="/opt/blender-$version"
[[ ! -e "$install_dir" ]] || { echo "$install_dir already exists; refusing to overwrite" >&2; exit 1; }
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
if [[ -n "${2:-}" ]]; then
    cp -- "$2" "$scratch/blender.tar.xz"
else
    curl --fail --location --retry 3 "${release[1]}" -o "$scratch/blender.tar.xz"
fi
echo "${release[2]}  $scratch/blender.tar.xz" | sha256sum -c -
tar -xJf "$scratch/blender.tar.xz" -C "$scratch"
BLENDER_EXPECTED_VERSION="$version" "$scratch/blender-$version-linux-x64/blender" \
  --background --factory-startup --python-exit-code 1 --python-expr \
  'import os, bpy, OpenEXR, opentimelineio; assert bpy.app.version_string == os.environ["BLENDER_EXPECTED_VERSION"]; print("BLENDER_RELEASE_OK", bpy.app.version_string)'
mv "$scratch/blender-$version-linux-x64" "$install_dir"
ln -sfn "$install_dir/blender" /usr/local/bin/blender
