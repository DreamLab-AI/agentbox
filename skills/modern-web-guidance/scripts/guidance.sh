#!/usr/bin/env bash
# npm prepends the package bin directory; invoke with Node for noexec caches.
set -euo pipefail
exec npm exec --yes --package=modern-web-guidance@1.0.0 -- sh -c '
  cli="${PATH%%:*}/modern-web-guidance"
  test -r "$cli" || { echo "modern-web-guidance CLI missing from npm bin directory" >&2; exit 1; }
  exec node "$cli" "$@"
' -- "$@"
