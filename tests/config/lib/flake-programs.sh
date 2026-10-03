#!/usr/bin/env bash
# flake-programs.sh <flake.nix>: print a minimal supervisord.conf with one [program:NAME] per program
# in flake.nix, carrying its user= line and the NAMES of every variable its environment= line can
# set (including those inside lib.optionalString interpolations), each with the value "/x". What
# `role-accounts isolate --env-classes` needs to judge every real program without a Nix eval.
# A name defined in several conditional branches is merged (first user=, union of variables).
# Templated names (`${c.name}`) are skipped: the per-chain programs they render are named from the
# [sidechain] tables and are secret-bearing by the table's sidestr-* wildcards.
set -euo pipefail
awk '
  /^\[program:[^]]+\]/ {
    prog = $0; sub(/^\[program:/, "", prog); sub(/\].*/, "", prog)
    if (index(prog, "${") > 0) { prog = ""; next }
    if (!(prog in known)) { known[prog] = 1; order[++n] = prog; seen[prog] = "," }
    next
  }
  /^\[/ { prog = ""; next }
  prog != "" && /^user=/ { if (!(prog in user)) user[prog] = substr($0, 6); next }
  prog != "" && /^environment=/ {
    s = "," substr($0, 13)
    while (match(s, /[,"][A-Z][A-Z0-9_]*=/)) {
      name = substr(s, RSTART + 1, RLENGTH - 2)
      if (index(seen[prog], "," name ",") == 0) {
        seen[prog] = seen[prog] name ","
        vars[prog] = vars[prog] (vars[prog] == "" ? "" : ",") name "=\"/x\""
      }
      s = substr(s, RSTART + RLENGTH)
    }
    next
  }
  END {
    for (i = 1; i <= n; i++) {
      p = order[i]
      printf "[program:%s]\ncommand=/bin/true\n", p
      if (p in user) printf "user=%s\n", user[p]
      if (vars[p] != "") printf "environment=%s\n", vars[p]
      printf "\n"
    }
  }
' "$1"
