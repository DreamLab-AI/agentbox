#!/usr/bin/env bash
# Resolve the current stable Codex CLI release and its Linux musl hashes.
#
# This is the Codex phase of `./agentbox.sh update`. The checked-in result is
# still content-addressed for reproducible Nix builds; operators no longer edit
# the version or either architecture hash by hand.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CODEX_NIX="${REPO_ROOT}/lib/codex-binary.nix"

dry_run=0
requested_version=""

usage() {
  echo "Usage: $0 [--dry-run] [--version <x.y.z>]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --version)
      requested_version="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "error: jq is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "error: sha256sum is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "error: tar is required" >&2; exit 1; }

if [[ -n "$requested_version" ]]; then
  latest="$requested_version"
else
  latest=$(curl -fsSL --retry 3 --retry-delay 2 \
    "https://registry.npmjs.org/@openai%2fcodex/latest" | jq -er '.version')
fi

if [[ ! "$latest" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: unexpected Codex version '$latest'" >&2
  exit 1
fi

pinned=$(grep -oE 'codexVersion[[:space:]]*=[[:space:]]*"[^"]+"' "$CODEX_NIX" \
  | head -1 | sed 's/.*"\([^"]*\)"/\1/')

if [[ "$pinned" == "$latest" ]]; then
  echo "  Codex CLI                     ${pinned} = latest"
  exit 0
fi

echo "  Codex CLI                     ${pinned:-unknown} -> ${latest}"
if [[ "$dry_run" -eq 1 ]]; then
  echo "  [--dry-run] release assets were not downloaded; no files changed."
  exit 0
fi

release_url="https://github.com/openai/codex/releases/download/rust-v${latest}"
asset_tmp=$(mktemp -d)
patched=""
trap 'rm -rf -- "$asset_tmp"; [[ -z "$patched" ]] || rm -f -- "$patched"' EXIT

fetch_asset() {
  local triple="$1"
  local archive="${asset_tmp}/codex-${triple}.tar.gz"
  local binary="codex-${triple}"

  echo "  fetching ${binary}.tar.gz" >&2
  curl -fsSL --retry 3 --retry-delay 2 \
    -o "$archive" "${release_url}/${binary}.tar.gz"

  if ! tar -tzf "$archive" | grep -qx "$binary"; then
    echo "error: ${binary}.tar.gz does not contain the expected binary" >&2
    exit 1
  fi

  sha256sum "$archive" | awk '{print $1}'
}

x86_hash=$(fetch_asset "x86_64-unknown-linux-musl" | tail -1)
arm_hash=$(fetch_asset "aarch64-unknown-linux-musl" | tail -1)

patched=$(mktemp "${CODEX_NIX}.tmp.XXXXXX")
awk -v version="$latest" -v x86_hash="$x86_hash" -v arm_hash="$arm_hash" '
  BEGIN { arch = ""; versions = 0; x86 = 0; arm = 0 }
  /^# Release: https:\/\/github.com\/openai\/codex\/releases\/tag\/rust-v/ {
    $0 = "# Release: https://github.com/openai/codex/releases/tag/rust-v" version
  }
  /codexVersion[[:space:]]*=/ {
    sub(/"[^"]+"/, "\"" version "\"")
    versions++
  }
  /"x86_64-linux"[[:space:]]*=/ { arch = "x86" }
  /"aarch64-linux"[[:space:]]*=/ { arch = "arm" }
  arch == "x86" && /sha256[[:space:]]*=/ {
    sub(/"[^"]+"/, "\"" x86_hash "\"")
    x86++
    arch = ""
  }
  arch == "arm" && /sha256[[:space:]]*=/ {
    sub(/"[^"]+"/, "\"" arm_hash "\"")
    arm++
    arch = ""
  }
  { print }
  END {
    if (versions != 1 || x86 != 1 || arm != 1) {
      print "error: Codex Nix layout changed; refusing a partial patch" > "/dev/stderr"
      exit 1
    }
  }
' "$CODEX_NIX" > "$patched"
mv "$patched" "$CODEX_NIX"
patched=""

echo "  updated lib/codex-binary.nix"
echo "    x86_64-linux  ${x86_hash}"
echo "    aarch64-linux ${arm_hash}"
