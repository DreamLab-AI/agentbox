# nostr-pod-bridge

Embedded Nostr relay and Solid-pod ingress bridge for agentbox.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/nostr-pod-bridge` and is
a self-contained Cargo workspace.

`nostr-pod-bridge` runs the embedded Nostr relay and bridges its events into
the Solid pod ingress path. Cryptography is consumed, never hand-rolled: NIP-44,
NIP-26 and NIP-59 come from `nostr-bbs-core`, and the relay substrate (NIP-01,
NIP-11, NIP-16) from `solid-pod-rs-nostr`.

### What it does

- Hosts the embedded relay and applies the allowlist ingress policy.
- Bridges accepted events into Solid pod writes under a `did:nostr` identity.
- Delegates all NIP crypto to audited upstream crates.


## Licence — AGPL-3.0-only, NOT dual-licensed

**This crate is licensed under the GNU Affero General Public License, version 3
only (AGPL-3.0-only). It is _not_ dual-licensed under MIT OR Apache-2.0.**

The rest of the `services/` subtree is permissive (MIT OR Apache-2.0) and may be
published to crates.io on those terms. This crate is the documented exception:
it links `solid-pod-rs-nostr`, which is AGPL-3.0-only, so it cannot grant
permissive terms and does not attempt to. Do not copy the sibling crates'
licensing boilerplate into this directory, and do not publish this crate under
the permissive assumption.

The full licence text is in [LICENSE](LICENSE); it is the same AGPL-3.0 text as
the repository root `LICENSE`.

Copyright (c) 2024-2026 DreamLab AI / Dr John O'Hare

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.

### Network use

AGPL-3.0 §13 applies: an operator who offers this bridge to users over a network
must make the corresponding source, including modifications, available to those
users.

### Contribution

Contributions to this crate are accepted under AGPL-3.0-only, not under the
permissive terms that govern the rest of `services/`.

## Repository

<https://github.com/DreamLab-AI/agentbox> — path `services/nostr-pod-bridge`.
