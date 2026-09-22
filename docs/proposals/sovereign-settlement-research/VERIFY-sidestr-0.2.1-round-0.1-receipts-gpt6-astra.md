# Independent verification pass, 2026-09-22 19:03–19:14Z — sidestr-core 0.2.1, sidestr-wallet 0.2.1, sidestr-round 0.1.0

**Provenance.** GPT-6 Astra via the codex CLI, default sandbox, neutral verification-engineering brief, against a `git archive` snapshot of worktree commit `2c4bff693` (the producers' fixes for the two earlier audits). The run was cut off by the model host while writing its findings section; the receipts below are complete and its verdict message is quoted verbatim here.

**Verdict (verbatim):** "The verification results support SHIP for core and wallet within the reviewed scope, and DO NOT SHIP for round because of the journal rollback bug. Strict text-record parity still fails only on the documented F2 case."

**What it did.** Re-ran every gate; wrote one new probe per fix for all nine earlier findings (F1 interior BOM and PUSHDATA1 claim boundary; F3 unicode byte limits; F4 UTF-8 byte counting; C1 every record prefix; C2 restart with changed fee; C3 wrong-hostname certificate; C4 fractional signature time across restart; C5 durable intent observed by the signer; C6 last indexed byte and chunked oversize) — all nine passed; ten adversarial blocks built by the JS engine and replayed in Rust with every derived list compared — one difference, the documented F2 strict record-length departure (`length-mismatch` recorded by the reference, refused here).

**The new finding (round, blocking).** `FileJournal::record` rolled a failed append back to a length cached at open, so with two live handles on one file a second handle's failed append truncated the first handle's four acknowledged intents to zero bytes (receipts `shared-journal-failure`, `shared-journal-normal-records`; probe `verify_journal_rollback.rs`). Fixed the same evening: rollback to the length measured on the file immediately before the write, and an exclusive advisory lock at `open` so a second live handle is refused by name; regression `a_second_live_handle_is_refused_and_rollback_is_measured_not_cached` in `sidestr-round/tests/audit_regressions_round.rs`.

---

# Independent verification — snapshot 2c4bff693

Snapshot provenance is supplied, not authenticated by Git. All cargo commands run from crates/sidestr with CARGO_TARGET_DIR set to the snapshot root/target. Reference environment: SIDESTR_SIDING=/home/devuser/workspace/sidestr/upstream/spec/siding; SCHEMA=/home/devuser/workspace/sidestr/upstream/schema; BLAKETESTNODE=/home/devuser/workspace/sidestr/upstream/blaketestnode. Reference trees are read-only.

## Receipt: fmt

UTC start: 2026-09-22T19:03:15.425773+00:00

Working directory: crates/sidestr

Command: `cargo fmt --all -- --check`

```text

```

Exit: 0; UTC end: 2026-09-22T19:03:15.946719+00:00

## Receipt: clippy

UTC start: 2026-09-22T19:03:15.991476+00:00

Working directory: crates/sidestr

Command: `cargo clippy --workspace --all-targets --all-features -- -D warnings`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling libc v0.2.189
   Compiling shlex v2.0.1
    Checking cfg-if v1.0.5
   Compiling find-msvc-tools v0.1.13
   Compiling proc-macro2 v1.0.107
   Compiling quote v1.0.47
   Compiling unicode-ident v1.0.26
   Compiling version_check v0.9.5
    Checking typenum v1.20.1
    Checking subtle v2.6.1
    Checking zeroize v1.9.0
    Checking untrusted v0.9.0
    Checking once_cell v1.21.4
    Checking log v0.4.34
    Checking bytes v1.12.1
    Checking itoa v1.0.18
   Compiling bitcoin-io v0.1.101
   Compiling httparse v1.10.1
   Compiling rustls v0.23.45
    Checking arrayvec v0.7.8
   Compiling thiserror v2.0.20
    Checking cpufeatures v0.2.17
   Compiling serde_core v1.0.229
   Compiling hex_lit v0.1.1
   Compiling zmij v1.0.23
    Checking base64 v0.23.1
   Compiling bitcoin v0.32.102
    Checking hashbrown v0.17.1
   Compiling serde_json v1.0.151
   Compiling serde v1.0.229
    Checking equivalent v1.0.2
    Checking bitcoin-units v0.1.101
    Checking base64 v0.21.7
    Checking bech32 v0.11.1
    Checking percent-encoding v2.3.2
    Checking memchr v2.8.3
    Checking utf8-zero v0.8.1
    Checking hex v0.4.3
   Compiling getrandom v0.3.4
   Compiling zerocopy v0.8.57
   Compiling getrandom v0.4.3
   Compiling rustix v1.1.5
    Checking bitflags v2.13.2
   Compiling autocfg v1.5.1
    Checking linux-raw-sys v0.12.1
    Checking fastrand v2.5.0
    Checking quick-error v1.2.3
    Checking bit-vec v0.8.0
    Checking fnv v1.0.7
    Checking unarray v0.1.4
    Checking regex-syntax v0.8.11
    Checking utf8parse v0.2.2
    Checking pin-project-lite v0.2.17
   Compiling cc v1.4.7
    Checking colorchoice v1.0.5
    Checking anstyle v1.0.14
    Checking is_terminal_polyfill v1.70.2
    Checking anstyle-query v1.1.5
    Checking data-encoding v2.11.1
    Checking futures-core v0.3.34
   Compiling heck v0.5.0
    Checking strsim v0.11.1
    Checking futures-sink v0.3.34
    Checking futures-task v0.3.34
    Checking slab v0.4.12
    Checking clap_lex v1.1.1
    Checking utf-8 v0.7.6
    Checking chunked_transfer v1.5.0
    Checking ascii v1.1.0
    Checking time-core v0.1.9
    Checking httpdate v1.0.3
    Checking num-conv v0.2.2
    Checking powerfmt v0.2.0
    Checking deranged v0.5.8
    Checking rustls-pki-types v1.15.1
    Checking hex-conservative v0.2.3
   Compiling generic-array v0.14.7
    Checking anstyle-parse v1.0.0
    Checking futures-util v0.3.34
    Checking bit-set v0.8.0
    Checking anstream v1.0.0
    Checking tiny_http v0.12.0
   Compiling num-traits v0.2.19
    Checking http v1.5.0
    Checking indexmap v2.14.2
    Checking clap_builder v4.6.7
    Checking webpki-roots v1.0.9
    Checking bitcoin_hashes v0.14.101
    Checking webpki-roots v0.26.11
    Checking ureq-proto v0.6.4
    Checking crypto-common v0.1.7
    Checking block-buffer v0.10.4
    Checking time v0.3.55
   Compiling syn v3.0.6
    Checking digest v0.10.7
   Compiling ring v0.17.14
   Compiling secp256k1-sys v0.10.1
   Compiling bitcoinconsensus v0.106.0+26.0
    Checking sha2 v0.10.9
    Checking blake2 v0.10.6
    Checking sha1 v0.10.7
    Checking hmac v0.12.1
    Checking base58ck v0.1.101
    Checking getrandom v0.2.17
    Checking wait-timeout v0.2.1
    Checking mio v1.2.3
    Checking socket2 v0.6.5
    Checking rand_core v0.9.5
    Checking yasna v0.5.2
    Checking rand_xorshift v0.4.0
    Checking tempfile v3.27.0
    Checking rusty-fork v0.3.1
   Compiling thiserror-impl v2.0.20
   Compiling serde_derive v1.0.229
   Compiling tokio-macros v2.7.2
   Compiling clap_derive v4.6.7
    Checking ppv-lite86 v0.2.21
    Checking rand_chacha v0.9.0
    Checking tokio v1.53.1
    Checking rand v0.9.5
    Checking proptest v1.11.0
    Checking secp256k1 v0.29.1
    Checking clap v4.6.7
    Checking rustls-webpki v0.103.15
    Checking rcgen v0.13.2
    Checking ureq v3.4.2
    Checking tokio-rustls v0.26.5
    Checking tungstenite v0.26.2
    Checking tokio-tungstenite v0.26.2
    Checking sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
    Checking sidestr-header v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-header)
    Checking sidestr-nostr v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-nostr)
    Checking sidestr-wallet v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-wallet)
    Checking sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 15.92s

```

Exit: 0; UTC end: 2026-09-22T19:03:31.993261+00:00

## Receipt: new-core-wallet

UTC start: 2026-09-22T19:07:05.305448+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-core -p sidestr-wallet --test verify_fixes -- --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling bitcoin v0.32.102
   Compiling syn v3.0.6
   Compiling ppv-lite86 v0.2.21
   Compiling rand v0.9.5
   Compiling rand_chacha v0.9.0
   Compiling proptest v1.11.0
   Compiling thiserror-impl v2.0.20
   Compiling serde_derive v1.0.229
   Compiling thiserror v2.0.20
   Compiling serde v1.0.229
   Compiling sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
   Compiling sidestr-wallet v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-wallet)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 6.17s
     Running tests/verify_fixes.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_fixes-d0bab1828625df7e)

running 2 tests
F1 interior BOM preserved; PUSHDATA1 BOM claim vout=99998 recognised; interior burn BOM refused
test f1_interior_bom_and_p1_claim_boundary ... ok
F3 UTF-8 byte bound 254/256 and unchecked payload 65537 uses PUSHDATA4 without truncation
test f3_unicode_byte_limits_and_large_unchecked_push ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/verify_fixes.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_fixes-e09b8afab0008c01)

running 1 test
F4 20 Unicode characters = 40 bytes accepted; 21 = 42 bytes rejected with MarkerTooLong(82)
test f4_parent_bound_counts_utf8_bytes ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s


```

Exit: 0; UTC end: 2026-09-22T19:07:11.517940+00:00

## Receipt: test

UTC start: 2026-09-22T19:03:32.047051+00:00

Working directory: crates/sidestr

Command: `cargo test --workspace --all-features`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling libc v0.2.189
   Compiling cfg-if v1.0.5
   Compiling typenum v1.20.1
   Compiling subtle v2.6.1
   Compiling zeroize v1.9.0
   Compiling untrusted v0.9.0
   Compiling once_cell v1.21.4
   Compiling bytes v1.12.1
   Compiling log v0.4.34
   Compiling itoa v1.0.18
   Compiling arrayvec v0.7.8
   Compiling cpufeatures v0.2.17
   Compiling equivalent v1.0.2
   Compiling hashbrown v0.17.1
   Compiling base64 v0.23.1
   Compiling bitcoin-units v0.1.101
   Compiling bech32 v0.11.1
   Compiling memchr v2.8.3
   Compiling base64 v0.21.7
   Compiling utf8-zero v0.8.1
   Compiling percent-encoding v2.3.2
   Compiling hex v0.4.3
   Compiling linux-raw-sys v0.12.1
   Compiling bitflags v2.13.2
   Compiling fastrand v2.5.0
   Compiling bit-vec v0.8.0
   Compiling quick-error v1.2.3
   Compiling fnv v1.0.7
   Compiling pin-project-lite v0.2.17
   Compiling utf8parse v0.2.2
   Compiling unarray v0.1.4
   Compiling regex-syntax v0.8.11
   Compiling anstyle v1.0.14
   Compiling is_terminal_polyfill v1.70.2
   Compiling anstyle-query v1.1.5
   Compiling colorchoice v1.0.5
   Compiling futures-core v0.3.34
   Compiling futures-task v0.3.34
   Compiling data-encoding v2.11.1
   Compiling slab v0.4.12
   Compiling futures-sink v0.3.34
   Compiling utf-8 v0.7.6
   Compiling strsim v0.11.1
   Compiling clap_lex v1.1.1
   Compiling deranged v0.5.8
   Compiling powerfmt v0.2.0
   Compiling httpdate v1.0.3
   Compiling time-core v0.1.9
   Compiling ascii v1.1.0
   Compiling num-conv v0.2.2
   Compiling chunked_transfer v1.5.0
   Compiling rustls-pki-types v1.15.1
   Compiling hex-conservative v0.2.3
   Compiling bit-set v0.8.0
   Compiling anstyle-parse v1.0.0
   Compiling bitcoin-io v0.1.101
   Compiling httparse v1.10.1
   Compiling serde_core v1.0.229
   Compiling hex_lit v0.1.1
   Compiling zmij v1.0.23
   Compiling zerocopy v0.8.57
   Compiling secp256k1-sys v0.10.1
   Compiling bitcoinconsensus v0.106.0+26.0
   Compiling num-traits v0.2.19
   Compiling thiserror v2.0.20
   Compiling futures-util v0.3.34
   Compiling rustix v1.1.5
   Compiling http v1.5.0
   Compiling indexmap v2.14.2
   Compiling anstream v1.0.0
   Compiling bitcoin_hashes v0.14.101
   Compiling generic-array v0.14.7
   Compiling tiny_http v0.12.0
   Compiling webpki-roots v1.0.9
   Compiling clap_builder v4.6.7
   Compiling webpki-roots v0.26.11
   Compiling getrandom v0.2.17
   Compiling getrandom v0.3.4
   Compiling getrandom v0.4.3
   Compiling wait-timeout v0.2.1
   Compiling socket2 v0.6.5
   Compiling mio v1.2.3
   Compiling ring v0.17.14
   Compiling rand_core v0.9.5
   Compiling crypto-common v0.1.7
   Compiling block-buffer v0.10.4
   Compiling rand_xorshift v0.4.0
   Compiling digest v0.10.7
   Compiling tokio v1.53.1
   Compiling ureq-proto v0.6.4
   Compiling time v0.3.55
   Compiling sha2 v0.10.9
   Compiling blake2 v0.10.6
   Compiling sha1 v0.10.7
   Compiling hmac v0.12.1
   Compiling base58ck v0.1.101
   Compiling secp256k1 v0.29.1
   Compiling bitcoin v0.32.102
   Compiling yasna v0.5.2
   Compiling tempfile v3.27.0
   Compiling rustls-webpki v0.103.15
   Compiling rusty-fork v0.3.1
   Compiling rcgen v0.13.2
   Compiling serde_json v1.0.151
   Compiling serde v1.0.229
   Compiling clap v4.6.7
   Compiling rustls v0.23.45
   Compiling ppv-lite86 v0.2.21
   Compiling rand_chacha v0.9.0
   Compiling rand v0.9.5
   Compiling proptest v1.11.0
   Compiling ureq v3.4.2
   Compiling tokio-rustls v0.26.5
   Compiling tungstenite v0.26.2
   Compiling tokio-tungstenite v0.26.2
   Compiling sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
   Compiling sidestr-header v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-header)
   Compiling sidestr-nostr v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-nostr)
   Compiling sidestr-wallet v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-wallet)
   Compiling sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 16.26s
     Running unittests src/lib.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/sidestr_core-2d20ace2e4d5a547)

running 23 tests
test block::tests::witness_decoder_is_strict ... ok
test block::tests::coinbase_height_inverts_the_push ... ok
test address::tests::round_trips_and_refusals ... ok
test block::tests::a_family_block_round_trips_and_weighs_like_bitcoins ... ok
test marker::tests::bom_is_dropped_exactly_where_the_reference_text_decodes ... ok
test marker::tests::claims_and_burns ... ok
test marker::tests::parent_records ... ok
test marker::tests::checked_constructors_and_untruncated_pushes ... ok
test block::tests::witness_round_trip_and_solution_push_sizes ... ok
test blockfile::tests::append_read_truncate ... ok
test marker::tests::records ... ok
test parent::rpc::tests::base64_and_amounts ... ok
test parent::tests::payments_checkpoints_and_reconciliation ... ok
test parents::tests::table ... ok
test marker::tests::peg_marker_both_forms ... ok
test document::tests::fixtures_parse_and_round_trip ... ok
test federation::tests::nums_matches_the_reference_derivation ... ok
test parent::tests::pegins_are_found_claimed_and_locked ... ok
test sighash::tests::unified_message_refuses_undefined_types ... ok
test federation::tests::federation_refuses_duplicates_and_derives_per_chain ... ok
test document::tests::refusals ... ok
test sighash::tests::unified_bit_is_read_only_where_the_rules_say ... ok
test federation::tests::leaf_round_trips_and_bounds_hold ... ok

test result: ok. 23 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/audit_regressions.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions-b5c2d4c9e2434134)

