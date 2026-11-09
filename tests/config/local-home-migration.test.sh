#!/usr/bin/env bash
# Real tar stream, fake Docker: check nested mounts and failure boundaries.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/source/share/uv/python" \
  "$fixture/source/share/factrail/decisions" "$fixture/source/share/opencode" \
  "$fixture/source/share/code-server" "$fixture/destination"
printf runtime > "$fixture/source/share/uv/python/runtime"
printf decisions > "$fixture/source/share/factrail/decisions/log.jsonl"
printf nested > "$fixture/source/share/opencode/db"
printf nested > "$fixture/source/share/code-server/config"
ln -s python/runtime "$fixture/source/share/uv/current"
export fixture
cat > "$fixture/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "$1" >> "$fixture/calls"
case "$1" in
  volume)
    case "$2" in
      inspect) [[ "$mode" = existing ]] ;;
      create) [[ "$mode" != create-fail ]] ;;
    esac ;;
  inspect) echo test-image ;;
  exec)
    [[ "$mode" != capture-fail ]] || exit 1
    shift 6
    [[ "$1" = /home/devuser/.local ]] || exit 2
    shift
    tar -C "$fixture/source" "$@" ;;
  run)
    [[ "$mode" != seed-fail ]] || exit 1
    tar -xf - -C "$fixture/destination" ;;
esac
SH
chmod +x "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
for mode in existing capture-fail create-fail seed-fail; do
  export mode
  if bash "$repo/scripts/migrate-local-home.sh" "$fixture/$mode.tar" > "$fixture/output" 2>&1; then
    echo "FAIL: $mode was swallowed"; exit 1
  fi
  ! rg -q 'Seeded agentbox-local-home' "$fixture/output"
done
# A pre-existing archive must be left untouched before any Docker calls.
export mode=ok
printf retained > "$fixture/existing.tar"
: > "$fixture/calls"
if bash "$repo/scripts/migrate-local-home.sh" "$fixture/existing.tar" >/dev/null 2>&1; then
  echo 'FAIL: existing archive accepted'; exit 1
fi
[[ $(cat "$fixture/existing.tar") = retained && ! -s "$fixture/calls" ]]
bash "$repo/scripts/migrate-local-home.sh" "$fixture/ok.tar" >/dev/null
[[ $(cat "$fixture/destination/share/uv/python/runtime") = runtime ]]
[[ $(cat "$fixture/destination/share/factrail/decisions/log.jsonl") = decisions ]]
[[ -L "$fixture/destination/share/uv/current" ]]
[[ ! -e "$fixture/destination/share/opencode" && ! -e "$fixture/destination/share/code-server" ]]
[[ $(stat -c %a "$fixture/ok.tar") = 600 ]]
echo 'PASS: private archive retains runtimes, decisions and symlinks; excludes nested volumes; failures propagate'
