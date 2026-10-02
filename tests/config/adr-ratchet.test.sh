#!/usr/bin/env bash
# adr-ratchet.test.sh — scripts/adr-ratchet.sh counts the backlog, not files.
#
# Each case builds a throwaway git repo with a base commit holding one proposed
# ADR, makes a change, and checks the ratchet's verdict. The end date is pinned
# far in the future so the rule is always enforced here.
set -euo pipefail

script="$(cd "$(dirname "$0")/../.." && pwd)/scripts/adr-ratchet.sh"
pass=0 fail=0

adr() { # <file> <status>
  printf -- '---\ntitle: test\ndecision_status: %s\n---\n\nBody.\n' "$2" > "docs/adr/$1"
}

run_case() { # <name> <expected OK|FAIL> <setup function> [trailer]
  local name="$1" want="$2" setup="$3" trailer="${4:-}" tmp got
  tmp="$(mktemp -d)"
  (
    cd "$tmp"
    git init -q -b main
    git config user.email t@example.invalid
    git config user.name test
    mkdir -p docs/adr
    adr ADR-0001-old.md proposed
    git add -A && git commit -qm base
    "$setup"
    git add -A && git commit -qm change ${trailer:+-m "$trailer"}
  )
  if got="$(cd "$tmp" && ADR_RATCHET_UNTIL=2999-01-01 bash "$script" docs/adr HEAD~1 HEAD 2>&1)"; then
    got=OK
  else
    got=FAIL
  fi
  rm -rf "$tmp"
  if [[ "$got" == "$want" ]]; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); echo "FAIL $name (want $want, got $got)"
  fi
}

new_accepted()         { adr ADR-0002-new.md accepted; }
new_proposed()         { adr ADR-0002-new.md proposed; }
new_proposed_closing() { adr ADR-0002-new.md proposed; adr ADR-0001-old.md accepted; }
new_unstated()         { printf -- '---\ntitle: no status\n---\n' > docs/adr/ADR-0002-new.md; }
new_proposed_exempt()  { adr ADR-0002-new.md proposed; }
non_adr_file()         { echo x > docs/adr/README.md; }

run_case "accepted record on arrival passes"             OK   new_accepted
run_case "proposed record that closes nothing fails"     FAIL new_proposed
run_case "proposed record that closes one passes"        OK   new_proposed_closing
run_case "record with no status counts as backlog"       FAIL new_unstated
run_case "trailer exempts a proposed record"             OK   new_proposed_exempt "ADR-Ratchet: ADR-0002 documents test"
run_case "non-ADR file is ignored"                       OK   non_adr_file

echo "adr-ratchet: $pass passed, $fail failed"
(( fail == 0 ))
