#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
line="$(grep '^  _JC_CFG_HAVE=' "$root/config/entrypoint-unified.sh")"
test_dir="$(mktemp -d)"
trap 'rmdir "$test_dir"' EXIT
_JC_CFG_STAMP="$test_dir/absent"
eval "$line"
[[ -z "$_JC_CFG_HAVE" ]]
_JC_CFG_STAMP="$root/tests/config/jev-config-stamp.test.sh"
eval "$line"
[[ "$_JC_CFG_HAVE" == "$(cat "$_JC_CFG_STAMP")" ]]
echo 'PASS: absent stamp survives errexit; existing stamp is preserved'
