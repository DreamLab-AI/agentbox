---
title: sidestr-core 0.2.0 and sidestr-header 0.2.0 — independent evidence audit (anti-fox)
date: 2026-09-22
auditor: GPT-6 Astra via the codex CLI (a different model family from the Claude producer, per the build-with-quality EDD anti-fox protocol)
producer: Claude agent (rust-engineer) in the agentbox worktree sidestr-genesis
code under test: bb820d3da698f89a98fcbd83365d6d2f75e9f9bc (the producer's build, pinned locally; not pushed)
method: the auditor re-ran every producer gate, then ran probes the producer had not (26 receipted groups), writing each as an execution receipt (command, raw output, timestamp, SHA). Its first session was cut off by the provider's content filter after the probes were complete; a second, report-only session consolidated the receipts into this document without running new probes. The lead re-ran both probe files with --include-ignored at 2026-09-22T14:20Z on the same SHA and reproduced the five counter-examples.
probe tests: crates/sidestr/sidestr-core/tests/audit_regressions.rs and crates/sidestr/sidestr-header/tests/audit_regressions.rs (renamed from the auditor's audit_probes.rs / audit_adversarial.rs once the fixes landed; they stay as permanent regressions)
receipt files: the [name.log](name.log) links below refer to the session scratchpad and are not in the repository; the probe tests and this report are the durable record
outcome: five counter-examples (three consensus-critical, two correctness) returned to the producer before commit; see the follow-up note at the end
---

**Independent evidence audit: sidestr release review**

The baseline gates passed. Five adversarial probes produced counter-examples. This report consolidates existing receipts; no probes or cargo commands were run during consolidation. Severity and proposed fixes below are auditor assessments of the recorded behaviour, not additional execution results.

**1. Revision and environment**

Reviewed SHA: `bb820d3da698f89a98fcbd83365d6d2f75e9f9bc`. Scope: `sidestr-core` 0.2.0, `sidestr-header` 0.2.0, and consumers `sidestr-nostr` / `sidestr-wallet` 0.1.0.

[environment.log](environment.log) records 2026-09-22 14:05:41 UTC; rustc 1.98.1 (48a229cea 2026-09-01); cargo 1.98.1 (797e8a9bc 2026-08-05); Node v22.23.1; Linux agentbox 7.2.0-1-cachyos, x86_64 GNU/Linux, kernel build dated 2026-08-20. The initial git status printed no changes. [unchanged.log](unchanged.log) later lists the two audit probe files as untracked.

Cargo receipts use `CARGO_TARGET_DIR=/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit`. Upstream revisions recorded in `unchanged.log`: spec `2de40bdac4cba01be0864156a553d8287c22e279`, schema `b8cbf6337c7450fe14ddc5bce00c7280059aab5d`, blaketestnode `d2764d21fe1f8c29b1979e49eb8287a72dd2347e`.

Each cited execution log has a same-stem JSON receipt containing command, timestamp, SHA, exit status and output. The lead's 2026-09-22T14:20Z rerun on this SHA is user-supplied evidence: with `--include-ignored`, core had 5 passes / 2 failures and header had 5 passes / 3 failures. The quotations below come from the earlier stored receipts, not an invented log for that rerun.

**2. Expectation groups**

| Expectation group | Verdict and recorded evidence |
|---|---|
| Gate: fmt | CONFIRMED — `cargo fmt --all -- --check` exited 0. [fmt.log](fmt.log), [fmt.json](fmt.json). |
| Gate: clippy | CONFIRMED — workspace/all-targets with `-D warnings` exited 0; final audit probe clippy also exited 0. [clippy.log](clippy.log), [final_probe_quality.log](final_probe_quality.log). |
| Gate: workspace tests | CONFIRMED — baseline workspace tests and doctests passed; this predates the adversarial probes and does not establish their success. [workspace.log](workspace.log). |
| Gate: doc | CONFIRMED — `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps` exited 0. [doc.log](doc.log). |
| Gate: features | CONFIRMED — core tests with `rpc,consensus-oracle` passed. [features.log](features.log). |
| Gate: no_std | CONFIRMED — header `--no-default-features` build passed on the recorded host. [nostd.log](nostd.log). |
| Gate: live replay | CONFIRMED — explicitly enabled live test replayed siding through height 229 and melchain through height 528 to their then-announced hashes. [live.log](live.log). |
| Gate: interop | CONFIRMED — explicitly configured Rust/JS reciprocal block acceptance test passed. [interop.log](interop.log), [interop.json](interop.json). |
| Gate: parent live | CONFIRMED — parent RPC test found 0.001 tBTC funding at height 153511, nine confirmations at tip 153519; scanned 20 blocks with no dreamlab peg-in markers. [parent_live.log](parent_live.log). |
| HeaderFamily convergence | COUNTER-EXAMPLE — baseline stock/v2 vectors and generic chain tests passed, but core Stock accepts bit 31 while header Stock decode rejects it; typed v2 genesis bypasses family rules. [workspace.log](workspace.log), [stock_bit31.log](stock_bit31.log), [v2_genesis.log](v2_genesis.log). |
| V2 edge headers versus JS | CONFIRMED — 28 combinations of fill 0/255, flags 0/1/2/3/4/7/255 and wire time 0/u32::MAX matched encoding, hash, signed prefix, block data and effective time; cleared bit 31 was rejected by decode and family rules. [oracle.log](oracle.log), [all_rules.log](all_rules.log). |
| Family/document mismatch | CONFIRMED — Stock with txbt4 and Blake2bV2 with tbtc4 were refused. [header_probes_retry.log](header_probes_retry.log), [all_rules.log](all_rules.log). |
| BLAKE2b replay with all rules | CONFIRMED — later saved mirrors reached siding 229 (`0c481897504e050652e66540d8fa4da4f702d9b49f65cc9e40bbd88b737d75e6`) and melchain 580 (`61141df9b38853241e86fd61ac03a2b192a8a5e7672830367d710ee5bccee9dd`); each of 31 evaluated rule names passed at every post-genesis height, and timewarp skipped every height. Genesis was explicitly trusted by hash. [fetch.log](fetch.log), [all_rules.log](all_rules.log). |
| Mid-chain mutations | CONFIRMED — height-133 witness, coinbase, time, previous-link and bit-31 mutations were refused with height retained at 132; reordering 134 before 133 and truncating the final byte were refused. Fresh mirror bytes included the exact fixture prefix used. [all_rules.log](all_rules.log), [live_prefix.log](live_prefix.log). |
| Replay record framing | COUNTER-EXAMPLE — changed binary height/size fields were accepted with the JSON index unchanged. [framing.log](framing.log). |
| Genesis solution validation | COUNTER-EXAMPLE — matching document hash allowed an unsigned federated genesis into state. [core_negative.log](core_negative.log). |
| Federation negative cases and identity | CONFIRMED — duplicate signature use, wrong internal key, wrong leaf hash, duplicate signers, zero/excess threshold, 17 signers and wrong challenge were refused; valid signer subsets shared template identity but produced different sealed hashes. Fresh JS federation output matched fixtures. [core_probes.log](core_probes.log), [fedcheck_retry.json](fedcheck_retry.json), [oracle.log](oracle.log). |
| Differential/parity checks | CONFIRMED — 161 consensus differential cases agreed, with two documented narrowings; federation tests, threshold subsets and both output-key parities passed. This is bounded agreement, not universal equivalence. [differential.log](differential.log). |
| Signed-prefix/template boundary | CONFIRMED — six nonce/extension mutations preserved signature validity; only ordinary nonce preserved template identity; added coinbase metadata invalidated the original signature. [all_rules.log](all_rules.log). |
| Witness decode and push boundaries | CONFIRMED — malformed/truncated/noncanonical witness inputs were refused; payload sizes 75, 76, 255 and 256 round-tripped; overclaimed lengths and trailing garbage were refused. [core_probes.log](core_probes.log). |
| Random-bytes no-panic scan | CONFIRMED — `witness_random_bytes_do_not_panic` passed its configured 4,096 cases, lengths 0–2,047, and checked re-encoding of accepted inputs; recorded scan found no panic markers in the selected passing logs. [core_probes.log](core_probes.log), [panic_scan.json](panic_scan.json). |
| Parent-view inputs and parent oracle | COUNTER-EXAMPLE — max-height confirmation arithmetic panicked. Other inputs passed: one-sat discovery, non-OP_RETURN/wrong-chain refusal, first-marker selection, network-specific addresses, nonstandard pegout refusal and oversized checkpoint refusal. JS agreed on recorded discovery cases; it accepted duplicate-key federation documents and malformed record text that Rust refused. [core_probes.log](core_probes.log), [core_negative.log](core_negative.log), [parent_oracle.log](parent_oracle.log). |
| Consumers | CONFIRMED — nostr and wallet tests/doctests passed against core 0.2.0, including their recorded oracle cases. [consumers.log](consumers.log). |
| Docs: shape_docs | CONFIRMED — receipt records the module/SPEC/source mapping and public API declarations; rustdoc passed. This confirms the documented shape, not every behavioural claim; the stock bit-31 refusal claim is contradicted on core paths above. [shape_docs.log](shape_docs.log), [doc.log](doc.log), [stock_bit31.log](stock_bit31.log). |
| Docs: departures | CONFIRMED — unsupported assets/pool/evm overlays refused; malformed record text refused where JS returned text; rejected claim candidate left no claim record, valid retry committed it; identical production inputs yielded identical blocks. [departures_retry.log](departures_retry.log), [parent_oracle.log](parent_oracle.log), [sources.log](sources.log). |
| Docs: unchanged | CONFIRMED — immediate-parent diff shows no consumer source or legacy vector/stock-header test changes; consumer manifests only raise core dependency 0.1 to 0.2. Earlier broader historical diff is not the release-parent comparison. [unchanged.log](unchanged.log), [unchanged.json](unchanged.json). |
| Docs: source_consumers | CONFIRMED — recorded consumers use core APIs; wallet `from_state` takes the stock `State` alias and spend signs standard BIP341 SIGHASH_DEFAULT. This does not demonstrate a generic v2 wallet state adapter. [source_consumers.log](source_consumers.log), [consumers.log](consumers.log). |

Initial `header_probes.log` and `departures.log` failed to compile the evolving probe code; their retries passed. `fedcheck.log` failed because the template path did not exist; `fedcheck_retry.json` records success with the saved template and `oracle.log` records fixture equality. These are setup failures, not additional crate counter-examples. Cargo's cache-clean permission warnings did not prevent the successful commands.

**3. Five counter-examples**

1. `genesis_without_solution_must_not_validate` — `sidestr-core/tests/audit_probes.rs`.

   Expected: reject a federated genesis without a solution, even when its hash matches the document. Recorded: `unsigned genesis solution=None` and `unsigned genesis with matching document hash: Ok((0, 1))`. [core_negative.log](core_negative.log).

   Severity: **consensus-critical** — the state constructor admitted an unsigned genesis and populated its UTXO state without enforcing the challenge. The receipt's source excerpt also shows an upstream hash-trust shortcut, so this is not evidence of a Rust/JS divergence. Fix proposed: validate genesis structure and solution before applying its transactions; expose any required trusted-checkpoint import as an explicit separate API.

2. `parent_confirmation_arithmetic_must_not_panic` — `sidestr-core/tests/audit_probes.rs`.

   Expected: `claimable` handles parent tip and peg-in height `u32::MAX`, with six required confirmations, without panic. Recorded: `attempt to add with overflow` at `sidestr-core/src/parent.rs:281:21`, followed by `claimable at max height panicked=true`. [core_negative.log](core_negative.log).

   Severity: **correctness** — boundary input crashes confirmation selection in the tested debug profile. Fix proposed: widen both additions to `u64` before comparing tip + 1 with height + confirmations, retaining the intended confirmation semantics.

3. `v2_genesis_with_bit31_clear_must_be_refused` — `sidestr-header/tests/audit_adversarial.rs`.

   Expected: typed v2 genesis admission enforces the bit-31 family rule. Recorded: `v2 bit31 clear typed genesis with matching document hash=Ok(0)`. Decode rejected the same header and family rules reported `knots:rule-header-v2-from-fork` false. [v2_genesis.log](v2_genesis.log).

   Severity: **consensus-critical** — typed genesis admission accepts a header that the family's own decoder and validation rule reject. Fix proposed: enforce family invariants in `StateOf::from_genesis` before state mutation, including for already-typed headers.

4. `stock_bit31_must_be_refused_in_decode_rules_and_replay` — `sidestr-header/tests/audit_adversarial.rs`.

   Expected: core/header stock paths refuse bit 31 at decode, typed validation, apply and replay. Recorded: `bit31=1 core::Stock decode=true header::Stock decode=Err(Encoding("stock header: stock header version has bit 31 set"))`, `header::Stock typed header family rules: []`, and `core replay: Ok(1)`. [stock_bit31.log](stock_bit31.log). JS replay instead printed `Error: header 1 failed: btc:rule-header-version`. [stock_js.log](stock_js.log).

   Severity: **consensus-critical** — Rust accepted and replayed a post-genesis block rejected by the JS kernel's header-version rule. Fix proposed: enforce stock bit-31 refusal in core header/block decoding and both stock family rule implementations, so typed apply cannot bypass it.

5. `replay_must_check_dat_record_framing` — `sidestr-header/tests/audit_adversarial.rs`.

   Expected: replay refuses binary framing inconsistent with the index. Recorded: `record133 dat height=999 size=0; JSON index unchanged; replay=Ok(228)`. [framing.log](framing.log).

   Severity: **correctness** — replay accepts a corrupt record wrapper while reading its payload through the separate index; the receipt does not demonstrate acceptance of invalid block payloads. Fix proposed: read and validate each eight-byte height/size prefix against its index entry, with checked offsets and file bounds, before decoding the payload.

**4. Probes that ran and found no additional counter-example**

In `sidestr-core/tests/audit_probes.rs`:

- `new_federation_negative_cases_and_identity`
- `malformed_witness_and_push_boundaries`
- `witness_random_bytes_do_not_panic`
- `parent_view_adversarial_inputs`
- `departures_execute_at_the_boundary`

The first four passed in [core_probes.log](core_probes.log); the fifth passed in [departures_retry.log](departures_retry.log). All five also passed in the lead's reported rerun.

In `sidestr-header/tests/audit_adversarial.rs`, all five passed in [all_rules.log](all_rules.log) and the lead's reported rerun:

- `v2_js_edge_headers`
- `document_family_mismatch`
- `mid_chain_mutations`
- `saved_live_mirrors_all_rule_counts`
- `signed_prefix_and_template_metadata_boundary`

Additional named differential/property probes passed in [differential.log](differential.log): `core_and_this_crate_agree_on_every_subset_and_malformation`, `a_subset_seals_exactly_when_it_has_k_members`, and `both_output_key_parities_occur_and_verify`.

**5. Untested or unverified scope**

- Full genesis rule validation is UNVERIFIABLE from the successful live runs: their genesis was trusted by hash. The dedicated negative probes instead demonstrate the two genesis counter-examples.
- Active timewarp behaviour is UNVERIFIABLE from these mirrors because that rule skipped every recorded post-genesis block. RDTS activation was not exercised; the source receipt documents `rdtsExpiryTime=0` and omission of that inactive overlay rule.
- Complete parent peg-in/claim/payout execution on the live parent is UNVERIFIABLE from `parent_live.log`: it found funding but no matching peg-in markers in the 20-block scan. Synthetic parent and claim cases were tested separately.
- Exhaustive fuzzing, every feature combination, non-host no_std targets, release-profile overflow behaviour, and performance/resource limits have no execution receipts in this evidence set. The bounded random witness scan and selected feature/host builds do not establish those properties.
- The unchanged consumer tests do not establish a generic BLAKE2b wallet state integration; `source_consumers.log` records the stock-only `from_state` signature.
- No remaining supplied expectation group is wholly untested. No new verification was attempted during this report-only consolidation, as requested.

---

# Part 2 — re-audit of the fixes (same auditor, 2026-09-22 15:13Z, code under test 18b150a2f0d04c6c98a6af7ec3212d701423c6cc)

The producer fixed the five counter-examples (a second Claude agent; the first had gone idle). The auditor re-ran the regressions and every gate, reviewed each fix at its layer, wrote one independent probe per fix, and inspected every arithmetic site in the parent and state modules. Verdict: the five are fixed; one additional pre-existing overflow (F1) and a test-portability defect block the release until closed. Receipt links refer to the session scratchpad (audit2/).

Independent evidence audit — sidestr 0.2.0 fix verification

Reviewed SHA: `18b150a2f0d04c6c98a6af7ec3212d701423c6cc`. Baseline: `bb820d3da698f89a98fcbd83365d6d2f75e9f9bc`. Audit date: 2026-09-22 UTC. Every receipt below records this reviewed SHA, command, UTC start time, exit status and raw output. Times are execution times, not producer claims.

Environment: rustc 1.98.1 (48a229cea 2026-09-01), cargo 1.98.1 (797e8a9bc 2026-08-05), Node v22.23.1; Linux agentbox 7.2.0-1-cachyos, x86_64. Working directory: `/home/devuser/workspace/project/agentbox/.claude/worktrees/sidestr-genesis/crates/sidestr`.

All Cargo executions used `CARGO_TARGET_DIR=/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit`; the harness set `TMPDIR=/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/audit2/tmp`. Upstream revisions: spec `2de40bdac4cba01be0864156a553d8287c22e279`, schema `b8cbf6337c7450fe14ddc5bce00c7280059aab5d`, blaketestnode `d2764d21fe1f8c29b1979e49eb8287a72dd2347e`. Receipts: [environment.log](environment.log), [environment.json](environment.json); 2026-09-22T15:13:47.776702+00:00; exit 0; [upstream_and_unchanged.log](upstream_and_unchanged.log), [upstream_and_unchanged.json](upstream_and_unchanged.json); 2026-09-22T15:16:05.807777+00:00; exit 0. Initial and final recorded git status were empty; `git diff --exit-code` succeeded. No tracked files were edited, no commits or publishing occurred, and no network writes were requested. The supplied regression tests themselves write to their hardcoded older `scratchpad/audit` location; auditor-authored probes and reports are under `audit2`. This is a limitation of compliance with the requested scratch-only boundary, not a claim that those test writes stayed under `audit2`.

**1. Former counter-examples — CONFIRMED**

All five named tests have `#[test]` and no `#[ignore]`:

| Former counter-example | Test location | Observed result |
|---|---|---|
| Unsigned genesis accepted by hash | `sidestr-core/tests/audit_regressions.rs:289`, `genesis_without_solution_must_not_validate` | `Rejected` at height 0 including `sidestr:rule-block-signature` |
| Parent max-height overflow | same file, line 274, `parent_confirmation_arithmetic_must_not_panic` | `claimable at max height panicked=false` |
| Typed v2 genesis bypass | `sidestr-header/tests/audit_regressions.rs:329`, `v2_genesis_with_bit31_clear_must_be_refused` | `Rejected` at height 0 including `knots:rule-header-v2-from-fork` |
| Stock bit 31 accepted | same file, line 71, `stock_bit31_must_be_refused_in_decode_rules_and_replay` | Decode and replay return `Encoding`; typed apply names `btc:rule-header-version` |
| Corrupt binary framing accepted | same file, line 209, `replay_must_check_dat_record_framing` | `BlockFile("record at offset 55544 is height 999 size 0; the index entry says height 133 size 673")` |

Exact requested command: `cargo test -p sidestr-core -p sidestr-header --test audit_regressions -- --include-ignored`.

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Receipt: [regressions.log](regressions.log), [regressions.json](regressions.json); 2026-09-22T15:13:47.869502+00:00; exit 0. A second execution with `--nocapture` supplies the named refusals above: [regressions_verbose.log](regressions_verbose.log), [regressions_verbose.json](regressions_verbose.json); 2026-09-22T15:16:29.632204+00:00; exit 0. Source/test-attribute inspection: [source_review.log](source_review.log), [source_review.json](source_review.json); 2026-09-22T15:15:46.998598+00:00; exit 0.

Reproducibility limit: header regression tests read `headers.json`, `siding/` and `melchain/` from a hardcoded absolute path in the previous audit scratch directory (`scratch()`, lines 12–13; reads at 31 and 229). Those files existed here. These passes do not establish a self-contained clean-checkout test suite; a checkout without that external data reaches `read(...).unwrap()` failures. The stock/framing tests also write through that hardcoded path. This dependency was introduced with the newly tracked regression file.

**2. Fix layers and complete arithmetic inspection**

- **(a) CONFIRMED.** `state.rs:251–290` constructs an empty validated state, judges height 0, appends `sidestr:rule-genesis-document`, rejects failed rules, and only then compares the expected/document hash and populates state. The document rule compares signed block data against the document-derived genesis and compares compact bits. `judge` supplies the peg sum through `Overlay.genesis_subsidy`; `rules.rs:689–710` allows that subsidy only at height 0. Exact document matching supplies the equality constraint that the coinbase upper-bound rule alone cannot provide. The independent underpayment check below fails only the document rule, despite a matching hash pin. This belongs in state admission plus the generic context rules.
- **(b) CONFIRMED.** `judge(0, ...)` uses `checked_sub(1)` for the absent previous header and an empty, bounded MTP window. `validate_header` always appends `family.header_rules(header, ctx.height)`. Thus already-typed genesis admission uses the generic family rules. The original clear-bit-31 test and the independent reserved-flag check both name the relevant Knots rule at height 0.
- **(c) CONFIRMED.** `HeaderFamily::version_number` is required, without a default. Core stock reports the underlying `i32` as `i64`; header stock casts its wire `u32` through `i32`; v2 reports unsigned `u32` as `i64`. The version rule compares that number with the minimum. Core `Stock::decode_header` and the crate's `SidestrBlock for bitcoin::Block::decode` call the bit-31 check; header stock already rejects it in its codec. This covers byte admission and typed validation. It does not change the upstream rust-bitcoin crate's general-purpose `deserialize` API.
- **(d) CONFIRMED.** `blockfile::read_block`, lines 134–168, checks `offset + 8 + size` with chained `checked_add`, checks the file length before allocation, reads both prefix fields, and returns `Error::BlockFile` for overflow, out-of-file bounds, or either mismatch. Ordinary filesystem errors still propagate as I/O errors. This belongs at the record reader, so replay inherits it. The independent height-only mutation confirms a correct size cannot hide a wrong height.
- **(e) NOT FIXED for the requested whole-surface claim; the original parent defect is CONFIRMED fixed.** Every arithmetic occurrence in `parent.rs` and `state.rs`, including implicit iterator sums, was inspected. `claimable` widens before both additions; its greatest right-hand sum is `2 * u32::MAX`, safely below `u64::MAX`. An additional unchecked public amount sum remains in `State::fees`, reproduced below.

Arithmetic inventory (production code unless stated):

| Location | Assessment |
|---|---|
| `parent.rs:283` | Both height/confirmation sums widened to `u64`; bounded and safe. |
| `parent.rs:446,451,454` | Base64 capacity/index arithmetic is `usize`; shifts/subtractions operate on indices bounded by three-byte chunks or `0..4`, not untrusted monetary/height arithmetic. |
| `parent.rs:590` | RPC amount multiplication is floating point after the explicit 0–21 million range check; cast is bounded to 2.1e15 sats. |
| `parent.rs:658` | `usize` success count increments at most once per element of the input slice. |
| `parent.rs:832` | `1_790_000_000 + h` is test-fixture code, not a production height operation. |
| `state.rs:328` | `usize len - 1`; public states contain genesis before `tip` is reachable. |
| `state.rs:394,428` | Widened next-height arithmetic; spendability uses saturating subtraction. |
| `state.rs:411–412` | Unchecked input `sum::<Option<u64>>()` and output `sum::<u64>()`; public `fees` does not first validate the transaction. Output sum panic reproduced. |
| `state.rs:487–491` | MTP slicing/subtraction bounded with `min`, `saturating_sub`, `checked_sub`. |
| `state.rs:500–505,585,610,619` | Peg/input totals, fee multiplication and next sighash height use saturating operations; no integer-overflow panic at these operations. |
| `state.rs:587,612` | Output sum follows transaction validation, which checks each amount and a checked total against max money. Fee subtraction follows `out_sum <= in_sum`. |
| `state.rs:642–645` | Next height checked; time increment saturating. |
| `state.rs:648` | Aggregate mempool fees still use unchecked `sum`; inputs have passed mempool admission. No separate reachable overflow reproduction was established for this aggregate. |

Receipts: [source_review.log](source_review.log), [source_review.json](source_review.json); 2026-09-22T15:15:46.998598+00:00; exit 0; [arithmetic_baseline.log](arithmetic_baseline.log), [arithmetic_baseline.json](arithmetic_baseline.json); 2026-09-22T15:17:00.996143+00:00; exit 0. The scan includes `+`, `-`, `*`, checked/saturating calls and `.sum`, rather than treating an operator-only grep as proof.

**JS agreement on the same stock blocks — CONFIRMED**

Both JS executions used `SIDESTR_SIDING=/home/devuser/workspace/sidestr/upstream/spec/siding`, `SCHEMA=/home/devuser/workspace/sidestr/upstream/schema` and `BLAKETESTNODE=/home/devuser/workspace/sidestr/upstream/blaketestnode`.

The original regression's signed block (`0xa0000000`) was read from its generated mirror; the independent signed block (`0x80000001`) was read from `audit2/stock-negative`. Rust named `btc:rule-header-version` on each. For each JS replay:

```text
Error: header 1 failed: btc:rule-header-version
```

Receipts: [js_negative_original.log](js_negative_original.log), [js_negative_original.json](js_negative_original.json); 2026-09-22T15:16:05.717516+00:00; exit 1; [js_negative_new.log](js_negative_new.log), [js_negative_new.json](js_negative_new.json); 2026-09-22T15:16:05.612358+00:00; exit 1. Exit 1 is the expected refusal. Exact commands are in the receipt appendix.

**3. Release gates and replays — CONFIRMED**

Every requested gate exited 0. No introduced runtime regression was observed in these executions.

| Check | Evidence |
|---|---|
| fmt | `cargo fmt --all -- --check`: no output, exit 0 |
| clippy | Workspace/all-targets, warnings denied: `Finished dev profile` |
| workspace tests | All executed test groups report zero failed; live tests remain ignored in this ordinary gate and are explicitly run below |
| rustdoc | Warnings denied; documentation generated for all four crates |
| core optional features | `rpc,consensus-oracle` test run exited 0 |
| header no-default-features | Host build exited 0; not a cross-target claim |
| live replays | siding: height **230**, `1a5451e1470a679da22076dd282c6a2ee12396c27cd0aeedd15af94a4cb0f492`; melchain: height **583**, `23e175cbea0107d1a0f66bb3d4a978e8b9ed98fbfc629864f9993de715c624e3`; announced-tip assertions passed |
| sealed estate | genesis **4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0**, height **17**, tip `2cd5985e35f5c9542983602a4241fcaa7004517ccfddad9f3ea732fa21ce1a70` |
| two-way interop | Environment variables supplied; `rust_and_js_accept_each_others_blocks ... ok`; source asserts both Rust-produced/JS-validated and JS-produced/Rust-validated height/hash results |
| consumers | `sidestr-nostr` and `sidestr-wallet` tests and doctests exited 0 |

Commands, UTC times, exit statuses and selected raw output appear in the receipt appendix. Full logs retain all individual test groups. Cargo emitted cache-clean permission warnings in some successful commands; these did not make the commands fail.

**4. Independent checks — five CONFIRMED; one additional NOT FIXED finding**

The standalone scratch crate depends on the reviewed crates by absolute path. It changes no tracked implementation or test file. Source: [probe/src/main.rs](probe/src/main.rs). Receipt: [independent_final.log](independent_final.log), [independent_final.json](independent_final.json); 2026-09-22T15:17:26.284186+00:00; exit 0.

```text
NEW genesis underpaid by 1 sat: Err(Rejected { height: 0, rules: ["sidestr:rule-genesis-document"] })
NEW v2 bit31 set, reserved flag 0x80: Err(Rejected { height: 0, rules: ["btc:rule-header-pow", "knots:rule-header-flags-reserved"] })
NEW stock version 0x80000001: Err(Rejected { height: 1, rules: ["btc:rule-header-version"] })
NEW record size correct, height wrong: Err(BlockFile("record at offset 0 is height 7 size 3; the index entry says height 8 size 3"))
NEW max confirmations: tip=0 -> 0; tip=MAX -> 1 amount=18446744073709551615
```

The genesis probe signs a 100-sat genesis, then changes the document peg to 101 sats and pins the actual block hash. The original 100-sat document/genesis also successfully constructs the funded state used below. The v2 check retains bit 31 and sets reserved flag `0x80`; its named family-rule failure is asserted independently of its additional PoW failure. The stock check also asserts header and block decoder refusal. The confirmation check uses peg height 0 and `peg_confirmations=u32::MAX`, asserting both rejection at tip 0 and eligibility at tip MAX, with a max-u64 amount copied intact.

**New finding F1 — NOT FIXED: public `State::fees` can panic on untrusted output amounts.**

Reproduction uses a valid state whose genesis has one 100-sat peg. A transaction references that known UTXO and has two outputs with values `u64::MAX` and `1`. `State::fees(&tx)` evaluates the unchecked output sum at `state.rs:412` before `checked_sub` can run:

```text
attempt to add with overflow
NEW FINDING State::fees known 100-sat input, outputs [MAX,1]: panic=true result=Err(Any { .. })
Five independent checks passed; additional overflow counterexample reproduced.
```

The panic is caught solely to keep the audit process running; exit 0 of the probe means the counter-example reproduced, not that overflow handling passed. Expected robustness: refuse/return `None` without panicking. The receipt backtrace identifies `StateOf<Stock>::fees`. The same unchecked sum appears at the baseline SHA, so this is an additional pre-existing defect, **not an introduced regression**. The reproduction is a public API boundary test; it does not demonstrate admission of this invalid transaction through mempool/block validation. Release-profile behavior was not executed.

To reproduce all five checks and F1, use the exact `independent_final` command below, with the shared `CARGO_TARGET_DIR` stated above. Initial `independent.log` records an auditor setup error (missing `txid` in the synthetic peg JSON). `independent_retry.log` records the first successful probe run; `independent_final.log` strengthens F1 to use a known funded input. These are retained, not silently replaced.

**5. Documentation — CONFIRMED for changed behavior; UNVERIFIABLE for the universal genesis claim**

Both crate-level “Where this port departs” lists and both README status sections now describe genesis rule validation, stock bit-31 refusal and record-framing checks consistently with the source and executions. Core README correctly says the original five counter-examples are fixed. It does not establish that every arithmetic boundary is safe.

`sidestr-core/src/lib.rs:157` additionally says “every genesis the reference has produced passes.” These receipts cover the provided fixtures, two live chains and the estate, not every reference-produced genesis. That universal wording is **UNVERIFIABLE** from this evidence. Likewise, calling the tests permanent regressions does not establish their portability while they require the older external scratch data. Source receipt: [source_review.log](source_review.log), [source_review.json](source_review.json); 2026-09-22T15:15:46.998598+00:00; exit 0.

**Overall verdict: 0.2.0 should not ship against the requested complete arithmetic-safety acceptance criterion: the five former counter-examples are fixed and every requested gate passes, but F1 still reproduces a public amount-overflow panic.**

**Execution receipt appendix**

All entries below carry reviewed SHA `18b150a2f0d04c6c98a6af7ec3212d701423c6cc` in their linked JSON. All commands run from the working directory above, with the shared Cargo target and TMPDIR. Output shown is selected verbatim lines; full output is in the corresponding log.

fmt — [fmt.log](fmt.log), [fmt.json](fmt.json); 2026-09-22T15:13:53.161938+00:00; exit 0

```sh
cargo fmt --all -- --check
```

```text
(no output)
```

clippy — [clippy.log](clippy.log), [clippy.json](clippy.json); 2026-09-22T15:13:53.450998+00:00; exit 0

```sh
cargo clippy --workspace --all-targets -- -D warnings
```

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.58s
```

workspace — [workspace.log](workspace.log), [workspace.json](workspace.json); 2026-09-22T15:13:55.114412+00:00; exit 0

```sh
cargo test --workspace
```

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.47s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.72s
```

doc — [doc.log](doc.log), [doc.json](doc.json); 2026-09-22T15:14:05.739794+00:00; exit 0

```sh
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
```

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.79s
   Generated /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/target-audit/doc/sidestr_core/index.html and 3 other files
```

features — [features.log](features.log), [features.json](features.json); 2026-09-22T15:14:07.555206+00:00; exit 0

```sh
cargo test -p sidestr-core --features rpc,consensus-oracle
```

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.70s
```

nostd — [nostd.log](nostd.log), [nostd.json](nostd.json); 2026-09-22T15:14:14.845008+00:00; exit 0

```sh
cargo build -p sidestr-header --no-default-features
```

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.61s
```

live — [live.log](live.log), [live.json](live.json); 2026-09-22T15:14:15.488007+00:00; exit 0

```sh
SIDESTR_LIVE=1 cargo test -p sidestr-header --test core_family -- --ignored --nocapture
```

```text
sidestr:txbt4-siding: replayed 231 blocks to 230 1a5451e1470a679da22076dd282c6a2ee12396c27cd0aeedd15af94a4cb0f492
sidestr:melchain: replayed 584 blocks to 583 23e175cbea0107d1a0f66bb3d4a978e8b9ed98fbfc629864f9993de715c624e3
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 1.93s
```

estate — [estate.log](estate.log), [estate.json](estate.json); 2026-09-22T15:14:19.032774+00:00; exit 0

```sh
cargo run -q --example siding -- replay --chain ../../config/sidechain/dreamlab/chain.json --dir /home/devuser/workspace/sidestr/dreamlab
```

```text
{"genesisHash":"4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0","height":17,"tip":"2cd5985e35f5c9542983602a4241fcaa7004517ccfddad9f3ea732fa21ce1a70","coins":0}
```

interop — [interop.log](interop.log), [interop.json](interop.json); 2026-09-22T15:14:19.393585+00:00; exit 0

```sh
SIDESTR_SIDING=/home/devuser/workspace/sidestr/upstream/spec/siding SCHEMA=/home/devuser/workspace/sidestr/upstream/schema BLAKETESTNODE=/home/devuser/workspace/sidestr/upstream/blaketestnode cargo test -p sidestr-core --test interop -- --nocapture
```

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.32s
```

consumers — [consumers.log](consumers.log), [consumers.json](consumers.json); 2026-09-22T15:14:21.910662+00:00; exit 0

```sh
cargo test -p sidestr-nostr -p sidestr-wallet
```

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.72s
```

independent_final — [independent_final.log](independent_final.log), [independent_final.json](independent_final.json); 2026-09-22T15:17:26.284186+00:00; exit 0

```sh
AUDIT_REPO=/home/devuser/workspace/project/agentbox/.claude/worktrees/sidestr-genesis/crates/sidestr AUDIT_OUT=/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/audit2 cargo run --offline --manifest-path /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/audit2/probe/Cargo.toml
```

```text
NEW genesis underpaid by 1 sat: Err(Rejected { height: 0, rules: ["sidestr:rule-genesis-document"] })
NEW v2 bit31 set, reserved flag 0x80: Err(Rejected { height: 0, rules: ["btc:rule-header-pow", "knots:rule-header-flags-reserved"] })
NEW stock version 0x80000001: Err(Rejected { height: 1, rules: ["btc:rule-header-version"] })
NEW record size correct, height wrong: Err(BlockFile("record at offset 0 is height 7 size 3; the index entry says height 8 size 3"))
NEW max confirmations: tip=0 -> 0; tip=MAX -> 1 amount=18446744073709551615
attempt to add with overflow
NEW FINDING State::fees known 100-sat input, outputs [MAX,1]: panic=true result=Err(Any { .. })
Five independent checks passed; additional overflow counterexample reproduced.
```

js_negative_original — [js_negative_original.log](js_negative_original.log), [js_negative_original.json](js_negative_original.json); 2026-09-22T15:16:05.717516+00:00; exit 1

```sh
SIDESTR_SIDING=/home/devuser/workspace/sidestr/upstream/spec/siding SCHEMA=/home/devuser/workspace/sidestr/upstream/schema BLAKETESTNODE=/home/devuser/workspace/sidestr/upstream/blaketestnode node sidestr-core/tests/xcheck.mjs replay sidestr-core/fixtures/trial/chain.json /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/audit/stock-bit31
```

```text
Error: header 1 failed: btc:rule-header-version
```

js_negative_new — [js_negative_new.log](js_negative_new.log), [js_negative_new.json](js_negative_new.json); 2026-09-22T15:16:05.612358+00:00; exit 1

```sh
SIDESTR_SIDING=/home/devuser/workspace/sidestr/upstream/spec/siding SCHEMA=/home/devuser/workspace/sidestr/upstream/schema BLAKETESTNODE=/home/devuser/workspace/sidestr/upstream/blaketestnode node sidestr-core/tests/xcheck.mjs replay sidestr-core/fixtures/trial/chain.json /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/audit2/stock-negative
```

```text
Error: header 1 failed: btc:rule-header-version
```
