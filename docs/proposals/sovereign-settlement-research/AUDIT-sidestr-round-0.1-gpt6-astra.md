---
title: sidestr-round 0.1.0 — independent evidence audit (anti-fox)
date: 2026-09-22
auditor: GPT-6 Astra via the codex CLI (a different model family from the Claude producer), run against a snapshot of the workspace
producer: Claude agent (rust-engineer) in the agentbox worktree sidestr-genesis
code under test: f59f0006728b8d8ab51c1f5c94658b15554dfe40 (the producer's build, pinned locally; not pushed)
method: the auditor re-ran the gates and the live mixed-engine interop, compared wire bytes and scheduling against round.mjs, and wrote probes under sidestr-round/tests/audit_*.rs (carried into the repository as regressions once fixed). Receipt links refer to the session scratchpad (audit3/probes/).
outcome: gates and interop confirmed; six findings (two safety, three correctness, one docs) returned to the producer before publication; see the follow-up note at the end
---

# sidestr-round 0.1.0 — independent release audit

**Verdict: do not publish this snapshot as documented.** Ordinary gates and mixed-engine interoperability pass, but torn-tail recovery defeats the block journal, peg-out self-proposals bypass `resign_after=None`, and the shipped relay client cannot use the documented WSS URLs. These are failures of the port's own claims, independent of the deferred BFT redesign.

Code SHA: `f59f0006728b8d8ab51c1f5c94658b15554dfe40` (the supplied `SHA.txt`). Reference spec SHA: `2de40bdac4cba01be0864156a553d8287c22e279`. Linux x86_64; rustc 1.98.1; cargo 1.98.1; Node v22.23.1. Audit date: 2026-09-22 UTC. R1 records the environment; R2 verifies **128 original files byte-for-byte against that commit** and zero parent-commit diff in all four published crate directories. Only `tests/audit_*.rs`, `../probes/`, and this requested report were added. No producer code was changed or committed.

All commands ran from the supplied `sidestr` directory with:

```sh
export CARGO_TARGET_DIR=/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit3
export SCHEMA=/home/devuser/workspace/sidestr/upstream/schema
export BLAKETESTNODE=/home/devuser/workspace/sidestr/upstream/blaketestnode
export SIDESTR_SIDING=/home/devuser/workspace/sidestr/upstream/spec/siding
```

Receipts below contain the exact command, UTC interval, code SHA and unedited output lines. Linked logs contain the full stdout/stderr. `python ../probes/run.py NAME 'COMMAND'` is the receipt wrapper; it passes those four variables to the recorded shell command. Findings are witnessed counter-examples or bounded confirmations, not universal safety proofs.

**1. Gates — CONFIRMED (R3–R7).**

- `cargo fmt --all -- --check`: passed, including final audit probes.
- `cargo clippy -p sidestr-round --all-targets --all-features -- -D warnings`: passed.
- `cargo test -p sidestr-round --all-features`: passed: 6 library tests, 1 peg-out interop test, 2 round interop tests, 5 peg-out tests, 6 round tests and 2 doctests. Binary target has no tests.
- `RUSTDOCFLAGS='-D warnings' cargo doc -p sidestr-round --no-deps --all-features`: passed.
- `cargo test -p sidestr-round --all-features --test '*' -- --include-ignored`: passed with the required live-reference environment. Additional verbose interop execution is R10.

Cargo emitted an environment cache-cleaning permission warning; it did not fail a gate. The initial compound gate receipt reports the last command's exit status; test result lines establish both test runs, and fmt/clippy/doc also have separate exit-0 receipts. Later adversarial tests intentionally assert the observed bad behavior, so their green status does **not** mean the release is safe.

**2. Wire and scheduling — CONFIRMED for tested wire bytes and whole-second samples; COUNTER-EXAMPLE to exact timing (R8, R9).**

All five kinds matched tags, content, NIP-01 signed-payload bytes, event ID and zero-aux outer signature. For 23510/23511/23514, the probe executes the actual reference `makeRound`, including JS partial signing and sealing, against the same block/key fixtures. It intercepts I/O and fixes time. For 23512/23513 it executes the actual reference `makePegoutRound` with identical supplied PSBTs through stubbed wallet RPC responses. That establishes envelope equality for the same PSBT, not independent Bitcoin Core PSBT construction/signing.

The entitlement table covers **126 cases**: slots 0–2, heights 1–6, lateness −1, 0, 29, 30, 59, 60, 90 seconds. Rust's actual on-event entitlement branch agrees with the expression extracted from the read-only reference. Actual Rust websocket REQs and reference subscribe behavior use kind-only filters and `since=now−600`; no `#chain` filter. Proposal age 90 seconds is accepted, 91 seconds silently dropped for `propose_after=30,n=3`. Rust retains its pending proposal at elapsed 90 and drops at 91. Re-signing is refused at 29 and 30, allowed at 31.

**C4 — correctness/docs: subsecond timing differs.** Reference `mayReSign` becomes true at 30,001 ms; Rust's integer-second API still sees elapsed 30 and refuses. Reference pending-drop occurs at 90,001 ms; Rust needs integer elapsed 91. Reproduce with R8's `node ../probes/wire.mjs` and R9's `audit_round_boundaries_and_validation`. Fix: preserve millisecond timing internally while retaining seconds in event timestamps, or explicitly document second-quantised scheduling rather than exact upstream timing. This is a timing departure, not an event-format mismatch.

**3. Journal hardening — COUNTER-EXAMPLE (R9, R2).**

Clean-file control: construct the block round with a real `FileJournal`, receive a valid proposal, discard returned actions before network publication, drop the round, reload, then offer a different template at the same height with `resign_after=None`. It refuses; both the previous entry and new authorisation reload.

**C1 — safety: a torn tail swallows the next durable vote.** Minimal reproduction: `audit_crash_and_torn_tail` in `tests/audit_round.rs`.

1. Record an earlier height, then append the truncated bytes `{"scope":`.
2. Reopen: `entries()` correctly returns the earlier complete entry and ignores the fragment.
3. Sign height 1. `record()` appends JSON directly after the fragment and returns success after `sync_data`; the returned action is publishable.
4. Drop before publishing and reload. The fragment plus the new record is now one malformed final line; `entries()` silently discards it. Only the earlier height remains.
5. A different height-1 template gets another partial despite `resign_after=None`.

The probe observes `loaded_entries=1 second_partial=1`; the clean control observes `loaded_entries=2 second_partial=0`. Earlier entries survive, but the subsequently acknowledged authorisation does not. Publishing the first returned action before the crash would expose the same loss. Fix: validate/recover the file before allowing appends; truncate only an identified unterminated torn suffix to the last durable record boundary, sync the repair, and fail closed on malformed terminated records. Make creation/directory durability explicit too. Retest append-after-recovery and a second crash. The existing producer test exercises reading a torn tail, not continued append/restart.

**C5 — docs: “if the write fails the signer does not sign” is false.** `audit_journal_failure_still_calls_signer` installs a counting `BlockSigner` and a failing journal. Output: one `sign_partial` invocation, zero Publish actions. Block and peg paths sign before recording. The narrower promise “no signature is returned for publication when record fails” passed. Fix: persist the intent before invoking the custody signer, or narrow the documentation to the publication guarantee. No leaked signature from `LocalKey` was demonstrated by this failure probe.

Default re-signing is intentionally enabled and survives reload only as a timed guard; see item 2 for whole-second parity and its precision limit. Neither a durable journal nor these tests establish anti-rollback, concurrent-writer safety, or BFT finality.

**4. Validation before signing — CONFIRMED in the exercised cases (R9).**

The executed refusal tests reject a consensus-valid zero-fee transaction under local mempool policy; a proposal with the wrong predecessor or non-increasing time; a proposal signed by an outsider; an entitled height-2 proposer while the receiver is at tip 0; and a tampered sealed block rejected by core's PoW/signature rules. The logs below carry the reference's outer wording. Deterministic-rule rejection is the declared extra refusal. JS and Rust validator-specific error suffixes are not claimed to be universally identical.

A valid event emitted by actual JS `makeRound` gets a Rust 23511, and core's `verify_partial` accepts its signature. Initial audit-fixture execution failed because the exported genesis had no premine while its block fixture used the shared helper's premine. I corrected only the audit fixture, reran the JS comparison and Rust import, and retained the failed receipt (`final-probes.log`). It is not a producer finding.

**5. Peg-out — mixed CONFIRMED / COUNTER-EXAMPLE / UNVERIFIABLE (R9, R10).**

CONFIRMED: wrong burn amount, additional foreign output, missing marker, and a non-federation `witness_utxo` script are refused. Fee-cap rejection, invalid/absent/misattributed co-signatures, and a different unsigned transaction are also exercised. Valid combined payments verify using core's BIP-342 verifier for the supported `tr(NUMS,multi_a(2,…))` domain; the live test pays burns proposed through JS and Rust rounds.

**C2 — safety: `resign_after=None` does not govern self-proposals.** Minimal reproduction: `audit_never_resign_restart_self_proposal` in `tests/audit_pegout.rs`. Slot 1 proposes a payment for a height-7 burn, writes it to a real file journal and exits. Reload with the same `None` configuration, provide different parent coins, and tick at `T0+90`. A second 23512 for the same burn contains a verifying signature over a different txid with disjoint inputs. These authorisations could support two non-conflicting payments if enough other signers co-sign; the probe does not claim both were broadcast. Cause: `tick` gates only on `propose_after*n`, while `on_proposal` honours `resign_after`. Fix: apply one shared durable burn-authorisation guard to both paths, including transitions from co-signer to proposer; preserve upstream retry behavior only when permitted by the selected policy. Test restart and disjoint-input retries. Default timeout re-signing remains an intentional upstream behavior, not a perpetual “one signature” guarantee.

COUNTER-EXAMPLE to the literal expectation “any extra output is refused” (severity: docs/expectation mismatch; no crate defect): an extra output returning value to the federation is accepted. This matches `pegoutround.mjs` and the function's documented change policy. It is **not a release defect**; clarify the expectation to “extra non-change output” rather than change the compatible policy.

UNVERIFIABLE here: real Bitcoin Core descriptor-wallet interoperability and an independent Core consensus oracle. The live harness's `CoreStandIn` uses this same crate's PSBT funding/signing/finalisation and core verifier. JS controls the round but its wallet RPCs are Rust-backed. Actual parent UTXO ownership is also not proved by validating self-described PSBT `witness_utxo` fields alone. No real parent node was used or paid.

**6. cosign node — source-confirmed boundaries, plus COUNTER-EXAMPLES (R2, R9).**

Source review: block/peg custody signing is reached through the rounds; parent `sendrawtransaction` is handled only for `PegoutAction::Broadcast`. The node **does** sign kind-33333 tip announcements outside a round decision. It also directly locks/unlocks parent outputs in `peg_tick`, based on scanned peg-ins and the chain's claimed set, with no corresponding round action. Those are upstream-style node policies; there is no general “all side effects require a state-machine decision” boundary. No BFT decision certificate exists or is expected in this port.

**C3 — correctness: WSS is unavailable in the shipped feature graph.** `audit_wss_support` connects the configured dependency to a local TCP listener using `wss://`. Even under `--all-features`, it returns `URL error: TLS support not compiled in`. `tokio-tungstenite` has no TLS feature enabled. Thus the README's public WSS relay examples cannot operate. Fix: enable a maintained TLS backend with a root store under the relay feature, then test a successful local TLS websocket handshake and relay exchange. No public-relay write was made for this probe.

**C6 — correctness: the HTTP byte surface is not restricted to the accepted chain.** `audit_http_unindexed_block` starts cosign with only genesis, appends a sealed height-1 block directly to its scratch `blocks.dat`, and requests its range. HTTP returns all 505 bytes exactly while `/tip` remains height 0. This requires local file mutation/unindexed tail; it is not evidence that a remote `/tx` or relay request can inject such a block. The raw file is served independently of the chain/index. Fix: serve a chain-owned committed snapshot/range bounded by the accepted index, and coordinate file publication with accepted state.

CONFIRMED by source receipt: `/tx` applies `Read::take(...,262_144)` before `read_to_string`, bounding the application's body read to 262,144 bytes. It ignores the read result and does not explicitly reject overlong requests with 413. This is not a proof of bounded total transport buffering or slow-client resistance.

**7. Documentation — CONFIRMED scope; COUNTER-EXAMPLE hardening/runtime details (R2, R8–R10).**

The limits correctly describe upstream availability tolerance rather than Byzantine tolerance, clock/relay dependence, variable sealed hashes, and lack of anti-rollback. The crate explicitly treats 23514 as candidate ingestion and disclaims finality. The tested same-host mixed-round scenarios and the pinned reference commit support the README status; no separate-machine or signer-rotation result is implied.

The declared architectural departures exist: pure state machines, Rust PSBT functions, clamped peg-out lateness, deterministic zero-aux `LocalKey`, deterministic proposal rules, fee cap, and co-signature verification. But the blanket restart protection and `None` promise are defeated by C1/C2; no-sign-on-record-failure is contradicted by C5; exact timing needs qualification (C4); documented WSS operation fails (C3). Real Core compatibility is not established by the included stand-in. Fix those implementations/claims before publishing as “usable now.”

**8. Published-crate consumers — CONFIRMED unchanged source; broader compatibility UNVERIFIABLE (R1, R2).**

The release commit changes the workspace manifest/lock and adds `sidestr-round`; it changes none of `sidestr-core`, `sidestr-header`, `sidestr-nostr`, or `sidestr-wallet`. All original snapshot files match the commit. I found no published-crate source/API regression introduced by this diff. This does not certify every downstream build, MSRV, target or lockfile resolution; the compiler used was 1.98.1.

**Prior review §9 checklist — implementation status, not BFT acceptance criteria for this release (R2, R8, R9).**

| Prior recommendation for `round.mjs` | This port |
|---|---|
| Delete timeout `mayReSign` | No by default; optional `None` for blocks. Peg-out bypass and journal recovery defects remain. |
| Replace clock entitlement with views/leaders | No; clock ring retained intentionally. |
| Replace in-memory signed map with durable safety state | Partial: FileJournal restores authorisations; MemoryJournal deliberately forgets. No BFT locks/views; C1 defeats recovery. |
| Remove proposer-exclusive aggregation | No; proposer pending state collects the partials. |
| Require decision proofs before block signatures | No. |
| Treat `onSealed` as candidate ingestion | Yes; core validator is called, no finality decision. |
| Prefer highest finalised compatible history | No finalised-history protocol exists. |
| Deterministic chain/UTXO validation; mempool policy is not consensus | Partial: deterministic judge first; local mempool refusal is retained as upstream signer policy. |
| Historical certificates and dependency fetch by digest | No certificate/fetch protocol. |
| Authenticated peg-out policy and durable payout state machine | Partial: authenticated events, burn/output/fee checks, signature checks, journal and paid ledger; no consensus-authorised payment intent or durable broadcast outbox; C1/C2 apply. |

**Probes finding no additional failure and limits of evidence.**

Passing observations include wire equality, the 126-case whole-second ring table, actual REQ filters, clean-file block crash/reload protection, proposal/partial/sealed validation, foreign-output/amount/marker/input-script checks, valid supported-domain BIP-342 witnesses, and live same-host availability/rotation/restart behavior. R9 also reruns the producer's assertion-based round and peg-out tests in audit copies to expose their raw log messages. Counter-example tests pass by asserting the defect; their names and raw output identify them.

Not tested: power loss at the filesystem/device layer; directory fsync durability; concurrent journal writers; rollback/cloning; a real Bitcoin Core wallet; independent BIP-342 engine differential testing; public WSS success (backend absent); cross-host partitions, Byzantine safety, reconfiguration, exhaustive event schedules or MSRV. Clean simulated crash tests cannot prove “ever/never” across all failures. Those omissions neither excuse C1/C2 nor turn this deliberately upstream protocol into the separate ADR-2101 BFT design.

**Execution receipts follow.** Each excerpt is selected from the linked raw log without rewriting its lines. The SHA in each receipt denotes the original implementation; added audit tests are the visible probe source, not committed producer code.

**R1 — [environment.log](probes/environment.log)**

```text
UTC_START=2026-09-22T16:30:47.977298+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=date -u; uname -a; rustc -Vv; cargo -V; node --version; git -C /home/devuser/workspace/sidestr/upstream/spec rev-parse HEAD; git -C /home/devuser/workspace/agentbox show --format=fuller --stat f59f0006728b8d8ab51c1f5c94658b15554dfe40 -- crates/sidestr; git -C /home/devuser/workspace/agentbox diff f59f0006728b8d8ab51c1f5c94658b15554dfe40^ f59f0006728b8d8ab51c1f5c94658b15554dfe40 -- crates/sidestr/Cargo.toml
Linux agentbox 7.2.0-1-cachyos #1 SMP PREEMPT_DYNAMIC Thu, 20 Aug 2026 21:06:41 +0000 x86_64 GNU/Linux
rustc 1.98.1 (48a229cea 2026-09-01)
cargo 1.98.1 (797e8a9bc 2026-08-05)
v22.23.1
2de40bdac4cba01be0864156a553d8287c22e279
 crates/sidestr/Cargo.lock                          |  352 ++++++-
 crates/sidestr/Cargo.toml                          |    3 +
 crates/sidestr/sidestr-round/Cargo.toml            |   48 +
 crates/sidestr/sidestr-round/LICENSE               |  661 ++++++++++++
 crates/sidestr/sidestr-round/README.md             |  116 +++
 crates/sidestr/sidestr-round/src/bin/cosign.rs     |  140 +++
 crates/sidestr/sidestr-round/src/chain.rs          |   54 +
 crates/sidestr/sidestr-round/src/error.rs          |   35 +
 crates/sidestr/sidestr-round/src/journal.rs        |  236 +++++
 crates/sidestr/sidestr-round/src/lib.rs            |  173 ++++
 crates/sidestr/sidestr-round/src/node.rs           |  963 ++++++++++++++++++
 crates/sidestr/sidestr-round/src/pegout.rs         | 1056 ++++++++++++++++++++
 crates/sidestr/sidestr-round/src/relay.rs          |  375 +++++++
 crates/sidestr/sidestr-round/src/round.rs          |  799 +++++++++++++++
 crates/sidestr/sidestr-round/src/signer.rs         |  212 ++++
 crates/sidestr/sidestr-round/tests/pegout.rs       |  561 +++++++++++
 crates/sidestr/sidestr-round/tests/round.rs        |  645 ++++++++++++
 crates/sidestr/sidestr-round/tests/support/mod.rs  |  189 ++++
 22 files changed, 7914 insertions(+), 6 deletions(-)
EXIT=0
UTC_END=2026-09-22T16:30:48.046973+00:00
```

**R2 — [source.log](probes/source.log)**

```text
UTC_START=2026-09-22T16:32:29.010788+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=python ../probes/source-audit.py
SNAPSHOT 128 existing tracked files byte-identical to f59f0006728b8d8ab51c1f5c94658b15554dfe40
PUBLISHED_CRATE sidestr-core: zero diff from parent commit
PUBLISHED_CRATE sidestr-header: zero diff from parent commit
PUBLISHED_CRATE sidestr-nostr: zero diff from parent commit
PUBLISHED_CRATE sidestr-wallet: zero diff from parent commit
EXIT=0
UTC_END=2026-09-22T16:32:29.791115+00:00
```

**R3 — [final-fmt.log](probes/final-fmt.log)**

```text
UTC_START=2026-09-22T16:33:48.272631+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=cargo fmt --all -- --check
EXIT=0
UTC_END=2026-09-22T16:33:48.727699+00:00
```

**R4 — [final-clippy.log](probes/final-clippy.log)**

```text
UTC_START=2026-09-22T16:33:48.771158+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=cargo clippy -p sidestr-round --all-targets --all-features -- -D warnings
    Checking sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/audit3/sidestr/sidestr-round)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.71s
EXIT=0
UTC_END=2026-09-22T16:33:49.550547+00:00
```

**R5 — [doc.log](probes/doc.log)**

```text
UTC_START=2026-09-22T16:31:52.992988+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=RUSTDOCFLAGS='-D warnings' cargo doc -p sidestr-round --no-deps --all-features
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.00s
   Generated /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit3/doc/sidestr_round/index.html and 1 other file
EXIT=0
UTC_END=2026-09-22T16:31:55.024618+00:00
```

**R6 — [gates.log](probes/gates.log)**

```text
UTC_START=2026-09-22T16:25:13.899320+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=cargo fmt --all -- --check; cargo clippy -p sidestr-round --all-targets --all-features -- -D warnings; cargo test -p sidestr-round --all-features; RUSTDOCFLAGS='-D warnings' cargo doc -p sidestr-round --no-deps --all-features; cargo test -p sidestr-round --all-features --test '*' -- --include-ignored
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test a_burn_is_paid_by_a_psbt_round_proposed_by_js_and_by_rust ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.68s
test rust_js_js has been running for over 60 seconds
test rust_rust_js has been running for over 60 seconds
test rust_rust_js ... ok
test rust_js_js ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 116.19s
test a_burn_larger_than_one_coin_takes_two_and_change_under_dust_goes_to_the_fee ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.63s
   Doc-tests sidestr_round
test sidestr-round/src/pegout.rs - pegout (line 30) ... ok
test sidestr-round/src/lib.rs - Readme (line 191) ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.47s
test a_burn_larger_than_one_coin_takes_two_and_change_under_dust_goes_to_the_fee ... ok
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.53s
test a_burn_is_paid_by_a_psbt_round_proposed_by_js_and_by_rust ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.62s
test rust_js_js has been running for over 60 seconds
test rust_rust_js has been running for over 60 seconds
test rust_rust_js ... ok
test rust_js_js ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 114.15s
test a_burn_larger_than_one_coin_takes_two_and_change_under_dust_goes_to_the_fee ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.59s
EXIT=0
UTC_END=2026-09-22T16:30:08.902769+00:00
```

**R7 — [export-corrected.log](probes/export-corrected.log)**

```text
UTC_START=2026-09-22T16:32:27.861557+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=cargo test -p sidestr-round --all-features --test audit_round --test audit_pegout audit_export -- --nocapture
AUDIT exported 2 Rust pegout events on identical PSBT fixtures
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.01s
AUDIT exported 3 Rust block events; entitlement cases=126
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.30s
EXIT=0
UTC_END=2026-09-22T16:32:29.281687+00:00
```

**R8 — [wire-final.log](probes/wire-final.log)**

```text
UTC_START=2026-09-22T16:33:49.448443+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=node ../probes/wire.mjs
WIRE kind=23510 tags=true content=true signed_payload_bytes=true id=true zero_aux_signature=true bytes=582
WIRE kind=23511 tags=true content=true signed_payload_bytes=true id=true zero_aux_signature=true bytes=333
WIRE kind=23514 tags=true content=true signed_payload_bytes=true id=true zero_aux_signature=true bytes=1142
ENTITLED slot=2 height=1 lateness=-1 JS=false Rust=false
ENTITLED slot=2 height=1 lateness=0 JS=false Rust=false
ENTITLED slot=2 height=1 lateness=29 JS=false Rust=false
ENTITLED slot=2 height=1 lateness=30 JS=true Rust=true
ENTITLED slot=2 height=1 lateness=59 JS=true Rust=true
ENTITLED slot=2 height=1 lateness=60 JS=true Rust=true
ENTITLED slot=2 height=1 lateness=90 JS=true Rust=true
MAY_RESIGN delta_ms=29000 JS=false Rust_integer_seconds=false
MAY_RESIGN delta_ms=30000 JS=false Rust_integer_seconds=false
MAY_RESIGN delta_ms=30001 JS=true Rust_integer_seconds=false
MAY_RESIGN delta_ms=30999 JS=true Rust_integer_seconds=false
MAY_RESIGN delta_ms=31000 JS=true Rust_integer_seconds=true
SUBSCRIPTION JS since=now-600 kind_only=true
WIRE kind=23512 tags=true content=true signed_payload_bytes=true id=true zero_aux_signature=true bytes=1296
WIRE kind=23513 tags=true content=true signed_payload_bytes=true id=true zero_aux_signature=true bytes=1535
PEG_PSBT_SCOPE identical supplied PSBT; JS wallet RPC stubbed, no independent Bitcoin Core signing claimed
DROP JS elapsed_ms=90000 pending=true
DROP JS elapsed_ms=90001 pending=false; Rust drops at integer delta=91
EXIT=0
UTC_END=2026-09-22T16:33:49.679497+00:00
```

**R9 — [probes-final.log](probes/probes-final.log)**

```text
UTC_START=2026-09-22T16:33:00.649419+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=cargo test -p sidestr-round --all-features --test audit_node --test audit_round --test audit_pegout -- --nocapture
AUDIT WSS connection error=URL error: TLS support not compiled in
AUDIT Rust actual subscription ["REQ","k23510",{"kinds":[23510],"since":1790094182}]
AUDIT Rust actual subscription ["REQ","k23511",{"kinds":[23511],"since":1790094182}]
AUDIT Rust actual subscription ["REQ","k23512",{"kinds":[23512],"since":1790094182}]
AUDIT Rust actual subscription ["REQ","k23513",{"kinds":[23513],"since":1790094182}]
AUDIT Rust actual subscription ["REQ","k23514",{"kinds":[23514],"since":1790094182}]
AUDIT HTTP unindexed sealed h1 served byte-for-byte=505 bytes; /tip height=0; local-file append required
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
AUDIT pegout mutation=missing_marker refusal=Some("does not pay the burn with its marker")
AUDIT pegout mutation=extra_foreign_output refusal=Some("pays something besides the burn and change to the peg")
AUDIT pegout mutation=extra_peg_change refusal=None
AUDIT exported 2 Rust pegout events on identical PSBT fixtures
AUDIT LOG peg-out round: proposal for 0707070707070707… refused: does not pay the burn with its marker
AUDIT LOG peg-out round: proposal for 0707070707070707… refused: pays something besides the burn and change to the peg
AUDIT LOG peg-out round: proposal for 0707070707070707… refused: fee 979000 sats is over this signer's cap of 100000
AUDIT LOG peg-out round: proposal for 0707070707070707… refused: spends something that is not the peg
AUDIT COUNTEREXAMPLE resign_after=None restart same_burn=0707070707070707070707070707070707070707070707070707070707070707:0 first_txid=eb13276672b03205de4ef234b95c795a24bd8c61107659cb12fae1dc3c474369 second_txid=50ee8aee6575f24e6334d9a746b3c031f4d02769dda6568b84368fbe573942a3 disjoint_inputs=true valid_second_signature=true
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
AUDIT valid JS proposal -> Rust 23511 -> core verify_partial=true
AUDIT resign delta=29 partials=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 29 s ago"]
AUDIT journal write failure: BlockSigner::sign_partial calls=1 Publish actions=0
AUDIT resign delta=30 partials=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 30 s ago"]
AUDIT resign delta=31 partials=1 logs=["round: signed h1 cb5d9228b63e… from 4df4d228…"]
AUDIT torn=false loaded_entries=2 second_partial=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago"]
AUDIT replay age=90 partials=1
AUDIT replay age=91 partials=0
AUDIT validation outsider partials=0 logs=["round: proposal h1 from 949e1955… refused: not its turn"]
AUDIT validation tip+2 partials=0 logs=["round: proposal h2 from f047d182… ignored (my tip is 0)"]
AUDIT drop at 90=false at 91=true logs=["round: my proposal h1 got 1 signature(s); dropping it"]
AUDIT torn=true loaded_entries=1 second_partial=1 logs=["round: signed h1 18d2a1b5fb87… from 4df4d228…"]
AUDIT exported 3 Rust block events; entitlement cases=126
AUDIT LOG round: proposal h101 refused: does not build on my tip
AUDIT LOG round: proposal h101 refused: does not build on my tip
AUDIT LOG round: proposal h101 refused: rules btc:rule-blockctx-inputs-available
AUDIT LOG round: proposal h101 refused: tx fe1709e27494… fee 0 is below the minimum 154 sats (154 vB at 1 sat/vB)
AUDIT LOG round: sealed block h101 from f047d182… refused: block 101 failed: btc:rule-header-pow, sidestr:rule-block-signature
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.60s
EXIT=0
UTC_END=2026-09-22T16:33:03.127833+00:00
```

**R10 — [live-verbose.log](probes/live-verbose.log)**

```text
UTC_START=2026-09-22T16:33:25.083263+00:00
SHA=f59f0006728b8d8ab51c1f5c94658b15554dfe40
COMMAND=cargo test -p sidestr-round --all-features --test interop_round --test interop_pegout -- --include-ignored --nocapture
  burn 1 8aae7e8a5ef405e6… proposed by signer 1 (Rust), co-signed by [2, 3]
  burn 2 e68002eb32dbdec9… proposed by signer 2 (JS), co-signed by [3, 1]
=== passed: 2 burns paid by the PSBT round, proposed by JS and by Rust, co-signed across engines, verified under BIP 342
test a_burn_is_paid_by_a_psbt_round_proposed_by_js_and_by_rust ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.64s
test rust_js_js has been running for over 60 seconds
test rust_rust_js has been running for over 60 seconds
  journal: 10 entries over 9 heights, every published signature journalled
=== passed ([Rust, Rust, Js]): 2-of-3 blocks through the round, rotation, mixed sealing both ways, one signer down tolerated, two halts, one back resumes, Rust restart on its journal
test rust_rust_js ... ok
  journal: 12 entries over 9 heights, every published signature journalled
=== passed ([Rust, Js, Js]): 2-of-3 blocks through the round, rotation, mixed sealing both ways, one signer down tolerated, two halts, one back resumes, Rust restart on its journal
test rust_js_js ... ok
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 114.23s
EXIT=0
UTC_END=2026-09-22T16:35:38.346329+00:00
```

Reproduction sources: [block/journal probes](sidestr/sidestr-round/tests/audit_round.rs), [peg-out probes](sidestr/sidestr-round/tests/audit_pegout.rs), [node probes](sidestr/sidestr-round/tests/audit_node.rs), [reference differential probe](probes/wire.mjs), [snapshot/source checks](probes/source-audit.py), [receipt runner](probes/run.py).
