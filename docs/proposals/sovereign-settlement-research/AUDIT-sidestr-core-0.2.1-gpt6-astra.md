---
title: sidestr-core 0.2.1 — independent verification of the PUSHDATA1 burn fix (anti-fox)
date: 2026-09-22
auditor: GPT-6 Astra via the codex CLI (a different model family from the Claude producer), against a snapshot of the workspace
code under test: f0a251ead08cd7b2d494a3c11cba27349ca179f8 (local pin, not pushed); baseline the 0.2.0 snapshot f59f0006
method: gates re-run; a same-block differential of derived records between the JS reference and Rust over every OP_RETURN encoding form for pegout, pegin, claim, ckpt and text records; a fixed-offset consistency review across core and wallet; public-API comparison. The first run was cut by the provider's content filter before any work; the second, worded as verification engineering, completed. Receipt links refer to the session scratchpad (audit4/probes/).
outcome: the PUSHDATA1 fix is confirmed; publication held for F1 (the reference strips a leading UTF-8 BOM when text-decoding markers and Rust does not, so BOM-prefixed burns diverge in records and validity); F3/F4 encoder domain bounds noted; see the follow-up note at the end
---

# Independent verification: sidestr-core 0.2.1

**Recommendation: hold publication pending the BOM decoding fix; the requested PUSHDATA1 fix works, but equivalent BOM-prefixed records still produce unpaid burns and block-validity splits.** Evidence: D1/D2 below.

All receipts identify snapshot SHA **f0a251ead08cd7b2d494a3c11cba27349ca179f8**, from `../SHA.txt`. UTC times and exact commands appear below and in [probes](probes/). Commands run from `sidestr/` unless a manifest path is supplied. Status applies to the tested cases, not an exhaustive proof.

## Environment and provenance — CONFIRMED / limited provenance

The current directory has no Git metadata (`git rev-parse HEAD` returned `fatal: not a git repository`, initial inspection at `2026-09-22T16:35:52Z`); SHA is the supplied snapshot label, not an independently authenticated checkout HEAD. The historical comparison uses the neighbouring audit3 snapshot, labelled `f59f0006728b8d8ab51c1f5c94658b15554dfe40`, whose manifest says 0.2.0. The exact published 0.2.0 archive was not independently authenticated: **UNVERIFIABLE** beyond that local baseline. [history.log](probes/history.log), [api.log](probes/api.log).

Common environment, set by `python ../probes/run.py` for every receipt:

```sh
export CARGO_TARGET_DIR=/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit4
export SIDESTR_SIDING=/home/devuser/workspace/sidestr/upstream/spec/siding
export SCHEMA=/home/devuser/workspace/sidestr/upstream/schema
export BLAKETESTNODE=/home/devuser/workspace/sidestr/upstream/blaketestnode
```

```text
UTC 2026-09-22T16:36:24.884827+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND rustc -Vv; cargo -V; node -v; uname -a
rustc 1.98.1 (48a229cea 2026-09-01)
host: x86_64-unknown-linux-gnu
LLVM version: 22.1.8
cargo 1.98.1 (797e8a9bc 2026-08-05)
v22.23.1
Linux agentbox 7.2.0-1-cachyos #1 SMP PREEMPT_DYNAMIC Thu, 20 Aug 2026 21:06:41 +0000 x86_64 GNU/Linux
EXIT 0
END UTC 2026-09-22T16:36:24.935642+00:00
```
Reference source identities (read-only inspection): spec `2de40bdac4cba01be0864156a553d8287c22e279`, schema `b8cbf6337c7450fe14ddc5bce00c7280059aab5d`, blaketestnode `d2764d21fe1f8c29b1979e49eb8287a72dd2347e`.

```text
UTC 2026-09-22T16:38:48.782912+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND git -C /home/devuser/workspace/agentbox rev-parse HEAD; git -C /home/devuser/workspace/agentbox log -8 --format="%H %s" -- crates/sidestr/sidestr-core; cat ../../audit3/SHA.txt; rg -n "version =" ../../audit3/sidestr/sidestr-core/Cargo.toml; git -C /home/devuser/workspace/sidestr/upstream/spec rev-parse HEAD; git -C /home/devuser/workspace/sidestr/upstream/schema rev-parse HEAD; git -C /home/devuser/workspace/sidestr/upstream/blaketestnode rev-parse HEAD
873d9e0a14f4e5d54a3c735afc27b3e7d833575f
f59f0006728b8d8ab51c1f5c94658b15554dfe40
3:version = "0.2.0"
2de40bdac4cba01be0864156a553d8287c22e279
b8cbf6337c7450fe14ddc5bce00c7280059aab5d
d2764d21fe1f8c29b1979e49eb8287a72dd2347e
EXIT 0
END UTC 2026-09-22T16:38:48.830911+00:00
```

