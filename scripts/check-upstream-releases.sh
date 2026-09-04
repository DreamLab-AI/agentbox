#!/usr/bin/env bash
# scripts/check-upstream-releases.sh
#
# Prints the current pinned versions of agentbox's upstream dependencies
# alongside the latest available version from their respective sources.
# A visual diff for humans — Renovate/Dependabot open the actual PRs.
#
# Requires: gh CLI authenticated, jq, curl.
# Exits 0 always; this is a report, not a gate.

set -euo pipefail

# Colours only when stdout is a TTY.
if [ -t 1 ]; then
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
else
  RED="" GREEN="" YELLOW="" BOLD="" RESET=""
fi

cd "$(dirname "$0")/.."

print_row() {
  local name="$1"; local pinned="$2"; local latest="$3"
  if [ "$pinned" = "$latest" ]; then
    printf "  %s%-32s%s %s %s\n" "$GREEN" "$name" "$RESET" "$pinned" "= latest"
  elif [ "$pinned" = "???" ]; then
    printf "  %s%-32s%s %s %sunknown pin; check source%s\n" "$YELLOW" "$name" "$RESET" "$pinned" "$YELLOW" "$RESET"
  else
    printf "  %s%-32s%s %s %s→ %s%s\n" "$RED" "$name" "$RESET" "$pinned" "$YELLOW" "$latest" "$RESET"
  fi
}

section() {
  printf "\n${BOLD}%s${RESET}\n" "$1"
}

latest_gh_release() {
  local repo="$1"; local tag_prefix="${2:-}"
  if [ -n "$tag_prefix" ]; then
    gh release list --repo "$repo" --limit 30 --json tagName --jq \
      ".[] | select(.tagName | startswith(\"$tag_prefix\")) | .tagName" 2>/dev/null \
      | head -1 | sed "s/^$tag_prefix//" || echo "???"
  else
    gh release view --repo "$repo" --json tagName --jq '.tagName' 2>/dev/null | sed 's/^v//' || echo "???"
  fi
}

latest_npm() {
  local pkg="$1"
  curl -fsSL "https://registry.npmjs.org/${pkg}/latest" 2>/dev/null | jq -r '.version' || echo "???"
}

latest_github_tag() {
  local repo="$1"
  gh api "repos/${repo}/tags" --jq '.[0].name' 2>/dev/null | sed 's/^v//' || echo "???"
}

# ──────────────────────────────────────────────────────────────────────────────
section "Codex Rust CLI (@openai/codex)"
pinned=$(grep -oE 'codexVersion\s*=\s*"[^"]+"' lib/codex-binary.nix | head -1 | sed 's/.*"\(.*\)"/\1/')
latest=$(latest_npm "@openai/codex")
print_row "openai/codex" "${pinned:-???}" "$latest"

