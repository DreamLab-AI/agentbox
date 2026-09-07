#!/usr/bin/env bash
# Dream-cycle evaluator: every hook script under config/hooks/ must parse.
#   *.cjs → node --check      *.sh → bash -n
# Checked-in script because the annexe ssh dispatch strips nested double
# quotes from inline entrypoints (the quoting bug class this engine ships).
#
# Census note (2026-09-07, dream night 09-01 "biggest uncertainty"): the
# directory is not the registration site. Root-session hooks are seeded by
# the entrypoint into ~/.claude/settings.json, per-profile ones by stacks.rs,
# and a few files here are helpers or CLIs, not hooks (config/hooks/README.md,
# ADR-2068). This evaluator answers "does every file parse", not "is every
# registered hook present" — read the counts with that in mind.
set -u
fail=0
cjs=0
sh=0
for f in config/hooks/*.cjs; do
  [ -e "$f" ] || continue
  cjs=$((cjs+1))
  node --check "$f" 2>/dev/null || { echo "SYNTAX FAIL: $f"; fail=$((fail+1)); }
done
for f in config/hooks/*.sh; do
  [ -e "$f" ] || continue
  sh=$((sh+1))
  bash -n "$f" 2>/dev/null || { echo "SYNTAX FAIL: $f"; fail=$((fail+1)); }
done
echo "hooks-checked: $((cjs+sh)) (cjs: $cjs, sh: $sh)  failures: $fail"
if [ "$fail" -eq 0 ]; then
  echo HOOKS-SYNTAX-OK
else
  echo HOOKS-SYNTAX-FAIL
  exit 1
fi