## 1. Required gates — CONFIRMED

Every requested gate exited zero. Regression execution explicitly included ignored tests and reported **10 passed, 0 failed, 0 ignored**. The reference environment was present, so the interop and regression reference branches actually executed. The probe was added after the original core suite; it ran separately, and formatting/clippy were repeated on the final added file. Cargo sometimes emitted a global-cache cleanup permission warning; this did not fail any gate (full logs preserve it).

```text
UTC 2026-09-22T16:42:43.398275+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo fmt --all -- --check
EXIT 0
END UTC 2026-09-22T16:42:43.857490+00:00
```

```text
UTC 2026-09-22T16:42:43.905281+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo clippy -p sidestr-core --all-targets --all-features -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.63s
EXIT 0
END UTC 2026-09-22T16:42:44.605598+00:00
```

```text
UTC 2026-09-22T16:36:39.038596+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo test -p sidestr-core
    Finished `test` profile [unoptimized + debuginfo] target(s) in 7.92s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.70s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.43s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.64s
EXIT 0
END UTC 2026-09-22T16:36:50.812724+00:00
```

```text
UTC 2026-09-22T16:41:02.655415+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo test -p sidestr-core --test audit_regressions -- --include-ignored
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.40s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.78s
EXIT 0
END UTC 2026-09-22T16:41:04.863754+00:00
```

```text
UTC 2026-09-22T16:36:52.940746+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND RUSTDOCFLAGS="-D warnings" cargo doc -p sidestr-core --no-deps
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.92s
   Generated /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit4/doc/sidestr_core/index.html
EXIT 0
END UTC 2026-09-22T16:36:53.885045+00:00
```

```text
UTC 2026-09-22T16:36:53.885269+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo test -p sidestr-core --test interop -- --nocapture
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.31s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s
EXIT 0
END UTC 2026-09-22T16:36:54.473394+00:00
```

```text
UTC 2026-09-22T16:36:54.473753+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo test -p sidestr-wallet -p sidestr-nostr -p sidestr-round
    Finished `test` profile [unoptimized + debuginfo] target(s) in 7.03s
test result: ok. 42 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.56s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.53s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.01s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.68s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.75s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.78s
EXIT 0
END UTC 2026-09-22T16:37:09.347569+00:00
```

## 2. Differential derived records

**CONFIRMED for the requested encoding matrix; DIFFERS for the additional BOM cases.** The probe creates a funded throwaway chain, matures its genesis coin to height 101, signs each candidate at height 102, and presents identical serialized block bytes to `State::add_block` and `Siding.addBlock`. Each candidate starts from the same baseline. One block contains the entire requested matrix; another combines accepted burns with ignored encodings to expose the recorded list instead of merely observing rejection. Individual candidates prevent an early rejection from masking later cases. Full inputs and outputs are retained in `probes/blocks-{input,rust,js}.json`.

The comparison checks exact JSON, including txid, vout, value, script, height, acceptance, error/rule string, and claim membership. For parent transactions the Node oracle runs `parent.mjs scanPegins` against an in-memory RPC fixture; Rust runs `parent::find_pegin`. Both see the same txid, taproot output, value, marker and height. No live RPC is used. Claims compare complete `parseClaims` records and also block application; checkpoints compare `(height,hash)` through `parseCheckpoint` and `parse_checkpoint`. Text records compare returned strings, not only presence. `probes/markers-{input,rust,js}.json` preserve all 101 cases.