section "Antigravity CLI (google-antigravity/antigravity-cli)"
pinned_agy=$(nix eval --raw nixpkgs#antigravity.version 2>/dev/null || echo "???")
latest=$(latest_gh_release "google-antigravity/antigravity-cli" "v")
print_row "antigravity" "${pinned_agy:-???}" "$latest"

section "Claude Code (@anthropic-ai/claude-code)"
latest=$(latest_npm "@anthropic-ai/claude-code")
pinned=$(grep -oE 'claudeCodeVersion\s*=\s*"[^"]+"' lib/claude-code-binary.nix | head -1 | sed 's/.*"\(.*\)"/\1/')
print_row "claude-code (runtime)" "${pinned:-???}" "$latest"
pinned_sidecar=$(grep -oE '@anthropic-ai/claude-code@[0-9.]+' claude-zai/Dockerfile 2>/dev/null | head -1 | sed 's/.*@//')
print_row "claude-code (zai sidecar)" "${pinned_sidecar:-???}" "$latest"

section "ComfyUI (comfyanonymous/ComfyUI)"
pinned=$(grep -oE 'comfyuiRev\s*=\s*"v?[0-9.]+"' flake.nix | head -1 | sed 's/.*"v\?\([0-9.]*\)"/\1/')
latest=$(latest_gh_release "comfyanonymous/ComfyUI")
print_row "comfyanonymous/ComfyUI" "${pinned:-???}" "$latest"

section "gitleaks (gitleaks/gitleaks)"
# secret-scan.yml installs the binary directly via GITLEAKS_VERSION="x.y.z"
# (the gitleaks-action wrapper is gone). Guarded: a format change here must
# degrade to "???", not kill the dashboard (set -euo pipefail).
pinned=$(grep -oE 'GITLEAKS_VERSION="[0-9.]+"' .github/workflows/secret-scan.yml 2>/dev/null | head -1 | grep -oE '[0-9.]+' || echo "???")
latest=$(latest_gh_release "gitleaks/gitleaks")
print_row "gitleaks/gitleaks" "${pinned:-???}" "$latest"

section "nostr-tools (npm)"
pinned=$(jq -r '.dependencies["nostr-tools"] // "???"' mcp/package.json 2>/dev/null | sed 's/^[\^~]//')
latest=$(latest_npm "nostr-tools")
print_row "nostr-tools" "${pinned:-???}" "$latest"

section "Nix inputs (flake.lock)"
if [ -f flake.lock ]; then
  echo "  To inspect or update: run"
  echo "      ${BOLD}nix flake metadata${RESET}            (show current revs)"
  echo "      ${BOLD}nix flake update${RESET}              (bump all inputs)"
  echo "  CI runs this automatically every Monday; see .github/workflows/nix-flake-update.yml"
else
  echo "  ${YELLOW}no flake.lock found — unexpected in this repo${RESET}"
fi

section "Skills corpus (inputs.skills — path:./skills)"
echo "  Currently path-input (local); see docs/guides/skills-upgrade.md"
echo "  Future: pinned github:DreamLab-AI/agentbox-skills input."

section "npm CLI packages (flake.nix makeNpmCli entries)"
for entry in \
  "ruvector|ruvector" \
  "@claude-flow/cli|@claude-flow/cli" \
  "ruflo|ruflo" \
  "agentic-qe|agentic-qe" \
  "codebase-memory-mcp|codebase-memory-mcp" \
  "agent-browser|agent-browser" \
  "playwright|playwright" \
  "@mermaid-js/mermaid-cli|@mermaid-js/mermaid-cli" \
; do
  pkg="${entry%|*}"
  npm_pkg="${entry#*|}"
  # Extract pinned version — look for version string near pkgName = "pkg"
  escaped_pkg=$(printf '%s\n' "$pkg" | sed 's/[.*+?^${}()|[\]\\]/\\&/g')
  pinned=$(grep -A3 "pkgName *= *\"${escaped_pkg}\"" flake.nix 2>/dev/null | grep -oE 'version *= *"[^"]+"' | head -1 | sed 's/.*"\(.*\)"/\1/' || echo "???")
  latest=$(latest_npm "$npm_pkg")
  print_row "$pkg" "${pinned:-???}" "$latest"
done
echo "  To bump: ./agentbox.sh update"

section "Docker sidecar images (agentbox.toml pins)"
# ruvector-postgres: pin is tag@digest in [integrations.ruvector_external].image;
# compare the digest part against what :latest resolves to on Docker Hub.
rv_pin=$(awk '/^\[integrations\.ruvector_external\]/{f=1;next} /^\[/{f=0}
              f && /^image[[:space:]]*=/{
                  sub(/^image[[:space:]]*=[[:space:]]*"/,""); sub(/".*$/,""); print; exit }' agentbox.toml 2>/dev/null || echo "???")
rv_pin_digest="${rv_pin##*@}"
[ "$rv_pin_digest" = "$rv_pin" ] && rv_pin_digest="floating:${rv_pin##*:}"
rv_hub=$(curl -fsSL "https://hub.docker.com/v2/repositories/ruvnet/ruvector-postgres/tags/latest" 2>/dev/null | jq -r '.digest // "???"')
rv_hub_tag=$(curl -fsSL "https://hub.docker.com/v2/repositories/ruvnet/ruvector-postgres/tags/?page_size=50" 2>/dev/null \
    | jq -r --arg d "$rv_hub" '[.results[] | select(.digest==$d and (.name|test("^[0-9]")))]
                               | sort_by(.last_updated) | last | .name // "?"')
print_row "ruvnet/ruvector-postgres" "${rv_pin_digest:0:19}" "${rv_hub:0:19} (${rv_hub_tag})"
echo "  To bump: ./agentbox.sh ruvector update   (gated: dump + snapshot + candidate rehearsal)"

printf "\n${BOLD}Legend${RESET}: ${GREEN}green${RESET} = pinned = latest; ${RED}red${RESET} = bump available; ${YELLOW}yellow${RESET} = unknown pin.\n"
printf "Renovate opens PRs for red rows on Mondays. This script is just a human-readable dashboard.\n\n"
