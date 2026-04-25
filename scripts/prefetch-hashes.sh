#!/usr/bin/env bash
# scripts/prefetch-hashes.sh
#
# One-shot helper that resolves every lib.fakeHash site in the flake to
# its real value and patches the source files. Idempotent: safe to re-run
# after a package-lock.json, solid-pod-rs rev, or npm-cli version bump.
#
# Prereqs:
#   - nix 2.18+ with experimental-features = nix-command flakes
#   - NIXPKGS_ALLOW_INSECURE=1 exported (handled inline)
#   - network access to https://registry.npmjs.org/ and https://github.com/
#
# Hash classes resolved:
#   - npmDepsHash      — buildNpmPackage local services (lib/npm-services.nix)
#   - sha256           — npm CLI tarball (.tgz) FOD inside lib/npm-cli.nix
#   - nodeModulesHash  — npm CLI node_modules FOD inside lib/npm-cli.nix
#   - srcHash          — fetchFromGitHub for solid-pod-rs and nagual-qe
#   - cargoHash        — buildRustPackage vendor FOD for nagual-qe
#
# What it does:
#   1. Runs nix run nixpkgs#prefetch-npm-deps against every
#      buildNpmPackage-driven service's package-lock.json.
#   2. nix-prefetch-url --unpack against solid-pod-rs and nagual-qe's
#      pinned git rev for the fetchFromGitHub srcHash.
#   3. Iteratively runs `nix build .#runtime` and patches any FOD
#      hash-mismatch surfaced — covers npm CLI tarball + node_modules
#      hashes and the nagual-qe cargoHash. Loops until no more mismatches.
#
# Usage:
#   ./scripts/prefetch-hashes.sh              # resolve everything
#   ./scripts/prefetch-hashes.sh --dry-run    # print what would change
#   ./scripts/prefetch-hashes.sh --service <name>   # single target
#       supported: management-api, mcp, solid-pod-rs, nagual-qe,
#                  skills/openai-codex/mcp-server, skills/lazy-fetch/mcp-server,
#                  skills/playwright/mcp-server, skills/comfyui/mcp-server
#   ./scripts/prefetch-hashes.sh --cli        # only resolve npm-cli + cargoHash mismatches
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

dry_run=0
target=""
cli_only=0
ld_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)     dry_run=1; shift ;;
    --service)     target="$2"; shift 2 ;;
    --cli)         cli_only=1; shift ;;
    --linked-data) ld_only=1; shift ;;
    -h|--help)
      sed -n '1,40p' "$0" | sed 's/^# \{0,1\}//'
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
  "mcp/consultants"
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
  ["mcp/consultants"]="consultantsPkg"
  ["skills/openai-codex/mcp-server"]="codexMcpPkg"
  ["skills/lazy-fetch/mcp-server"]="lazyFetchMcpPkg"
  ["skills/playwright/mcp-server"]="playwrightMcpPkg"
  ["skills/comfyui/mcp-server"]="comfyuiMcpPkg"
)

declare -A svc_path_by_drvname=(
  ["management-api"]="management-api"
  ["nostr-bridge"]="mcp"
  ["agentbox-consultants"]="mcp/consultants"
  ["openai-codex-mcp"]="skills/openai-codex/mcp-server"
  ["lazy-fetch-mcp"]="skills/lazy-fetch/mcp-server"
  ["playwright-mcp"]="skills/playwright/mcp-server"
  ["comfyui-mcp"]="skills/comfyui/mcp-server"
)