| Candidate | Both engines, unless noted |
|---|---|
| Direct push, 34-byte destination | Accept; one identical burn |
| PUSHDATA1, 35-/40-byte destination | Accept; one identical burn each |
| Bare length 87, 40-byte destination | Accept; one identical burn |
| Nonminimal PUSHDATA1, 34-byte destination | Accept; one identical burn |
| `6aff` + 255 bytes starting `pegout:` | Decode payload, decline under `sidestr:rule-pegouts`; no records |
| PUSHDATA2, two pushes, length mismatch | Accept block but ignore the tested marker; no burn |
| 41-byte destination, odd destination hex, wrapped empty `pegout:` | Decline under `sidestr:rule-pegouts`; no records |
| Unwrapped literal bytes `pegout:` | Accept block; no burn |
| All requested forms in one block | Decline under `sidestr:rule-pegouts`; empty list |
| Accepted/ignored mixture | Accept; same five complete burn records |
| Claim direct / PUSHDATA1 | Accept; same parsed claim and committed membership |
| Claim PUSHDATA2 / two pushes / length mismatch | Decline under `btc:rule-blockctx-coinbase-amount` because the positive payout has no recognised claim |
| Checkpoint matrix | All 101 parser results agree, including nulls for unrelated markers |

“Odd hex” above means the hex destination text inside a byte-valid script. Rust's `Script` cannot represent half a byte: malformed outer hex strings are outside this byte-level comparison. There is no claim that every Bitcoin PUSHDATA2 byte string is excluded by the deliberately permissive lexical grammar; the requested concrete encodings were tested.

D1: reproduction and raw results:

```text
UTC 2026-09-22T16:42:09.620996+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo test -p sidestr-core --test audit_independent -- --nocapture
record_script bytes=0 success=true roundtrip=true
record_script bytes=75 success=true roundtrip=true
record_script bytes=76 success=true roundtrip=true
record_script bytes=255 success=true roundtrip=true
record_script bytes=256 success=false roundtrip=false
claim_marker vout=99999 prefix=6a4c4c parsed=1
claim_marker vout=100000 prefix=6a4c4d parsed=0
claim_marker vout=4294967295 prefix=6a4c51 parsed=0
pegout_marker script_bytes=40 prefix=6a4c57 decoded=true parsed=true
pegout_marker script_bytes=125 prefix=6a4c01 decoded=false parsed=false
marker cases compared=101
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 19.64s
EXIT 0
END UTC 2026-09-22T16:42:30.239924+00:00
```
D2: exact output comparison (the probe test completing successfully means the experiment ran, **not** that parity held):

```text
UTC 2026-09-22T16:42:43.287499+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND python ../probes/compare.py
data compared 101 equal 101 different 0 []
pegout compared 101 equal 99 different 2 ['bom-bare', 'bom-p1']
record compared 101 equal 73 different 28 ['peg34-mismatch', 'peg34-two', 'odd-mismatch', 'odd-two', 'empty-mismatch', 'empty-two', 'ff-mismatch', 'peginbom-mismatch', 'peginbom-two', 'claim-mismatch', 'claim-two', 'text-mismatch', 'text-two', 'bomclaim-bare', 'bomclaim-two', 'badbom-bare', 'badbom-mismatch', 'badbom-two', 'newline-mismatch', 'newline-two', 'newlineclaim-mismatch', 'newlineclaim-two', 'text76-bare', 'text76-two', 'text255-mismatch', 'bom-bare', 'bom-mismatch', 'bom-two']
pegin compared 101 equal 99 different 2 ['peginbom-bare', 'peginbom-p1']
claim compared 101 equal 99 different 2 ['bomclaim-bare', 'bomclaim-p1']
ckpt compared 101 equal 101 different 0 []
peg34-bare MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 1 js_records 1 record_lists_equal True rust_claimed False js_claimed False
peg35-p1 MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 1 js_records 1 record_lists_equal True rust_claimed False js_claimed False
peg40-p1 MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 1 js_records 1 record_lists_equal True rust_claimed False js_claimed False
peg40-bare MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 1 js_records 1 record_lists_equal True rust_claimed False js_claimed False
peg34-p1 MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 1 js_records 1 record_lists_equal True rust_claimed False js_claimed False
ff-bare MATCH rust_ok False js_ok False rust_rule block 102 failed: sidestr:rule-pegouts js_rule block 102 failed: sidestr:rule-pegouts rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
peg34-p2 MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
peg34-two MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
peg34-mismatch MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
peg41-p1 MATCH rust_ok False js_ok False rust_rule block 102 failed: sidestr:rule-pegouts js_rule block 102 failed: sidestr:rule-pegouts rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
odd-p1 MATCH rust_ok False js_ok False rust_rule block 102 failed: sidestr:rule-pegouts js_rule block 102 failed: sidestr:rule-pegouts rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
empty-bare MATCH rust_ok False js_ok False rust_rule block 102 failed: sidestr:rule-pegouts js_rule block 102 failed: sidestr:rule-pegouts rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
bare-text MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
bom-bare DIFF rust_ok True js_ok True rust_rule None js_rule None rust_records 0 js_records 1 record_lists_equal False rust_claimed False js_claimed False
badbom-bare DIFF rust_ok True js_ok False rust_rule None js_rule block 102 failed: sidestr:rule-pegouts rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
newline-bare MATCH rust_ok False js_ok False rust_rule block 102 failed: sidestr:rule-pegouts js_rule block 102 failed: sidestr:rule-pegouts rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
all MATCH rust_ok False js_ok False rust_rule block 102 failed: sidestr:rule-pegouts js_rule block 102 failed: sidestr:rule-pegouts rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
accepted-mix MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 5 js_records 5 record_lists_equal True rust_claimed False js_claimed False
claim-bare MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed True js_claimed True
claim-p1 MATCH rust_ok True js_ok True rust_rule None js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed True js_claimed True
claim-p2 MATCH rust_ok False js_ok False rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule block 102 failed: btc:rule-blockctx-coinbase-amount rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
claim-mismatch MATCH rust_ok False js_ok False rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule block 102 failed: btc:rule-blockctx-coinbase-amount rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
claim-two MATCH rust_ok False js_ok False rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule block 102 failed: btc:rule-blockctx-coinbase-amount rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
bomclaim-bare DIFF rust_ok False js_ok True rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed True
bomclaim-p1 DIFF rust_ok False js_ok True rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule None rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed True
bomclaim-p2 MATCH rust_ok False js_ok False rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule block 102 failed: btc:rule-blockctx-coinbase-amount rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
bomclaim-mismatch MATCH rust_ok False js_ok False rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule block 102 failed: btc:rule-blockctx-coinbase-amount rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
bomclaim-two MATCH rust_ok False js_ok False rust_rule block 102 failed: btc:rule-blockctx-coinbase-amount js_rule block 102 failed: btc:rule-blockctx-coinbase-amount rust_records 0 js_records 0 record_lists_equal True rust_claimed False js_claimed False
Exact JSON comparisons complete; expected differences retained, not treated as passing parity.
EXIT 0
END UTC 2026-09-22T16:42:43.350551+00:00
```
D3: selected raw derived records, including every field of the accepted mixed block:

