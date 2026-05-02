#!/usr/bin/env bash
# scripts/bump-npm-cli-versions.sh
#
# Fetches latest npm versions for every makeNpmCli entry in flake.nix,
# patches the version string, and resets sha256 + nodeModulesHash to
# lib.fakeHash so that prefetch-hashes.sh --cli can resolve real hashes.
#
# Idempotent: safe to re-run; skips packages already at latest.
# Exits 0 always — reports what changed.
#
# Usage:
#   ./scripts/bump-npm-cli-versions.sh             # patch in-place
#   ./scripts/bump-npm-cli-versions.sh --dry-run   # report only, no patch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FLAKE="${REPO_ROOT}/flake.nix"

dry_run=0
[[ "${1:-}" == "--dry-run" ]] && dry_run=1

# Colours only when stdout is a TTY.
if [ -t 1 ]; then
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  RED="" GREEN="" YELLOW="" RESET=""
fi

latest_npm() {
  curl -fsSL "https://registry.npmjs.org/${1}/latest" 2>/dev/null | jq -r '.version' || echo "???"
}

bumped=0

bump_pkg() {
  local npm_pkg="$1"   # npm package name (may be scoped)
  local label="$2"     # human label for reporting

  latest=$(latest_npm "$npm_pkg")
  if [[ "$latest" == "???" ]]; then
    printf "  %s%-32s%s SKIP (registry unreachable)\n" "$YELLOW" "$label" "$RESET"
    return
  fi

  # Find pinned version near `pkgName = "npm_pkg"` in flake.nix
  escaped=$(printf '%s\n' "$npm_pkg" | sed 's/[.*+?^${}()|[\]\\]/\\&/g')
  pinned=$(grep -A3 "pkgName *= *\"${escaped}\"" "$FLAKE" 2>/dev/null \
    | grep -oE 'version *= *"[^"]+"' | head -1 | sed 's/.*"\(.*\)"/\1/' || echo "???")

  if [[ "$pinned" == "$latest" ]]; then
    printf "  %s%-32s%s %s = latest\n" "$GREEN" "$label" "$RESET" "$pinned"
    return
  fi

  printf "  %s%-32s%s %s → %s%s\n" "$RED" "$label" "$RESET" "${pinned:-???}" "$latest" "$RESET"

  if [[ "$dry_run" -eq 1 ]]; then
    return
  fi

  # 1. Bump version string: version = "<old>" → version = "<new>"
  #    Scope: lines within the pkgName block. Use awk to only replace inside
  #    the correct block (first occurrence of version after the pkgName line).
  awk -v pkg="$npm_pkg" -v new_ver="$latest" '
    /pkgName[[:space:]]*=[[:space:]]*"/ {
      if (index($0, "\"" pkg "\"")) in_block=1
    }
    in_block && /version[[:space:]]*=[[:space:]]*"[^"]*"/ {
      sub(/"[0-9][^"]*"/, "\"" new_ver "\"")
      in_block=0
    }
    { print }
  ' "$FLAKE" > "${FLAKE}.tmp" && mv "${FLAKE}.tmp" "$FLAKE"

  # 2. Reset sha256 and nodeModulesHash to lib.fakeHash in the same block.
  awk -v pkg="$npm_pkg" '
    /pkgName[[:space:]]*=[[:space:]]*"/ {
      if (index($0, "\"" pkg "\"")) in_block=1; resets=0
    }
    in_block && /sha256[[:space:]]*=/ && !/nodeModulesHash/ && resets<1 {
      sub(/sha256[[:space:]]*=[[:space:]]*"[^"]*"/, "sha256          = lib.fakeHash")
      resets++
    }
    in_block && /nodeModulesHash[[:space:]]*=/ && resets<2 {
      sub(/nodeModulesHash[[:space:]]*=[[:space:]]*"[^"]*"/, "nodeModulesHash = lib.fakeHash")
      resets++
    }
    in_block && resets>=2 { in_block=0 }
    { print }
  ' "$FLAKE" > "${FLAKE}.tmp" && mv "${FLAKE}.tmp" "$FLAKE"

  bumped=$(( bumped + 1 ))
}

echo ""
echo "Checking npm CLI versions..."
echo ""

bump_pkg "ruvector"                  "ruvector"
bump_pkg "@claude-flow/cli"          "@claude-flow/cli"
bump_pkg "ruflo"                     "ruflo"
bump_pkg "agentic-qe"                "agentic-qe"
bump_pkg "codebase-memory-mcp"       "codebase-memory-mcp"
bump_pkg "agent-browser"             "agent-browser"
bump_pkg "playwright"                "playwright"
bump_pkg "@mermaid-js/mermaid-cli"   "@mermaid-js/mermaid-cli"
bump_pkg "@google/gemini-cli"        "@google/gemini-cli"

echo ""
if [[ "$dry_run" -eq 1 ]]; then
  echo "${YELLOW}[--dry-run] no changes written.${RESET}"
elif [[ "$bumped" -eq 0 ]]; then
  echo "${GREEN}All npm CLI packages are already at latest.${RESET}"
else
  echo "${GREEN}Bumped ${bumped} package(s). Run prefetch-hashes.sh --cli to resolve new hashes.${RESET}"
fi
echo ""