patch_npm_deps_hash() {
  local service="$1" hash="$2"
  local attr="${svc_attr[$service]:-}"
  [ -z "$attr" ] && { echo "no attr mapping for $service"; return 1; }

  local date
  date=$(date -u +%Y-%m-%d)
  local marker="        ${attr} = npmServicesLib.makeNpmService"
  local file="${REPO_ROOT}/flake.nix"

  # Locate the line declaring the attr (e.g. `playwrightMcpPkg = npmServicesLib.makeNpmService`)
  # and rewrite the FIRST `npmDepsHash = …;` line that appears after it. This avoids the
  # nested-brace problem the original regex hit on blocks with inline `extraEnv = { … };`
  # attrsets — Python's `re` lacks recursive matching, so we use a line-window pass instead.
  python3 - "$file" "$attr" "$hash" "$date" "$service" <<'PY'
import re, sys, pathlib
file, attr, new_hash, today, service = sys.argv[1:6]
path = pathlib.Path(file)
lines = path.read_text().splitlines(keepends=True)

# Index of the line that opens the attr's makeNpmService call.
opener_re  = re.compile(r'^\s*' + re.escape(attr) + r'\s*=\s*npmServicesLib\.makeNpmService\s*\{?')
hash_re    = re.compile(r'^(\s*)npmDepsHash\s*=\s*(?:lib\.fakeHash|"[^"]*");')

start = next((i for i, l in enumerate(lines) if opener_re.match(l)), None)
if start is None:
    print(f"WARN: no opener for {attr}", file=sys.stderr); sys.exit(0)

# Find the next npmDepsHash line within the same block. Stop at the closing `};`
# of this attrset (depth tracking — count `{` and `}` on each line).
depth = 0
target = None
for i in range(start, len(lines)):
    depth += lines[i].count('{') - lines[i].count('}')
    if hash_re.match(lines[i]):
        target = i
        break
    if i > start and depth <= 0:
        break

if target is None:
    print(f"WARN: no npmDepsHash rewrite applied for {attr}", file=sys.stderr); sys.exit(0)

m = hash_re.match(lines[target])
indent = m.group(1)
lines[target] = f'{indent}npmDepsHash = "{new_hash}";\n'

# Replace any preceding `# Prefetched …` line (idempotency); otherwise insert one.
comment = f'{indent}# Prefetched {today}. Refresh: nix run nixpkgs#prefetch-npm-deps -- {service}/package-lock.json\n'
prev = target - 1
prefetched_re = re.compile(r'^\s*#\s*Prefetched\b')
if prev >= start and prefetched_re.match(lines[prev]):
    lines[prev] = comment
else:
    lines.insert(target, comment)

path.write_text(''.join(lines))
print(f"patched {attr} npmDepsHash → {new_hash}")
PY
}

