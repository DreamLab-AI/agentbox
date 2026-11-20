---
id: ADR-2208
title: Offline defense evidence replay reuses the MetaHarness gate without a new gateway
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: f6a87328266381a2f2f1bf6ddf7050ebd72eda49
verified_paths: [flake.nix, agentbox.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, config/npm-locks/metaharness-artex-defense-0.1.0.package-lock.json, tests/config/offline-defense.test.cjs]
owner: operator
review_trigger: ARTEX or its harness dependency changes, a proposal to intercept live traffic or start the aidefence gateway, or a change to the single memory-store boundary
repo: agentbox
domain: BASELINE-container
evidence_class: source+test+deployment+runtime
acceptance_boundary: Standalone Nix package plus five checks covering the image gate and both packaged fixtures/modes, receipt verification, tamper rejection and no overwrite. Rebuilt Agentbox is active; isolated candidate replay and aidefence detector checks pass. No live quarantine, universal ingress screening or new gateway is claimed.
---

# ADR-2208 — Offline defense tools reuse the MetaHarness gate

## Activation witness — 2026-11-20

Agentbox source `559c2c39e2f5e8087d890b6ea89d63a75be1940b`, image ID
`sha256:b51f2286bda3610de732c8e21edf4186c06583e39d2b3d1211cdba5d7dba2f72`,
was activated at 12:17:11 UTC. The network-isolated candidate passed ARTEX
replay/receipt verification, benign and synthetic-injection aidefence checks,
and Ruflo learning/retention-default assertions without production volumes.
The active container exposes the CLI; RuVector MCP memory health passes.
This is packaging and bounded detector evidence, not live traffic protection.

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

## Re-verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Governed delta: `flake.nix` changed in one line, `:3169`: the `[program:nip98-proxy]` supervisor `environment=` gains `NIP98_PROXY_REQUIRE_CONFIG="1"` (W3-05, ADR-2210). One line replaces one line, so no `flake.nix` citation moves, and nothing else in the file changed. This record makes no claim about the proxy's supervisor environment or its config projection. The record's MetaHarness-gate claims are untouched by an environment variable on another program. The Decision is unchanged and no claim of this record is falsified by the JOURNAL-LOCK (ADR-2211), W3-05 (ADR-2210) or Podkey-policy (ADR-2212) merges. Commands run: `git diff 664161bdc..f6a873282 -- flake.nix agentbox.toml schema/agentbox.toml.schema.json management-api/lib/system-manifest.js config/npm-locks/metaharness-artex-defense-0.1.0.package-lock.json tests/config/offline-defense.test.cjs`. Re-run the diff to reproduce.
