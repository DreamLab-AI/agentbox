# Governance contract v1

The wire contract for the governance event kinds 31400-31405, rendered as data.
`nostr-bbs-core` (`crates/nostr-bbs-core/src/governance.rs`) is its only author;
these files are generated from it and never edited by hand.

| File | Content |
|------|---------|
| `<kind>-<name>.json` | One valid, fully populated, signed example of each kind, built with the crate's own types and validated by the crate's own validator. |
| `manifest.json` | The kinds and names, required and optional tags and content fields, every enum string the contract uses, and the numeric rules a producer must respect (for example `min_human_rationale_chars`). |

Fixed test keys and timestamps are used, so the files are reproducible.

## Who consumes it

Consumers that cannot link the Rust crate copy this directory verbatim. agentbox
(JavaScript) loads `manifest.json` through `management-api/lib/governance-contract.js`
and checks what it produces against these examples. Rust consumers such as
VisionClaw should depend on `nostr-bbs-core` directly instead.

## Regenerating

The test `governance_golden_files_match_the_crate` fails when any file is stale.
After an intended change to the contract:

```sh
UPDATE_GOVERNANCE_CONTRACT=1 cargo test -p nostr-bbs-core --test governance_contract_golden
```

Review the diff, commit it, and copy the directory to each consumer. A breaking
change belongs in a new `v2/` directory, not an edit to `v1/`.
