#!/usr/bin/env bash
# npx-stale-scan.sh — find (and optionally prune) stale npx package caches.
#
# The npm `npx <pkg>` cache (~/.npm/_npx/<hash>/) is keyed by the literal
# spec; with --prefer-offline (or plain cache hits) it can serve a stale
# version FOREVER after the baked/global tool moved on. Upstream incident
# (pacphi/agentic-kit archive): a machine pinned to ruflo 3.32.x kept
# executing a cached 3.28.0 for months; six envs held ~6.4 GB.
#
# Agentbox context: ruflo/agentic-qe/claude-flow are Nix-baked and immutable,
# so a stale npx cache is the ONE way an old version can still execute inside
# the container. This scan compares every cached ruvnet-ecosystem package
# against the baked binary's version and flags older copies.
#
# Usage:
#   npx-stale-scan.sh           # report only
#   npx-stale-scan.sh --prune   # delete stale cache envs (confirmed stale only)
set -euo pipefail

NPX_CACHE="${NPX_CACHE:-$HOME/.npm/_npx}"
PRUNE=0
[[ "${1:-}" == "--prune" ]] && PRUNE=1

# package → baked-version command (extend as tools are added to the image)
declare -A BAKED=(
  [ruflo]="ruflo --version"
  [claude-flow]="claude-flow --version"
  [agentic-qe]="aqe --version"
)

baked_version() { # <cmd...> → semver or empty
  $1 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true
}

semver_lt() { # a < b ?
  [ "$1" = "$2" ] && return 1
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]
}

[ -d "$NPX_CACHE" ] || { echo "✓ no npx cache at $NPX_CACHE"; exit 0; }

total_size=$(du -sh "$NPX_CACHE" 2>/dev/null | cut -f1 || echo "?")
echo "npx cache: $NPX_CACHE (total $total_size)"

stale_found=0
for env_dir in "$NPX_CACHE"/*/; do
  [ -d "$env_dir" ] || continue
  for pkg in "${!BAKED[@]}"; do
    pj="$env_dir/node_modules/$pkg/package.json"
    [ -f "$pj" ] || continue
    cached_ver=$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$pj" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
    [ -n "$cached_ver" ] || continue
    baked_ver=$(baked_version "${BAKED[$pkg]}")
    [ -n "$baked_ver" ] || continue
    if semver_lt "$cached_ver" "$baked_ver"; then
      stale_found=1
      sz=$(du -sh "$env_dir" 2>/dev/null | cut -f1 || echo "?")
      echo "  STALE  $pkg $cached_ver (baked: $baked_ver)  $sz  $env_dir"
      if [ "$PRUNE" = "1" ]; then
        rm -rf "$env_dir"
        echo "         pruned."
        break   # env dir gone — stop checking other pkgs in it
      fi
    fi
  done
done

if [ "$stale_found" = "0" ]; then
  echo "✓ no stale ruvnet-ecosystem packages in the npx cache"
elif [ "$PRUNE" = "0" ]; then
  echo "Stale entries found — re-run with --prune to remove them."
fi
