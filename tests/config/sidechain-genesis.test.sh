#!/usr/bin/env bash
# ADR-2103 / PRD-024 P1 — the sealed chain documents under config/sidechain/.
#
# The property under test: a committed chain document is a sealed identity, not
# configuration. Every field the validator reads is present and well-formed, the
# signer and challenge agree, no mainnet parent appears without a P21 receipt, no
# key material is in the repository, and (when the block file is reachable) block 0
# of the chain on disk hashes to the document's genesisHash.
#
# Cases, per document:
#   1. required fields present with the right shapes
#   2. challenge is the signer's single-key taproot script (5120 || signer)
#   3. parent is a SPEC 3.2 alias; a mainnet alias needs p21Receipt (ADR-2103 D4)
#   4. containmentDigest is the SHA-256 of the JCS form of containment
#   5. no 32-byte hex secret sits beside the document (keys are never in git)
#   6. block file present -> sha256d(header[0..80]) == genesisHash (skipped when absent)
# Run: bash tests/config/sidechain-genesis.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DOCS="$REPO/config/sidechain"
STATE_ROOT="${SIDESTR_STATE_ROOT:-${WORKSPACE:-$HOME/workspace}/sidestr}"

pass=0; fail=0; skip=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }
skipped() { skip=$((skip+1)); printf '  skip %s\n    %s\n' "$1" "${2:-}"; }

echo "sidechain genesis documents (ADR-2103)"

found=0
for doc in "$DOCS"/*/chain.json; do
  [ -f "$doc" ] || continue
  found=$((found+1))
  name="$(basename "$(dirname "$doc")")"
  echo "── $name"

  # 1–4: document invariants, one python3 pass so the JSON is parsed once
  out="$(python3 - "$doc" "$name" <<'PY'
import hashlib, json, re, sys
p, name = sys.argv[1], sys.argv[2]
d = json.load(open(p))
errs = []
hex64 = re.compile(r'^[0-9a-f]{64}$')
req = {"id": str, "name": str, "parent": str, "challenge": str, "powLimit": str, "addressPrefix": str,
       "pegConfirmations": int, "refundBlocks": int, "pegoutBlocks": int, "genesisTime": int,
       "pegs": list, "signer": str, "genesisHash": str}
for k, t in req.items():
    if k not in d: errs.append(f"missing {k}")
    elif not isinstance(d[k], t): errs.append(f"{k} is not {t.__name__}")
if not errs:
    if d["id"] != f"sidestr:{d['name']}": errs.append("id is not sidestr:<name>")
    if d["name"] != name: errs.append(f"directory {name} != name {d['name']}")
    if not hex64.match(d["signer"]): errs.append("signer is not 32-byte hex")
    if not hex64.match(d["genesisHash"]): errs.append("genesisHash is not 32-byte hex")
    if not re.match(r'^[a-z]{1,8}$', d["addressPrefix"]): errs.append("addressPrefix is not 1-8 lower-case letters")
    if d["challenge"] != "5120" + d["signer"]: errs.append("challenge is not 5120||signer")
    aliases = {"btc": True, "tbtc4": False, "xbt": True, "txbt4": False}
    if d["parent"] not in aliases: errs.append(f"parent {d['parent']!r} is not a SPEC 3.2 alias")
    elif aliases[d["parent"]] and not d.get("p21Receipt"): errs.append(f"mainnet parent {d['parent']} without p21Receipt (ADR-2103 D4)")
    if d.get("containment") is not None:
        c = d["containment"]
        jcs = json.dumps(c, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        want = "sha256:" + hashlib.sha256(jcs).hexdigest()
        if d.get("containmentDigest") != want: errs.append("containmentDigest does not match JCS(containment)")
        if c.get("parent") != d["parent"]: errs.append("containment.parent != parent")
        if c.get("cashOut") is not False: errs.append("containment.cashOut must be false (ADR-2103 D5)")
print("\n".join(errs))
PY
)"
  if [ -z "$out" ]; then ok "document invariants (fields, challenge, parent alias, P21, containment)"
  else bad "document invariants" "$out"; fi

  # 5: no key material beside the document
  leak="$(grep -rlE '^[0-9a-f]{64}$' "$(dirname "$doc")" 2>/dev/null || true)"
  if [ -z "$leak" ]; then ok "no bare 32-byte hex key file beside the document"
  else bad "no bare 32-byte hex key file beside the document" "$leak"; fi

  # 6: block 0 on disk hashes to the document's genesisHash
  dat="$STATE_ROOT/$name/blocks.dat"
  if [ -f "$dat" ]; then
    out="$(python3 - "$dat" "$doc" <<'PY'
import hashlib, json, struct, sys
d = open(sys.argv[1], "rb").read(); doc = json.load(open(sys.argv[2]))
h, s = struct.unpack("<II", d[:8]); hdr = d[8:8+80]
got = hashlib.sha256(hashlib.sha256(hdr).digest()).digest()[::-1].hex()
v, = struct.unpack("<i", hdr[:4]); t, = struct.unpack("<I", hdr[68:72])
errs = []
if h != 0: errs.append(f"first entry is height {h}, not 0")
if got != doc["genesisHash"]: errs.append(f"header sha256d {got} != genesisHash {doc['genesisHash']}")
if hdr[4:36] != bytes(32): errs.append("prev is not all zeros")
if t != doc["genesisTime"]: errs.append(f"header time {t} != genesisTime {doc['genesisTime']}")
if doc["parent"] in ("btc", "tbtc4") and (v & 0x80000000): errs.append("bit 31 set on a stock-header chain")
print("\n".join(errs))
PY
)"
    if [ -z "$out" ]; then ok "block 0 on disk: sha256d(header) == genesisHash, prev zero, time == genesisTime"
    else bad "block 0 on disk" "$out"; fi
  else
    skipped "block 0 on disk" "no block file at $dat (set SIDESTR_STATE_ROOT)"
  fi
done

[ "$found" -gt 0 ] || bad "at least one chain document under config/sidechain/" "none found"

echo
echo "passed $pass, failed $fail, skipped $skip"
[ "$fail" -eq 0 ]
