#!/usr/bin/env bash
# Exercise the migration's failure boundaries without real Docker or credentials.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
eval "$(sed -n '/^cmd_migrate_claude_home() {/,/^}/p' "$ROOT/agentbox.sh")"
CYAN= GREEN= RED= YELLOW= NC=
COMPOSE_ARGS=()
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mode=stop
docker() {
    case "$1" in
        ps) echo agentbox ;;
        compose) [[ "$mode" != stop ]] ;;
        volume) [[ "$mode" != volume ]] ;;
        run) [[ "$mode" != copy ]] ;;
    esac
}
for mode in stop volume copy; do
    if output=$(cmd_migrate_claude_home --force --source "$fixture" 2>&1); then
        echo "FAIL: $mode error was swallowed"; exit 1
    fi
    if [[ "$output" == *'seeded.'* ]]; then
        echo "FAIL: $mode reported success"; exit 1
    fi
done
mode=ok
cmd_migrate_claude_home --force --source "$fixture" >/dev/null
echo 'PASS: stop, volume and copy failures propagate; successful migration completes'