patch_npm_deps_hash_by_drvname() {
  local drvname="$1" hash="$2"
  local service="${svc_path_by_drvname[$drvname]:-}"
  [ -z "$service" ] && {
    echo "WARN: no npm service mapping for derivation '$drvname'" >&2
    return 1
  }
  patch_npm_deps_hash "$service" "$hash"
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

prefetch_nagual_qe() {
  local file="${REPO_ROOT}/lib/nagual-qe.nix"
  local rev
  rev=$(grep -oE '^\s*rev\s*=\s*"[^"]+"' "$file" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
  [ -z "$rev" ] && { echo "could not parse rev from $file"; return 1; }

  echo "== prefetch nagual-qe@$rev =="
  local url="https://github.com/proffesor-for-testing/nagual-qe/archive/${rev}.tar.gz"
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
    print(f"patched nagual-qe srcHash → {new_hash}")
else:
    print("nagual-qe srcHash unchanged")
PY
  fi
  echo "  cargoHash stays lib.fakeHash until first build — resolve via --cli."
}

# Iterative loop: runs `nix build .#runtime`, parses the first FOD hash
# mismatch from the output, and patches it back into the appropriate
# source file. Repeats until no more mismatches surface.
#
# Handles three classes of FOD hash:
#   1. npm-cli node_modules FOD   (lib/npm-cli.nix passthru.packageWithDeps)
#   2. nagual-qe cargoHash        (buildRustPackage vendor FOD)
#   3. solid-pod-rs cargoHash     (only relevant if pods=local-solid-rs and
#                                  the lockfile bumps; solid-pod-rs.nix uses
#                                  cargoLock.lockFile so cargoHash is not
#                                  applicable there — handled via vendoring).
prefetch_via_build_loop() {
  local max_iters=20
  local iter=0
  echo "== iterative FOD-hash resolver (npm-cli + cargoHash) =="
  while [ "$iter" -lt "$max_iters" ]; do
    iter=$((iter + 1))
    echo "-- iteration $iter --"

    # Run the build; we expect failure on hash mismatch. Capture both
    # stdout and stderr, but cap the size so a successful build doesn't
    # blow up the buffer.
    local output
    set +e
    output=$(nix build "${REPO_ROOT}#runtime" --no-link 2>&1 | tail -300)
    local rc=$?
    set -e

    if [ "$rc" -eq 0 ]; then
      echo "  build succeeded — all hashes resolved."
      return 0
    fi

    if ! echo "$output" | grep -q "hash mismatch in fixed-output derivation"; then
      echo "  build failed but no hash mismatch found — surfacing tail of output:"
      echo "$output" | tail -30
      return 1
    fi

    # Extract first mismatch block.
    local block drv_path got_hash
    block=$(echo "$output" | grep -B1 -A4 "hash mismatch in fixed-output derivation" | head -10)
    drv_path=$(echo "$block" | grep -oE "/nix/store/[a-z0-9]+-[a-zA-Z0-9._+-]+\.drv" | head -1)
    got_hash=$(echo "$block" | grep -oE 'got:\s*sha256-[A-Za-z0-9+/=]+' | head -1 | awk '{print $NF}')

    if [ -z "$drv_path" ] || [ -z "$got_hash" ]; then
      echo "  could not parse hash mismatch block; tail of output:"
      echo "$output" | tail -30
      return 1
    fi

    local fod_name
    fod_name=$(basename "$drv_path" .drv)
    fod_name=$(echo "$fod_name" | sed -E 's/^[a-z0-9]{32}-//')
    echo "  FOD: $fod_name  →  $got_hash"

    if [ "$dry_run" -ne 0 ]; then
      echo "  (dry-run — would patch flake.nix or lib/nagual-qe.nix)"
      return 0
    fi

    # Dispatch: which file gets the patch?
    if [[ "$fod_name" =~ ^(.+)-with-deps-([0-9A-Za-z.+-]+)$ ]]; then
      local pname="${BASH_REMATCH[1]}"
      patch_npm_cli_node_modules_hash "$pname" "$got_hash"
    elif [[ "$fod_name" =~ ^(.+)-npm-deps$ ]]; then
      local drv_name="${BASH_REMATCH[1]}"
      patch_npm_deps_hash_by_drvname "$drv_name" "$got_hash"
    elif [[ "$fod_name" =~ ^(.+)-([0-9A-Za-z.+-]+)-vendor\.tar\.zst$ ]] \
      || [[ "$fod_name" =~ ^cargo-deps-(.+)-([0-9A-Za-z.+-]+)$ ]] \
      || [[ "$fod_name" =~ vendor ]]; then
      patch_cargo_hash "$got_hash"
    else
      # Treat any other FOD as the npm-cli tarball case (sha256, not nodeModulesHash).
      # This is rare since tarball sha256s ship hard-pinned, but covers fakeHash bumps.
      echo "  unknown FOD pattern; attempting tarball hash patch under flake.nix"
      patch_npm_cli_tarball_hash "$fod_name" "$got_hash" || true
    fi
  done
  echo "  hit max iterations ($max_iters) — manual intervention needed."
  return 1
}

patch_npm_cli_node_modules_hash() {
  local pname="$1" hash="$2"
  local file="${REPO_ROOT}/flake.nix"
  python3 - "$file" "$pname" "$hash" <<'PY'
import sys, pathlib, re
file, pname, new_hash = sys.argv[1:4]
src = pathlib.Path(file).read_text()
# Match the mkNpmCli block whose `pname` (derived from pkgName) matches.
# We can't compute pname purely from pkgName via regex, so we accept any
# pkgName whose npm-style basename equals pname (after @-strip + /-rewrite).
# Fast path: search for `bin = "<short>"` near a sha256 line.
# We leverage the fact that nodeModulesHash is the only fakeHash directly
# adjacent to a `bin = "<x>"` whose corresponding pname matches pname.
def npm_to_pname(pkgName: str) -> str:
    return pkgName.lstrip('@').replace('/', '-')

# Locate every mkNpmCli call block.
pattern = re.compile(
    r'(\bmkNpmCli\s*\{[^\}]*?pkgName\s*=\s*"([^"]+)"[^\}]*?)'
    r'(nodeModulesHash\s*=\s*(?:lib\.fakeHash|"[^"]*");)',
    re.DOTALL,
)
matched = []
def repl(m):
    pre, pkgname, hashline = m.group(1), m.group(2), m.group(3)
    if npm_to_pname(pkgname) == pname:
        matched.append(pkgname)
        return pre + f'nodeModulesHash = "{new_hash}";'
    return m.group(0)

new = pattern.sub(repl, src)
if new != src and matched:
    pathlib.Path(file).write_text(new)
    print(f"  patched nodeModulesHash for {matched[0]} → {new_hash}")
else:
    print(f"  no nodeModulesHash matched for pname={pname} (already resolved?)")
PY
}

patch_npm_cli_tarball_hash() {
  local fod_name="$1" hash="$2"
  echo "  (skip: tarball sha256 patch via fod_name='$fod_name' not yet implemented)"
  return 0
}

patch_cargo_hash() {
  local hash="$1"
  local file="${REPO_ROOT}/lib/nagual-qe.nix"
  if [ ! -f "$file" ]; then
    echo "  cargo-hash: no nagual-qe.nix — nothing to patch"
    return 0
  fi
  python3 - "$file" "$hash" <<'PY'
import sys, pathlib, re
file, new_hash = sys.argv[1:3]
src = pathlib.Path(file).read_text()
new = re.sub(r'cargoHash\s*=\s*(?:lib\.fakeHash|"[^"]*");',
             f'cargoHash = "{new_hash}";', src, count=1)
if new != src:
    pathlib.Path(file).write_text(new)
    print(f"  patched cargoHash → {new_hash}")
else:
    print(f"  cargoHash unchanged (already {new_hash}?)")
PY
}

# --- main ---

if [ "$cli_only" -eq 1 ]; then
  prefetch_via_build_loop
  exit $?
fi

# Linked-data context catalogue (PRD-006 / ADR-012 / lib/linked-data-contexts.nix).
# Each entry pins a remote @context document via lib.fakeHash on first install.
# We resolve every URL to its SRI hash by calling nix-prefetch-url and
# converting the base32 output, then patch the catalogue file in place.
prefetch_linked_data_contexts() {
  local file="${REPO_ROOT}/lib/linked-data-contexts.nix"
  if [ ! -f "$file" ]; then
    echo "linked-data: $file not found; skipping"
    return 0
  fi

  echo "== resolving JSON-LD context catalogue hashes =="
  python3 - "$file" "$dry_run" <<'PY'
import re, sys, subprocess, pathlib
file, dry = sys.argv[1], int(sys.argv[2])
path = pathlib.Path(file)
src  = path.read_text().splitlines(keepends=True)

entry_re = re.compile(r'^\s*url\s*=\s*"(?P<url>[^"]+)"\s*;')
hash_re  = re.compile(r'^(\s*)sha256\s*=\s*lib\.fakeHash\s*;')

i = 0
changes = 0
while i < len(src):
  m = entry_re.match(src[i])
  if m:
    url = m.group('url')
    # Find the next sha256 line within the next 3 lines.
    for j in range(i+1, min(i+5, len(src))):
      mh = hash_re.match(src[j])
      if mh:
        print(f"  prefetch {url}")
        try:
          out = subprocess.check_output(
            ["nix-prefetch-url", "--type", "sha256", url],
            stderr=subprocess.PIPE, text=True
          ).strip()
          sri = subprocess.check_output(
            ["nix", "hash", "to-sri", "--type", "sha256", out],
            stderr=subprocess.PIPE, text=True
          ).strip()
          if dry:
            print(f"    would patch sha256 = {sri};")
          else:
            indent = mh.group(1)
            src[j] = f"{indent}sha256 = \"{sri}\";\n"
            changes += 1
        except subprocess.CalledProcessError as e:
          print(f"    error fetching {url}: {e.stderr}")
        break
  i += 1

if changes and not dry:
  path.write_text("".join(src))
  print(f"linked-data: patched {changes} sha256 entries in {file}")
elif changes == 0:
  print("linked-data: no fakeHash entries to resolve")
PY
}

if [ "$ld_only" -eq 1 ]; then
  prefetch_linked_data_contexts
  exit $?
fi

prefetch_linkedobjects_browser() {
  local file="${REPO_ROOT}/lib/linkedobjects-browser.nix"
  if [ ! -f "$file" ]; then
    echo "linkedobjects-browser: $file not found; skipping"
    return 0
  fi
  echo "== resolving linkedobjects-browser srcHash =="
  local rev
  rev=$(grep -E '^\s*rev\s*=' "$file" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
  if [ -z "$rev" ]; then
    echo "  could not read rev from $file"
    return 1
  fi
  local sri
  sri=$(nix-prefetch-url --unpack "https://github.com/linkedobjects/browser/archive/${rev}.tar.gz" 2>/dev/null \
        | xargs -r nix hash to-sri --type sha256)
  if [ -z "$sri" ]; then
    echo "  fetch failed"
    return 1
  fi
  if [ "$dry_run" -eq 1 ]; then
    echo "  would patch srcHash = \"$sri\";"
    return 0
  fi
  python3 -c "
import re, sys, pathlib
p = pathlib.Path('$file')
s = p.read_text()
s = re.sub(r'srcHash\s*=\s*lib\.fakeHash\s*;', f'srcHash = \"$sri\";', s, count=1)
p.write_text(s)
print('  patched srcHash = $sri')
"
}

if [ -n "$target" ]; then
  case "$target" in
    solid-pod-rs)         prefetch_solid_pod_rs ;;
    nagual-qe)            prefetch_nagual_qe ;;
    linkedobjects-browser) prefetch_linkedobjects_browser ;;
    *)                    prefetch_npm_service "$target" ;;
  esac
  exit 0
fi

for svc in "${npm_services[@]}"; do
  prefetch_npm_service "$svc"
done
prefetch_solid_pod_rs
prefetch_nagual_qe
prefetch_linked_data_contexts
prefetch_linkedobjects_browser

# After the source-level hashes are resolved, run the iterative loop so the
# FOD-level hashes (npm CLI node_modules + nagual-qe cargoHash) are filled
# in by parsing the build's hash-mismatch errors.
echo
echo "== resolving FOD-level hashes via iterative build =="
prefetch_via_build_loop || {
  echo
  echo "Some FOD hashes could not be resolved automatically. Run the build"
  echo "manually and patch any remaining lib.fakeHash sites by hand:"
  echo "  nix build .#runtime --print-build-logs 2>&1 | grep -B1 -A2 'hash mismatch'"
  exit 1
}

echo
echo "Done. If you are ready to build, run:"
echo "  nix build .#runtime --print-build-logs"
