# ADR-016 — License Consolidation: AGPL-3.0-only End-to-End

- **Status:** Accepted
- **Date:** 2026-05-16
- **Deciders:** DreamLab AI core team
- **Supersedes:** Implicit per-package licensing in sub-manifests
- **Related:** [ADR-010](ADR-010-rust-solid-pod-adoption.md) (solid-pod-rs adoption), [ADR-017](ADR-017-multi-tenant-did-nostr-pods.md) (multi-tenant pods)

## Context

agentbox originally carried a mix of licence designations across its
sub-packages. The root `LICENSE` is GNU AGPL-3.0-only, but the following
`package.json` files declared `"license": "MIT"` (or other variants):

| File                                | Pre-ADR-016 license |
|-------------------------------------|---------------------|
| `management-api/package.json`       | MIT                 |
| `aisp/package.json`                 | MIT                 |
| `mcp/package.json`                  | MIT                 |
| `https-bridge/package.json`         | MIT                 |
| `mcp/consultants/package.json`      | `AGPL-3.0` (non-SPDX-`only` form) |
| `package.json` (root)               | (unspecified)       |
| `browsercontainer/package.json`     | (unspecified)       |
| `claude-zai/wrapper/package.json`   | (unspecified)       |

Two facts have converged since those manifests were written:

1. **solid-pod-rs is now library-linked and binary-aggregated everywhere**
   ([ADR-010](ADR-010-rust-solid-pod-adoption.md)). The management-api, the
   relay bridge, and the consultant tier all consume the pod over a local
   socket; `linked_data` and `did_documents` surfaces are served directly by
   `solid-pod-rs`. The coupling is not arm's-length network use — it is
   in-process aggregation per AGPL §10.
2. **The agentbox container is a network service** ([ADR-009](ADR-009-embedded-nostr-relay.md),
   [ADR-073](ADR-073-federation-peer-trust.md), forthcoming ADR-017). AGPL
   §13 (network corresponding source) requires the combined work, including
   any modifications, be offered to interacting users under the same
   AGPL-3.0-only.

Carrying MIT designations on individual sub-packages while the aggregated
binary is AGPL-3.0-only is internally inconsistent. It also creates a real
risk of downstream confusion: a forker who copies `management-api/` in
isolation might believe it is MIT-licensed and redistribute it under terms
incompatible with the linked AGPL components.

## Decision

1. **All first-party agentbox code is AGPL-3.0-only**, declared explicitly
   in every sub-package manifest using the SPDX-conformant identifier
   `AGPL-3.0-only` (not the deprecated `AGPL-3.0`).
2. **Third-party dependencies retain their own licenses** — agentbox does
   not relicense them. They are attributed in the `NOTICE` file per AGPL
   §5(a-c).
3. **The combined work is offered AGPL-3.0-only end-to-end.** AGPL §13
   network corresponding source obligations apply to the agentbox binary
   and all aggregated services (management-api, relay bridge, consultants,
   pod). Operators MUST make Corresponding Source available to all network
   users.
4. **A `NOTICE` file at the repository root** lists the headline
   first-party and third-party components with their licenses, and points
   to the canonical upstream for AGPL §13 source distribution.

## Mechanical changes shipped with this ADR

- `management-api/package.json` — `"MIT"` → `"AGPL-3.0-only"`
- `aisp/package.json` — `"MIT"` → `"AGPL-3.0-only"`
- `mcp/package.json` — `"MIT"` → `"AGPL-3.0-only"`
- `https-bridge/package.json` — `"MIT"` → `"AGPL-3.0-only"`
- `mcp/consultants/package.json` — `"AGPL-3.0"` → `"AGPL-3.0-only"` (SPDX form)
- `package.json` (root) — adds `"license": "AGPL-3.0-only"`
- `browsercontainer/package.json` — adds `"license": "AGPL-3.0-only"`
- `claude-zai/wrapper/package.json` — adds `"license": "AGPL-3.0-only"`
- `NOTICE` — new file at repository root

`skills/*` sub-packages are third-party SDKs and templates authored
upstream. Their licences are retained as published. This ADR does not
relicense them; the combined-work obligation applies to the agentbox
distribution as a whole, not to skills that are not invoked at runtime.

## Consequences

- **Positive:** licence designation matches reality. Forkers see one
  consistent answer. AGPL §10/§13 obligations are surfaced at the point of
  declaration, not buried in the root `LICENSE`.
- **Positive:** prevents accidental MIT-style redistribution of a
  sub-package that links a GPL-family library.
- **Neutral:** no API surface, runtime behaviour, or dependency closure is
  affected.
- **Minor:** users who relied on the MIT designation of any sub-package
  for permissive redistribution must adopt AGPL terms. In practice none
  of these sub-packages were redistributed independently; they exist to
  ship as part of the agentbox container.

## Verification

- `grep -RE '"license"' --include=package.json` (excluding `node_modules/`
  and `skills/`) returns only `AGPL-3.0-only`.
- `scripts/agentbox-config-validate.js` is licence-agnostic; no validator
  change required.
- `NOTICE` is present at the repository root and lists `solid-pod-rs`
  with its AGPL-3.0-only designation.
