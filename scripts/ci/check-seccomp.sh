#!/bin/sh
# check-seccomp.sh — Invariant: the supplemental seccomp denylist still denies
# the high-value syscalls established by the hardening sprint.
#
# config/seccomp-agentbox.json is INTENTIONALLY allow-by-default
# (defaultAction == SCMP_ACT_ALLOW): it is a thin supplemental DENYLIST layered
# on top of Docker's default profile, not a replacement allowlist. This check
# asserts the file parses, the default action is ALLOW, and that each high-value
# syscall is still present in an SCMP_ACT_ERRNO rule. Fails if any denial is
# dropped.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FILE="$ROOT/config/seccomp-agentbox.json"

fail() { echo "FAIL (check-seccomp): $1" >&2; exit 1; }

[ -f "$FILE" ] || fail "missing $FILE"

# Required denied syscalls (must each appear in an SCMP_ACT_ERRNO rule).
REQUIRED="ptrace bpf mount kexec_load unshare setns"

node - "$FILE" "$REQUIRED" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const required = process.argv[3].split(/\s+/).filter(Boolean);

let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('FAIL (check-seccomp): JSON parse error: ' + e.message);
  process.exit(1);
}

if (doc.defaultAction !== 'SCMP_ACT_ALLOW') {
  console.error('FAIL (check-seccomp): defaultAction is "' + doc.defaultAction +
    '", expected SCMP_ACT_ALLOW (supplemental denylist contract). If this profile ' +
    'was converted to an allowlist, update this check deliberately.');
  process.exit(1);
}

const rules = Array.isArray(doc.syscalls) ? doc.syscalls : [];
// Collect every syscall name that is denied via SCMP_ACT_ERRNO.
const denied = new Set();
for (const r of rules) {
  if (r && r.action === 'SCMP_ACT_ERRNO' && Array.isArray(r.names)) {
    for (const n of r.names) denied.add(n);
  }
}

const missing = required.filter((n) => !denied.has(n));
if (missing.length) {
  console.error('FAIL (check-seccomp): high-value syscall denial(s) dropped from ' +
    'SCMP_ACT_ERRNO rules: ' + missing.join(', '));
  process.exit(1);
}

console.log('PASS (check-seccomp): defaultAction=SCMP_ACT_ALLOW; denied via ERRNO: ' +
  required.join(', '));
NODE