```text
UTC 2026-09-22T16:46:46.595085+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND python ../probes/evidence.py
blocks rust {"name":"bom-bare","ok":true,"error":null,"pegouts":[],"claimed":false}
blocks rust {"name":"badbom-bare","ok":true,"error":null,"pegouts":[],"claimed":false}
blocks rust {"name":"accepted-mix","ok":true,"error":null,"pegouts":[{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":0,"value":20000,"script":"abababababababababababababababababababababababababababababababababab","height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":1,"value":20000,"script":"ababababababababababababababababababababababababababababababababababab","height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":2,"value":20000,"script":"abababababababababababababababababababababababababababababababababababababababab","height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":3,"value":20000,"script":"abababababababababababababababababababababababababababababababababababababababab","height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":4,"value":20000,"script":"abababababababababababababababababababababababababababababababababab","height":102}],"claimed":false}
blocks rust {"name":"bomclaim-bare","ok":false,"error":"block 102 failed: btc:rule-blockctx-coinbase-amount","pegouts":[],"claimed":false}
blocks js {"name":"bom-bare","ok":true,"error":null,"pegouts":[{"txid":"82efb5e24a4c8c9be5ff193f7c9857cb64c49c1ab28ed006e4dc56a58c4fb3ce","vout":0,"script":"abcd","value":20000,"height":102}],"claimed":false}
blocks js {"name":"badbom-bare","ok":false,"error":"block 102 failed: sidestr:rule-pegouts","pegouts":[],"claimed":false}
blocks js {"name":"accepted-mix","ok":true,"error":null,"pegouts":[{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":0,"script":"abababababababababababababababababababababababababababababababababab","value":20000,"height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":1,"script":"ababababababababababababababababababababababababababababababababababab","value":20000,"height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":2,"script":"abababababababababababababababababababababababababababababababababababababababab","value":20000,"height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":3,"script":"abababababababababababababababababababababababababababababababababababababababab","value":20000,"height":102},{"txid":"907d4aa83987a924c5453803e342eaef867cd30991f7a0cd2732c68b1cdea055","vout":4,"script":"abababababababababababababababababababababababababababababababababab","value":20000,"height":102}],"claimed":false}
blocks js {"name":"bomclaim-bare","ok":true,"error":null,"pegouts":[],"claimed":true}
markers rust {"name":"peginbom-bare","data":"706567696e3a736964657374723a696e646570656e64656e743aefbbbf61626364","pegout":null,"record":"pegin:sidestr:independent:\ufeffabcd","pegin":[{"txid":"ba5592925212d16e00c07f4fc4fe419135d63eaef6077eb54d1811efaa116f5e","vout":0,"amount":100000,"script":"efbbbf61626364","height":42,"parentAddress":null}],"claim":{"claims":[],"errors":[]},"ckpt":null}
markers rust {"name":"text-mismatch","data":null,"pegout":null,"record":null,"pegin":[],"claim":{"claims":[],"errors":[]},"ckpt":null}
markers rust {"name":"bomclaim-bare","data":"efbbbf636c61696d3a626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262623a30","pegout":null,"record":"\ufeffclaim:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:0","pegin":[],"claim":{"claims":[],"errors":[]},"ckpt":null}
markers js {"name":"peginbom-bare","data":"706567696e3a736964657374723a696e646570656e64656e743aefbbbf61626364","pegout":null,"record":"pegin:sidestr:independent:\ufeffabcd","pegin":[{"txid":"ba5592925212d16e00c07f4fc4fe419135d63eaef6077eb54d1811efaa116f5e","vout":0,"amount":100000,"script":"abcd","height":42,"parentAddress":null}],"claim":{"claims":[],"errors":[]},"ckpt":null}
markers js {"name":"text-mismatch","data":null,"pegout":null,"record":"hello","pegin":[],"claim":{"claims":[],"errors":[]},"ckpt":null}
markers js {"name":"bomclaim-bare","data":"efbbbf636c61696d3a626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262623a30","pegout":null,"record":"claim:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:0","pegin":[],"claim":{"claims":[{"index":1,"txid":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","vout":0,"payout":{"index":0,"value":100000,"scriptPubKey":"5120b327313c8e675fbd0a686d3587a54c0a4747407c3a4840e7db74f4dcdd70532c"}}],"errors":[]},"ckpt":null}
EXIT 0
END UTC 2026-09-22T16:46:46.655204+00:00
```

