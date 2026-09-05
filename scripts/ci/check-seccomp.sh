#!/bin/sh
# check-seccomp.sh — Invariant: the supplemental seccomp denylist still denies
# EVERY syscall the hardening sprint established, and still carries the AF_ALG
# socket-argument rule that closes CVE-2026-31431.
#
# config/seccomp-agentbox.json is INTENTIONALLY allow-by-default
# (defaultAction == SCMP_ACT_ALLOW): it is a thin supplemental DENYLIST layered
# on top of Docker's default profile, not a replacement allowlist. This check
# asserts the file parses, the default action is ALLOW, that every one of the
# 46 established syscall denials is still present in an SCMP_ACT_ERRNO rule,
# and that the argument-filtered AF_ALG rule is intact.
#
# ADR-2046 widened this gate. It previously named only six syscalls
# (ptrace bpf mount kexec_load unshare setns), so the other forty could be
# deleted from the profile without failing CI, and the CVE rule — the single
# most specific protection in the file — was not checked at all.
#
# Adding a NEW denial is always allowed (that is tightening). Removing one
# fails: edit BASELINE below in the same change as the profile, deliberately.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
FILE="$ROOT/config/seccomp-agentbox.json"

fail() { echo "FAIL (check-seccomp): $1" >&2; exit 1; }

[ -f "$FILE" ] || fail "missing $FILE"

# The complete established denylist (46 names), ADR-2046. Sorted for review.
BASELINE="add_key bpf clock_adjtime clock_settime create_module delete_module
finit_module get_kernel_syms get_mempolicy init_module ioperm iopl kcmp
kexec_file_load kexec_load keyctl lookup_dcookie mbind mount move_pages
nfsservctl perf_event_open pivot_root process_vm_readv process_vm_writev ptrace
query_module quotactl reboot request_key set_mempolicy setns settimeofday stime
swapon swapoff sysfs _sysctl umount umount2 unshare uselib userfaultfd ustat
vm86 vm86old"

node - "$FILE" "$BASELINE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const baseline = process.argv[3].split(/\s+/).filter(Boolean);

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

// Unconditional denials: SCMP_ACT_ERRNO rules with no argument filter.
const denied = new Set();
// Argument-filtered denials, keyed name/index/value/op.
const argDenied = new Set();
for (const r of rules) {
  if (!r || r.action !== 'SCMP_ACT_ERRNO' || !Array.isArray(r.names)) continue;
  const args = Array.isArray(r.args) ? r.args : [];
  if (args.length === 0) {
    for (const n of r.names) denied.add(n);
  } else {
    for (const n of r.names) {
      for (const a of args) argDenied.add(`${n}/${a.index}/${a.value}/${a.op}`);
    }
  }
}

const missing = baseline.filter((n) => !denied.has(n));
if (missing.length) {
  console.error('FAIL (check-seccomp): ' + missing.length +
    ' established syscall denial(s) dropped from SCMP_ACT_ERRNO rules: ' +
    missing.join(', '));
  process.exit(1);
}

// CVE-2026-31431: socket(AF_ALG=38, ...) must stay blocked by an arg filter.
const AF_ALG = 'socket/0/38/SCMP_CMP_EQ';
if (!argDenied.has(AF_ALG)) {
  console.error('FAIL (check-seccomp): the AF_ALG socket rule is missing or ' +
    'altered — expected an SCMP_ACT_ERRNO rule on "socket" with ' +
    'args[0] value 38 op SCMP_CMP_EQ (CVE-2026-31431, algif_aead privesc via splice()).');
  process.exit(1);
}

const extra = [...denied].filter((n) => !baseline.includes(n));
console.log('PASS (check-seccomp): defaultAction=SCMP_ACT_ALLOW; ' +
  denied.size + ' unconditional denial(s) cover all ' + baseline.length +
  ' established names; AF_ALG socket rule intact' +
  (extra.length ? '; ' + extra.length + ' additional denial(s): ' + extra.join(', ') : ''));
NODE