running 10 tests
test parent_confirmation_arithmetic_must_not_panic ... ok
test op_return_push_boundaries_match_the_reference ... ok
test malformed_witness_and_push_boundaries ... ok
test fees_and_submit_must_not_panic_on_overflowing_outputs ... ok
test parent_view_adversarial_inputs ... ok
test genesis_without_solution_must_not_validate ... ok
test departures_execute_at_the_boundary ... ok
test new_federation_negative_cases_and_identity ... ok
test witness_random_bytes_do_not_panic ... ok
test pushdata1_burns_are_recorded_and_refused_exactly_as_the_reference ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.07s

     Running tests/audit_regressions_records.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_records-4652532e5beffd64)

running 6 tests
test bom_burns_parse_as_the_reference_parses_them ... ok
test bom_records_read_as_the_reference_reads_them ... ok
test bom_claims_parse_as_the_reference_parses_them ... ok
test encoder_bounds ... ok
test bom_pegins_name_the_script_the_reference_names ... ok
test identical_bytes_derive_identical_records_in_both_engines ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 20.86s

     Running tests/claims.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/claims-e9dda1f8177fa622)

running 1 test
test claims ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s

     Running tests/consensus_oracle.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/consensus_oracle-d9dcc6b0b65061ab)

running 1 test
test core_and_this_crate_agree_on_every_subset_and_malformation ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.43s

     Running tests/federation.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/federation-e88da77e78216021)

running 5 tests
test template_id_survives_sealing_and_the_block_hash_does_not ... ok
test federation_and_sealed_blocks_are_byte_identical_to_the_reference ... ok
test consensus_accepts_annex_and_non_default_sighash_partials ... ok
test a_federated_chain_opens_with_a_seal_and_replays_without_one ... ok
test the_reference_refusals_and_the_reviews ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s

     Running tests/federation_prop.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/federation_prop-e1b7d9a613640eac)

running 2 tests
test both_output_key_parities_occur_and_verify ... ok
test a_subset_seals_exactly_when_it_has_k_members ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.43s

     Running tests/interop.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/interop-b16be1e8597b0268)

running 1 test
test rust_and_js_accept_each_others_blocks ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s

     Running tests/oracle.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/oracle-f4b28884b7aaf1ce)

running 3 tests
test dreamlab_genesis_hashes_to_the_document_and_verifies ... ok
test trial_genesis_is_byte_identical_to_the_reference ... ok
test dreamlab_replays_through_the_chain ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/parent_live.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/parent_live-5f8108b5d38c41b3)

running 1 test
test the_peg_wallets_funding_is_found_from_the_parent_side ... ignored, set SIDESTR_PARENT_RPC to the testnet4 node's JSON-RPC URL (LAN); read-only

test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/pegout-33fec8010cc32577)

running 1 test
test pegouts ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s

     Running tests/rules.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/rules-55e6a660d786017f)

running 1 test
test every_rule_accepts_and_refuses ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s

     Running tests/stock_header.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/stock_header-aacc837e7f2164fb)

running 1 test
test both_parents_open_produce_and_replay_stock_arm ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s

     Running unittests src/lib.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/sidestr_header-9730e7e6ebac3e66)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/audit_regressions.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions-6028b1f5da9f37e9)

running 8 tests
test document_family_mismatch ... ok
test v2_genesis_with_bit31_clear_must_be_refused ... ok
test stock_bit31_must_be_refused_in_decode_rules_and_replay ... ok
test signed_prefix_and_template_metadata_boundary ... ok
test v2_js_edge_headers ... ok
test replay_must_check_dat_record_framing ... ok
test mid_chain_mutations ... ok
test saved_live_mirrors_all_rule_counts ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.20s

     Running tests/core_family.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/core_family-789a11d24fbf9947)

running 5 tests
test blake2b_live_mirrors_replay_to_their_announced_tips ... ignored, set SIDESTR_LIVE=1: fetches https://melvin.me/public/{siding,melchain}/
test stock_family_seals_the_trial_genesis_to_the_reference_bytes ... ok
test blake2b_txbt4_siding_replays_from_genesis_to_the_recorded_tip ... ok
test blake2b_chain_produces_and_replays_with_unified_and_default_spends ... ok
test blake2b_rules_refuse_tampered_headers_and_stock_sighash_refuses_unified ... ok

test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.35s

     Running tests/vectors.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/vectors-d73ef5489a6be94d)

running 13 tests
test family_metadata ... ok
test hashes_compare_against_targets_numerically ... ok
test compact_targets_round_trip_and_reject_core_edge_cases ... ok
test stock_block_data_matches_siding_oracle ... ok
test stock_check_pow_against_pow_limit ... ok
test stock_fields_decode_as_expected ... ok
test stock_rejects_wrong_length_and_bit_31 ... ok
test v2_rejects_wrong_length_bit_31_clear_and_reserved_flags ... ok
test stock_headers_before_the_fork_are_still_sha256d ... ok
test stock_vectors_hash_to_their_known_ids ... ok
test sidestr_shaped_v2_headers_match_the_js_oracle ... ok
test live_fork_headers_hash_as_the_node_says ... ok
test knots_vectors_encode_decode_and_hash_stage_for_stage ... ok

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/lib.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/sidestr_nostr-8c027cea6b7c0991)

running 42 tests
test estate::tests::urn_is_checked_not_minted ... ok
test event::tests::id_matches_json_stringify_semantics ... ok
test kinds::tests::the_table_is_sorted_unique_and_classed_by_number ... ok
test event::tests::keys_are_refused_when_malformed ... ok
test relay::tests::filters_serialise_as_nip01 ... ok
test estate::tests::a_binding_is_signed_by_the_identity_it_names ... ok
test event::tests::a_policy_signer_can_refuse_by_kind ... ok
test tags::tests::heights_and_ids ... ok
test rules::tests::rule_address_grammar ... ok
test tags::tests::chain_check_is_exact ... ok
test tags::tests::outpoint_grammar ... ok
test estate::tests::binding_round_trip ... ok
test relay::tests::relay_messages ... ok
test event::tests::the_json_shape_is_nip01_field_for_field ... ok
test record::tests::a_peg_record_is_a_json_object ... ok
test record::tests::the_address_and_kind_are_the_shared_contract ... ok
test round::tests::partial_round_trip_and_rejections ... ok
test event::tests::tampering_is_caught ... ok
test tip::tests::the_template_refuses_what_cannot_be_announced ... ok
test tx::tests::faucet_round_trip_and_rejections ... ok
test record::tests::ambiguity_is_reported_never_guessed ... ok
test relay::tests::client_messages ... ok
test rules::tests::rule_round_trip_and_rejections ... ok
test tip::tests::judging_a_mirror ... ok
test tx::tests::transaction_round_trip_and_rejections ... ok
test rules::tests::genesis_round_trip_and_rejections ... ok
test round::tests::proposal_and_sealed_round_trip ... ok
test event::tests::signing_is_deterministic_and_verifies ... ok
test estate::tests::domain_event_rejections ... ok
test record::tests::a_pledge_is_recognised_by_shape ... ok
test event::tests::with_signature_accepts_only_a_valid_pair ... ok
test tip::tests::the_mirror_whose_chain_json_names_the_announcer_is_chosen_the_other_skipped ... ok
test tip::tests::no_mirror_vouched_for_by_the_announcer_is_a_clear_error ... ok
test tip::tests::stock_headers_parse_where_upstream_returns_null ... ok
test tip::tests::the_event_is_kind_33333_addressable_by_d_tagged_t_sidestr_and_verifies ... ok
test round::tests::pegout_round_trip_and_rejections ... ok
test tip::tests::it_parses_back_tip_headers_mirrors_without_trailing_slashes ... ok
test estate::tests::the_five_round_trip_with_content_authoritative ... ok
test relay::tests::the_follower_applies_the_on_receipt_checks_in_order ... ok
test relay::tests::fetch_latest_tip_and_publish_all_over_the_port ... ok
test tip::tests::newest_takes_the_highest_tip_then_the_latest_and_only_the_known_signer ... ok
test tip::tests::a_malformed_content_is_rejected ... ok

test result: ok. 42 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s

     Running tests/live.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/live-d873c342b9d416c8)

running 4 tests
test a_v2_announcement_carries_a_full_window_of_164_byte_headers ... ok
test the_dreamlab_announcement_is_stock_family_and_upstream_rejects_it ... ok
test every_live_announcement_verifies_and_parses ... ok
test newest_picks_one_announcement_per_chain_and_a_follower_would_not_take_them ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.55s

     Running tests/oracle.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/oracle-f3426e6c95f8c00e)

running 7 tests
test a_33502_with_junk_content_is_ambiguous_not_a_pledge ... ok
test transaction_and_faucet_events_are_byte_identical ... ok
test the_kernels_random_aux_signature_verifies_but_is_not_ours ... ok
test the_stock_tip_is_byte_identical_and_parses_where_upstream_returns_null ... ok
test the_v2_tip_matches_upstream_parse_and_judgement ... ok
test round_events_are_byte_identical ... ok
test every_vector_verifies_under_this_crate ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running unittests src/lib.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/sidestr_round-dc81ba24f0830286)

running 7 tests
test node::tests::pegin_records_round_trip ... ok
test node::tests::ranges_parse_as_a_mirror_sends_them ... ok
test journal::tests::the_wire_shape_of_an_entry_is_stable ... ok
test journal::tests::a_fresh_file_and_a_reload_read_older_records_without_a_stage ... ok
test signer::tests::a_local_key_is_deterministic_and_never_displays_itself ... ok
test journal::tests::the_file_journal_round_trips_and_repairs_a_torn_tail_before_appending ... ok
test relay::tests::the_stand_in_stores_replays_and_pushes_and_the_client_follows_and_publishes ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s

     Running unittests src/bin/cosign.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/cosign-8f3e4c3509b3bd5d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/audit_regressions_node.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_node-40356bc792179931)

running 4 tests
test audit_wss_public_relay_read_only_smoke ... ignored, network: set SIDESTR_RELAY_SMOKE=1 (or a wss:// URL) to run
test audit_subscription_filter ... ok
test audit_wss_support ... ok
test audit_http_unindexed_block ... ok

test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.10s

     Running tests/audit_regressions_pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_pegout-d36e7994ac6403c3)

running 6 tests
test audit_missing_marker_and_extra_non_change_output_are_refused_change_to_the_peg_is_not ... ok
test audit_journal_failure_does_not_call_the_pegout_signer ... ok
test audit_export_peg_wire ... ok
test audit_never_resign_restart_self_proposal ... ok
test audit_a_cosigner_does_not_become_the_proposer_for_a_burn_it_signed ... ok
test audit_upstream_policy_permits_a_disjoint_input_retry_after_the_ring ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s

     Running tests/audit_regressions_round.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_round-2d3d0b68b5569956)

running 5 tests
test audit_import_js_proposal ... ok
test audit_journal_failure_does_not_call_signer ... ok
test audit_round_boundaries_and_validation ... ok
test audit_crash_and_torn_tail ... ok
test audit_export_wire_and_entitlement ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s

     Running tests/interop_pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/interop_pegout-2738424d1a41f9c6)

running 1 test
test a_burn_is_paid_by_a_psbt_round_proposed_by_js_and_by_rust ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.70s

     Running tests/interop_round.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/interop_round-c8e9a2a1ee008298)

running 2 tests
test rust_js_js has been running for over 60 seconds
test rust_rust_js has been running for over 60 seconds
test rust_js_js ... ok
test rust_rust_js ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 148.04s

     Running tests/pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/pegout-cc75c5d903427720)

running 5 tests
test lateness_moves_the_payer_ring_and_a_stale_proposal_is_dropped ... ok
test a_burn_larger_than_one_coin_takes_two_and_change_under_dust_goes_to_the_fee ... ok
test the_payer_proposes_a_cosigner_checks_and_signs_and_k_finalises ... ok
test one_signature_per_burn_is_journalled_before_publish_and_survives_a_restart ... ok
test refusals_are_logged_as_pegoutround_mjs_logs_them ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s

     Running tests/round.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/round-a1157827fe9c56ec)

running 6 tests
test a_key_outside_the_federation_and_a_level_1_document_are_refused ... ok
test resign_after_none_never_signs_a_height_twice ... ok
test the_proposer_rotates_and_k_signatures_seal ... ok
test the_journal_is_written_before_publish_and_survives_a_restart ... ok
test lateness_lets_the_ring_advance_and_a_stale_proposal_is_dropped ... ok
test refusals_are_logged_as_round_mjs_logs_them ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.63s

     Running unittests src/lib.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/sidestr_wallet-cdebf61b60d785a5)

running 8 tests
test deliver::tests::urls_and_replies ... ok
test coins::tests::json_shape_is_the_producers ... ok
test pegin::tests::long_records_are_refused_not_emitted_unreadable ... ok
test select::tests::largest_first_and_stable ... ok
test key::tests::derivation_separates_domains ... ok
test pegin::tests::networks_and_records ... ok
test spend::tests::resolve_scripts_and_addresses ... ok
test key::tests::plain_key_signs_valid_schnorr ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/builders.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/builders-3c561fe38e57644d)

running 7 tests
test pegin_accepts_and_rejects ... ok
test spend_change_under_dust_goes_to_the_fee ... ok
test coins_from_the_producers_json_spend_the_same ... ok
test spend_rejects ... ok
test policy_is_consulted_before_signing ... ok
test burn_accepts_and_rejects ... ok
test spend_accepts_and_sizes_the_fee ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s

     Running tests/oracle.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/oracle-2ddea833b75b6542)

running 1 test
test spend_and_burn_pass_core_rules_and_siding_submit ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.93s

   Doc-tests sidestr_core

running 12 tests
test sidestr-core/src/blockfile.rs - blockfile (line 10) - compile ... ok
test sidestr-core/src/chain.rs - chain (line 10) - compile ... ok
test sidestr-core/src/marker.rs - marker::try_claim_marker (line 245) ... ok
test sidestr-core/src/address.rs - address (line 10) ... ok
test sidestr-core/src/marker.rs - marker::try_pegout_marker (line 350) ... ok
test sidestr-core/src/parents.rs - parents (line 14) ... ok
test sidestr-core/src/document.rs - document (line 16) ... ok
test sidestr-core/src/parent.rs - parent (line 22) ... ok
test sidestr-core/src/block.rs - block (line 21) ... ok
test sidestr-core/src/marker.rs - marker (line 17) ... ok
test sidestr-core/src/federation.rs - federation (line 29) ... ok
test sidestr-core/src/lib.rs - (line 66) ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.88s

   Doc-tests sidestr_header

running 14 tests
test sidestr-header/src/hash.rs - hash::tagged_hash (line 47) ... ok
test sidestr-header/src/target.rs - target::Target::to_compact (line 101) ... ok
test sidestr-header/src/target.rs - target::Target::from_hex (line 42) ... ok
test sidestr-header/src/hash.rs - hash::blake2b_256 (line 67) ... ok
test sidestr-header/src/lib.rs - check_pow (line 467) ... ok
test sidestr-header/src/lib.rs - BlockHash (line 182) ... ok
test sidestr-header/src/family.rs - family (line 18) ... ok
test sidestr-header/src/signet.rs - signet::block_data (line 32) ... ok
test sidestr-header/src/lib.rs - (line 99) ... ok
test sidestr-header/src/stock.rs - stock::StockHeader (line 22) ... ok
test sidestr-header/src/hash.rs - hash::sha256 (line 29) ... ok
test sidestr-header/src/v2.rs - v2::Blake2bV2Header (line 62) ... ok
test sidestr-header/src/target.rs - target::Target::from_compact (line 55) ... ok
test sidestr-header/src/family.rs - family::Blake2bV2 (line 60) ... ok

test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.91s

   Doc-tests sidestr_nostr

running 11 tests
test sidestr-nostr/src/tx.rs - tx (line 19) ... ok
test sidestr-nostr/src/relay.rs - relay (line 29) ... ok
test sidestr-nostr/src/estate.rs - estate (line 34) ... ok
test sidestr-nostr/src/kinds.rs - kinds (line 18) ... ok
test sidestr-nostr/src/rules.rs - rules (line 29) ... ok
test sidestr-nostr/src/round.rs - round (line 24) ... ok
test sidestr-nostr/src/lib.rs - Readme (line 180) ... ok
test sidestr-nostr/src/record.rs - record (line 33) ... ok
test sidestr-nostr/src/lib.rs - (line 57) ... ok
test sidestr-nostr/src/event.rs - event (line 41) ... ok
test sidestr-nostr/src/tip.rs - tip (line 39) ... ok

