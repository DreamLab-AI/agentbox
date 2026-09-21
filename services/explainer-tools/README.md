# explainer-tools

Rust tooling for the `explainer` skill.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at
`services/explainer-tools` and is a self-contained Cargo workspace.

Today it ships one binary, `explainer-loom-draft` — the port of the skill's former
`scripts/loom-draft.mjs` — with the evidence, diagram and media gates to follow.

## What it does not reimplement

The façade protocol comes from the published [`loom-client`](https://crates.io/crates/loom-client)
crate, which `services/dream-engine` and `services/podcast-ingest` also depend on. That
is deliberate (ADR-139): one place knows that a façade can answer HTTP 200 with ontology
prose instead of calling the model, that a truncated reasoning model returns *empty*
content rather than a short answer, and that grounding applied to a non-ontology subject
is a wrong answer rather than a good one. Three callers each knew a different subset
before; adding a fourth that knew its own subset is how that knowledge rots.

## Build and test

```bash
cargo build --release          # binary at target/release/explainer-loom-draft
cargo test
```

## Licence

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE) at your
option.

This crate lives inside the [agentbox](https://github.com/DreamLab-AI/agentbox) repository, which as a whole is
AGPL-3.0-only. The permissive grant is per crate and travels with the crate:
`services/` is a deliberately permissive subtree so these modules can be reused
and published outside the hosted service. See
[ADR-2030](https://github.com/DreamLab-AI/agentbox/blob/main/docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md)
and [services/LICENSING-NOTICE.md](https://github.com/DreamLab-AI/agentbox/blob/main/services/LICENSING-NOTICE.md).
`publish = false` for now: the crate is internal to agentbox, but it carries the
permissive pair so any part of it can be lifted out without a licensing question.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 licence, shall be
dual licensed as above, without any additional terms or conditions.
