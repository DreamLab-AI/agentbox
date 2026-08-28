#!/usr/bin/env bash
# Dream-cycle evaluator: every config/hooks/*.cjs must pass node --check.
# Checked-in script because the annexe ssh dispatch strips nested double
# quotes from inline entrypoints (the quoting bug class this engine ships).
set -u
fail=0
for f in config/hooks/*.cjs; do
  node --check "$f" 2>/dev/null || { echo "SYNTAX FAIL: $f"; fail=$((fail+1)); }
done
echo "hooks-checked: $(ls config/hooks/*.cjs | wc -l)  failures: $fail"
[ "$fail" -eq 0 ] && echo HOOKS-SYNTAX-OK || echo HOOKS-SYNTAX-FAIL