test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.45s

   Doc-tests sidestr_round

running 2 tests
test sidestr-round/src/pegout.rs - pegout (line 35) ... ok
test sidestr-round/src/lib.rs - Readme (line 231) ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.18s

   Doc-tests sidestr_wallet

running 11 tests
test sidestr-wallet/src/policy.rs - policy (line 10) ... ok
test sidestr-wallet/src/key.rs - key::derive_subkey (line 145) ... ok
test sidestr-wallet/src/deliver.rs - deliver (line 14) ... ok
test sidestr-wallet/src/key.rs - key::derive_spend_key (line 182) ... ok
test sidestr-wallet/src/key.rs - key (line 17) ... ok
test sidestr-wallet/src/burn.rs - burn (line 15) ... ok
test sidestr-wallet/src/coins.rs - coins (line 12) ... ok
test sidestr-wallet/src/spend.rs - spend (line 14) ... ok
test sidestr-wallet/src/pegin.rs - pegin (line 18) ... ok
test sidestr-wallet/src/select.rs - select (line 16) ... ok
test sidestr-wallet/src/lib.rs - (line 47) ... ok

test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.00s


```

Exit: 0; UTC end: 2026-09-22T19:07:13.241358+00:00

## Receipt: new-round

UTC start: 2026-09-22T19:07:11.587083+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-round --all-features --test verify_round --test verify_pegout --test verify_node -- --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling ureq v3.4.2
   Compiling sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
   Compiling sidestr-nostr v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-nostr)
   Compiling sidestr-header v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-header)
   Compiling sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
warning: unused import: `sidestr_round::signer::LocalKey`
  --> sidestr-round/tests/verify_pegout.rs:10:5
   |
10 | use sidestr_round::signer::LocalKey;
   |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   |
   = note: `#[warn(unused_imports)]` (part of `#[warn(unused)]`) on by default

warning: `sidestr-round` (test "verify_pegout") generated 1 warning (run `cargo fix --test "verify_pegout" -p sidestr-round` to apply 1 suggestion)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 8.68s
     Running tests/verify_node.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_node-c186cba6a80e5530)

running 2 tests
C3 trusted issuer but wrong hostname refused: IO error: invalid peer certificate: certificate not valid for name "127.0.0.1"; certificate is only valid for DnsName("localhost")
test c3_trusted_certificate_wrong_hostname_refused ... ok
C6 final indexed byte served exactly, open range at end=416, chunked body cap+1=413
test c6_last_indexed_byte_and_chunked_oversize ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.47s

     Running tests/verify_pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_pegout-bd7e95d1c4780e18)

running 1 test
C2 same input set; fee 2 -> 9 changes txid; restart refuses second authorisation
test c2_restart_same_inputs_changed_fee ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s

     Running tests/verify_round.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_round-e9edff2a799a53c6)

running 3 tests
C5 custody callback reads durable intent; lost response + restart never invokes custody twice
test c5_signer_observes_durable_intent_and_failure_survives_restart ... ok
C4 journal restart preserves .731 seconds; retry at +29999/+30000 refused, +30001 signed
test c4_restart_preserves_fractional_signature_time ... ok
C1 all 172 prefixes, including complete JSON without newline, survive append/reopen
test c1_every_record_prefix_recovered_before_append ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.80s


```

Exit: 0; UTC end: 2026-09-22T19:07:23.655643+00:00

## Receipt: doc

UTC start: 2026-09-22T19:07:13.293665+00:00

Working directory: crates/sidestr

Command: `RUSTDOCFLAGS="-D warnings" cargo doc --workspace --all-features`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
    Blocking waiting for file lock on build directory
    Checking unicode-ident v1.0.26
 Documenting unicode-ident v1.0.26
 Documenting cfg-if v1.0.5
 Documenting typenum v1.20.1
 Documenting subtle v2.6.1
 Documenting bytes v1.12.1
 Documenting log v0.4.34
 Documenting itoa v1.0.18
 Documenting arrayvec v0.7.8
 Documenting cpufeatures v0.2.17
 Documenting hashbrown v0.17.1
 Documenting zeroize v1.9.0
 Documenting untrusted v0.9.0
 Documenting equivalent v1.0.2
 Documenting base64 v0.23.1
 Documenting bech32 v0.11.1
 Documenting percent-encoding v2.3.2
 Documenting bitcoin-units v0.1.101
 Documenting utf8-zero v0.8.1
 Documenting memchr v2.8.3
 Documenting utf8parse v0.2.2
 Documenting hex v0.4.3
 Documenting pin-project-lite v0.2.17
 Documenting once_cell v1.21.4
 Documenting is_terminal_polyfill v1.70.2
 Documenting anstyle v1.0.14
 Documenting colorchoice v1.0.5
 Documenting anstyle-query v1.1.5
 Documenting strsim v0.11.1
 Documenting futures-sink v0.3.34
 Documenting clap_lex v1.1.1
 Documenting data-encoding v2.11.1
 Documenting futures-core v0.3.34
 Documenting heck v0.5.0
    Checking heck v0.5.0
 Documenting utf-8 v0.7.6
 Documenting futures-task v0.3.34
 Documenting slab v0.4.12
 Documenting httpdate v1.0.3
 Documenting ascii v1.1.0
 Documenting chunked_transfer v1.5.0
    Checking proc-macro2 v1.0.107
 Documenting libc v0.2.189
 Documenting bitcoin-io v0.1.101
 Documenting httparse v1.10.1
 Documenting serde_core v1.0.229
 Documenting zerocopy v0.8.57
 Documenting hex_lit v0.1.1
 Documenting zmij v1.0.23
    Checking ureq v3.4.2
 Documenting secp256k1-sys v0.10.1
 Documenting bitcoinconsensus v0.106.0+26.0
 Documenting ring v0.17.14
    Checking quote v1.0.47
 Documenting proc-macro2 v1.0.107
 Documenting rustls-pki-types v1.15.1
 Documenting anstyle-parse v1.0.0
 Documenting hex-conservative v0.2.3
    Checking syn v3.0.6
    Checking sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
 Documenting futures-util v0.3.34
    Checking sidestr-nostr v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-nostr)
    Checking sidestr-header v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-header)
 Documenting tiny_http v0.12.0
 Documenting indexmap v2.14.2
 Documenting http v1.5.0
    Checking sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
 Documenting anstream v1.0.0
 Documenting quote v1.0.47
 Documenting generic-array v0.14.7
 Documenting rustls-webpki v0.103.15
 Documenting bitcoin_hashes v0.14.101
 Documenting getrandom v0.3.4
 Documenting mio v1.2.3
 Documenting socket2 v0.6.5
 Documenting serde_json v1.0.151
 Documenting ppv-lite86 v0.2.21
 Documenting clap_builder v4.6.7
 Documenting syn v3.0.6
 Documenting ureq-proto v0.6.4
 Documenting crypto-common v0.1.7
 Documenting block-buffer v0.10.4
 Documenting rustls v0.23.45
 Documenting rand_core v0.9.5
 Documenting base58ck v0.1.101
 Documenting secp256k1 v0.29.1
 Documenting ureq v3.4.2
 Documenting digest v0.10.7
 Documenting thiserror-impl v2.0.20
 Documenting serde_derive v1.0.229
 Documenting tokio-macros v2.7.2
 Documenting clap_derive v4.6.7
 Documenting rand_chacha v0.9.0
 Documenting bitcoin v0.32.102
 Documenting sha2 v0.10.9
 Documenting sha1 v0.10.7
 Documenting blake2 v0.10.6
 Documenting hmac v0.12.1
 Documenting tokio v1.53.1
 Documenting thiserror v2.0.20
 Documenting clap v4.6.7
 Documenting serde v1.0.229
 Documenting rand v0.9.5
 Documenting tokio-rustls v0.26.5
 Documenting sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
 Documenting tungstenite v0.26.2
 Documenting sidestr-nostr v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-nostr)
 Documenting sidestr-header v0.2.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-header)
 Documenting sidestr-wallet v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-wallet)
 Documenting tokio-tungstenite v0.26.2
 Documenting sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 10s
   Generated /home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/doc/sidestr_core/index.html and 5 other files

```

Exit: 0; UTC end: 2026-09-22T19:08:23.465598+00:00

## Receipt: parity-js

UTC start: 2026-09-22T19:08:41.715739+00:00

Working directory: crates/sidestr

Command: `node ../../out/parity.mjs`

```text
JS height=102 burn_payload=75 text_payload=75 records=4 burns=1 claims=1 pegins=1
JS height=103 burn_payload=76 text_payload=76 records=5 burns=1 claims=1 pegins=1
JS height=104 burn_payload=80 text_payload=80 records=5 burns=1 claims=1 pegins=1
JS height=105 burn_payload=75 text_payload=75 records=3 burns=1 claims=1 pegins=1
JS height=106 burn_payload=77 text_payload=76 records=4 burns=1 claims=1 pegins=1
JS height=107 burn_payload=87 text_payload=80 records=5 burns=1 claims=1 pegins=1
JS height=108 burn_payload=14 text_payload=75 records=4 burns=1 claims=1 pegins=1
JS height=109 burn_payload=75 text_payload=76 records=4 burns=1 claims=1 pegins=1
JS height=110 burn_payload=79 text_payload=80 records=5 burns=1 claims=1 pegins=1
JS height=111 burn_payload=80 text_payload=75 records=6 burns=1 claims=1 pegins=1
JS built and accepted 10 consecutive adversarial blocks after 101-block maturity baseline; files retained under out/parity-*

```

Exit: 0; UTC end: 2026-09-22T19:08:43.484983+00:00

## Receipt: core-regressions

UTC start: 2026-09-22T19:08:23.533532+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-core --all-features --test audit_regressions --test audit_regressions_records -- --include-ignored --skip smoke --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling httparse v1.10.1
   Compiling http v1.5.0
   Compiling digest v0.10.7
   Compiling sha2 v0.10.9
   Compiling ureq-proto v0.6.4
   Compiling ureq v3.4.2
   Compiling sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 6.04s
     Running tests/audit_regressions.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions-8685fdc4112b804a)

running 10 tests
witness  => None
witness fd => None
unsupported overlay assets: Err(Document("chain sidestr:trial names rule \"assets\", which this validator does not have (sidestr-core carries the core rules only)"))
witness fd00 => None
witness fe0000 => None
witness ff => None
unsupported overlay pool: Err(Document("chain sidestr:trial names rule \"pool\", which this validator does not have (sidestr-core carries the core rules only)"))
witness 0800 => None
witness 01ff => None
witness 01feffffffff => None
witness 0001 => None
unsupported overlay evm: Err(Document("chain sidestr:trial names rule \"evm\", which this validator does not have (sidestr-core carries the core rules only)"))
witness fd0000 => None
witness fd0101 => None
record_text(6a0261)=None; JS receipt parent_oracle returns a
claimable at max height panicked=false
test parent_confirmation_arithmetic_must_not_panic ... ok
test op_return_push_boundaries_match_the_reference ... ok
solution payload=75 push prefix=4becc7
payload=75: overclaimed length and trailing garbage refused
solution payload=76 push prefix=4c4cec
payload=76: overclaimed length and trailing garbage refused
solution payload=255 push prefix=4cffec
payload=255: overclaimed length and trailing garbage refused
solution payload=256 push prefix=4d0001
payload=256: overclaimed length and trailing garbage refused
test malformed_witness_and_push_boundaries ... ok
unsigned genesis solution=None
fees with outputs [MAX, 1] on a 100-sat coin: Ok(None)
submit of the same transaction: Ok(true)
test fees_and_submit_must_not_panic_on_overflowing_outputs ... ok
failed claim candidate: Err(Rejected { height: 1, rules: ["btc:rule-block-merkle-root", "sidestr:rule-block-signature"] }); claim remains unrecorded
below dust=1sat discovery: amount=1 vout=0
marker not OP_RETURN: None
marker for other chain: None
two markers: selected first script=OP_PUSHNUM_1 OP_PUSHBYTES_32 82a23c18f7e12d180ed51eb895cdd49e0f6a1432cd08b791a32ed0664607fdcc
valid retry accepted; claim committed
same script: mainnet=bc1ps23rcx8huyk3srk4r6uftnw5nc8k59pje5yt0ydr9mgxv3s8lhxq3vad56 testnet=tb1ps23rcx8huyk3srk4r6uftnw5nc8k59pje5yt0ydr9mgxv3s8lhxqxytzw4
nonstandard pegout: Err(Parent("script 51… has no address on the parent"))
checkpoint >80: Err(Block("checkpoint of 143 bytes exceeds the 80-byte data limit; the chain id is too long"))
test parent_view_adversarial_inputs ... ok
unsigned genesis with matching document hash: Err(Rejected { height: 0, rules: ["btc:rule-header-pow", "sidestr:rule-block-signature"] })
test genesis_without_solution_must_not_validate ... ok
same-signer-two-slots: Err(ScriptPath(InvalidSignature { slot: 1 }))
wrong-internal-key: Err(ScriptPath(Commitment))
identical state/key/next-block inputs produced identical blocks
test departures_execute_at_the_boundary ... ok
wrong-leaf-hash: Err(ScriptPath(InvalidSignature { slot: 0 }))
document duplicate: Err(Federation("signer 823a0785da0bb0beef8438e3e2c2712130d5a6013fb5e2ba678b8bd47da46942 is listed twice"))
document threshold-zero: Err(Federation("threshold between 1 and the number of signers"))
document threshold-n-plus-one: Err(Federation("threshold between 1 and the number of signers"))
document 17-signers: Err(Federation("1 to 16 signers"))
document wrong-challenge: Err(Document("sidestr:fedtest: challenge 5120823a0785… is not the one 3 signers with threshold 2 derive (512082a23c18…)"))
subset[0,1] template=226153683fe4441636debd05c1d5aae7c8ff38193da01c8e8afe781fd64d4274 sealed=1ddcf2578facf2b26ece1a85267ac2c5a9aec9eefd2de84c02830a5bde98e60d
subset[0,2] template=226153683fe4441636debd05c1d5aae7c8ff38193da01c8e8afe781fd64d4274 sealed=3c6b09d3b9c5ed184868467128712609ad3ab37e71c3a5188623bde5e147456a
test new_federation_negative_cases_and_identity ... ok
rust pegouts after the block: [(0, 34), (1, 35), (2, 40), (3, 40), (4, 2)]
js pegouts after the block: [(0, 34), (1, 35), (2, 40), (3, 40), (4, 2)]
rust verdict on the malformed OP_PUSHDATA1 burn: Err(Rejected { height: 103, rules: ["sidestr:rule-pegouts"] })
test witness_random_bytes_do_not_panic ... ok
js verdict on the malformed OP_PUSHDATA1 burn: {"ok":false,"error":"block 103 failed: sidestr:rule-pegouts"}
test pushdata1_burns_are_recorded_and_refused_exactly_as_the_reference ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.11s

     Running tests/audit_regressions_records.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_records-e0b9c205c1d7f1c7)

running 6 tests
test bom_records_read_as_the_reference_reads_them ... ok
test bom_burns_parse_as_the_reference_parses_them ... ok
test encoder_bounds ... ok
test bom_claims_parse_as_the_reference_parses_them ... ok
test bom_pegins_name_the_script_the_reference_names ... ok
marker cases compared=101 identical except the F2 record departure on 25
blocks compared=30 identical
test identical_bytes_derive_identical_records_in_both_engines ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 22.09s


