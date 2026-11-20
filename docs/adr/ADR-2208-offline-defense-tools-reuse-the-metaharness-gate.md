---
id: ADR-2208
title: Offline defense evidence replay reuses the MetaHarness gate without a new gateway
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 664161bdcfee1c4d7a5c820c6ddb0a0b0c085af6
verified_paths: [flake.nix, agentbox.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, config/npm-locks/metaharness-artex-defense-0.1.0.package-lock.json, tests/config/offline-defense.test.cjs]
owner: operator
review_trigger: ARTEX or its harness dependency changes, a proposal to intercept live traffic or start the aidefence gateway, or a change to the single memory-store boundary
repo: agentbox
domain: BASELINE-container
evidence_class: source+test
acceptance_boundary: Standalone Nix package plus five checks covering the image gate and both packaged fixtures/modes, receipt verification, tamper rejection and no overwrite; no rebuilt Agentbox activation, live quarantine or new gateway is claimed.
---

# ADR-2208 — Offline defense tools reuse the MetaHarness gate

## Context

The operator requested ARTEX Defense and aidefence during the core-tool refresh.
Ruflo's reviewed lock already includes aidefence 3.2.1 and its scoped adapter.
ARTEX is an MIT offline evidence-replay CLI, not a live interception layer.

## Decision

- Pin `@metaharness/artex-defense` 0.1.0, its exact harness 0.2.1 dependency,
  tarball integrity and recursive dependency hash. The named root addition is
  an exception to the routine 72-hour hold; its dependency predates the cutoff.
- `[toolchains].metaharness` includes `artex-defense` with the existing CLIs.
  The catalogue remains rebuild-class. No extra supervisor or MCP server is
  needed for an offline CLI, and no service/listener/interception is enabled.
- Receipts are operator-requested files, not a sixth durable adapter or new
  memory authority. `simulate` is not a quarantine of a real session.
- Reuse Ruflo's aidefence dependency rather than start a second AIMDS gateway.
  Packaging or a detector smoke test is not proof that every ingress is screened.
  New interception requires separate policy and privacy/adapter review.
- Retain governed MCP-only memory and SONA-off. Ruflo's newly default-on local
  learning is disabled; its new snapshot/cost-ledger retention defaults off.

## Verification

The actual Nix package passes both `identity` and `findings` fixtures in monitor
and simulate modes. Every report verifies against its trusted tail, refuses
overwrite and fails after tampering. The static gate/service test also passes.
The package's own npm test discovers zero cases and is not counted. The new
lock audit reports zero findings; no live deployment is inferred from this.

See [the scoped source review](../estate-closeout/2026-11-20/core-tools-and-browser-source-review.md).
