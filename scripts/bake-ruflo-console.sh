#!/usr/bin/env bash
# bake-ruflo-console.sh SRC OUT MARKETPLACE_JSON
#
# Build step for [toolchains].ruflo_console (flake.nix rufloConsolePlugins).
# SRC is the pinned ruflo checkout (the `rufloConsole` flake input). OUT
# receives exactly three directories, ruflo-console, ruflo-mods and ruflo-swarm,
# which the image copies into the `agentbox` directory marketplace
# (/opt/agentbox/config/claude-plugins) beside factrail.
#
# - Only those three plugin directories are copied. The ruflo repository is
#   about 100 MB and holds 40-odd other plugins, so nothing else from SRC lands.
# - node_modules is never copied: the plugins are TypeScript function-hook
#   modules that Claude Code loads directly and that import only `claude-code`
#   types.
# - userConfig.cli defaults to "ruflo" in ruflo-console and ruflo-swarm.
#   Upstream's default, npx-offline, runs `npx --offline -y @claude-flow/cli@latest`,
#   which fails ENOTCACHED in a container whose npm cache has never fetched the
#   package. The image ships the cli as the Nix-baked `ruflo` bin on PATH instead.
# - Every plugin's version must equal the version marketplace.json lists for it,
#   so a bumped pin with a stale catalogue fails the build rather than
#   registering under the wrong version.
set -euo pipefail

src="${1:?usage: bake-ruflo-console.sh SRC OUT MARKETPLACE_JSON}"
out="${2:?usage: bake-ruflo-console.sh SRC OUT MARKETPLACE_JSON}"
market="${3:?usage: bake-ruflo-console.sh SRC OUT MARKETPLACE_JSON}"

plugins=(ruflo-console ruflo-mods ruflo-swarm)
cli_default="ruflo"

mkdir -p "$out"
for name in "${plugins[@]}"; do
  from="$src/plugins/$name"
  manifest="$from/.claude-plugin/plugin.json"
  [ -f "$manifest" ] || { echo "bake-ruflo-console: $manifest missing at the pinned rev" >&2; exit 1; }
  [ -f "$from/hooks/hooks.json" ] || { echo "bake-ruflo-console: $name has no hooks/hooks.json" >&2; exit 1; }

  # cp -r then prune keeps the plugin's own layout, symlinks included.
  cp -r "$from" "$out/$name"
  chmod -R u+w "$out/$name"
  find "$out/$name" -name node_modules -prune -exec rm -rf {} +

  baked="$out/$name/.claude-plugin/plugin.json"
  if jq -e '.userConfig.cli' "$baked" >/dev/null; then
    jq --arg d "$cli_default" '.userConfig.cli.default = $d' "$baked" > "$baked.tmp"
    mv "$baked.tmp" "$baked"
  fi

  have="$(jq -r .version "$baked")"
  want="$(jq -r --arg n "$name" '.plugins[] | select(.name == $n) | .version' "$market")"
  if [ "$have" != "$want" ]; then
    echo "bake-ruflo-console: $name is $have at the pinned rev but marketplace.json lists '${want}'" >&2
    exit 1
  fi
done

# Nothing but the three plugin directories at the top level.
extra="$(find "$out" -mindepth 1 -maxdepth 1 | sed "s#^$out/##" | grep -vxE 'ruflo-console|ruflo-mods|ruflo-swarm' || true)"
if [ -n "$extra" ]; then
  echo "bake-ruflo-console: unexpected entries in $out: $extra" >&2
  exit 1
fi
