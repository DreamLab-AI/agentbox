#!/usr/bin/env bash
# Skills estate freshness + progressive-disclosure lint (ADR-2021).
#
# STABLE CI ENTRY POINT. `.github/workflows/invariants.yml` and the pre-rebuild
# gate call this file; the checks themselves live in `lint-skills.mjs` because
# the frontmatter contract needs a real YAML parse rather than line greps.
#
# Run:  bash skills/lint-skills.sh      Exit 0 = clean, non-zero = violations.
#
# Suppression (documented): a line carrying the `lint-ok` marker is waved
# through by every check; STALE additionally honours the historical prose
# context words (DEAD/retired/legacy/deprecated/"is not"/"never target").
# Suppressions are listed separately in the summary — a suppression is an
# explicit exception, never semantic validation.
set -u
cd "$(dirname "$0")"

NODE_BIN="${NODE:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "lint-skills: node is required (CI installs Node 20; see .github/workflows/invariants.yml)" >&2
  exit 2
fi

exec "$NODE_BIN" ./lint-skills.mjs "$@"
