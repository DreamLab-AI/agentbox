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
# - ruflo-mods gains a `routeTasks` userConfig option, default false (ADR-2134).
#   Upstream's prompt.submit keyword router injects "Routing task: coder 60%"
#   on every prompt, task notifications included, recommending ruflo agent types
#   this estate does not register (ADR-2092); nothing consumes it. Skill choice
#   is the System One router's job (ADR-2091) and model choice is Claude
#   Code's (advisor, per-call subagent model). The patch matches literal
#   anchors and fails the build when a bumped pin moves them.
set -euo pipefail

# patch_literal FILE OLD NEW — replace one literal occurrence or fail the bake.
patch_literal() {
  local file="$1" old="$2" new="$3" text
  text="$(cat "$file"; printf x)"
  text="${text%x}"
  if [[ "$text" != *"$old"* ]]; then
    echo "bake-ruflo-console: anchor not found in $file (ruflo pin moved?): $old" >&2
    exit 1
  fi
  printf '%s' "${text/"$old"/"$new"}" > "$file"
}

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

  if [ "$name" = ruflo-mods ]; then
    patch_literal "$out/$name/hooks/options.ts" \
      "  readonly routeContext: boolean" \
      $'  readonly routeTasks: boolean\n  readonly routeContext: boolean'
    patch_literal "$out/$name/hooks/options.ts" \
      "    routeContext: bool(o.routeContext, true)," \
      $'    routeTasks: bool(o.routeTasks, false),\n    routeContext: bool(o.routeContext, true),'
    patch_literal "$out/$name/hooks/route/index.ts" \
      "    if (!state.owned.has('route')) return next(advisory ? { ...e, context } : e)" \
      "    if (!options.routeTasks || !state.owned.has('route')) return next(advisory ? { ...e, context } : e)"
    jq '.userConfig = ({routeTasks: {type: "boolean", title: "Keyword task routing",
          description: "Inject the keyword router'"'"'s \"Routing task\" block into every prompt. Off in agentbox (ADR-2134): skills route through System One, models through Claude Code.",
          required: false, default: false}} + (.userConfig // {}))' "$baked" > "$baked.tmp"
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
