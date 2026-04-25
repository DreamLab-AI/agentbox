#!/usr/bin/env bash
# scripts/prefetch-hashes.sh
#
# One-shot helper that resolves every lib.fakeHash site in the flake to
# its real value and patches the source files. Idempotent: safe to re-run
# after a package-lock.json or solid-pod-rs rev bump.
#
# Prereqs:
#   - nix 2.18+ with experimental-features = nix-command flakes
#   - NIXPKGS_ALLOW_INSECURE=1 exported (handled inline)
#   - network access to https://registry.npmjs.org/ and https://github.com/
#
# What it does:
#   1. Runs nix run nixpkgs#prefetch-npm-deps against every
#      buildNpmPackage-driven service's package-lock.json.
#   2. nix-prefetch-url --unpack against solid-pod-rs's pinned git rev for
#      the fetchFromGitHub srcHash (ADR-010).
#   3. nix run nixpkgs#prefetch-npm-deps equivalents for any npm-cli
#      sha256 values in flake.nix that are still lib.fakeHash.
#   4. Writes every resolved hash into the canonical source site via sed,
#      preserving surrounding comments.
#
# Usage:
#   ./scripts/prefetch-hashes.sh              # resolve + patch
#   ./scripts/prefetch-hashes.sh --dry-run    # print what would change
#   ./scripts/prefetch-hashes.sh --service management-api   # single target
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

dry_run=0
target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)   dry_run=1; shift ;;
    --service)   target="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

command -v nix >/dev/null 2>&1 || {
  echo "error: nix not found in PATH. Install via https://nixos.org/download"
  exit 1
}

export NIXPKGS_ALLOW_INSECURE=1

# Services managed by lib/npm-services.nix — the npmDepsHash values live in
# flake.nix, marker pattern is `name = "<service>";` nearby.
npm_services=(
  "management-api"
  "mcp"
  "skills/openai-codex/mcp-server"
  "skills/lazy-fetch/mcp-server"
  "skills/playwright/mcp-server"
  "skills/comfyui/mcp-server"
)

# Derivation-name → flake.nix attribute name mapping. Used to patch the
# correct `npmDepsHash = "..."` site.
declare -A svc_attr=(
  ["management-api"]="managementApiPkg"
  ["mcp"]="nostrBridgePkg"
  ["skills/openai-codex/mcp-server"]="codexMcpPkg"
  ["skills/lazy-fetch/mcp-server"]="lazyFetchMcpPkg"
  ["skills/playwright/mcp-server"]="playwrightMcpPkg"
  ["skills/comfyui/mcp-server"]="comfyuiMcpPkg"
)

patch_npm_deps_hash() {
  local service="$1" hash="$2"
  local attr="${svc_attr[$service]:-}"
  [ -z "$attr" ] && { echo "no attr mapping for $service"; return 1; }

  local date
  date=$(date -u +%Y-%m-%d)
  local marker="        ${attr} = npmServicesLib.makeNpmService"
  local file="${REPO_ROOT}/flake.nix"

  # Find the npmDepsHash line within the attr block and rewrite. Idempotent
  # because we rewrite the hash value and the prefetch date comment.
  python3 - "$file" "$attr" "$hash" "$date" <<'PY'
import re, sys, pathlib
file, attr, new_hash, today = sys.argv[1:5]
src = pathlib.Path(file).read_text()
# Locate the attr block start and the next npmDepsHash within it.
pattern = re.compile(
    r'(?P<pre>\s+' + re.escape(attr) + r'\s*=\s*npmServicesLib\.makeNpmService\s*\{[^\}]*?)'
    r'(?P<hashline>(?:# [^\n]*\n\s+)*npmDepsHash\s*=\s*(?:lib\.fakeHash|"[^"]*");)',
    re.DOTALL,
)
def repl(m):
    new_line = f'# Prefetched {today}. Refresh: nix run nixpkgs#prefetch-npm-deps -- <service>/package-lock.json\n          npmDepsHash = "{new_hash}";'
    return m.group('pre') + new_line
new = pattern.sub(repl, src, count=1)
if new == src:
    print(f"WARN: no npmDepsHash rewrite applied for {attr}", file=sys.stderr)
else:
    pathlib.Path(file).write_text(new)
    print(f"patched {attr} npmDepsHash → {new_hash}")
PY
}

prefetch_npm_service() {
  local service="$1"
  local lock="${REPO_ROOT}/${service}/package-lock.json"
  [ -f "$lock" ] || { echo "skip $service (no package-lock.json)"; return 0; }

  echo "== prefetch $service =="
  local hash
  hash=$(nix run nixpkgs#prefetch-npm-deps -- "$lock" 2>/dev/null | tail -1)
  if [[ "$hash" =~ ^sha256- ]]; then
    echo "  hash: $hash"
    if [ "$dry_run" -eq 0 ]; then
      patch_npm_deps_hash "$service" "$hash"
    fi
  else
    echo "ERROR: prefetch returned '$hash'"
    return 1
  fi
}

prefetch_solid_pod_rs() {
  local file="${REPO_ROOT}/lib/solid-pod-rs.nix"
  local rev
  rev=$(grep -oE '^\s*rev\s*=\s*"[^"]+"' "$file" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
  [ -z "$rev" ] && { echo "could not parse rev from $file"; return 1; }

  echo "== prefetch solid-pod-rs@$rev =="
  local url="https://github.com/DreamLab-AI/solid-pod-rs/archive/${rev}.tar.gz"
  local base32
  base32=$(nix-prefetch-url --unpack --type sha256 "$url" 2>/dev/null | tail -1)
  local sri
  sri=$(nix hash convert --hash-algo sha256 --to sri "$base32" 2>&1 | tail -1)
  echo "  hash: $sri"

  if [ "$dry_run" -eq 0 ]; then
    python3 - "$file" "$sri" <<'PY'
import sys, pathlib, re
file, new_hash = sys.argv[1:3]
src = pathlib.Path(file).read_text()
new = re.sub(r'srcHash\s*=\s*(?:lib\.fakeHash|"[^"]*");',
             f'srcHash = "{new_hash}";', src, count=1)
if new != src:
    pathlib.Path(file).write_text(new)
    print(f"patched srcHash → {new_hash}")
else:
    print("srcHash unchanged")
PY
  fi
}

# --- main ---

if [ -n "$target" ]; then
  case "$target" in
    solid-pod-rs) prefetch_solid_pod_rs ;;
    *) prefetch_npm_service "$target" ;;
  esac
  exit 0
fi

for svc in "${npm_services[@]}"; do
  prefetch_npm_service "$svc"
done
prefetch_solid_pod_rs

echo
echo "Done. If you are ready to build, run:"
echo "  nix build .#runtime --print-build-logs"
echo
echo "The solid-pod-rs cargoHash stays lib.fakeHash until you flip"
echo "adapters.pods = \"local-solid-rs\" in agentbox.toml and run the build"
echo "once — nix will print the expected cargoHash in its mismatch message."
