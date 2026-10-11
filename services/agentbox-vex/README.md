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

Licensed under MIT OR Apache-2.0; see the adjacent licence texts.
