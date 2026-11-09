#!/usr/bin/env bash
# Run on the Docker host, with writers quiescent and Agentbox still running.
# Stopping/replacing the old container destroys its .local tmpfs.
set -euo pipefail
archive=${1:?Usage: bash scripts/migrate-local-home.sh /absolute/path/local-home.tar}
[[ "$archive" = /* && ! -e "$archive" && ! -L "$archive" ]] || {
  echo 'Choose a new absolute archive path.' >&2; exit 1;
}
if docker volume inspect agentbox-local-home >/dev/null 2>&1; then
  echo 'agentbox-local-home already exists; refusing to overwrite retained state.' >&2
  exit 1
fi
image=$(docker inspect --format '{{.Image}}' agentbox)
umask 077
set -o noclobber
# Keep SQLite databases and WALs together; exclude independent nested volumes.
docker exec --user 1000:1000 agentbox tar -C /home/devuser/.local \
  --exclude=./share/opencode --exclude=./share/code-server -cf - . > "$archive"
tar -tf "$archive" >/dev/null
docker volume create agentbox-local-home >/dev/null
docker run --rm -i --network none --user 0:0 --entrypoint /bin/sh \
  -v agentbox-local-home:/local-home "$image" \
  -c 'tar -xf - -C /local-home && chown 1000:1000 /local-home' < "$archive"
echo "Seeded agentbox-local-home; retained recovery archive: $archive"
echo 'The running container still uses tmpfs. Recreate with base + override Compose before resuming writers.'