### F1 — DIFFERS: UTF-8 BOM changes records and consensus (high impact)

Minimal scripts:

```text
valid burn:     6a0eefbbbf7065676f75743a61626364
malformed burn: 6a0fefbbbf7065676f75743a6162636465
```

These are direct pushes of `EF BB BF` followed by `pegout:abcd` and `pegout:abcde`. In D2, `bom-bare` is accepted by both engines, but Rust records no burn and JavaScript records a 20,000-sat burn to `abcd`. `badbom-bare` is accepted by Rust while JavaScript declines `sidestr:rule-pegouts`. The same valid marker parser discrepancy occurs under PUSHDATA1. Full matching block bytes, including funding and signatures, are in `blocks-input.json`; replay using the D1 command.

`TextDecoder` removes an initial UTF-8 BOM. Rust's `from_utf8` / `from_utf8_lossy` preserve it. Consequently `looks_like_pegout` and `parse_pegout` disagree with the reference even after correctly decoding the push. This is a second route to an unpaid burn, plus a block-validity split. This discrepancy is pre-existing in the compared baseline, not introduced by changing the push offset (API source diff receipt).

The same mechanism affects other requested records:

- `bomclaim-bare` and `bomclaim-p1`: `BOM + claim:<64 b characters>:0`; JavaScript accepts and records the claim, Rust declines `btc:rule-blockctx-coinbase-amount` and records none. D1 contains both complete parsed claim lists; D2 contains the block outcomes.
- `peginbom-bare` / `peginbom-p1`: data `pegin:sidestr:independent:` + `EF BB BF` + ASCII `abcd`. Parent scan returns script `abcd` in JavaScript, but `efbbbf61626364` in Rust. Thus the same parent transaction names different sidechain payout scripts.
- `record_text` preserves the BOM while `recordText` drops it, even for a correctly sized canonical push. This difference is not covered by the documented length-check departure.

