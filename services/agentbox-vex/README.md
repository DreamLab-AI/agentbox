# agentbox-vex

Project-specific Rust tooling for Agentbox's image build evidence. It generates
OpenVEX from reviewed predicates, scopes assessments to a content digest, and
verifies the evidence bundle before a scanner applies it. It is host tooling,
not a daemon or a durable-state adapter, and is not published as a reusable crate.

Operator and rule-authoring instructions: [VEX guide](../../docs/developer/vex.md).

```sh
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

## Licence

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT licence ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 licence, shall be
dual licensed as above, without any additional terms or conditions.
