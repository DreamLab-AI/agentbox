#!/usr/bin/env bash
# python-runtime-path — `python3` in a supervised process is the runtime env.
#
# nixpkgs wraps the `supervisord` script so that it prepends the bare interpreter's
# bin to PATH. supervisord passes its environment to every program, so until this
# was fixed every agent shell ran a python3 with no site-packages while numpy sat
# unimportable further down PATH. flake.nix now puts a launcher ahead of the wrapper
# that runs `python3 -s -m supervisor.supervisord` with the runtime env's interpreter.
#
# Asserts:
#   1. flake.nix defines the launcher and lists it before pythonRuntimeEnv
#   2. the entrypoint still starts PID 1 by the bare name `supervisord`
#   3. behaviour (needs an interpreter with the supervisor module, else SKIP): a child
#      of the module launch resolves python3 to an interpreter that imports numpy,
#      and a program-level PATH="x:%(ENV_PATH)s" carries no bare-interpreter prefix
#   4. the same child under the wrapper does NOT (the defect is real, not assumed);
#      SKIP when no wrapped supervisord is on PATH
#   5. live (AGENTBOX_RC_LIVE=1, a rebuilt container): this shell's python3 imports numpy
# shellcheck disable=SC2015,SC2016
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${HERE}/../.."
PASS=0; FAIL=0
_ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad()  { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_skip() { PASS=$((PASS + 1)); printf 'ok %d # SKIP %s\n' "$((PASS + FAIL))" "$1"; }

# 1 ── the build
grep -q 'supervisordLauncher = pkgs.writeShellScriptBin "supervisord"' "$ROOT/flake.nix" \
  && grep -q 'exec ${pythonRuntimeEnv}/bin/python3 -s -m supervisor.supervisord "\$@"' "$ROOT/flake.nix" \
  && _ok "flake.nix defines the supervisord launcher on the runtime env's interpreter" \
  || _bad "flake.nix must define supervisordLauncher running the module with pythonRuntimeEnv"
ORDER="$(awk '/pythonBasePackages = \[/{f=1;next} f&&/\]/{exit} f{print $1}' "$ROOT/flake.nix" | paste -sd' ')"
[ "$ORDER" = "supervisordLauncher pythonRuntimeEnv" ] \
  && _ok "the launcher is listed before pythonRuntimeEnv, so it wins on PATH" \
  || _bad "pythonBasePackages must be [ supervisordLauncher pythonRuntimeEnv ] in that order" "got: $ORDER"

# 2 ── the entrypoint
grep -qx 'exec supervisord -c "\$_AB_SUPERVISORD_CONF" -n' "$ROOT/config/entrypoint-unified.sh" \
  && _ok "the entrypoint starts PID 1 by name, so the launcher is what runs" \
  || _bad "the entrypoint no longer execs supervisord by its bare name"

# 3, 4 ── behaviour, in a throwaway supervisord
PYENV=""
for p in $(which -a python3 2>/dev/null); do
  "$p" -s -c 'import supervisor, numpy' 2>/dev/null && { PYENV="$p"; break; }
done
if [ -z "$PYENV" ]; then
  _skip "no interpreter with supervisor and numpy on PATH (run inside the agentbox image)"
  _skip "wrapper comparison needs the same interpreter"
else
  T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
  cat > "$T/t.conf" <<CONF
[supervisord]
nodaemon=true
logfile=$T/sv.log
pidfile=$T/sv.pid
childlogdir=$T
[program:probe]
command=/bin/sh -c 'python3 -c "import numpy; print(1)" >$T/numpy-%(ENV_TAG)s 2>/dev/null; echo "\$PATH" >$T/path-%(ENV_TAG)s; sleep 1'
environment=PATH="/sentinel/bin:%(ENV_PATH)s"
autorestart=false
startsecs=0
CONF
  # The image's PATH: the runtime env's bin, with no bare interpreter ahead of it.
  IMGPATH="$(dirname "$PYENV"):$(printf '%s' "$PATH" | tr ':' '\n' | grep -v -E '/[a-z0-9]{32}-python3-[0-9.]+/bin$|-supervisor-[0-9.]+/bin$' | paste -sd:)"
  ( cd "$T" && TAG=module PATH="$IMGPATH" timeout 5 "$PYENV" -s -m supervisor.supervisord -c "$T/t.conf" -n >/dev/null 2>&1 )
  [ "$(cat "$T/numpy-module" 2>/dev/null)" = 1 ] \
    && _ok "module launch: a supervised child's python3 imports numpy" \
    || _bad "module launch: a supervised child's python3 cannot import numpy" "PATH head: $(head -c 300 "$T/path-module" 2>/dev/null)"
  [ "$(cut -d: -f1,2 "$T/path-module" 2>/dev/null)" = "/sentinel/bin:$(dirname "$PYENV")" ] \
    && _ok "module launch: %(ENV_PATH)s is the image's PATH, with nothing prepended" \
    || _bad "module launch: something was prepended to PATH" "PATH head: $(head -c 300 "$T/path-module" 2>/dev/null)"
  WRAPPED="$(dirname "$PYENV")/supervisord"
  if [ -x "$WRAPPED" ]; then
    ( cd "$T" && TAG=wrapper PATH="$IMGPATH" timeout 5 "$WRAPPED" -c "$T/t.conf" -n >/dev/null 2>&1 )
    [ "$(cat "$T/numpy-wrapper" 2>/dev/null)" != 1 ] \
      && _ok "wrapper launch: the same child cannot import numpy (the defect the launcher removes)" \
      || _skip "this nixpkgs wrapper no longer prepends the bare interpreter; the launcher is now belt and braces"
  else
    _skip "no wrapped supervisord beside the runtime interpreter"
  fi
fi

# 5 ── live
if [ "${AGENTBOX_RC_LIVE:-0}" = 1 ]; then
  python3 -c 'import numpy' 2>/dev/null \
    && _ok "live: this shell's python3 imports numpy" \
    || _bad "live: this shell's python3 cannot import numpy" "python3 = $(command -v python3)"
else
  _skip "live check (set AGENTBOX_RC_LIVE=1 in a container rebuilt with the launcher)"
fi

printf '1..%d\n# python-runtime-path: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
