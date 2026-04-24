# Licensing and aggregation analysis

Agentbox combines code under several licences. This document records the
analysis that lets us ship everything in a single OCI image without any one
licence's copyleft clause infecting unrelated first-party code.

## Context in one paragraph

Agentbox itself is [MPL-2.0](../../LICENSE). The image bundles two vendored
components with stronger copyleft: `solid-pod-rs` (AGPL-3.0-only) and
`nostr-rs-relay` (MIT, no copyleft, listed for completeness). The question is
whether shipping AGPL-3.0 `solid-pod-rs` alongside MPL-2.0 agentbox turns the
combined work into AGPL. The answer is **no, provided we keep the AGPL
component as a separate binary**. This file explains why, what that rule
means in practice, and what developers changing the code must preserve.

## Inventory

| Component | Licence | Source of truth | Linkage |
|-----------|---------|-----------------|---------|
| agentbox (first-party, this repo) | MPL-2.0 | `LICENSE` | — |
| `solid-pod-rs` (first-party, DreamLab-AI) | AGPL-3.0-only | [github.com/DreamLab-AI/solid-pod-rs](https://github.com/DreamLab-AI/solid-pod-rs) | Binary under supervisord; **not** linked as a library |
| `nostr-rs-relay` (upstream, Scsibug) | MIT | [github.com/scsibug/nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay) | Binary from nixpkgs |
| `openai/privacy-filter` weights | Apache-2.0 | [huggingface.co/openai/privacy-filter](https://huggingface.co/openai/privacy-filter) | Model weights loaded by the opf-router sidecar |
| `nostr-tools` npm | MIT | npm | Library linked into `management-api` |
| `@noble/curves` | MIT | npm | Library linked into `management-api` |

Agentbox's own Rust code (current scope: zero; future scope: possibly a
management-api rewrite) **must not link** the `solid-pod-rs` crate as a
library. Only the `solid-pod-rs-server` binary is packaged.

## AGPL-3.0 and aggregation (§5)

AGPL-3.0 is the network-service variant of GPL-3.0: §13 extends the copyleft
clause from distribution to network provision. If a derivative work of an
AGPL-covered work is offered to users over a network, source must be made
available to those users.

AGPL §5 defines "aggregate":

> A compilation of a covered work with other separate and independent works,
> which are not by their nature extensions of the covered work, and which
> are not combined with it such as to form a larger program, in or on a
> volume of a storage or distribution medium, is called an "aggregate" if
> the compilation and its resulting copyright are not used to limit the
> access or legal rights of the compilation's users beyond what the
> individual works permit. Inclusion of a covered work in an aggregate does
> not cause this License to apply to the other parts of the aggregate.

The Free Software Foundation's own FAQ on
[Mere aggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)
draws the line at what gets linked into one address space:

> If the modules are included in the same executable file, they are
> definitely combined in one program. If modules are designed to run linked
> together in a shared address space, that almost certainly means combining
> them into one program.

Agentbox's OCI image is a filesystem tree bundled into a tarball. Inside
it, `solid-pod-rs-server` is an ELF binary launched by `supervisord` as a
separate process with its own PID and its own address space. The
`management-api` Node.js process communicates with it only over
`HTTP://127.0.0.1:8484`, using the Solid protocol. There is no shared
library linkage, no FFI, no shared-memory mapping, no IPC channel other
than HTTP.

**This is aggregation, not combination.** The AGPL source-availability
requirement (§13) applies to `solid-pod-rs` on its own — we comply by
preserving the upstream GitHub URL in the NIP-11 service document and by
keeping the `LICENSE` file inside `$out/share/doc/solid-pod-rs/LICENSE`
(the derivation's `postInstall` step enforces this). AGPL does not extend
to agentbox's MPL-2.0 first-party code.

## What this rule means in practice

### Allowed

- Running `solid-pod-rs-server` as a supervisord program in the agentbox
  image. Current state.
- Editing `management-api/adapters/pods/local-solid-rs.js` — it speaks to
  the pod over HTTP; nothing is linked.
- Bumping the `solid-pod-rs` pin in `lib/solid-pod-rs.nix`.
- Adding new Cargo feature flags via the `extraFeatures` parameter.
- Shipping `solid-pod-rs-server` binaries inside the OCI image distributed
  via GHCR.

### Not allowed without a licence-compatibility review

- Adding `solid-pod-rs` as a Rust `[dependency]` in any first-party Cargo
  workspace. If agentbox ever grows a Rust service, that service **must
  not** embed the crate.
- Copying source from the `solid-pod-rs` repo into this repo for reuse. The
  copy would carry AGPL forward into whatever file imports it.
- Exposing `solid-pod-rs` as an in-process Rust library and calling it via
  FFI from another agentbox process. Same address space = combination.
- Stripping the `LICENSE` from `$out/share/doc/solid-pod-rs/` or suppressing
  the upstream URL from the service document.

### Required when shipping

1. Preserve `LICENSE` (AGPL-3.0) in the derivation output at
   `share/doc/solid-pod-rs/LICENSE`. Enforced by `lib/solid-pod-rs.nix`.
2. Expose the upstream repo URL (`https://github.com/DreamLab-AI/solid-pod-rs`)
   somewhere reachable by a network user of the pod. The Solid service
   information document at `GET /` is the agreed pointer.
3. Do not ship binary-only distributions that remove the ability to obtain
   the AGPL source. The agentbox OCI image includes the URL; downstream
   consumers inherit it.

## Other licences in the image

- **MIT** components (`nostr-rs-relay`, `nostr-tools`, `@noble/curves`) —
  permissive; aggregation analysis is trivial. Attribution preserved in
  each component's upstream `LICENSE` file, copied into the derivation
  output by the build.
- **Apache-2.0** components (`openai/privacy-filter` weights, `codex`
  binary) — permissive plus patent-grant clause. No source-disclosure
  requirement. Preserved in the respective derivation outputs.
- **MPL-2.0** (agentbox itself) — file-level copyleft. Any MPL-licensed
  source file modified must retain the MPL licence header; combined works
  that include MPL files do not become MPL as a whole.

## If someone contributes new code that links AGPL code

Reject the PR. Document the request as an issue and ping the maintainers.
If the need is legitimate, the resolution is usually one of:

1. Split the functionality into a separate service that speaks over HTTP
   (same pattern as `solid-pod-rs`).
2. Convince upstream to dual-licence (unlikely for established AGPL projects).
3. Find or write an MPL/MIT/Apache-2.0 alternative.

## Supply-chain attestation

`flake.lock` pins every input by hash. `lib/solid-pod-rs.nix` pins a git rev
and (after prefetch) both `srcHash` and `cargoHash`. The Nix sandbox
guarantees that a build either produces the pinned hash or fails loudly.
For SBOM purposes, `nix build .#runtime --print-out-paths` gives the list of
every derivation in the image.

## Further reading

- [MPL-2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [GPL/AGPL FAQ: Mere aggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)
- [GPL/AGPL FAQ: If a program uses a library, does the library's licence apply to the program?](https://www.gnu.org/licenses/gpl-faq.html#IfLibraryIsGPL)
- [AGPL-3.0 full text](https://www.gnu.org/licenses/agpl-3.0.html)
- [ADR-010 — solid-pod-rs as first-class pod server](../reference/adr/ADR-010-rust-solid-pod-adoption.md)
