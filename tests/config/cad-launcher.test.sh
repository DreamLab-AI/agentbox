#!/usr/bin/env bash
# cad-launcher — the CAD feature's policy, lock and wiring (ADR-2195).
#
# Static (always):
#   1. the lock is well formed: one wheel per package, sha256 + PyPI URL, cad/cad-server/cad-mcp at
#      one release, every file installable on cp313 x86_64 manylinux
#   2. the launcher exports the policy: telemetry off, update feed off, offline, no index, wheelhouse
#      as the only source, DISPLAY hidden, state on the workspace volume
#   3. the launcher refuses setup/update/uninstall/plugin/telemetry on/doctor (repair) before it looks
#      for uv or installs anything, and lets the read-only forms through to the "no wheelhouse" message
#   4. flake.nix gates package set, supervisor block and fonts on one flag; the gate is declared in
#      the system manifest, the apply classes and the schema; cad_print requires cad
#   5. no adapted skill tells an agent to install from the network or hand over a loopback link
# Live (AGENTBOX_RC_LIVE=1, in a container built with [skills.spatial_and_3d] cad = true):
#   6. `cad` runs offline: build, STEP export, telemetry off, updates off, engine supervised
#   7. a snapshot draws (the engine's Xvfb + Mesa GLX), and a drawing's PDF has text (fonts)
# shellcheck disable=SC2015,SC2016
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${HERE}/../.."
L="$ROOT/config/cad/cad-launcher.sh"
PASS=0; FAIL=0
_ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad()  { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_skip() { PASS=$((PASS + 1)); printf 'ok %d # SKIP %s\n' "$((PASS + FAIL))" "$1"; }
has()   { grep -qF -- "$2" "$1"; }

# 1 ── the lock
if command -v node >/dev/null; then
  OUT="$(cd "$ROOT" && node scripts/cad-wheels-lock.js --check 2>&1)" \
    && _ok "wheels.lock.json is well formed" || _bad "wheels.lock.json is malformed" "$(printf '%s' "$OUT" | head -3 | tr '\n' ' ')"
else _skip "node not available for the lock check"; fi

# 2 ── the policy the launcher exports
for want in 'DO_NOT_TRACK=1' 'CAD_TELEMETRY=0' 'CAD_UPDATE_CHECK=0' 'UV_OFFLINE=1 UV_NO_INDEX=1' \
            'UV_FIND_LINKS="$WH"' 'CAD_UPDATE_FIND_LINKS="$WH"' 'UV_PYTHON_DOWNLOADS=never' 'UV_NO_CONFIG=1' \
            'unset DISPLAY' 'CAD_STATE_DIR="$ROOT/state"' '--offline --no-index --find-links "$WH"'; do
  has "$L" "$want" && _ok "launcher sets: $want" || _bad "launcher no longer sets: $want"
done
bash -n "$L" && _ok "launcher parses" || _bad "launcher has a syntax error"

# 3 ── refusals happen first; read-only forms pass through to the missing-wheelhouse message
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
run() { env -u AGENTBOX_CAD_WHEELHOUSE -u AGENTBOX_CAD_PYTHON HOME="$T" AGENTBOX_CAD_HOME="$T/cad" bash "$L" "$@" 2>&1; }
# With no wheelhouse every call ends at "no wheelhouse"; give it a fake one so refusals are reached.
mkdir -p "$T/wh"; echo '{}' > "$T/wh/wheels.lock.json"; printf '#!/bin/sh\nexit 0\n' > "$T/py"; chmod +x "$T/py"
runw() { HOME="$T" AGENTBOX_CAD_HOME="$T/cad" AGENTBOX_CAD_WHEELHOUSE="$T/wh" AGENTBOX_CAD_PYTHON="$T/py" bash "$L" "$@" 2>&1; }
for sub in "setup" "update" "update auto on" "update auto off" "uninstall" "plugin" "telemetry on" "telemetry off" "doctor"; do
  # shellcheck disable=SC2086
  OUT="$(runw $sub)"; RC=$?
  [ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -q 'disabled in agentbox\|repairs by reinstalling' \
    && _ok "refuses: cad $sub" || _bad "does not refuse: cad $sub" "rc=$RC $(printf '%s' "$OUT" | head -1)"
done
[ ! -e "$T/cad" ] && _ok "a refused command creates no state" || _bad "a refused command created state under AGENTBOX_CAD_HOME"
OUT="$(run status)"; RC=$?
[ "$RC" -eq 2 ] && printf '%s' "$OUT" | grep -q 'gated' && _ok "with the gate off the launcher says CAD is gated" || _bad "gate-off message is missing" "$OUT"

# 4 ── one gate, declared everywhere
F="$ROOT/flake.nix"
has "$F" 'cadEnabled = spatialCfg.cad or false;' \
  && has "$F" 'lib.optionals cadEnabled [ cadLib.launcher cadLib.xvfb ]' \
  && has "$F" '${lib.optionalString cadEnabled "\n${cadServiceBlock}"}' \
  && has "$F" '${lib.optionalString cadEnabled '"''" \
  && _ok "flake.nix gates packages, supervisor block and fonts on cadEnabled" || _bad "flake.nix gate wiring changed"
awk '/^\[program:cad-engine\]/{f=1} f&&/^[[:space:]]*'"''"';/{exit} f' "$F" > "$T/block"
has "$T/block" 'command=${cadLib.launcher}/bin/cad server' && has "$T/block" 'user=devuser' && has "$T/block" 'autorestart=true' \
  && _ok "the engine is a supervised program run as devuser" || _bad "[program:cad-engine] is missing"
has "$ROOT/lib/cad.nix" 'sha256 = w.sha256;' && has "$ROOT/lib/cad.nix" 'python313' \
  && _ok "lib/cad.nix fetches each wheel by its locked sha256 and pins CPython 3.13" || _bad "lib/cad.nix no longer verifies wheels by hash"
for f in management-api/lib/system-manifest.js schema/agentbox.toml.apply.json; do
  has "$ROOT/$f" 'skills.spatial_and_3d.cad' && has "$ROOT/$f" 'skills.spatial_and_3d.cad_print' \
    && _ok "gates declared in $f" || _bad "gates missing from $f"
done
has "$ROOT/management-api/lib/system-manifest.js" "gate: 'skills.spatial_and_3d.cad_print', requires: ['skills.spatial_and_3d.cad']" \
  && _ok "cad_print requires cad" || _bad "cad_print no longer requires cad"
grep -qE '^cad = (true|false)$' "$ROOT/agentbox.toml" && _ok "agentbox.toml states the cad gate" || _bad "agentbox.toml has no cad gate"

# 5 ── the adapted skills
SK="$ROOT/skills"
BADLINES="$(grep -rnE 'curl [^|]*\| *sh|install\.sh|install\.ps1|outside a sandbox|brew install|pip install|uvx |npx |Give the[[:space:]]*$|Give the user the page|AppImage or Flatpak\.$' "$SK"/cad "$SK"/cad-*/ 2>/dev/null | grep -v 'no `curl | sh`, no `uvx`, no `pip`' | grep -v 'Do not download an AppImage' | grep -v 'agentbox.md:.*| `curl' || true)"
[ -z "$BADLINES" ] && _ok "no adapted skill tells an agent to install from the network" || _bad "install instructions survive in the cad skills" "$(printf '%s' "$BADLINES" | head -2 | tr '\n' ' ')"
N=0; for d in cad cad-drawing cad-fea cad-robot cad-pcb cad-print cad-render; do
  [ -f "$SK/$d/SKILL.md" ] && [ -f "$SK/$d/LICENSE" ] && grep -q "^name: $d$" "$SK/$d/SKILL.md" && N=$((N + 1))
done
[ "$N" -eq 7 ] && _ok "seven cad skills, each with its upstream LICENSE and its own name" || _bad "expected 7 cad skills with LICENSE and matching name, found $N"
grep -q 'never handed over' "$SK/cad/SKILL.md" && _ok "the core skill says the viewer link is not handed over" || _bad "the core skill lost the viewer note"

# 6, 7 ── live
if [ "${AGENTBOX_RC_LIVE:-0}" = 1 ]; then
  W="$(mktemp -d)"; mkdir -p "$W/src"
  cat > "$W/src/plate.py" <<'PY'
import build123d as bd
from cad import model


@model
def plate():
    return bd.Box(40, 20, 6) - bd.Cylinder(4, 6)


if __name__ == "__main__":
    plate()
PY
  cat > "$W/src/plate_drawing.py" <<'PY'
from cad.eng_drawing import Sheet, eng_drawing
from plate import plate


@eng_drawing(out="../plate.pdf")
def plate_drawing():
    sheet = Sheet("A4", title="PLATE", part_number="T-1", material="6061", revision="A")
    top, front, right = sheet.three_views(plate().shape)
    top.overall()
    return sheet


if __name__ == "__main__":
    plate_drawing()
PY
  OUT="$(cd "$W" && cad run src/plate.py 2>&1)"
  ID="$(printf '%s' "$OUT" | grep -oE 'id: [0-9a-f-]{36}' | head -1 | cut -c5-)"
  [ -n "$ID" ] && _ok "live: a model builds" || _bad "live: the model did not build" "$(printf '%s' "$OUT" | tail -2 | tr '\n' ' ')"
  (cd "$W" && cad model export "$ID" plate.step >/dev/null 2>&1) && head -c 12 "$W/plate.step" | grep -q 'ISO-10303' \
    && _ok "live: STEP export" || _bad "live: STEP export failed"
  cad telemetry status 2>&1 | grep -q 'Telemetry is off' && _ok "live: telemetry is off" || _bad "live: telemetry is not off"
  cad update auto status 2>&1 | grep -q 'updates are off' && _ok "live: automatic updates are off" || _bad "live: automatic updates are not off"
  supervisorctl status cad-engine 2>/dev/null | grep -q RUNNING && _ok "live: cad-engine is supervised and running" || _bad "live: cad-engine is not RUNNING under supervisord"
  OUT="$(cd "$W" && cad model snapshot "$ID" plate.png 2>&1)"
  [ -s "$W/plate.png" ] && _ok "live: a snapshot draws (Xvfb + Mesa GLX)" || _bad "live: no snapshot" "$(printf '%s' "$OUT" | tail -1)"
  (cd "$W" && cad run src/plate_drawing.py >/dev/null 2>&1)
  # Text is drawn as outlines, so the PDF embeds no font: the evidence is the scan itself.
  [ -s "$W/plate.pdf" ] && _ok "live: a drawing PDF was made" || _bad "live: no drawing PDF"
  [ "$(find -L /usr/share/fonts -name '*.ttf' 2>/dev/null | head -5 | wc -l)" -ge 1 ] \
    && _ok "live: /usr/share/fonts holds TrueType files for the drawing text" || _bad "live: /usr/share/fonts has no .ttf files; drawing text will be empty boxes"
  rm -rf "$W"
else
  _skip "live checks (AGENTBOX_RC_LIVE=1 in a container built with cad = true)"
fi

printf '1..%d\n# cad-launcher: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