```

Exit: 0; UTC end: 2026-09-22T19:08:53.824031+00:00

## Receipt: round-regressions

UTC start: 2026-09-22T19:08:53.877963+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-round --all-features --test audit_regressions_node --test audit_regressions_round --test audit_regressions_pegout -- --include-ignored --skip smoke --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 3.24s
     Running tests/audit_regressions_node.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_node-4b228d5373ca7389)

running 3 tests
AUDIT Rust actual subscription ["REQ","k23510",{"kinds":[23510],"since":1790103537}]
AUDIT Rust actual subscription ["REQ","k23511",{"kinds":[23511],"since":1790103537}]
AUDIT Rust actual subscription ["REQ","k23512",{"kinds":[23512],"since":1790103537}]
AUDIT Rust actual subscription ["REQ","k23513",{"kinds":[23513],"since":1790103537}]
AUDIT Rust actual subscription ["REQ","k23514",{"kinds":[23514],"since":1790103537}]
test audit_subscription_filter ... ok
AUDIT WSS local TLS handshake=101 REQ/EOSE/EVENT exchange=ok default roots refuse self-signed=IO error: invalid peer certificate: UnknownIssuer
test audit_wss_support ... ok
AUDIT HTTP unindexed sealed h1 not served: range beyond index=416, /blocks.dat=538 committed bytes of 1043 on disk; /tip height=0
AUDIT POST /tx over 262144 bytes=413; at the cap=400
test audit_http_unindexed_block ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 1.11s

     Running tests/audit_regressions_pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_pegout-c15b52815d2fed95)

running 6 tests
AUDIT pegout mutation=missing_marker refusal=Some("does not pay the burn with its marker")
AUDIT pegout mutation=extra_foreign_output refusal=Some("pays something besides the burn and change to the peg")
AUDIT LOG peg-out round: proposal for 0707070707070707… not signed: journal: audit failure
AUDIT peg-out journal write failure: sign_pegout_input calls=0 Publish actions=0 logs=["peg-out round: proposal for 0707070707070707… not signed: journal: audit failure"]
AUDIT LOG peg-out round: proposal for 0707070707070707… not signed: journal: audit failure
AUDIT pegout mutation=extra_peg_change refusal=None
test audit_missing_marker_and_extra_non_change_output_are_refused_change_to_the_peg_is_not ... ok
test audit_journal_failure_does_not_call_the_pegout_signer ... ok
AUDIT exported 2 Rust pegout events on identical PSBT fixtures
test audit_export_peg_wire ... ok
AUDIT resign_after=None restart same_burn=0707070707070707070707070707070707070707070707070707070707070707:0 first_txid=eb13276672b03205de4ef234b95c795a24bd8c61107659cb12fae1dc3c474369 second_proposal=none
test audit_never_resign_restart_self_proposal ... ok
test audit_a_cosigner_does_not_become_the_proposer_for_a_burn_it_signed ... ok
AUDIT upstream policy retry same_burn=0707070707070707070707070707070707070707070707070707070707070707:0 first_txid=eb13276672b03205de4ef234b95c795a24bd8c61107659cb12fae1dc3c474369 second_txid=50ee8aee6575f24e6334d9a746b3c031f4d02769dda6568b84368fbe573942a3 disjoint_inputs=true valid_second_signature=true at=T0+90
test audit_upstream_policy_permits_a_disjoint_input_retry_after_the_ring ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s

     Running tests/audit_regressions_round.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_round-a65fc76da93656c5)

running 5 tests
AUDIT JS proposal not generated yet; run again after wire.mjs
test audit_import_js_proposal ... ok
AUDIT LOG round: proposal h1 not signed: journal: audit failure
AUDIT journal write failure: BlockSigner::sign_partial calls=0 Publish actions=0 logs=["round: proposal h1 not signed: journal: audit failure"]
AUDIT LOG round: proposal h1 not signed: journal: audit failure
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 29 s ago
AUDIT resign delta=29 partials=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 29 s ago"]
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 30 s ago
AUDIT resign delta=30 partials=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 30 s ago"]
AUDIT LOG round: proposal h1 signed but not published: journal: audit failure after signing
AUDIT LOG round: signed h1 cb5d9228b63e… from 4df4d228…
AUDIT resign delta=31 partials=1 logs=["round: signed h1 cb5d9228b63e… from 4df4d228…"]
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed d7e4dfa5… for this height 5 s ago
test audit_journal_failure_does_not_call_signer ... ok
AUDIT MAY_RESIGN delta_ms=29000 JS=false Rust=false
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago
AUDIT torn=false loaded_entries=2 records=3 second_partial=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago"]
AUDIT MAY_RESIGN delta_ms=30000 JS=false Rust=false
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT MAY_RESIGN delta_ms=30001 JS=true Rust=true
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT MAY_RESIGN delta_ms=30999 JS=true Rust=true
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT MAY_RESIGN delta_ms=31000 JS=true Rust=true
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT replay age_ms=90000 partials=1
AUDIT LOG round: proposal is not a block
AUDIT replay age_ms=90001 partials=0
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h1 from f047d182… refused: not its turn
AUDIT LOG round: proposal h1 from 949e1955… refused: not its turn
AUDIT validation outsider partials=0 logs=["round: proposal h1 from 949e1955… refused: not its turn"]
AUDIT LOG round: proposal h1 from f047d182… refused: not its turn
AUDIT LOG round: proposal h2 from f047d182… ignored (my tip is 0)
AUDIT validation tip+2 partials=0 logs=["round: proposal h2 from f047d182… ignored (my tip is 0)"]
AUDIT LOG round: proposal h1 from f047d182… refused: not its turn
AUDIT LOG round: my proposal h1 got 1 signature(s); dropping it
AUDIT DROP at 90000=false at 90001=true logs=["round: my proposal h1 got 1 signature(s); dropping it"]
test audit_round_boundaries_and_validation ... ok
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago
AUDIT torn=true loaded_entries=2 records=3 second_partial=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago"]
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
test audit_crash_and_torn_tail ... ok
AUDIT LOG round: proposal h2 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h2 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h2 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h3 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h3 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h3 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h4 from f047d182… refused: not its turn
AUDIT LOG round: proposal h4 from f047d182… refused: not its turn
AUDIT LOG round: proposal h4 from f047d182… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h5 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h5 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h5 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h6 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h6 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h6 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT exported 3 Rust block events; entitlement cases=126
test audit_export_wire_and_entitlement ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s


```

Exit: 0; UTC end: 2026-09-22T19:08:58.845295+00:00

## Receipt: replay

UTC start: 2026-09-22T19:08:58.927394+00:00

Working directory: crates/sidestr

Command: `cargo run -q --example siding -- replay --chain ../../config/sidechain/dreamlab/chain.json --dir /home/devuser/workspace/sidestr/dreamlab`

```text

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
{"genesisHash":"4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0","height":33,"tip":"24c3347506979215a1b73514f0537a187de77d67cc0b9f478af984aa3c095f50","coins":0}

```

Exit: 0; UTC end: 2026-09-22T19:09:02.123467+00:00

## Receipt: parity-js-linked

UTC start: 2026-09-22T19:10:34.840910+00:00

Working directory: crates/sidestr

Command: `node ../../out/parity.mjs`

```text
JS height=102 burn_payload=75 text_payload=75 records=4 burns=1 claims=1 pegins=1
JS height=103 burn_payload=76 text_payload=76 records=5 burns=1 claims=1 pegins=1
JS height=104 burn_payload=80 text_payload=80 records=5 burns=1 claims=1 pegins=1
JS height=105 burn_payload=75 text_payload=75 records=3 burns=1 claims=1 pegins=1
JS height=106 burn_payload=77 text_payload=76 records=4 burns=1 claims=1 pegins=1
JS height=107 burn_payload=87 text_payload=80 records=5 burns=1 claims=1 pegins=1
JS height=108 burn_payload=14 text_payload=75 records=4 burns=1 claims=1 pegins=1
JS height=109 burn_payload=75 text_payload=76 records=4 burns=1 claims=1 pegins=1
JS height=110 burn_payload=79 text_payload=80 records=5 burns=1 claims=1 pegins=1
JS height=111 burn_payload=80 text_payload=75 records=5 burns=1 claims=1 pegins=1
JS built and accepted 10 consecutive adversarial blocks after 101-block maturity baseline; files retained under out/parity-*

```

Exit: 0; UTC end: 2026-09-22T19:10:36.421977+00:00

## Receipt: parity-rust

UTC start: 2026-09-22T19:10:36.459320+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-core --test verify_parity -- --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 2.66s
     Running tests/verify_parity.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_parity-efb0f059dfd72358)

running 1 test
RUST height=102 burns=1 claims=1 pegins=1 text_records=4 JS_text_records=4
RUST height=103 burns=1 claims=1 pegins=1 text_records=5 JS_text_records=5
RUST height=104 burns=1 claims=1 pegins=1 text_records=5 JS_text_records=5
RUST height=105 burns=1 claims=1 pegins=1 text_records=3 JS_text_records=3
RUST height=106 burns=1 claims=1 pegins=1 text_records=4 JS_text_records=4
RUST height=107 burns=1 claims=1 pegins=1 text_records=5 JS_text_records=5
RUST height=108 burns=1 claims=1 pegins=1 text_records=4 JS_text_records=4
RUST height=109 burns=1 claims=1 pegins=1 text_records=4 JS_text_records=4
RUST height=110 burns=1 claims=1 pegins=1 text_records=5 JS_text_records=5
RUST height=111 burns=1 claims=1 pegins=1 text_records=4 JS_text_records=5
PARITY total_blocks=10 differing_fields=1 differences=[{"height":111,"field":"records","rust":[{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":0,"text":"pegout:ababababababababababababababababababababababababababababababababababab"},{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":1,"text":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":3,"text":"a﻿b"},{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":5,"text":"pegin:v:﻿51206360e856310ce5d294e8be33fc807077dc56ac80d95d9cd4ddbd21325eff73f7"}],"js":[{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":0,"text":"pegout:ababababababababababababababababababababababababababababababababababab"},{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":1,"text":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":3,"text":"a﻿b"},{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":4,"text":"length-mismatch"},{"txid":"d993cf545d51ba82ef77573f8e917883fb2fc83c2a687a2114caec04f678d52f","vout":5,"text":"pegin:v:﻿51206360e856310ce5d294e8be33fc807077dc56ac80d95d9cd4ddbd21325eff73f7"}]}]