**Recommended change:** implement the reference's initial-BOM handling at the same text-decoding boundaries: burn recognition, burn parsing, claim parsing, peg-in remainder's hex-form detection, and text records. Preserve the intentionally strict record-length check. Add direct/PUSHDATA1 BOM regression cases covering full derived lists and named rejection rules. Re-run this differential corpus before publishing. Do not indiscriminately strip BOM bytes from binary checkpoint payloads or raw peg-in scripts; match exactly which bytes the reference text-decodes. [D1/D2; `marker.rs` and upstream parsers inspected in review.log.]

### F2 — DIFFERS: record length checking, intentional and documented

Minimal example: `6a0668656c6c6f` declares six bytes but contains `hello` (five). Rust returns null; JavaScript returns `hello`. D1 reports `DIFF "text-mismatch" record: rust=null js="hello"`. The reference's length check is on a commented-out part of a line in `records.mjs`; it can also treat extra push bytes as text. These differences are expected under the departures list. **Recommendation:** retain the stricter Rust check and the explicit departure; distinguish it from the undocumented BOM behavior. [D1, review.log; complete mismatches in markers JSON.]

## 3. Fixed-offset and encoder/decoder consistency review

Search receipts S1/S2 record exact commands and every hit, including non-script indexing and tests. Verdicts below are source review plus the executed boundary/interop checks, not an exhaustive fuzzing claim.

| Site | Verdict |
|---|---|
| `marker.rs:54–67` (`b[2]`, `[2..]`, `0x4c`) | CONFIRMED: branches on PUSHDATA1 before slicing, verifies exact byte count; 101/101 raw payload results agree with JS. |
| `marker.rs:74–95` | CONFIRMED push offsets; DIFFERS intentionally on length, and unexpectedly on BOM text decoding (F1/F2). |
| `marker.rs:106–114` encoder | CONFIRMED canonical direct/PUSHDATA1 for bounded data. `record_script` checks <=255 and round-trips 0/75/76/255; refuses 256. Unchecked callers can exceed its one-byte length (F3). |
| `marker.rs:295–297`; `rules.rs` burn loop | CONFIRMED offset fix: recognition calls `op_return_data`; no direct-push assumption remains here. F1 concerns decoding text after that step. |
| `address.rs:64` | CONFIRMED: `[2..]` follows `witness_version()`, which validates a 2–40-byte direct witness program and total length; PUSHDATA1 is not an alternative encoding of that template. |
| `sighash.rs:248`, `federation.rs:506` | CONFIRMED: `[2..34]` follows `is_p2tr()` checks; fixed taproot template, not generic OP_RETURN parsing. |
| `block.rs:549–567`, `583–592` | CONFIRMED: signet solution reads/writes direct/PUSHDATA1/PUSHDATA2 with explicit offsets; regression probes round-trip payloads 75/76/255/256 and refuse bad lengths/trailing bytes. This is a different grammar from marker records. |
| `block.rs` commitment helpers; `rules.rs:571` | CONFIRMED: fixed 38-byte witness commitment prefix is checked before fixed slices; it is a specified template, not a generic push assumption. |
| `block.rs:733` coinbase height; `rules.rs` height reader | CONFIRMED bounded/minimal height grammar; rejects nonminimal PUSHDATA1 instead of misreading its body. Existing regression tests cover malformed height pushes. |
| `marker.rs:351–356` checkpoint offsets | CONFIRMED: operates on decoded data after prefix stripping and exact 37-byte remainder check; fixed fields are intentional. |
| `document.rs:220` challenge hex offset | CONFIRMED: guarded by `5120` prefix and 68 hex characters. |
| `chain.rs:143` `[1..]` | CONFIRMED irrelevant to scripts: skips genesis in block-index replay. |
| Remaining S1 hits in tests/docs, block-file framing, witness arrays, signature fields and UTXO examples | CONFIRMED not generic script-body extraction; no additional OP_RETURN fixed-offset reader found by the listed searches. |
| `sidestr-wallet/src/pegin.rs:76–79`, `204–208`, `226` | CONFIRMED uses Bitcoin script builder and shared core decoder, no fixed-offset marker reader. DIFFERS on the helper's claimed 255-byte bound for long payment records (F4). |
| `sidestr-wallet/src/burn.rs` | CONFIRMED uses `pegout_marker` and validates with `parse_pegout`; normal destination outputs covered by dependant tests. |

S1/S2 receipts (raw context and full hit list are linked to avoid hiding matching sites):

