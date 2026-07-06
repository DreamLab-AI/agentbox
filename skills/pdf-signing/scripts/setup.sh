#!/usr/bin/env bash
# Resolve (and if needed provision) a Python interpreter that can run pyHanko.
# Prints the interpreter path on stdout. Idempotent + cheap on repeat calls.
#
# Order of preference:
#   1. An ambient python3 that already imports pyhanko (e.g. baked into the
#      Nix image — see SKILL.md "Durable install"). No venv, nothing to build.
#   2. A previously-built skill venv.
#   3. Build a venv here and pip install pyHanko (needs PyPI on first run only).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/venv"

have_pyhanko() { "$1" -c 'import pyhanko, cryptography, PIL' >/dev/null 2>&1; }

for cand in python3 python3.12; do
  if command -v "$cand" >/dev/null 2>&1 && have_pyhanko "$cand"; then
    command -v "$cand"; exit 0
  fi
done

if [[ -x "$venv/bin/python" ]] && have_pyhanko "$venv/bin/python"; then
  echo "$venv/bin/python"; exit 0
fi

echo "pdf-signing: provisioning venv (one-off pyHanko install)…" >&2
python3 -m venv "$venv" >&2
"$venv/bin/pip" -q install --upgrade pip >&2
"$venv/bin/pip" -q install "pyhanko[image-support,opentype]" >&2
have_pyhanko "$venv/bin/python" || { echo "pdf-signing: pyHanko install failed" >&2; exit 1; }
echo "$venv/bin/python"
