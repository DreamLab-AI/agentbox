#!/usr/bin/env bash
# cad-launcher.sh - the agentbox front door to text-to-cad's `cad` command (ADR-2195).
#
# Upstream expects to install itself from PyPI, resolve its CAD kernel at first use, report usage
# and update itself. None of that is acceptable in a pinned image, so this launcher:
#   - installs cad-server ONCE, offline, from the image's hash-locked wheelhouse, into a venv on the
#     workspace volume keyed by the wheelhouse lock (a new image makes a new venv);
#   - points every environment the tool makes afterwards at the same wheelhouse, offline and with
#     no package index, so the kernel, the solver, KiCad and Blender are exactly the locked wheels;
#   - turns telemetry and the update feed off for every process it starts;
#   - refuses the subcommands that edit agent-app configuration or turn either back on;
#   - gives the foreign (manylinux) wheels the shared libraries the image keeps in the Nix store;
#   - hides DISPLAY, so the engine draws on an Xvfb of its own and never opens a browser on the
#     operator's VNC desktop.
#
# Set by the image wrapper (flake.nix, cadLauncher):
#   AGENTBOX_CAD_WHEELHOUSE  directory of wheels, with wheels.lock.json beside them
#   AGENTBOX_CAD_PYTHON      a CPython 3.13 interpreter
#   AGENTBOX_CAD_LIBPATH     colon-separated library directories for the wheels
# Optional:
#   AGENTBOX_CAD_HOME        where the venv, state and caches live (default $WORKSPACE/.agentbox/cad)
# There is no online mode. A package outside the lock is added to the lock and arrives with the
# next image (scripts/cad-wheels-lock.js); the engine holds its own offline environment, so a
# per-command switch could not reach it anyway.
set -euo pipefail

die() { echo "cad: $*" >&2; exit 2; }

WH="${AGENTBOX_CAD_WHEELHOUSE:-}"; PY="${AGENTBOX_CAD_PYTHON:-}"
[ -n "$WH" ] && [ -f "$WH/wheels.lock.json" ] || die "no wheelhouse (AGENTBOX_CAD_WHEELHOUSE). CAD is gated: set [skills.spatial_and_3d].cad = true in agentbox.toml and rebuild."
[ -n "$PY" ] && [ -x "$PY" ] || die "no Python 3.13 (AGENTBOX_CAD_PYTHON)."

# Subcommands that reach outside the tool: agent-app configuration, self-update, phoning home.
case "${1:-}" in
  update)
    [ "${2:-}" = auto ] && [ "${3:-status}" = status ] || die "'cad update' is disabled in agentbox: the release changes with the image (config/cad/wheels.lock.json), and automatic updates are off by policy (ADR-2195)." ;;
  setup|uninstall|plugin)
    die "'cad $1' is disabled in agentbox: it edits agent-app configuration or replaces the pinned release. The release changes with the image (config/cad/wheels.lock.json)." ;;
  telemetry)
    case "${2:-status}" in status) ;; *) die "'cad telemetry ${2}' is disabled in agentbox: telemetry is off by policy (ADR-2195)." ;; esac ;;
  doctor)
    case " ${*:2} " in *" --check "*) ;; *) die "'cad doctor' repairs by reinstalling from the network. Use 'cad doctor --check'; to reset, remove ${AGENTBOX_CAD_HOME:-\$WORKSPACE/.agentbox/cad}/venv-*." ;; esac ;;
esac

command -v uv >/dev/null || die "uv is not on PATH."

ROOT="${AGENTBOX_CAD_HOME:-${WORKSPACE:-$HOME/workspace}/.agentbox/cad}"
# Keyed by the lock AND the interpreter: either changing with a new image makes a new venv, and one
# whose interpreter has left the Nix store is never reused.
LOCK="$( { cat "$WH/wheels.lock.json"; echo "$PY"; } | sha256sum | cut -c1-16)"
VENV="$ROOT/venv-$LOCK"
VERSION="$(basename "$(ls "$WH"/cad_server-*.whl | head -n 1)" | cut -d- -f2)"
mkdir -p "$ROOT/state" "$ROOT/cache" "$ROOT/engine" "$ROOT/uv"

export DO_NOT_TRACK=1 CAD_TELEMETRY=0 CAD_UPDATE_CHECK=0 CAD_INSTALL_CHANNEL=agentbox
export CAD_STATE_DIR="$ROOT/state" CAD_CACHE_DIR="$ROOT/cache" CAD_ENGINE_DIR="$ROOT/engine" UV_CACHE_DIR="$ROOT/uv"
export UV_NO_CONFIG=1 UV_PYTHON="$PY" UV_PYTHON_DOWNLOADS=never UV_FIND_LINKS="$WH" CAD_UPDATE_FIND_LINKS="$WH"
export UV_OFFLINE=1 UV_NO_INDEX=1
export LD_LIBRARY_PATH="${AGENTBOX_CAD_LIBPATH:+$AGENTBOX_CAD_LIBPATH:}${LD_LIBRARY_PATH:-}"
unset DISPLAY XAUTHORITY WAYLAND_DISPLAY BROWSER

if [ ! -f "$VENV/.agentbox-cad-ready" ] || [ ! -x "$VENV/bin/python" ]; then
  echo "cad: first use of this image's CAD release ($VERSION): installing from the wheelhouse, offline" >&2
  exec 9>"$ROOT/.install.lock"; flock 9
  if [ ! -f "$VENV/.agentbox-cad-ready" ] || [ ! -x "$VENV/bin/python" ]; then
    rm -rf "$VENV"
    uv venv --quiet --no-project --python "$PY" "$VENV" >&2
    uv pip install --quiet --offline --no-index --find-links "$WH" --python "$VENV/bin/python" "cad-server==$VERSION" >&2
    echo "$VERSION $LOCK" > "$VENV/.agentbox-cad-ready"
    # An older image's venv is dead weight once this one is ready.
    for old in "$ROOT"/venv-*; do [ "$old" = "$VENV" ] || rm -rf "$old"; done
  fi
  flock -u 9; exec 9>&-
fi
exec "$VENV/bin/cad" "$@"
