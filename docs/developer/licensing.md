# Licensing

Agentbox is [AGPL-3.0](../../LICENSE). Every first-party source file and every
bundled component that carries a copyleft licence is AGPL-3.0 or a permissive
licence compatible with it.

## Component matrix

| Component | Licence | Linkage | Source pointer |
|-----------|---------|---------|----------------|
| agentbox (this repo) | AGPL-3.0 | — | `LICENSE` |
| `solid-pod-rs` (DreamLab-AI) | AGPL-3.0-only | Binary under supervisord — HTTP boundary only | [github.com/DreamLab-AI/solid-pod-rs](https://github.com/DreamLab-AI/solid-pod-rs) |
| `linkedobjects/browser` | AGPL-3.0 | Static assets served by management-api | [github.com/linkedobjects/browser](https://github.com/linkedobjects/browser) |
| `nostr-rs-relay` (Scsibug) | MIT | Binary from nixpkgs — HTTP boundary only | [github.com/scsibug/nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay) |
| `nagual-qe` (proffesor-for-testing) | MIT | Binary launched by supervisord | [github.com/proffesor-for-testing/nagual-qe](https://github.com/proffesor-for-testing/nagual-qe) |
| `nostr-tools` npm | MIT | Library linked into `management-api` | npm |
| `@noble/curves` npm | MIT | Library linked into `management-api` | npm |
| `openai/privacy-filter` weights | Apache-2.0 | Model weights loaded by opf-router | Hugging Face |
| `codex` binary (OpenAI) | Apache-2.0 | Binary invoked as a subprocess | github.com/openai/codex |

All permissive (MIT, Apache-2.0) components are compatible with AGPL-3.0. No
aggregation analysis is required because the project is now uniformly AGPL-3.0
on all first-party and copyleft-carrying components.

## AGPL-3.0 obligations for operators

Running agentbox as a **hosted service** — offering it to users over a network —
triggers §13: you must make the full corresponding source available to those
users, including any modifications you have made.

Self-hosted and internal use carry no additional obligations beyond the standard
copyleft terms (preserve notices, make source available if you distribute
binaries).

### Source-Code headers

The management-api emits a `Source-Code` HTTP header on every response from
`/lo/*` (the linkedobjects/browser viewer mount path) pointing at the upstream
repository. This satisfies the AGPL §13 network-service disclosure requirement
for that component.

## AGPL-3.0 compliance rules for contributors

1. **Do not link `solid-pod-rs` as a Rust library.** Only the
   `solid-pod-rs-server` binary is packaged. Communication happens over
   `HTTP://127.0.0.1:8484`; no shared address space.
2. **Preserve `LICENSE` files in derivation outputs.** `lib/solid-pod-rs.nix`,
   `lib/linkedobjects-browser.nix`, and `lib/nagual-qe.nix` all copy upstream
   `LICENSE` files into `$out/share/doc/<component>/LICENSE` in `postInstall`.
3. **New components must be licence-reviewed before merging.** Add them to the
   matrix above. AGPL-3.0, MIT, Apache-2.0, and MPL-2.0 are all pre-approved.
   GPL-2.0-only is incompatible with AGPL-3.0 — raise an issue.
4. **No proprietary model weights in the image.** Weights must be permissively
   licensed (Apache-2.0, MIT, or equivalent) to remain compatible.

## Supply-chain attestation

`flake.lock` pins every Nix input by hash. `lib/solid-pod-rs.nix` and
`lib/nagual-qe.nix` pin a git rev plus `srcHash` and `cargoHash`. The Nix
sandbox guarantees that a build either produces the pinned hash or fails
loudly — there is no silent substitution of dependency content.

For SBOM purposes, `nix build .#runtime --print-out-paths` gives the
deterministic closure of every derivation in the image.

## Further reading

- [AGPL-3.0 full text](https://www.gnu.org/licenses/agpl-3.0.html)
- [AGPL FAQ: network use is distribution](https://www.gnu.org/licenses/gpl-faq.html#UnchangedInterface)
- [ADR-010 — solid-pod-rs as first-class pod server](../reference/adr/ADR-010-rust-solid-pod-adoption.md)
