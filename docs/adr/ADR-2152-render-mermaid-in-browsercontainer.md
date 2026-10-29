---
id: ADR-2152
title: Render Mermaid in browsercontainer without an Agentbox Chromium closure
date: 2026-10-27
decision_status: superseded
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: [ADR-2154]
verified_commit: d1dd896f4a790762b150d81a94a03b268b04c543
verified_paths: []
owner: jjohare
review_trigger: a change to Mermaid CLI, the mmdc client, browsercontainer's renderer, or their shared-volume topology
repo: agentbox
domain: BASELINE-container
---

# ADR-2152: Render Mermaid in browsercontainer without an Agentbox Chromium closure

## Context

Agentbox already sends some Mermaid renders to browsercontainer, yet its
Nix `@mermaid-js/mermaid-cli` package also pulled in a full Chromium source
build. That is a third browser beside browsercontainer's persistent GPU Chrome
Beta and its system Chromium for headless Mermaid. The latter is deliberately
separate from the authenticated Chrome profile.

## Decision

With `[skills.docs].mermaid` enabled, Agentbox ships only an `mmdc` command
that forwards supported render options to browsercontainer's `/render-mermaid`
endpoint and copies the result from `gui-tools-exchange`. Puppeteer, Mermaid
CLI and the headless Chromium binary belong to browsercontainer. Unsupported
CLI options fail explicitly. The artifact probe checks client installation,
while an actual render is a separate sidecar health test.

## Consequences

The Agentbox image no longer needs Chromium to render diagrams, reducing its
build closure and avoiding a long independent browser compilation. Mermaid
rendering now depends on browsercontainer availability and the exchange
volume. The sidecar keeps its persistent Chrome Beta/Podkey profile separate
from headless diagram rendering; image preparation does not restart either
container or remove their data volumes. The sidecar package and browser pins
remain an independent lifecycle concern.

## Verification

Against the uncommitted 2026-10-27 working tree: `node
tests/config/mermaid-sidecar.test.cjs` passes; `nix build` of the `mmdc`
derivation succeeds; `nix-store -q --requisites` of the evaluated runtime
derivation has no Chromium or Mermaid CLI derivation. No activation claim is
made; verify a real SVG/PNG/PDF render from the prepared image after the
sidecar update is available.
