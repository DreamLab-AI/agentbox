#!/usr/bin/env bash
# Run on the Docker host after exiting Codex sessions, before replacing agentbox.
# Keep agentbox itself running: stopping it destroys its tmpfs home.
set -euo pipefail
archive=${1:?Usage: bash scripts/migrate-codex-home.sh /absolute/path/codex-home.tar}
[[ "$archive" = /* && ! -e "$archive" ]] || { echo 'Choose a new absolute archive path.' >&2; exit 1; }
if docker volume inspect agentbox-codex-home >/dev/null 2>&1; then
  echo 'agentbox-codex-home already exists; refusing to overwrite retained state.' >&2
  exit 1
fi
image=$(docker inspect --format '{{.Image}}' agentbox)
umask 077
# Exclude independent mounts; retain SQLite databases together with their WALs.
# Codex writers must be quiescent for the entire capture.
docker exec --user 1000:1000 agentbox tar -C /home/devuser/.codex \
  --exclude=./auth.json --exclude=./packages --exclude=./tmp -cf - . > "$archive"
tar -tf "$archive" >/dev/null
docker volume create agentbox-codex-home >/dev/null
docker run --rm -i --network none --user 0:0 --entrypoint /bin/sh \
  -v agentbox-codex-home:/codex-home "$image" \
  -c 'tar -xf - -C /codex-home && chown 1000:1000 /codex-home' < "$archive"
echo "Seeded agentbox-codex-home; retained recovery archive: $archive"
echo 'The running container still uses tmpfs. Recreate it with base + override Compose before reopening Codex.'