thread 'ten_js_blocks_compare_every_derived_list' (186854) panicked at sidestr-core/tests/verify_parity.rs:77:5:
strict parity failed; see out/parity-differences.json
stack backtrace:
   0: __rustc::rust_begin_unwind
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/panicking.rs:679:5
   1: core::panicking::panic_fmt
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/panicking.rs:80:14
   2: verify_parity::ten_js_blocks_compare_every_derived_list
             at ./tests/verify_parity.rs:77:5
   3: verify_parity::ten_js_blocks_compare_every_derived_list::{closure#0}
             at ./tests/verify_parity.rs:7:46
   4: <verify_parity::ten_js_blocks_compare_every_derived_list::{closure#0} as core::ops::function::FnOnce<()>>::call_once
             at /nix/store/5z8a51mk41ic4b55m5y8c85kgsaa7cv2-rust-minimal-1.98.1/lib/rustlib/src/rust/library/core/src/ops/function.rs:250:5
   5: <fn() -> core::result::Result<(), alloc::string::String> as core::ops::function::FnOnce<()>>::call_once
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5
note: Some details are omitted, run with `RUST_BACKTRACE=full` for a verbose backtrace.
test ten_js_blocks_compare_every_derived_list ... FAILED

failures:

failures:
    ten_js_blocks_compare_every_derived_list

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s

error: test failed, to rerun pass `-p sidestr-core --test verify_parity`

```

Exit: 101; UTC end: 2026-09-22T19:10:39.261924+00:00

## Receipt: shared-journal-failure

UTC start: 2026-09-22T19:10:39.333524+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-round --all-features --test verify_journal_rollback -- --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.93s
     Running tests/verify_journal_rollback.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_journal_rollback-17465cf7ec3fb647)

running 2 tests
test journal_child ... ignored, only invoked in an isolated child with RLIMIT_FSIZE

running 1 test
acknowledged block vote; bytes=176


thread 'two_live_journal_handles_preserve_acknowledged_vote_on_write_failure' (186959) panicked at sidestr-round/tests/verify_journal_rollback.rs:16:5:
acknowledged vote lost by second handle's failed append
stack backtrace:
   0: __rustc::rust_begin_unwind
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/panicking.rs:679:5
   1: core::panicking::panic_fmt
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/panicking.rs:80:14
   2: verify_journal_rollback::two_live_journal_handles_preserve_acknowledged_vote_on_write_failure
             at ./tests/verify_journal_rollback.rs:16:5
   3: verify_journal_rollback::two_live_journal_handles_preserve_acknowledged_vote_on_write_failure::{closure#0}
             at ./tests/verify_journal_rollback.rs:3:74
   4: <verify_journal_rollback::two_live_journal_handles_preserve_acknowledged_vote_on_write_failure::{closure#0} as core::ops::function::FnOnce<()>>::call_once
             at /nix/store/5z8a51mk41ic4b55m5y8c85kgsaa7cv2-rust-minimal-1.98.1/lib/rustlib/src/rust/library/core/src/ops/function.rs:250:5
   5: <fn() -> core::result::Result<(), alloc::string::String> as core::ops::function::FnOnce<()>>::call_once
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5
note: Some details are omitted, run with `RUST_BACKTRACE=full` for a verbose backtrace.
test two_live_journal_handles_preserve_acknowledged_vote_on_write_failure ... FAILED

failures:

failures:
    two_live_journal_handles_preserve_acknowledged_vote_on_write_failure

test result: FAILED. 0 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.22s

error: test failed, to rerun pass `-p sidestr-round --test verify_journal_rollback`

```

Exit: 101; UTC end: 2026-09-22T19:10:41.534247+00:00

## Receipt: provenance

UTC start: 2026-09-22T19:10:55.253397+00:00

Working directory: crates/sidestr

Command: `rustc -Vv && cargo -V && node --version && sha256sum sidestr-core/src/marker.rs sidestr-wallet/src/pegin.rs sidestr-round/src/journal.rs sidestr-round/src/round.rs sidestr-round/src/pegout.rs sidestr-round/src/node.rs sidestr-round/src/relay.rs && ls -ld ../../.git && git status`

```text
rustc 1.98.1 (48a229cea 2026-09-01)
binary: rustc
commit-hash: 48a229ceaefd4985c50990b14116b6d856af0985
commit-date: 2026-09-01
host: x86_64-unknown-linux-gnu
release: 1.98.1
LLVM version: 22.1.8
cargo 1.98.1 (797e8a9bc 2026-08-05)
v22.23.1
ab58194a8ec2994e598a70cb901e0dd9ea4f7e6a6376aff9c100111844747e27  sidestr-core/src/marker.rs
edc244c09011feb00f32bca63c888248310805953833e9e5e5d3c3d90957d815  sidestr-wallet/src/pegin.rs
67663cd5d5f167c288d90a4a0f46e713c61644add162002fe0a9b1cc36a33aac  sidestr-round/src/journal.rs
3d38f3fa54eadd4eddf0c27aa248e770e35dbcc7b6e0c6cb4a35910e02cbf91b  sidestr-round/src/round.rs
129fb91fe1939ab9646278738909e718d5dbd77e051550e85bee83417d7922f3  sidestr-round/src/pegout.rs
b025a0514b5469bbe8ecadb1c01f8a0a2dc1a1a591d7f25098320c8f5b772f09  sidestr-round/src/node.rs
1a588e11d75a9497a6f45d5efa5aa0a9414c05bd49c43f13ea3688f49226dbcd  sidestr-round/src/relay.rs
ls: cannot access '../../.git': No such file or directory

```

Exit: 2; UTC end: 2026-09-22T19:10:55.312969+00:00

## Receipt: shared-journal-normal-records

UTC start: 2026-09-22T19:11:32.665775+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-round --all-features --test verify_journal_rollback -- --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.92s
     Running tests/verify_journal_rollback.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_journal_rollback-17465cf7ec3fb647)

running 2 tests
test journal_child ... ignored, only invoked in an isolated child with RLIMIT_FSIZE

running 1 test
acknowledged block vote; bytes=912
second handle append=Err(Journal("/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/out/verify-shared-journal.jsonl: append: File too large (os error 27)")); retained_entries=0 file_bytes=0
test journal_child ... FAILED

failures:

failures:
    journal_child

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.26s


thread 'journal_child' (188642) panicked at sidestr-round/tests/verify_journal_rollback.rs:64:5:
assertion `left == right` failed: the acknowledged intent must remain after another handle fails
  left: 0
 right: 4
stack backtrace:
   0: __rustc::rust_begin_unwind
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/panicking.rs:679:5
   1: core::panicking::panic_fmt
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/panicking.rs:80:14
   2: core::panicking::assert_failed_inner
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/panicking.rs:434:23
   3: core::panicking::assert_failed::<usize, usize>
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/panicking.rs:394:5
   4: verify_journal_rollback::journal_child
             at ./tests/verify_journal_rollback.rs:64:5
   5: verify_journal_rollback::journal_child::{closure#0}
             at ./tests/verify_journal_rollback.rs:23:19
   6: <verify_journal_rollback::journal_child::{closure#0} as core::ops::function::FnOnce<()>>::call_once
             at /nix/store/5z8a51mk41ic4b55m5y8c85kgsaa7cv2-rust-minimal-1.98.1/lib/rustlib/src/rust/library/core/src/ops/function.rs:250:5
   7: <fn() -> core::result::Result<(), alloc::string::String> as core::ops::function::FnOnce<()>>::call_once
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5
note: Some details are omitted, run with `RUST_BACKTRACE=full` for a verbose backtrace.


thread 'two_live_journal_handles_preserve_acknowledged_vote_on_write_failure' (188639) panicked at sidestr-round/tests/verify_journal_rollback.rs:16:5:
acknowledged vote lost by second handle's failed append
stack backtrace:
   0: __rustc::rust_begin_unwind
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/panicking.rs:679:5
   1: core::panicking::panic_fmt
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/panicking.rs:80:14
   2: verify_journal_rollback::two_live_journal_handles_preserve_acknowledged_vote_on_write_failure
             at ./tests/verify_journal_rollback.rs:16:5
   3: verify_journal_rollback::two_live_journal_handles_preserve_acknowledged_vote_on_write_failure::{closure#0}
             at ./tests/verify_journal_rollback.rs:3:74
   4: <verify_journal_rollback::two_live_journal_handles_preserve_acknowledged_vote_on_write_failure::{closure#0} as core::ops::function::FnOnce<()>>::call_once
             at /nix/store/5z8a51mk41ic4b55m5y8c85kgsaa7cv2-rust-minimal-1.98.1/lib/rustlib/src/rust/library/core/src/ops/function.rs:250:5
   5: <fn() -> core::result::Result<(), alloc::string::String> as core::ops::function::FnOnce<()>>::call_once
             at /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5
note: Some details are omitted, run with `RUST_BACKTRACE=full` for a verbose backtrace.
test two_live_journal_handles_preserve_acknowledged_vote_on_write_failure ... FAILED

failures:

failures:
    two_live_journal_handles_preserve_acknowledged_vote_on_write_failure

test result: FAILED. 0 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.43s

error: test failed, to rerun pass `-p sidestr-round --test verify_journal_rollback`

```

Exit: 101; UTC end: 2026-09-22T19:11:34.051805+00:00

## Receipt: final-fmt

UTC start: 2026-09-22T19:11:34.106608+00:00

Working directory: crates/sidestr

Command: `cargo fmt --all -- --check`

```text

```

Exit: 0; UTC end: 2026-09-22T19:11:34.828841+00:00

## Receipt: final-clippy

UTC start: 2026-09-22T19:11:34.865829+00:00

Working directory: crates/sidestr

Command: `cargo clippy --workspace --all-targets --all-features -- -D warnings`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
    Checking sidestr-core v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-core)
    Checking sidestr-wallet v0.2.1 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-wallet)
    Checking sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
error: unused import: `sidestr_round::signer::LocalKey`
  --> sidestr-round/tests/verify_pegout.rs:10:5
   |
10 | use sidestr_round::signer::LocalKey;
   |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   |
   = note: `-D unused-imports` implied by `-D warnings`
   = help: to override `-D warnings` add `#[allow(unused_imports)]`

error: could not compile `sidestr-round` (test "verify_pegout") due to 1 previous error
warning: build failed, waiting for other jobs to finish...

```

Exit: 101; UTC end: 2026-09-22T19:11:36.616635+00:00

## Receipt: source-review

UTC start: 2026-09-22T19:12:24.080483+00:00

Working directory: crates/sidestr

Command: `python ../../out/review.py`

```text
Historical diff: NOT AVAILABLE inside permitted snapshot; no .git or diff/patch files. Supplied reports supply before-behaviour only; excerpts below are current layer evidence, not a fabricated diff.

### F1/F3 marker root sidestr-core/src/marker.rs
sidestr-core/src/marker.rs:76: /// the start of the stream and never yields U+FEFF for it). Every reader
sidestr-core/src/marker.rs:77: /// below that the reference text-decodes goes through this, and only those:
sidestr-core/src/marker.rs:78: /// the parent-side peg-out record and the checkpoint are compared as bytes
sidestr-core/src/marker.rs:79: /// there and here (`parent.mjs parsePegoutMarker`, `checkpoint.mjs
sidestr-core/src/marker.rs:80: /// parseCheckpoint`), so a marker leading with a BOM is not one of them in
sidestr-core/src/marker.rs:81: /// either engine.
sidestr-core/src/marker.rs:82: fn without_bom(d: &[u8]) -> &[u8] {
sidestr-core/src/marker.rs:83:     d.strip_prefix(BOM).unwrap_or(d)
sidestr-core/src/marker.rs:84: }
sidestr-core/src/marker.rs:85: 
sidestr-core/src/marker.rs:86: /// `d` as the reference's `TextDecoder` yields it: strict UTF-8 after
sidestr-core/src/marker.rs:87: /// [`without_bom`], `None` where the decoder would throw or, in the
sidestr-core/src/marker.rs:88: /// non-fatal readers, yield U+FFFD (which no marker grammar then matches).
sidestr-core/src/marker.rs:89: fn marker_text(d: &[u8]) -> Option<&str> {
sidestr-core/src/marker.rs:90:     std::str::from_utf8(without_bom(d)).ok()
sidestr-core/src/marker.rs:91: }
sidestr-core/src/marker.rs:92: 
sidestr-core/src/marker.rs:93: /// The text of an `OP_RETURN` output, or `None` when it is not a single push
sidestr-core/src/marker.rs:94: /// of at most 255 bytes of UTF-8 (`siding/lib/records.mjs recordText`). A
sidestr-core/src/marker.rs:95: /// push must be minimal: a direct push for up to 75 bytes, `OP_PUSHDATA1`
sidestr-core/src/marker.rs:96: /// above that. A leading byte-order mark is dropped, as the reference's
sidestr-core/src/marker.rs:97: /// `TextDecoder` drops it: `EF BB BF` + `issue:X:0` is the record `issue:X:0`.
sidestr-core/src/marker.rs:98: pub fn record_text(spk: &Script) -> Option<String> {
sidestr-core/src/marker.rs:99:     let b = spk.as_bytes();
sidestr-core/src/marker.rs:100:     if b.len() < 2 || b[0] != 0x6a {
sidestr-core/src/marker.rs:101:         return None;
sidestr-core/src/marker.rs:102:     }
sidestr-core/src/marker.rs:103:     let (len, data) = if b[1] == 0x4c {
sidestr-core/src/marker.rs:104:         if b.len() < 3 || b[2] <= 75 {
sidestr-core/src/marker.rs:105:             return None;
sidestr-core/src/marker.rs:106:         }
sidestr-core/src/marker.rs:107:         (usize::from(b[2]), &b[3..])
sidestr-core/src/marker.rs:108:     } else {
sidestr-core/src/marker.rs:109:         if b[1] > 75 {
sidestr-core/src/marker.rs:110:             return None;
sidestr-core/src/marker.rs:111:         }
sidestr-core/src/marker.rs:112:         (usize::from(b[1]), &b[2..])
sidestr-core/src/marker.rs:113:     };
sidestr-core/src/marker.rs:114:     if data.len() != len {
sidestr-core/src/marker.rs:115:         return None;
sidestr-core/src/marker.rs:116:     }
sidestr-core/src/marker.rs:117:     marker_text(data).map(str::to_string)
sidestr-core/src/marker.rs:118: }
sidestr-core/src/marker.rs:119: 
sidestr-core/src/marker.rs:120: /// A record: `OP_RETURN` with a minimal single push of the text
sidestr-core/src/marker.rs:121: /// (`siding/lib/records.mjs recordScript`); at most 255 bytes.
sidestr-core/src/marker.rs:122: pub fn record_script(text: &str) -> Result<ScriptBuf> {
sidestr-core/src/marker.rs:123:     let b = text.as_bytes();
sidestr-core/src/marker.rs:124:     if b.len() > 255 {
sidestr-core/src/marker.rs:125:         return Err(Error::Block("a record is at most 255 bytes".into()));
sidestr-core/src/marker.rs:126:     }
sidestr-core/src/marker.rs:127:     Ok(op_return(b))
sidestr-core/src/marker.rs:128: }
sidestr-core/src/marker.rs:129: 
sidestr-core/src/marker.rs:130: /// `OP_RETURN` with one minimal push of `data`: direct to 75 bytes,
sidestr-core/src/marker.rs:131: /// `OP_PUSHDATA1` to 255, `OP_PUSHDATA2` to 65 535, `OP_PUSHDATA4` beyond.
sidestr-core/src/marker.rs:139:     match data.len() {
sidestr-core/src/marker.rs:140:         n @ 0..=75 => out.push(n as u8),
sidestr-core/src/marker.rs:141:         n @ 76..=255 => out.extend_from_slice(&[0x4c, n as u8]),
sidestr-core/src/marker.rs:142:         n @ 256..=65_535 => {
sidestr-core/src/marker.rs:143:             out.push(0x4d);
sidestr-core/src/marker.rs:144:             out.extend_from_slice(&(n as u16).to_le_bytes());
sidestr-core/src/marker.rs:145:         }
sidestr-core/src/marker.rs:146:         n => {
sidestr-core/src/marker.rs:147:             out.push(0x4e);
sidestr-core/src/marker.rs:148:             out.extend_from_slice(&(n as u32).to_le_bytes());
sidestr-core/src/marker.rs:149:         }
sidestr-core/src/marker.rs:150:     }
sidestr-core/src/marker.rs:151:     out.extend_from_slice(data);
sidestr-core/src/marker.rs:152:     ScriptBuf::from_bytes(out)
sidestr-core/src/marker.rs:153: }
sidestr-core/src/marker.rs:154: 
sidestr-core/src/marker.rs:155: fn is_lower_hex(s: &str) -> bool {
sidestr-core/src/marker.rs:156:     s.bytes()
sidestr-core/src/marker.rs:157:         .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
sidestr-core/src/marker.rs:158: }
sidestr-core/src/marker.rs:159: 
sidestr-core/src/marker.rs:160: // --- peg-in (SPEC 6) -------------------------------------------------------
sidestr-core/src/marker.rs:161: 
sidestr-core/src/marker.rs:162: /// The peg-in marker's data: `pegin:<chain id>:` then the sidechain output
sidestr-core/src/marker.rs:163: /// script as raw bytes when that fits the parent's 80-byte data limit, as hex
sidestr-core/src/marker.rs:164: /// text otherwise (`siding/lib/marker.mjs pegMarkerData`).
sidestr-core/src/marker.rs:194:                 .map(ScriptBuf::from_bytes);
sidestr-core/src/marker.rs:195:         }
sidestr-core/src/marker.rs:196:     }
sidestr-core/src/marker.rs:197:     Some(ScriptBuf::from_bytes(rest.to_vec()))
sidestr-core/src/marker.rs:198: }
sidestr-core/src/marker.rs:199: 
sidestr-core/src/marker.rs:200: // --- claims (SPEC 6) -------------------------------------------------------
sidestr-core/src/marker.rs:201: 
sidestr-core/src/marker.rs:202: /// The payout output a claim marker follows.
sidestr-core/src/marker.rs:203: #[derive(Debug, Clone, PartialEq, Eq)]
sidestr-core/src/marker.rs:204: pub struct Payout {
sidestr-core/src/marker.rs:205:     /// Index of the payout in the coinbase.
sidestr-core/src/marker.rs:206:     pub index: usize,
sidestr-core/src/marker.rs:207:     /// Its value in sats.
sidestr-core/src/marker.rs:208:     pub value: u64,
sidestr-core/src/marker.rs:209:     /// The script paid: the one the peg-in marker named.
sidestr-core/src/marker.rs:210:     pub script_pubkey: ScriptBuf,
sidestr-core/src/marker.rs:211: }
sidestr-core/src/marker.rs:212: 
sidestr-core/src/marker.rs:213: /// A claim: two consecutive coinbase outputs, the payout then `claim:<txid>:<vout>`.
sidestr-core/src/marker.rs:214: #[derive(Debug, Clone, PartialEq, Eq)]
sidestr-core/src/marker.rs:257:     if vout > CLAIM_VOUT_MAX {
sidestr-core/src/marker.rs:258:         return Err(Error::Encoding(format!(
sidestr-core/src/marker.rs:259:             "a claim's vout is at most {CLAIM_VOUT_MAX} (five decimal digits), not {vout}"
sidestr-core/src/marker.rs:260:         )));
sidestr-core/src/marker.rs:261:     }
sidestr-core/src/marker.rs:262:     Ok(claim_marker(txid, vout))
sidestr-core/src/marker.rs:263: }
sidestr-core/src/marker.rs:264: 
sidestr-core/src/marker.rs:265: /// The claims a coinbase makes and the malformed ones (`siding/lib/overlay.mjs
sidestr-core/src/marker.rs:266: /// parseClaims`). A claim is two consecutive coinbase outputs: the payout,
sidestr-core/src/marker.rs:267: /// then an `OP_RETURN` carrying `claim:<parent txid>:<vout>`. The pairing is
sidestr-core/src/marker.rs:268: /// structural, so a level-1 validator, which has no parent view, can still
sidestr-core/src/marker.rs:269: /// bind each claimed amount to one outpoint; a level-2 validator checks the
sidestr-core/src/marker.rs:270: /// pair against the parent. A marker without a positive, spendable payout
sidestr-core/src/marker.rs:271: /// right before it is an error, not a claim.
sidestr-core/src/marker.rs:272: pub fn parse_claims(coinbase: &Transaction) -> (Vec<Claim>, Vec<String>) {
sidestr-core/src/marker.rs:273:     let mut claims = Vec::new();
sidestr-core/src/marker.rs:352: /// assert!(try_pegout_marker(&"5120".to_string()).is_ok()); // 2 bytes, the least
sidestr-core/src/marker.rs:353: /// assert!(try_pegout_marker(&"AB".repeat(40)).is_ok());    // 40 bytes, the most
sidestr-core/src/marker.rs:354: /// assert!(try_pegout_marker(&"ab".repeat(41)).is_err());
sidestr-core/src/marker.rs:355: /// assert!(try_pegout_marker("abc").is_err());
sidestr-core/src/marker.rs:356: /// assert!(try_pegout_marker("zz").is_err());
sidestr-core/src/marker.rs:357: /// ```
sidestr-core/src/marker.rs:358: pub fn try_pegout_marker(script_hex: &str) -> Result<ScriptBuf> {
sidestr-core/src/marker.rs:359:     let s = script_hex.to_ascii_lowercase();
sidestr-core/src/marker.rs:360:     if s.len() % 2 != 0 || !(4..=80).contains(&s.len()) || !is_lower_hex(&s) {
sidestr-core/src/marker.rs:361:         return Err(Error::Encoding(format!(
sidestr-core/src/marker.rs:362:             "a burn names a parent output script of 2 to 40 bytes as hex, not {script_hex:?}"
sidestr-core/src/marker.rs:363:         )));
sidestr-core/src/marker.rs:364:     }
sidestr-core/src/marker.rs:365:     Ok(pegout_marker(&s))
sidestr-core/src/marker.rs:366: }
sidestr-core/src/marker.rs:367: 
sidestr-core/src/marker.rs:368: /// The parent output script a burn names, when it is 2 to 40 bytes of lower
sidestr-core/src/marker.rs:369: /// hex (`siding/lib/overlay.mjs parsePegout`); `None` otherwise. The push is
sidestr-core/src/marker.rs:370: /// text-decoded as the reference decodes it, one leading byte-order mark
sidestr-core/src/marker.rs:371: /// dropped: `EF BB BF pegout:abcd` names `abcd`.
sidestr-core/src/marker.rs:372: pub fn parse_pegout(spk: &Script) -> Option<String> {
sidestr-core/src/marker.rs:373:     let d = op_return_data(spk)?;
sidestr-core/src/marker.rs:374:     let t = marker_text(d)?;
sidestr-core/src/marker.rs:375:     let s = t.strip_prefix("pegout:")?;
sidestr-core/src/marker.rs:376:     (s.len() % 2 == 0 && (4..=80).contains(&s.len()) && is_lower_hex(s)).then(|| s.to_string())
sidestr-core/src/marker.rs:377: }
sidestr-core/src/marker.rs:378: 
sidestr-core/src/marker.rs:379: /// Every burn in a transaction (`siding/lib/overlay.mjs parsePegouts`); the
sidestr-core/src/marker.rs:380: /// height is the caller's to fill.

### F4 wallet sidestr-wallet/src/pegin.rs
sidestr-wallet/src/pegin.rs:265: /// its `send` would fail at the node.)
sidestr-wallet/src/pegin.rs:266: pub fn pegout_payment_outputs(
sidestr-wallet/src/pegin.rs:267:     chain_id: &str,
sidestr-wallet/src/pegin.rs:268:     side_txid: &str,
sidestr-wallet/src/pegin.rs:269:     parent_script_hex: &str,
sidestr-wallet/src/pegin.rs:270:     value: u64,
sidestr-wallet/src/pegin.rs:271: ) -> Result<Vec<TxOut>> {
sidestr-wallet/src/pegin.rs:272:     let script = ScriptBuf::from_hex(parent_script_hex)
sidestr-wallet/src/pegin.rs:273:         .map_err(|_| Error::BadDestination(parent_script_hex.to_string()))?;
sidestr-wallet/src/pegin.rs:274:     let data = pegout_marker_data(chain_id, side_txid)?;
sidestr-wallet/src/pegin.rs:275:     if data.len() > PARENT_DATA_LIMIT {
sidestr-wallet/src/pegin.rs:276:         return Err(Error::MarkerTooLong(data.len()));
sidestr-wallet/src/pegin.rs:277:     }
sidestr-wallet/src/pegin.rs:278:     Ok(vec![
sidestr-wallet/src/pegin.rs:279:         TxOut {
sidestr-wallet/src/pegin.rs:280:             value: Amount::from_sat(value),
sidestr-wallet/src/pegin.rs:281:             script_pubkey: script,
sidestr-wallet/src/pegin.rs:282:         },
sidestr-wallet/src/pegin.rs:283:         TxOut {
sidestr-wallet/src/pegin.rs:284:             value: Amount::ZERO,
sidestr-wallet/src/pegin.rs:285:             script_pubkey: op_return(&data)?,
sidestr-wallet/src/pegin.rs:286:         },
sidestr-wallet/src/pegin.rs:287:     ])
sidestr-wallet/src/pegin.rs:288: }
sidestr-wallet/src/pegin.rs:289: 
sidestr-wallet/src/pegin.rs:290: /// The producer's checkpoint on the parent (SPEC 11;

### C1 journal and new shared-handle blocker sidestr-round/src/journal.rs
sidestr-round/src/journal.rs:174: fn parse(bytes: &[u8], path: &Path) -> Result<Parsed> {
sidestr-round/src/journal.rs:175:     let mut entries = Vec::new();
sidestr-round/src/journal.rs:176:     let mut pos = 0usize;
sidestr-round/src/journal.rs:177:     let mut line_no = 0usize;
sidestr-round/src/journal.rs:178:     let mut durable_len = 0u64;
sidestr-round/src/journal.rs:179:     let mut torn = None;
sidestr-round/src/journal.rs:180:     while pos < bytes.len() {
sidestr-round/src/journal.rs:181:         line_no += 1;
sidestr-round/src/journal.rs:182:         let rest = &bytes[pos..];
sidestr-round/src/journal.rs:183:         match rest.iter().position(|b| *b == b'\n') {
sidestr-round/src/journal.rs:184:             Some(nl) => {
sidestr-round/src/journal.rs:185:                 let line = &rest[..nl];
sidestr-round/src/journal.rs:186:                 let text = std::str::from_utf8(line).map_err(|e| {
sidestr-round/src/journal.rs:187:                     Error::Journal(format!("{} line {line_no}: {e}", path.display()))
sidestr-round/src/journal.rs:188:                 })?;
sidestr-round/src/journal.rs:189:                 if !text.trim().is_empty() {
sidestr-round/src/journal.rs:190:                     let e = serde_json::from_str::<VoteEntry>(text).map_err(|e| {
sidestr-round/src/journal.rs:191:                         Error::Journal(format!("{} line {line_no}: {e}", path.display()))
sidestr-round/src/journal.rs:192:                     })?;
sidestr-round/src/journal.rs:193:                     entries.push(e);
sidestr-round/src/journal.rs:194:                 }
sidestr-round/src/journal.rs:195:                 pos += nl + 1;
sidestr-round/src/journal.rs:196:                 durable_len = pos as u64;
sidestr-round/src/journal.rs:197:             }
sidestr-round/src/journal.rs:198:             None => {
sidestr-round/src/journal.rs:199:                 let whole = std::str::from_utf8(rest)
sidestr-round/src/journal.rs:200:                     .ok()
sidestr-round/src/journal.rs:201:                     .and_then(|t| serde_json::from_str::<VoteEntry>(t).ok());
sidestr-round/src/journal.rs:202:                 torn = Some((pos as u64, whole));
sidestr-round/src/journal.rs:203:                 break;
sidestr-round/src/journal.rs:204:             }
sidestr-round/src/journal.rs:205:         }
sidestr-round/src/journal.rs:206:     }
sidestr-round/src/journal.rs:207:     Ok(Parsed {
sidestr-round/src/journal.rs:208:         entries,
sidestr-round/src/journal.rs:209:         durable_len,
sidestr-round/src/journal.rs:230:     pub fn open(path: impl AsRef<Path>) -> Result<Self> {
sidestr-round/src/journal.rs:231:         let path = path.as_ref().to_path_buf();
sidestr-round/src/journal.rs:232:         if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
sidestr-round/src/journal.rs:233:             std::fs::create_dir_all(dir)?;
sidestr-round/src/journal.rs:234:         }
sidestr-round/src/journal.rs:235:         let existed = path.exists();
sidestr-round/src/journal.rs:236:         let mut file = OpenOptions::new()
sidestr-round/src/journal.rs:237:             .create(true)
sidestr-round/src/journal.rs:238:             .append(true)
sidestr-round/src/journal.rs:239:             .read(true)
sidestr-round/src/journal.rs:240:             .open(&path)
sidestr-round/src/journal.rs:241:             .map_err(|e| journal_err(&path, "open", e))?;
sidestr-round/src/journal.rs:242:         if !existed {
sidestr-round/src/journal.rs:243:             file.sync_all()
sidestr-round/src/journal.rs:244:                 .map_err(|e| journal_err(&path, "fsync", e))?;
sidestr-round/src/journal.rs:245:             sync_dir(&path)?;
sidestr-round/src/journal.rs:246:         }
sidestr-round/src/journal.rs:247:         let mut bytes = Vec::new();
sidestr-round/src/journal.rs:248:         file.read_to_end(&mut bytes)
sidestr-round/src/journal.rs:249:             .map_err(|e| journal_err(&path, "read", e))?;
sidestr-round/src/journal.rs:250:         let parsed = parse(&bytes, &path)?;
sidestr-round/src/journal.rs:251:         let mut durable_len = parsed.durable_len;
sidestr-round/src/journal.rs:252:         if let Some((start, whole)) = parsed.torn {
sidestr-round/src/journal.rs:253:             match whole {
sidestr-round/src/journal.rs:254:                 Some(_) => {
sidestr-round/src/journal.rs:255:                     // a whole entry that lost only its newline: terminate it
sidestr-round/src/journal.rs:256:                     file.write_all(b"\n")
sidestr-round/src/journal.rs:257:                         .map_err(|e| journal_err(&path, "repair", e))?;
sidestr-round/src/journal.rs:258:                     durable_len = bytes.len() as u64 + 1;
sidestr-round/src/journal.rs:259:                 }
sidestr-round/src/journal.rs:260:                 None => {
sidestr-round/src/journal.rs:261:                     file.set_len(start)
sidestr-round/src/journal.rs:262:                         .map_err(|e| journal_err(&path, "truncate torn tail", e))?;
sidestr-round/src/journal.rs:263:                     durable_len = start;
sidestr-round/src/journal.rs:264:                 }
sidestr-round/src/journal.rs:265:             }
sidestr-round/src/journal.rs:266:             file.sync_all()
sidestr-round/src/journal.rs:267:                 .map_err(|e| journal_err(&path, "fsync repair", e))?;
sidestr-round/src/journal.rs:268:             sync_dir(&path)?;
sidestr-round/src/journal.rs:269:         }
sidestr-round/src/journal.rs:270:         Ok(Self {
sidestr-round/src/journal.rs:271:             path,
sidestr-round/src/journal.rs:272:             file,
sidestr-round/src/journal.rs:273:             durable_len,
sidestr-round/src/journal.rs:274:             poisoned: None,
sidestr-round/src/journal.rs:275:         })
sidestr-round/src/journal.rs:276:     }
sidestr-round/src/journal.rs:284:     fn record(&mut self, entry: &VoteEntry) -> Result<()> {
sidestr-round/src/journal.rs:285:         if let Some(why) = &self.poisoned {
sidestr-round/src/journal.rs:286:             return Err(Error::Journal(format!(
sidestr-round/src/journal.rs:287:                 "{}: refusing every write after a failed append: {why}",
sidestr-round/src/journal.rs:288:                 self.path.display()
sidestr-round/src/journal.rs:289:             )));
sidestr-round/src/journal.rs:290:         }
sidestr-round/src/journal.rs:291:         let mut line = serde_json::to_string(entry).map_err(|e| Error::Journal(e.to_string()))?;
sidestr-round/src/journal.rs:292:         line.push('\n');
sidestr-round/src/journal.rs:293:         let written = self
sidestr-round/src/journal.rs:294:             .file
sidestr-round/src/journal.rs:295:             .write_all(line.as_bytes())
sidestr-round/src/journal.rs:296:             .and_then(|()| self.file.sync_data());
sidestr-round/src/journal.rs:297:         match written {
sidestr-round/src/journal.rs:298:             Ok(()) => {
sidestr-round/src/journal.rs:299:                 self.durable_len += line.len() as u64;
sidestr-round/src/journal.rs:300:                 Ok(())
sidestr-round/src/journal.rs:301:             }
sidestr-round/src/journal.rs:302:             Err(e) => {
sidestr-round/src/journal.rs:303:                 // cut back to the last record boundary so a torn line is never appended to
sidestr-round/src/journal.rs:304:                 let rolled = self
sidestr-round/src/journal.rs:305:                     .file
sidestr-round/src/journal.rs:306:                     .set_len(self.durable_len)
sidestr-round/src/journal.rs:307:                     .and_then(|()| self.file.sync_data());
sidestr-round/src/journal.rs:308:                 if let Err(r) = rolled {
sidestr-round/src/journal.rs:309:                     self.poisoned = Some(format!("{e}; rollback failed: {r}"));
sidestr-round/src/journal.rs:310:                 }
sidestr-round/src/journal.rs:311:                 Err(journal_err(&self.path, "append", e))
sidestr-round/src/journal.rs:312:             }
sidestr-round/src/journal.rs:313:         }
sidestr-round/src/journal.rs:314:     }
sidestr-round/src/journal.rs:315: 
sidestr-round/src/journal.rs:316:     fn entries(&self) -> Result<Vec<VoteEntry>> {
sidestr-round/src/journal.rs:317:         if let Some(why) = &self.poisoned {

### C2/C5 burn guard sidestr-round/src/pegout.rs
sidestr-round/src/pegout.rs:651: impl PegoutRound {
sidestr-round/src/pegout.rs:652:     /// A round for `fed` on `chain_id` as `signer`, with the journal loaded
sidestr-round/src/pegout.rs:653:     /// and the ledger of what is already paid.
sidestr-round/src/pegout.rs:654:     pub fn new(
sidestr-round/src/pegout.rs:655:         fed: Federation,
sidestr-round/src/pegout.rs:656:         chain_id: &str,
sidestr-round/src/pegout.rs:657:         signer: Box<dyn RoundSigner>,
sidestr-round/src/pegout.rs:658:         journal: Box<dyn VoteJournal>,
sidestr-round/src/pegout.rs:659:         cfg: PegoutConfig,
sidestr-round/src/pegout.rs:660:         ledger: PegoutLedger,
sidestr-round/src/pegout.rs:661:     ) -> Result<Self> {
sidestr-round/src/pegout.rs:662:         let me = signer.pubkey();
sidestr-round/src/pegout.rs:663:         if !fed.signers.contains(&me) {
sidestr-round/src/pegout.rs:664:             return Err(Error::Key("this key is not one of the signers".into()));
sidestr-round/src/pegout.rs:665:         }
sidestr-round/src/pegout.rs:666:         let mut authorised = BTreeMap::new();
sidestr-round/src/pegout.rs:667:         for e in journal.entries()? {
sidestr-round/src/pegout.rs:737:     /// The one guard both paths consult: no payment authorised for this
sidestr-round/src/pegout.rs:738:     /// burn, or the one there is has had its window (`resign_after`
sidestr-round/src/pegout.rs:739:     /// seconds or more, as `pegoutround.mjs onProposal` compares) and the
sidestr-round/src/pegout.rs:740:     /// policy allows another.
sidestr-round/src/pegout.rs:741:     fn may_sign_burn(&self, key: &str, now_ms: u64) -> bool {
sidestr-round/src/pegout.rs:742:         match (self.authorised.get(key), self.cfg.resign_after) {
sidestr-round/src/pegout.rs:743:             (None, _) => true,
sidestr-round/src/pegout.rs:744:             (Some(_), None) => false,
sidestr-round/src/pegout.rs:745:             (Some(at), Some(w)) => now_ms.saturating_sub(*at) >= w * 1000,
sidestr-round/src/pegout.rs:746:         }
sidestr-round/src/pegout.rs:747:     }
sidestr-round/src/pegout.rs:787:     fn intent(
sidestr-round/src/pegout.rs:788:         &mut self,
sidestr-round/src/pegout.rs:789:         key: &str,
sidestr-round/src/pegout.rs:790:         role: VoteRole,
sidestr-round/src/pegout.rs:791:         subject: &str,
sidestr-round/src/pegout.rs:792:         psbt: &Psbt,
sidestr-round/src/pegout.rs:793:         now_ms: u64,
sidestr-round/src/pegout.rs:794:     ) -> Result<()> {
sidestr-round/src/pegout.rs:795:         self.journal(key, role, subject, psbt, now_ms, None)?;
sidestr-round/src/pegout.rs:796:         self.authorised.insert(key.to_string(), now_ms);
sidestr-round/src/pegout.rs:797:         Ok(())
sidestr-round/src/pegout.rs:798:     }
sidestr-round/src/pegout.rs:799: 
sidestr-round/src/pegout.rs:800:     /// Intent, then the custody signer over every input, then the
sidestr-round/src/pegout.rs:801:     /// signature record: the order the journal guarantees. `Err(false, _)`
sidestr-round/src/pegout.rs:802:     /// means the signer was never asked; `Err(true, _)` that signatures
sidestr-round/src/pegout.rs:803:     /// exist, the intent is journalled, and nothing is to be published.
sidestr-round/src/pegout.rs:804:     fn authorise(
sidestr-round/src/pegout.rs:805:         &mut self,
sidestr-round/src/pegout.rs:806:         key: &str,
sidestr-round/src/pegout.rs:807:         role: VoteRole,
sidestr-round/src/pegout.rs:808:         subject: &str,
sidestr-round/src/pegout.rs:809:         psbt: &mut Psbt,
sidestr-round/src/pegout.rs:810:         now_ms: u64,
sidestr-round/src/pegout.rs:811:     ) -> core::result::Result<(), (bool, Error)> {
sidestr-round/src/pegout.rs:812:         self.intent(key, role, subject, psbt, now_ms)
sidestr-round/src/pegout.rs:813:             .map_err(|e| (false, e))?;
sidestr-round/src/pegout.rs:814:         sign_pegout_psbt(psbt, &self.fed, &self.chain_id, key, self.signer.as_ref())
sidestr-round/src/pegout.rs:815:             .map_err(|e| (true, e))?;
sidestr-round/src/pegout.rs:816:         let sigs = self.my_signatures(psbt);
sidestr-round/src/pegout.rs:817:         self.journal(key, role, subject, psbt, now_ms, Some(sigs))
sidestr-round/src/pegout.rs:818:             .map_err(|e| (true, e))?;
sidestr-round/src/pegout.rs:843:             }
sidestr-round/src/pegout.rs:844:             // then upstream's retry throttle: not within propose_after × n of my last attempt
sidestr-round/src/pegout.rs:845:             let last = self
sidestr-round/src/pegout.rs:846:                 .authorised
sidestr-round/src/pegout.rs:847:                 .get(&key)
sidestr-round/src/pegout.rs:848:                 .copied()
sidestr-round/src/pegout.rs:849:                 .max(self.backoff.get(&key).copied());
sidestr-round/src/pegout.rs:850:             if last.is_some_and(|at| now.saturating_sub(at) < self.ring_ms()) {
sidestr-round/src/pegout.rs:851:                 continue;
sidestr-round/src/pegout.rs:852:             }
sidestr-round/src/pegout.rs:853:             let me = self.me;
sidestr-round/src/pegout.rs:854:             if self.entitled(&me, b.height, now, now) {
sidestr-round/src/pegout.rs:855:                 if let Err(e) = self.propose(now, b, coins, &mut out) {
sidestr-round/src/pegout.rs:856:                     out.push(PegoutAction::Log(format!("peg-out round: {e}")));
sidestr-round/src/pegout.rs:857:                     self.backoff.insert(key, now);
sidestr-round/src/pegout.rs:858:                 }
sidestr-round/src/pegout.rs:859:             }
sidestr-round/src/pegout.rs:860:         }
sidestr-round/src/pegout.rs:861:         let stale: Vec<String> = self
sidestr-round/src/pegout.rs:862:             .pending
sidestr-round/src/pegout.rs:863:             .iter()
sidestr-round/src/pegout.rs:864:             .filter(|(_, p)| now.saturating_sub(p.at) > self.ring_ms())
sidestr-round/src/pegout.rs:865:             .map(|(k, _)| k.clone())
sidestr-round/src/pegout.rs:866:             .collect();
sidestr-round/src/pegout.rs:867:         for k in stale {
sidestr-round/src/pegout.rs:868:             let p = self.pending.remove(&k).expect("listed");
sidestr-round/src/pegout.rs:869:             out.push(PegoutAction::Log(format!(
sidestr-round/src/pegout.rs:870:                 "peg-out round: dropping my proposal for {}… ({} signature(s))",
sidestr-round/src/pegout.rs:871:                 short(&k, 16),
sidestr-round/src/pegout.rs:888:         coins: &[PegCoin],
sidestr-round/src/pegout.rs:889:         out: &mut Vec<PegoutAction>,
sidestr-round/src/pegout.rs:890:     ) -> Result<()> {
sidestr-round/src/pegout.rs:891:         let key = burn_key(b);
sidestr-round/src/pegout.rs:892:         let mut psbt = build_pegout_psbt(&self.fed, &self.chain_id, b, coins, self.cfg.fee_rate)?;
sidestr-round/src/pegout.rs:893:         self.intent(&key, VoteRole::Proposed, "", &psbt, now)?;
sidestr-round/src/pegout.rs:894:         sign_pegout_psbt(
sidestr-round/src/pegout.rs:895:             &mut psbt,
sidestr-round/src/pegout.rs:896:             &self.fed,
sidestr-round/src/pegout.rs:897:             &self.chain_id,
sidestr-round/src/pegout.rs:898:             &key,
sidestr-round/src/pegout.rs:899:             self.signer.as_ref(),
sidestr-round/src/pegout.rs:900:         )?;
sidestr-round/src/pegout.rs:901:         let ev = sign_psbt_event(
sidestr-round/src/pegout.rs:902:             self.signer.as_ref(),
sidestr-round/src/pegout.rs:903:             &PegoutPsbt {
sidestr-round/src/pegout.rs:904:                 chain_id: self.chain_id.clone(),
sidestr-round/src/pegout.rs:905:                 burn: Outpoint {
sidestr-round/src/pegout.rs:906:                     txid: b.txid.clone(),
sidestr-round/src/pegout.rs:907:                     vout: b.vout,
sidestr-round/src/pegout.rs:908:                 },
sidestr-round/src/pegout.rs:909:                 height: b.height,
sidestr-round/src/pegout.rs:910:                 psbt: psbt.to_string(),
sidestr-round/src/pegout.rs:911:             },
sidestr-round/src/pegout.rs:912:             now / 1000,
sidestr-round/src/pegout.rs:913:         )?;
sidestr-round/src/pegout.rs:914:         let sigs_hex = self.my_signatures(&psbt);
sidestr-round/src/pegout.rs:915:         self.journal(&key, VoteRole::Proposed, &ev.id, &psbt, now, Some(sigs_hex))?;
sidestr-round/src/pegout.rs:916:         let mut sigs = BTreeMap::new();
sidestr-round/src/pegout.rs:917:         sigs.insert(self.me_hex.clone(), psbt.clone());
sidestr-round/src/pegout.rs:918:         self.pending.insert(
sidestr-round/src/pegout.rs:919:             key.clone(),
sidestr-round/src/pegout.rs:920:             PendingPegout {

### C4/C5 block guard sidestr-round/src/round.rs
sidestr-round/src/round.rs:325:     /// `round.mjs mayReSign`: no signature at this height, or the one there
sidestr-round/src/round.rs:326:     /// is has had its window to seal — strictly more than `resign_after`
sidestr-round/src/round.rs:327:     /// seconds, measured in milliseconds.
sidestr-round/src/round.rs:328:     fn may_resign(&self, height: u32, now_ms: u64) -> bool {
sidestr-round/src/round.rs:329:         match (self.signed.get(&height), self.cfg.resign_after) {
sidestr-round/src/round.rs:330:             (None, _) => true,
sidestr-round/src/round.rs:331:             (Some(_), None) => false,
sidestr-round/src/round.rs:332:             (Some(prev), Some(after)) => now_ms.saturating_sub(prev.at) > after * 1000,
sidestr-round/src/round.rs:333:         }
sidestr-round/src/round.rs:334:     }
sidestr-round/src/round.rs:335: 
sidestr-round/src/round.rs:336:     /// `propose_after × n`, in milliseconds: the proposal's life.
sidestr-round/src/round.rs:337:     fn ring_ms(&self) -> u64 {
sidestr-round/src/round.rs:338:         self.cfg.propose_after * 1000 * self.n()
sidestr-round/src/round.rs:339:     }
sidestr-round/src/round.rs:340: 
sidestr-round/src/round.rs:413:         &mut self,
sidestr-round/src/round.rs:414:         block: &F::Block,
sidestr-round/src/round.rs:415:         height: u32,
sidestr-round/src/round.rs:416:         role: VoteRole,
sidestr-round/src/round.rs:417:         subject: &str,
sidestr-round/src/round.rs:418:         now_ms: u64,
sidestr-round/src/round.rs:419:     ) -> core::result::Result<Signature, (bool, Error)> {
sidestr-round/src/round.rs:420:         let tid = self.template_id(block).map_err(|e| (false, e))?;
sidestr-round/src/round.rs:421:         self.journal(tid, height, role, subject, now_ms, None)
sidestr-round/src/round.rs:422:             .map_err(|e| (false, e))?;
sidestr-round/src/round.rs:423:         // journalled: from here the height counts as signed whatever happens next
sidestr-round/src/round.rs:424:         self.signed.insert(
sidestr-round/src/round.rs:425:             height,
sidestr-round/src/round.rs:426:             SignedAt {
sidestr-round/src/round.rs:427:                 id: subject.to_string(),
sidestr-round/src/round.rs:428:                 at: now_ms,
sidestr-round/src/round.rs:429:             },
sidestr-round/src/round.rs:430:         );
sidestr-round/src/round.rs:431:         let sig = self.partial(block, height, tid).map_err(|e| (true, e))?;
sidestr-round/src/round.rs:432:         self.journal(tid, height, role, subject, now_ms, Some(&sig))
sidestr-round/src/round.rs:433:             .map_err(|e| (true, e))?;
sidestr-round/src/round.rs:434:         Ok(sig)
sidestr-round/src/round.rs:435:     }
sidestr-round/src/round.rs:582:         };
sidestr-round/src/round.rs:583:         if ev.pubkey == self.me_hex {
sidestr-round/src/round.rs:584:             return;
sidestr-round/src/round.rs:585:         }
sidestr-round/src/round.rs:586:         // a relay replaying an old proposal: its proposer has moved on
sidestr-round/src/round.rs:587:         if now.saturating_sub(ev.created_at.saturating_mul(1000)) > self.ring_ms() {
sidestr-round/src/round.rs:588:             return;
sidestr-round/src/round.rs:589:         }
sidestr-round/src/round.rs:590:         let secs = now / 1000;
sidestr-round/src/round.rs:591:         let log = |s: String| Action::Log(s);

### C3 transport sidestr-round/src/relay.rs
sidestr-round/src/relay.rs:43:         .unwrap_or(0)
sidestr-round/src/relay.rs:44: }
sidestr-round/src/relay.rs:45: 
sidestr-round/src/relay.rs:46: /// The TLS client configuration `wss://` uses: rustls, the `ring`
sidestr-round/src/relay.rs:47: /// provider, TLS 1.2 and 1.3, the Mozilla root store, no client
sidestr-round/src/relay.rs:48: /// certificate. Built once per process: the root store is some hundred
sidestr-round/src/relay.rs:49: /// certificates, and a signer publishes on a fresh connection every time.
sidestr-round/src/relay.rs:50: pub fn default_tls_config() -> Arc<rustls::ClientConfig> {
sidestr-round/src/relay.rs:51:     static CONFIG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
sidestr-round/src/relay.rs:52:     CONFIG
sidestr-round/src/relay.rs:53:         .get_or_init(|| {
sidestr-round/src/relay.rs:54:             let mut roots = rustls::RootCertStore::empty();
sidestr-round/src/relay.rs:55:             roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
sidestr-round/src/relay.rs:56:             Arc::new(
sidestr-round/src/relay.rs:57:                 rustls::ClientConfig::builder_with_provider(Arc::new(
sidestr-round/src/relay.rs:58:                     rustls::crypto::ring::default_provider(),
sidestr-round/src/relay.rs:59:                 ))
sidestr-round/src/relay.rs:60:                 .with_safe_default_protocol_versions()
sidestr-round/src/relay.rs:61:                 .expect("ring supports TLS 1.2 and 1.3")
sidestr-round/src/relay.rs:62:                 .with_root_certificates(roots)
sidestr-round/src/relay.rs:63:                 .with_no_client_auth(),
sidestr-round/src/relay.rs:64:             )
sidestr-round/src/relay.rs:65:         })
sidestr-round/src/relay.rs:66:         .clone()
sidestr-round/src/relay.rs:67: }
sidestr-round/src/relay.rs:68: 
sidestr-round/src/relay.rs:69: /// [`Connector::Rustls`] over [`default_tls_config`]: what `ws://` and
sidestr-round/src/relay.rs:70: /// `wss://` URLs are opened with unless a caller says otherwise.
sidestr-round/src/relay.rs:71: pub fn default_connector() -> Connector {
sidestr-round/src/relay.rs:72:     Connector::Rustls(default_tls_config())
sidestr-round/src/relay.rs:73: }
sidestr-round/src/relay.rs:74: 
sidestr-round/src/relay.rs:75: /// One websocket connection to `url`, plain or TLS by its scheme. The
sidestr-round/src/relay.rs:76: /// error is boxed: tungstenite's is large and this is the cold path.
sidestr-round/src/relay.rs:77: async fn connect(
sidestr-round/src/relay.rs:78:     url: &str,
sidestr-round/src/relay.rs:79:     connector: &Connector,
sidestr-round/src/relay.rs:80: ) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, Box<tokio_tungstenite::tungstenite::Error>>
sidestr-round/src/relay.rs:81: {
sidestr-round/src/relay.rs:82:     tokio_tungstenite::connect_async_tls_with_config(url, None, false, Some(connector.clone()))
sidestr-round/src/relay.rs:83:         .await
sidestr-round/src/relay.rs:84:         .map(|(ws, _)| ws)

### C6 indexed reads/body cap and two-handle wiring sidestr-round/src/node.rs
sidestr-round/src/node.rs:304:     /// loop's thread, where nothing can accept a block meanwhile.
sidestr-round/src/node.rs:305:     fn committed_dat(&self, range: Option<&str>) -> DatReply {
sidestr-round/src/node.rs:306:         let end = self
sidestr-round/src/node.rs:307:             .chain
sidestr-round/src/node.rs:308:             .index()
sidestr-round/src/node.rs:309:             .blocks
sidestr-round/src/node.rs:310:             .last()
sidestr-round/src/node.rs:311:             .map(|e| e.offset + HEADER + u64::from(e.size))
sidestr-round/src/node.rs:312:             .unwrap_or(0);
sidestr-round/src/node.rs:313:         let bytes = match std::fs::read(self.chain.dat_path()) {
sidestr-round/src/node.rs:314:             Ok(b) => b,
sidestr-round/src/node.rs:315:             Err(e) => {
sidestr-round/src/node.rs:316:                 return DatReply {
sidestr-round/src/node.rs:317:                     code: 500,
sidestr-round/src/node.rs:318:                     body: serde_json::json!({"error": e.to_string()})
sidestr-round/src/node.rs:319:                         .to_string()
sidestr-round/src/node.rs:320:                         .into_bytes(),
sidestr-round/src/node.rs:321:                     content_range: None,
sidestr-round/src/node.rs:322:                 }
sidestr-round/src/node.rs:323:             }
sidestr-round/src/node.rs:324:         };
sidestr-round/src/node.rs:325:         if (bytes.len() as u64) < end {
sidestr-round/src/node.rs:326:             return DatReply {
sidestr-round/src/node.rs:327:                 code: 500,
sidestr-round/src/node.rs:328:                 body: serde_json::json!({"error": "the block file is shorter than its index"})
sidestr-round/src/node.rs:329:                     .to_string()
sidestr-round/src/node.rs:330:                     .into_bytes(),
sidestr-round/src/node.rs:331:                 content_range: None,
sidestr-round/src/node.rs:332:             };
sidestr-round/src/node.rs:333:         }
sidestr-round/src/node.rs:334:         let committed = &bytes[..end as usize];
sidestr-round/src/node.rs:335:         match range {
sidestr-round/src/node.rs:336:             None => DatReply {
sidestr-round/src/node.rs:337:                 code: 200,
sidestr-round/src/node.rs:338:                 body: committed.to_vec(),
sidestr-round/src/node.rs:339:                 content_range: None,
sidestr-round/src/node.rs:340:             },
sidestr-round/src/node.rs:341:             Some(h) => match parse_range(h, end) {
sidestr-round/src/node.rs:342:                 Some((s, e)) => DatReply {
sidestr-round/src/node.rs:343:                     code: 206,
sidestr-round/src/node.rs:344:                     body: committed[s as usize..=e as usize].to_vec(),
sidestr-round/src/node.rs:345:                     content_range: Some(format!("bytes {s}-{e}/{end}")),
sidestr-round/src/node.rs:346:                 },
sidestr-round/src/node.rs:347:                 None => DatReply {
sidestr-round/src/node.rs:348:                     code: 416,
sidestr-round/src/node.rs:349:                     body: Vec::new(),
sidestr-round/src/node.rs:350:                     content_range: Some(format!("bytes */{end}")),
sidestr-round/src/node.rs:351:                 },
sidestr-round/src/node.rs:352:             },
sidestr-round/src/node.rs:353:         }
sidestr-round/src/node.rs:354:     }
sidestr-round/src/node.rs:355: 
sidestr-round/src/node.rs:356:     fn answer(&mut self, q: Query) {
sidestr-round/src/node.rs:357:         match q {
sidestr-round/src/node.rs:358:             Query::Status(r) => {
sidestr-round/src/node.rs:359:                 let _ = r.send(self.status());
sidestr-round/src/node.rs:360:             }
sidestr-round/src/node.rs:361:             Query::Tip(r) => {
sidestr-round/src/node.rs:695:                 }
sidestr-round/src/node.rs:696:                 ("POST", "/tx") => {
sidestr-round/src/node.rs:697:                     let too_large = json(
sidestr-round/src/node.rs:698:                         413,
sidestr-round/src/node.rs:699:                         &serde_json::json!({"error": format!("the body is over {MAX_TX_BODY} bytes")}),
sidestr-round/src/node.rs:700:                     );
sidestr-round/src/node.rs:701:                     if req.body_length().is_some_and(|n| n > MAX_TX_BODY) {
sidestr-round/src/node.rs:702:                         let _ = req.respond(too_large);
sidestr-round/src/node.rs:703:                         continue;
sidestr-round/src/node.rs:704:                     }
sidestr-round/src/node.rs:705:                     let mut body = String::new();
sidestr-round/src/node.rs:706:                     let read = std::io::Read::read_to_string(
sidestr-round/src/node.rs:707:                         &mut std::io::Read::take(req.as_reader(), MAX_TX_BODY as u64 + 1),
sidestr-round/src/node.rs:708:                         &mut body,
sidestr-round/src/node.rs:709:                     );
sidestr-round/src/node.rs:710:                     if read.is_err() || body.len() > MAX_TX_BODY {
sidestr-round/src/node.rs:711:                         let _ = req.respond(too_large);
sidestr-round/src/node.rs:712:                         continue;
sidestr-round/src/node.rs:713:                     }
sidestr-round/src/node.rs:714:                     let (tx, rx) = oneshot::channel();
sidestr-round/src/node.rs:715:                     let _ = to_loop.send(Query::Tx(body, tx));
sidestr-round/src/node.rs:716:                     match rx.blocking_recv() {
sidestr-round/src/node.rs:717:                         Ok(Ok(v)) => json(200, &v),
sidestr-round/src/node.rs:718:                         Ok(Err(e)) => json(400, &serde_json::json!({"error": e})),
sidestr-round/src/node.rs:719:                         Err(_) => json(500, &serde_json::json!({"error": "the signer is gone"})),
sidestr-round/src/node.rs:720:                     }
sidestr-round/src/node.rs:743:     })?;
sidestr-round/src/node.rs:744:     let journal_path = settings
sidestr-round/src/node.rs:745:         .journal
sidestr-round/src/node.rs:746:         .clone()
sidestr-round/src/node.rs:747:         .unwrap_or_else(|| dir.join("votes.jsonl"));
sidestr-round/src/node.rs:748:     let journal = FileJournal::open(&journal_path)?;
sidestr-round/src/node.rs:749:     let loaded = journal.entries()?.len();
sidestr-round/src/node.rs:750:     let mut round = Round::new(
sidestr-round/src/node.rs:751:         chain.state(),
sidestr-round/src/node.rs:752:         Box::new(LocalKey::from_hex(&key_text)?),
sidestr-round/src/node.rs:753:         Box::new(journal),
sidestr-round/src/node.rs:754:         settings.round.clone(),
sidestr-round/src/node.rs:755:     )?;
sidestr-round/src/node.rs:770:     let pegout = match (&parent, &settings.parent) {
sidestr-round/src/node.rs:771:         (Some(_), Some(p)) if p.wallet.is_some() => Some(PegoutRound::new(
sidestr-round/src/node.rs:772:             fed.clone(),
sidestr-round/src/node.rs:773:             &doc.id,
sidestr-round/src/node.rs:774:             Box::new(LocalKey::from_hex(&key_text)?),
sidestr-round/src/node.rs:775:             Box::new(FileJournal::open(&journal_path)?),
sidestr-round/src/node.rs:776:             PegoutConfig {
sidestr-round/src/node.rs:777:                 network,
sidestr-round/src/node.rs:778:                 ..settings.pegout.clone()
sidestr-round/src/node.rs:779:             },
sidestr-round/src/node.rs:780:             read_json::<PegoutLedger>(&dir.join("pegouts.json")),

### F2 documented exception sidestr-core/src/lib.rs
sidestr-core/src/lib.rs:230: //!   [`rules::validate_block_context`] returns the records a block *would*
sidestr-core/src/lib.rs:231: //!   leave and [`state::State::apply`] commits them only when every rule
sidestr-core/src/lib.rs:232: //!   passed.
sidestr-core/src/lib.rs:233: //! - **`record_text` checks the push length.** The reference's check is
sidestr-core/src/lib.rs:234: //!   commented out; [`marker::record_text`] refuses a record whose bytes do not
sidestr-core/src/lib.rs:235: //!   match its push length, or whose push is not minimal, where `recordText`
sidestr-core/src/lib.rs:236: //!   reads the text anyway. This is the only derived-record difference the
sidestr-core/src/lib.rs:237: //!   differential in `tests/audit_regressions_records.rs` allows.
sidestr-core/src/lib.rs:238: //! - **Zero auxiliary randomness everywhere**, not only for the genesis. Both
sidestr-core/src/lib.rs:239: //!   are valid BIP 340; only reproducibility differs.

```

Exit: 0; UTC end: 2026-09-22T19:12:24.122460+00:00

## Receipt: final-fmt-clean

UTC start: 2026-09-22T19:12:24.164496+00:00

Working directory: crates/sidestr

Command: `cargo fmt --all -- --check`

```text

```

Exit: 0; UTC end: 2026-09-22T19:12:24.727221+00:00

## Receipt: final-clippy-clean

UTC start: 2026-09-22T19:12:24.771205+00:00

Working directory: crates/sidestr

Command: `cargo clippy --workspace --all-targets --all-features -- -D warnings`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
    Checking sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.61s

```

Exit: 0; UTC end: 2026-09-22T19:12:25.453482+00:00

## Receipt: new-pegout-clean

UTC start: 2026-09-22T19:12:25.531326+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-round --all-features --test verify_pegout -- --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
   Compiling sidestr-round v0.1.0 (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/crates/sidestr/sidestr-round)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.19s
     Running tests/verify_pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/verify_pegout-bd7e95d1c4780e18)

running 1 test
C2 same input set; fee 2 -> 9 changes txid; restart refuses second authorisation
test c2_restart_same_inputs_changed_fee ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s


```

Exit: 0; UTC end: 2026-09-22T19:12:26.877868+00:00

## Receipt: js-proposal-fixture

UTC start: 2026-09-22T19:13:34.209322+00:00

Working directory: crates/sidestr

Command: `node ../../out/js-proposal.mjs`

```text
Reference makeRound generated kind=23510 height=1 id=fe634af597b3e91d1ccaf61dd36804043cf4a569de6380f0afb23511814268a5 using auditwire fixture

```

Exit: 0; UTC end: 2026-09-22T19:13:34.346650+00:00

## Receipt: round-regressions-with-js

UTC start: 2026-09-22T19:13:34.391637+00:00

Working directory: crates/sidestr

Command: `cargo test -p sidestr-round --all-features --test audit_regressions_node --test audit_regressions_round --test audit_regressions_pegout -- --include-ignored --skip smoke --nocapture`

```text
warning: failed to auto-clean cache data

failed to clean entries from the global cache

Caused by:
  failed to remove file `/home/devuser/workspace/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/protobuf-2.28.0/regenerate.sh`

Caused by:
  Permission denied (os error 13)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.37s
     Running tests/audit_regressions_node.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_node-4b228d5373ca7389)

running 3 tests
AUDIT Rust actual subscription ["REQ","k23510",{"kinds":[23510],"since":1790103814}]
AUDIT Rust actual subscription ["REQ","k23511",{"kinds":[23511],"since":1790103814}]
AUDIT Rust actual subscription ["REQ","k23512",{"kinds":[23512],"since":1790103814}]
AUDIT Rust actual subscription ["REQ","k23513",{"kinds":[23513],"since":1790103814}]
AUDIT Rust actual subscription ["REQ","k23514",{"kinds":[23514],"since":1790103814}]
test audit_subscription_filter ... ok
AUDIT WSS local TLS handshake=101 REQ/EOSE/EVENT exchange=ok default roots refuse self-signed=IO error: invalid peer certificate: UnknownIssuer
test audit_wss_support ... ok
AUDIT HTTP unindexed sealed h1 not served: range beyond index=416, /blocks.dat=538 committed bytes of 1043 on disk; /tip height=0
AUDIT POST /tx over 262144 bytes=413; at the cap=400
test audit_http_unindexed_block ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.10s

     Running tests/audit_regressions_pegout.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_pegout-c15b52815d2fed95)

running 6 tests
AUDIT pegout mutation=missing_marker refusal=Some("does not pay the burn with its marker")
AUDIT pegout mutation=extra_foreign_output refusal=Some("pays something besides the burn and change to the peg")
AUDIT LOG peg-out round: proposal for 0707070707070707… not signed: journal: audit failure
AUDIT peg-out journal write failure: sign_pegout_input calls=0 Publish actions=0 logs=["peg-out round: proposal for 0707070707070707… not signed: journal: audit failure"]
AUDIT LOG peg-out round: proposal for 0707070707070707… not signed: journal: audit failure
test audit_journal_failure_does_not_call_the_pegout_signer ... ok
AUDIT pegout mutation=extra_peg_change refusal=None
test audit_missing_marker_and_extra_non_change_output_are_refused_change_to_the_peg_is_not ... ok
AUDIT exported 2 Rust pegout events on identical PSBT fixtures
test audit_export_peg_wire ... ok
AUDIT resign_after=None restart same_burn=0707070707070707070707070707070707070707070707070707070707070707:0 first_txid=eb13276672b03205de4ef234b95c795a24bd8c61107659cb12fae1dc3c474369 second_proposal=none
test audit_never_resign_restart_self_proposal ... ok
AUDIT upstream policy retry same_burn=0707070707070707070707070707070707070707070707070707070707070707:0 first_txid=eb13276672b03205de4ef234b95c795a24bd8c61107659cb12fae1dc3c474369 second_txid=50ee8aee6575f24e6334d9a746b3c031f4d02769dda6568b84368fbe573942a3 disjoint_inputs=true valid_second_signature=true at=T0+90
test audit_upstream_policy_permits_a_disjoint_input_retry_after_the_ring ... ok
test audit_a_cosigner_does_not_become_the_proposer_for_a_burn_it_signed ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s

     Running tests/audit_regressions_round.rs (/home/devuser/workspace/.tmp/claude-1000/-home-devuser-workspace-project-agentbox/c4dd2b46-14b8-49b3-ba0e-2236cf27200a/scratchpad/verify5/target/debug/deps/audit_regressions_round-a65fc76da93656c5)

running 5 tests
AUDIT valid JS proposal -> Rust 23511 -> core verify_partial=true
test audit_import_js_proposal ... ok
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 29 s ago
AUDIT resign delta=29 partials=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 29 s ago"]
AUDIT LOG round: proposal h1 not signed: journal: audit failure
AUDIT journal write failure: BlockSigner::sign_partial calls=0 Publish actions=0 logs=["round: proposal h1 not signed: journal: audit failure"]
AUDIT LOG round: proposal h1 not signed: journal: audit failure
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 30 s ago
AUDIT resign delta=30 partials=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 15669894… for this height 30 s ago"]
AUDIT LOG round: signed h1 cb5d9228b63e… from 4df4d228…
AUDIT resign delta=31 partials=1 logs=["round: signed h1 cb5d9228b63e… from 4df4d228…"]
AUDIT MAY_RESIGN delta_ms=29000 JS=false Rust=false
AUDIT LOG round: proposal h1 signed but not published: journal: audit failure after signing
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed d7e4dfa5… for this height 5 s ago
test audit_journal_failure_does_not_call_signer ... ok
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT MAY_RESIGN delta_ms=30000 JS=false Rust=false
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h1 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago
AUDIT torn=false loaded_entries=2 records=3 second_partial=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago"]
AUDIT LOG round: proposal is not a block
AUDIT MAY_RESIGN delta_ms=30001 JS=true Rust=true
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT MAY_RESIGN delta_ms=30999 JS=true Rust=true
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h1 from f047d182… refused: not its turn
AUDIT LOG round: proposal h1 from f047d182… refused: not its turn
AUDIT MAY_RESIGN delta_ms=31000 JS=true Rust=true
AUDIT LOG round: proposal h1 from f047d182… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT replay age_ms=90000 partials=1
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT replay age_ms=90001 partials=0
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h1 from 949e1955… refused: not its turn
AUDIT validation outsider partials=0 logs=["round: proposal h1 from 949e1955… refused: not its turn"]
AUDIT LOG round: proposal h2 from f047d182… ignored (my tip is 0)
AUDIT validation tip+2 partials=0 logs=["round: proposal h2 from f047d182… ignored (my tip is 0)"]
AUDIT LOG round: my proposal h1 got 1 signature(s); dropping it
AUDIT DROP at 90000=false at 90001=true logs=["round: my proposal h1 got 1 signature(s); dropping it"]
test audit_round_boundaries_and_validation ... ok
AUDIT LOG round: proposal h2 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h2 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h2 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h2 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago
AUDIT torn=true loaded_entries=2 records=3 second_partial=0 logs=["round: proposal h1 from 4df4d228… refused: I signed 4c3684e5… for this height 1 s ago"]
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h3 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h3 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h3 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
test audit_crash_and_torn_tail ... ok
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal h3 from f047d182… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h4 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h4 from f047d182… refused: not its turn
AUDIT LOG round: proposal h4 from f047d182… refused: not its turn
AUDIT LOG round: proposal h4 from f047d182… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h5 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h5 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal h5 from f51de7a4… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h5 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h6 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h6 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal h6 from 4df4d228… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal h6 from f047d182… refused: not its turn
AUDIT LOG round: proposal is not a block
AUDIT LOG round: proposal is not a block
AUDIT exported 3 Rust block events; entitlement cases=126
test audit_export_wire_and_entitlement ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.25s


```

Exit: 0; UTC end: 2026-09-22T19:13:35.191238+00:00

## Receipt: reference-provenance

UTC start: 2026-09-22T19:13:35.241595+00:00

Working directory: crates/sidestr

Command: `sha256sum "$SIDESTR_SIDING/lib/marker.mjs" "$SIDESTR_SIDING/lib/overlay.mjs" "$SIDESTR_SIDING/lib/records.mjs" "$SIDESTR_SIDING/lib/chain.mjs" "$SIDESTR_SIDING/lib/round.mjs" && git -C "$SIDESTR_SIDING" rev-parse HEAD && git -C "$SCHEMA" rev-parse HEAD && git -C "$BLAKETESTNODE" rev-parse HEAD`

```text
65b51932bc8078cbdcaf1d68f19ca6cb0fc3d14319db2a90b74749c1bb7b6221  /home/devuser/workspace/sidestr/upstream/spec/siding/lib/marker.mjs
d0bea820231a1ff252df9025b9b7a067a1263fc0047bf24d3f20364654b86b89  /home/devuser/workspace/sidestr/upstream/spec/siding/lib/overlay.mjs
8afa474cf154d8db6442a269deb30a83e67e8cc36e295c03c47a67c0c934ccca  /home/devuser/workspace/sidestr/upstream/spec/siding/lib/records.mjs
236ae7b2a2f260f751c10c25eaffde1c25fbbd3528c453e010c2ef620ea1c034  /home/devuser/workspace/sidestr/upstream/spec/siding/lib/chain.mjs
1acf20baf426cc45c98fac9b435f1e2832b862daeb063a1d8dc5b78fb463903f  /home/devuser/workspace/sidestr/upstream/spec/siding/lib/round.mjs
2de40bdac4cba01be0864156a553d8287c22e279
b8cbf6337c7450fe14ddc5bce00c7280059aab5d
d2764d21fe1f8c29b1979e49eb8287a72dd2347e

```

Exit: 0; UTC end: 2026-09-22T19:13:35.265896+00:00
