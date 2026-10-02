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
#   6. block file present -> block 0's header hashes to genesisHash under the parent's header
#      family: sha256d of the 80-byte stock header beside btc/tbtc4, Knots' BLAKE2b v2 hash
#      (knots_header_v2.py) of the 164-byte header beside xbt/txbt4 (skipped when absent)
# Once, before the documents:
#   0. knots_header_v2.py reproduces Knots 29.4.2's own hashes of two live txbt4 headers
#      (getblockheader <hash> false), so case 6 is checked against the node, not against this
#      repository's reading of the codec
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

# 0: known answers from the live txbt4 node (Knots 29.4.2): heights 150,309, the first v2 block
# after the fork, and 152,225
out="$(PYTHONPATH="$HERE" python3 - <<'PY'
from knots_header_v2 import v2_hash
vectors = [
    ("000000a0b679e74906380839e273448fecf76e2ce95e21770ebbe1b7d1b9000000000000b89a9a63a3e422bc9e7a866a2979dcdb4f4a63df0958fa798d3645fbfb1cac1487b9946affff001d73541009b64dc60f87b9946a00000000b10cf00d0100000000000000000000002200000000000000000000000000000000000000254b02000000000000000000000000000000000000000000000000000000000000000000",
     "00000000000096ebd9ecd086095f024d8eb4d1cdb9d8b124dc0e610a4f24f858"),
    ("000000a0ca67bfad363a0c1f03ffffbb848ebe4ebd79ed58d7e92474889492230000000013566ef7c3acadf6fec257aa00b60050c210aad55c484f5565019c3db7a1ed72ec0cc06affff001df9b12900000000002f54010000000000000000044242424242424242000000000400000000000000000000000000000000000000a15202000000000000000000000000000000000000000000000000000000000000000000",
     "00000000d213420f7815e3ff0e7906060f4219cad6b912a42446bd8970c12c6b"),
]
for hdr, want in vectors:
    got = v2_hash(bytes.fromhex(hdr))
    if got != want:
        print(f"{want}: got {got}")
PY
)"
if [ -z "$out" ]; then ok "BLAKE2b v2 header hash reproduces Knots on two live txbt4 headers"
else bad "BLAKE2b v2 header hash reproduces Knots on two live txbt4 headers" "$out"; fi

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
    out="$(PYTHONPATH="$HERE" python3 - "$dat" "$doc" <<'PY'
import hashlib, json, struct, sys
from knots_header_v2 import v2_hash, fields, header_time
d = open(sys.argv[1], "rb").read(); doc = json.load(open(sys.argv[2]))
h, s = struct.unpack("<II", d[:8])
errs = []
if h != 0: errs.append(f"first entry is height {h}, not 0")
blake = doc["parent"] in ("xbt", "txbt4")
if blake:  # Knots v2: 164 bytes, bit 31 set, committed height 0
    hdr = d[8:8+164]; got = v2_hash(hdr); f = fields(hdr); t = header_time(f); prev = f["prev"]
    if not f["version"] & 0x80000000: errs.append("bit 31 clear on a BLAKE2b-family chain")
    if f["height"] != 0: errs.append(f"committed height {f['height']}, not 0")
else:      # stock: 80 bytes, bit 31 clear
    hdr = d[8:8+80]; got = hashlib.sha256(hashlib.sha256(hdr).digest()).digest()[::-1].hex()
    v, = struct.unpack("<i", hdr[:4]); t, = struct.unpack("<I", hdr[68:72]); prev = hdr[4:36]
    if v & 0x80000000: errs.append("bit 31 set on a stock-header chain")
if got != doc["genesisHash"]: errs.append(f"header {'blake2b-v2' if blake else 'sha256d'} {got} != genesisHash {doc['genesisHash']}")
if prev != bytes(32): errs.append("prev is not all zeros")
if t != doc["genesisTime"]: errs.append(f"header time {t} != genesisTime {doc['genesisTime']}")
print("\n".join(errs))
PY
)"
    if [ -z "$out" ]; then ok "block 0 on disk: header hash (parent's family) == genesisHash, prev zero, time == genesisTime"
    else bad "block 0 on disk" "$out"; fi
  else
    skipped "block 0 on disk" "no block file at $dat (set SIDESTR_STATE_ROOT)"
  fi
done

[ "$found" -gt 0 ] || bad "at least one chain document under config/sidechain/" "none found"

echo
echo "passed $pass, failed $fail, skipped $skip"
[ "$fail" -eq 0 ]