```text
UTC 2026-09-22T16:40:10.347105+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND rg -n "\\[[0-9]+\\.\\.|\\[[0-9]+\\]|split_at|0x4c|0x4d|OP_PUSHBYTES|push_slice|new_op_return" sidestr-core/src sidestr-wallet/src; sed -n "70,84p;200,223p" sidestr-wallet/src/pegin.rs; sed -n "45,115p" sidestr-core/src/marker.rs; sed -n "535,592p" sidestr-core/src/block.rs; sed -n "58,70p" sidestr-core/src/address.rs
EXIT 0
END UTC 2026-09-22T16:40:10.396555+00:00
```
[Full raw output: sites.log](probes/sites.log).

```text
UTC 2026-09-22T16:42:10.737275+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND sed -n "480,511p" sidestr-core/src/federation.rs; sed -n "195,217p;242,251p" sidestr-core/src/sighash.rs; sed -n "550,575p" sidestr-core/src/rules.rs; sed -n "718,750p" sidestr-core/src/block.rs; sed -n "168,198p" /home/devuser/workspace/.cargo/registry/src/*/bitcoin-0.32.102/src/blockdata/script/borrowed.rs; sed -n "245,280p" sidestr-wallet/src/pegin.rs
EXIT 0
END UTC 2026-09-22T16:42:10.765519+00:00
```
[Full raw output: guards.log](probes/guards.log).

### F3 — DIFFERS: unchecked marker encoder domains (pre-existing, lower priority)

D1's `encoder_bounds` reproduces:

```text
claim_marker vout=99999 prefix=6a4c4c parsed=1
claim_marker vout=100000 prefix=6a4c4d parsed=0
claim_marker vout=4294967295 prefix=6a4c51 parsed=0
pegout_marker script_bytes=40 prefix=6a4c57 decoded=true parsed=true
pegout_marker script_bytes=125 prefix=6a4c01 decoded=false parsed=false
```

`claim_marker` takes any u32 but its parser accepts only five decimal digits. `pegout_marker` takes an unchecked string and its internal encoder truncates a 257-byte payload length to one. These are invalid marker-domain inputs rather than disagreement on valid 2–40-byte burns, but callers receive an unusable script without an error. **Recommendation:** document/enforce constructor domains; add checked constructors while retaining current signatures if patch-level API compatibility is required. Keep the reference's five-digit claim grammar unless intentionally coordinating a rule change. [D1; S1; API source comparison.]

### F4 — DIFFERS: wallet encoder can emit a form its reader ignores

