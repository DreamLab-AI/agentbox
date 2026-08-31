#!/bin/sh
# check-ports-loopback.sh — Invariant: published ports across EVERY compose file
# bind to 127.0.0.1 (R-003), except the explicitly sanctioned LAN exposures
# below. Fails on any other publish in any docker-compose*.yml.
#
# Structure: this is a WHITELIST gate. Every entry inside a `ports:` block must
# be a plain double/single-quoted or bare short-syntax mapping that either binds
# 127.0.0.1 or appears verbatim on the SANCTIONED list. Any other shape —
# YAML anchors/aliases, env interpolation (${HOST:-0.0.0.0}), port ranges,
# IPv6 binds ([::]), bare container-only ports, inline flow lists
# (`ports: [...]`), long syntax — is rejected as unauditable, so a bypass is
# structurally impossible rather than merely unmatched.
#
# History: the gate originally audited only docker-compose.yml with a blacklist
# regex, which let the voice cockpit (:8444) and three sidecar overlays publish
# 0.0.0.0 uninspected (ADR-2013), and was bypassable via quoting/interpolation
# (codex adversarial review 2026-08-31). Now: all files, whitelist semantics.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

fail() { echo "FAIL (check-ports-loopback): $1" >&2; exit 1; }

# Sanctioned non-loopback publishes: "<compose-basename>:<mapping>" pairs.
# Adding a line here is a security decision — cite the governing record.
#   docker-compose.yml 9096         — ADR-045 NIP-98 sovereign ingress
#   docker-compose.voice.yml 8443/8444 — voice cockpit TLS door (ADR-2013 second
#                                     LAN ingress, modelled not hidden)
#   docker-compose.browsercontainer.yml 5903/8931/9222 — sidecar VNC / MCP SSE /
#                                     raw CDP for LAN operators+agents
#   docker-compose.gui-tools.yml 5905/9876/9877 — sidecar VNC / Blender-MCP /
#                                     QGIS-MCP
#   docker-compose.xr-runtime.yml 5904 — sidecar VNC
SANCTIONED="
docker-compose.yml:9096:9096
docker-compose.voice.yml:0.0.0.0:8443:8443
docker-compose.voice.yml:0.0.0.0:8444:8444
docker-compose.browsercontainer.yml:0.0.0.0:5903:5903
docker-compose.browsercontainer.yml:0.0.0.0:8931:8931
docker-compose.browsercontainer.yml:0.0.0.0:9222:9223
docker-compose.gui-tools.yml:0.0.0.0:5905:5905
docker-compose.gui-tools.yml:0.0.0.0:9876:9876
docker-compose.gui-tools.yml:0.0.0.0:9877:9877
docker-compose.xr-runtime.yml:0.0.0.0:5904:5904
"

found_any=0
overall_bad=""

for FILE in "$ROOT"/docker-compose*.yml; do
  [ -f "$FILE" ] || continue
  found_any=1
  base="$(basename "$FILE")"

  # Long syntax is banned in every file, in every spelling the short-syntax
  # walker cannot see: block keys (with any whitespace around ':') and inline
  # flow mappings ({target: ..., published: ...}).
  if sed -e 's/#.*$//' "$FILE" | grep -nE '(^|[[:space:]{,])["'\'']?(published|host_ip)["'\'']?[[:space:]]*:' ; then
    echo "FAIL (check-ports-loopback): long-syntax port mapping (published:/host_ip:)" >&2
    echo "  found in $base — use short syntax (\"127.0.0.1:PORT:PORT\") so the" >&2
    echo "  loopback invariant stays checkable." >&2
    exit 1
  fi

  # Walk ports: blocks. Emit "BAD <reason> <line>" for anything that is not a
  # plain short-syntax mapping in the whitelist. awk tracks block state by
  # indentation; `ports:` with inline content (flow list) is rejected outright.
  bad_lines="$(awk -v sanctioned="$SANCTIONED" -v base="$base" '
    function indent_of(s,   n) { n = match(s, /[^ ]/); return n ? n - 1 : length(s) }
    function strip(s) {
      sub(/^[ \t]*-[ \t]*/, "", s)      # list dash
      gsub(/["'\'']/, "", s)             # both quote styles
      sub(/[ \t]+$/, "", s)
      return s
    }
    BEGIN {
      n = split(sanctioned, sl, "\n")
      for (i = 1; i <= n; i++) if (sl[i] != "") allow[sl[i]] = 1
    }
    {
      line = $0
      # ports: key — block form arms the walker; ANY inline content is
      # rejected. Key may be quoted ("ports":/'"'"'ports'"'"':) — same semantics
      # in YAML, so the same treatment here.
      if (line ~ /^[ \t]*["'\'']?ports["'\'']?[ \t]*:[ \t]*$/) { inp = 1; pind = indent_of(line); next }
      if (line ~ /^[ \t]*["'\'']?ports["'\'']?[ \t]*:[ \t]*[^ \t]/) { print "BAD inline-flow-ports " line; next }
      if (!inp) next
      if (line ~ /^[ \t]*$/ || line ~ /^[ \t]*#/) next
      if (line !~ /^[ \t]*-/) {
        if (indent_of(line) <= pind) { inp = 0 }
        next
      }
      # A list item inside a ports block. Tabs in indentation are illegal YAML
      # and also break indent tracking — reject them.
      if (line ~ /^[ \t]*\t/) { print "BAD tab-indent " line; next }
      val = strip(line)
      if (val ~ /^127\.0\.0\.1:[0-9]+:[0-9]+(\/(tcp|udp))?$/) next
      if ((base ":" val) in allow) next
      print "BAD unsanctioned-or-unparseable " val
    }
  ' "$FILE")"

  if [ -n "$bad_lines" ]; then
    overall_bad="$overall_bad$(printf '%s\n' "$bad_lines" | sed "s/^/$base: /")\n"
  fi
done

[ "$found_any" = 1 ] || fail "no docker-compose*.yml found under $ROOT"

if [ -n "$overall_bad" ]; then
  echo "FAIL (check-ports-loopback): ports entries that are not loopback, not" >&2
  echo "  sanctioned, or not plain short syntax (anchors/aliases/interpolation/" >&2
  echo "  ranges/IPv6/bare ports are rejected as unauditable):" >&2
  printf '%b' "$overall_bad" >&2
  echo "  Bind 127.0.0.1:, or add the exact mapping to the SANCTIONED list in" >&2
  echo "  this script with a citation to the governing decision record." >&2
  exit 1
fi

echo "PASS (check-ports-loopback): all compose publishes loopback-only or explicitly sanctioned"
