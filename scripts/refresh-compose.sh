#!/usr/bin/env bash
# Refresh the generated mount/service contract before a local image build.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
compose_output="$(nix build .#compose --no-link --print-out-paths)"
if [[ ! -f "$compose_output/docker-compose.yml" ]]; then
  echo "ERROR: compose build did not produce one docker-compose.yml" >&2
  exit 1
fi

# Validate without printing the resolved environment. Do not replace a working
# configuration if generation or validation fails. Paths resolve in repo_root.
docker compose --project-directory "$repo_root" \
  -f "$compose_output/docker-compose.yml" config --quiet

compose_tmp="$(mktemp "$repo_root/.compose-refresh.XXXXXX")"
trap 'rm -f "$compose_tmp"' EXIT
install -m644 "$compose_output/docker-compose.yml" "$compose_tmp"
mv "$compose_tmp" "$repo_root/docker-compose.yml"
echo "Refreshed docker-compose.yml from the current Nix manifest."