Minimal reproduction: call `sidestr_wallet::pegin::pegout_payment_outputs(&"x".repeat(216), &"a".repeat(64), "51", 10000)`, then `marker::parse_pegout_marker` on output 1 with the same chain id. The constructor succeeds but the parser returns none: its 256-byte payload is encoded with PUSHDATA2. The private helper says “at most 255 bytes” but `PushBytesBuf` does not enforce that bound. A parent burn-payment record built with a sufficiently long id is therefore not rediscoverable through the shared marker grammar. **Recommendation:** enforce the actual marker bound (and the parent's 80-byte policy where appropriate) before constructing the script; return an explicit error. This is outside the normal short-id patch regression, but is an executed encoder/decoder inconsistency.

```text
UTC 2026-09-22T16:43:06.933473+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND cargo run --manifest-path ../probes/wallet/Cargo.toml --offline --quiet
chain_id_bytes=15 prefix=6a377065 decoded=true parsed=true
chain_id_bytes=215 prefix=6a4cff70 decoded=true parsed=true
chain_id_bytes=216 prefix=6a4d0001 decoded=false parsed=false
EXIT 0
END UTC 2026-09-22T16:43:09.075600+00:00
```
The JavaScript encoder comparison also exposes its pre-existing 76-byte claim boundary: `claimMarker` at vout 99999 emits bare `4c` and does not parse back, while Rust emits `4c4c` and parses one claim. This is the documented canonical-encoder asymmetry reaching claims. Recommend canonical encoding upstream; preserve Rust decoding parity. The record encoders agree on round trips and the 255-byte bound; pegout encoders differ above 75 payload bytes but both resulting forms parse.

```text
UTC 2026-09-22T16:46:24.103363+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND node ../probes/encoder-oracle.mjs
JS claimMarker vout=0 prefix=6a4863 parsed=1
JS claimMarker vout=9999 prefix=6a4b63 parsed=1
JS claimMarker vout=99999 prefix=6a4c63 parsed=0
JS claimMarker vout=100000 prefix=6a4d63 parsed=0
JS pegoutMarker script_bytes=34 prefix=6a4b70 parsed=true
JS pegoutMarker script_bytes=35 prefix=6a4d70 parsed=true
JS pegoutMarker script_bytes=40 prefix=6a5770 parsed=true
JS recordScript bytes=0 prefix=6a00 roundtrip=true
JS recordScript bytes=75 prefix=6a4b78 roundtrip=true
JS recordScript bytes=76 prefix=6a4c4c roundtrip=true
JS recordScript bytes=255 prefix=6a4cff roundtrip=true
JS recordScript bytes=256 error=a record is at most 255 bytes
EXIT 0
END UTC 2026-09-22T16:46:24.203184+00:00
```

## 4. Version and documentation

**CONFIRMED against the local 0.2.0 baseline:** all-feature rustdoc extraction yields 1,326 public declarations in each version, with no additions/removals. The extraction includes item declarations, fields/variants within declarations, and method signatures. The source comparison independently shows changes confined to documentation, tests, burn recognition and the burn-loop guard; no public signatures changed. `cargo public-api` was unavailable (review.log), so the requested rustdoc route was used. Historical source was copied under `probes/v020`; existing snapshot files were not edited for this comparison. Complete lists: `probes/api020all.txt`, `probes/api021all.txt`; implementation and commands: `probes/api.py`.

```text
UTC 2026-09-22T16:39:24.650804+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND python ../probes/api.py
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.14s
   Generated /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit4/doc/sidestr_core/index.html
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.06s
   Generated /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit4/doc/sidestr_core/index.html
020all public declarations 1326
021all public declarations 1326
REMOVED []
ADDED []
EXIT 0
END UTC 2026-09-22T16:39:28.222649+00:00
```

**CONFIRMED, with wording limits:** README lines 83–86, CHANGELOG 0.2.1, and the departures list accurately describe canonical encoding versus the permissive push decoder and the fixed PUSHDATA1 burn recognition. The byte parser comparison found no mismatch. **DIFFERS if read as a claim of complete record parity:** the new text still omits F1; update after fixing it. Also, the neighbouring 0.2.0 source already uses canonical PUSHDATA1 in `op_return`: the patch's encoder is unchanged. Thus “only the encoder changed” is accurate only as a contrast with JavaScript encoding, not as a description of the 0.2.0→0.2.1 code diff. [API diff; review receipt below.]

```text
UTC 2026-09-22T16:36:49.530771+00:00
SHA f0a251ead08cd7b2d494a3c11cba27349ca179f8 (snapshot label)
COMMAND rg -n '\[2\.\.\]|\[1\.\.\]|b\[2\]|0x4c|0x4d|OP_PUSHBYTES' sidestr-core/src sidestr-wallet/src; cat sidestr-core/CHANGELOG.md; rg -n -A22 -B3 'canon|0.2.1|push|record_text' sidestr-core/README.md; sed -n '19,40p' /home/devuser/workspace/sidestr/upstream/spec/siding/lib/overlay.mjs; sed -n '28,49p' /home/devuser/workspace/sidestr/upstream/spec/siding/lib/parent.mjs; rg -n -A35 'pub fn find_pegin' sidestr-core/src/parent.rs; ls /home/devuser/workspace/sidestr; cargo public-api --version
## 0.2.1 — 2026-09-22
No API change.
83:- Markers are written with a canonical push (`OP_PUSHDATA1` above 75 bytes)
84-  and read exactly as siding's `opReturnData` reads them — a bare length byte
85-  or an `OP_PUSHDATA1` prefix, minimal or not — because that is the burn
86-  rule's grammar and a burn a reference wallet wrote must be paid.
error: no such command: `public-api`
EXIT 101
END UTC 2026-09-22T16:36:49.616218+00:00
```

## Scope and retained evidence

Added test: `sidestr-core/tests/audit_independent.rs`. Scratch harnesses, copied historical source/docs, complete block/marker inputs and both engines' outputs are under `probes/`. Existing author tests and production source were left unedited; no commits or network writes were performed. The Node harness copies each throwaway baseline before calling `addBlock`; reference source stays read-only. Commands and harness source make this review reproducible. Test counts alone must not be read as parity: D2 explicitly preserves the discrepancies.

The tested patch repairs the reported offset defect and all requested gates pass. **Publishing recommendation: HOLD sidestr-core 0.2.1 until F1 is fixed and the identical-block differential cases agree.** [Gate receipts; D1/D2.]
