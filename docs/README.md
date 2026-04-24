# Agentbox documentation

Audience-tiered navigation. Pick the path that matches what you're trying to do.

```
docs/
├── user/         ← You run agentbox; you want it to work
├── developer/    ← You change agentbox; you ship PRs
└── reference/    ← Canonical specs (ADR / PRD / DDD)
```

---

## User docs — for operators

You have a machine, you want agentbox running on it, ideally with as little fuss as possible.

| Start here | |
|---|---|
| [Glossary & orientation](user/glossary.md) | Zero-to-one for people new to headless agent runtimes |
| [Quickstart](user/quickstart.md) | First boot in ten minutes |
| [Installation](user/installation.md) | Per-OS install paths (Linux, macOS, Windows, remote) |
| [Configuration](user/configuration.md) | `agentbox.toml` reference — every section, every key |
| [Running](user/running.md) | Copy-paste recipes per host × arch × GPU |
| [Platforms](user/platforms.md) | Compatibility matrix: what works where |
| [Troubleshooting](user/troubleshooting.md) | Common failure modes and fixes |

| Day-2 operations | |
|---|---|
| [Providers](user/providers.md) | API-key management — `[providers.*]` manifest sections |
| [Backup & restore](user/backup-restore.md) | `agentbox.sh backup / restore` — what's included, secrets handling |
| [Consuming the image](user/consuming-image.md) | GHCR registry tags, multi-arch manifest |
| [Provisioning remote hosts](user/provisioning.md) | `agentbox.sh provision --target oci \| fly \| hetzner \| bare` |

| Sovereign data stack — key parts of the DreamLab-AI ecosystem | |
|---|---|
| [Solid pod (solid-pod-rs)](user/solid-pod.md) | First-party Rust Solid Protocol 0.11 server — durable storage, WAC, NIP-98, atomic-rename |
| [Nostr relay](user/nostr-relay.md) | External-agent messaging over an embedded Nostr relay with pod-inbox bridge |
| [Privacy filter](user/privacy-filter.md) | Local PII redaction sidecar (openai/privacy-filter) as adapter middleware |

| Feature guides | |
|---|---|
| [3DGS (COLMAP + METIS + LichtFeld)](user/3dgs.md) | 3D Gaussian Splatting pipeline |
| [Blender](user/blender.md) | Blender toolchain |
| [ComfyUI](user/comfyui.md) | Built-in vs external ComfyUI |
| [LaTeX](user/latex.md) | TeX Live full |

---

## Developer docs — for contributors

You're adding a feature, implementing an adapter, or investigating a regression.

| Architecture | |
|---|---|
| [Architecture overview](developer/architecture.md) | How it all fits together — manifest → flake → image → runtime |
| [Adapter pattern](developer/adapters.md) | Five slots × three classes; how to write a new impl |
| [Sovereign mesh](developer/sovereign-mesh.md) | Nostr client + NIP-98 auth + relay pool internals |
| [Skills upgrade path](developer/skills-upgrade.md) | Migrating from `path:./skills` to a standalone repo |

| Tooling | |
|---|---|
| [Testing](developer/testing.md) | Suite shape, running locally, CI wiring |
| [Version tracking](developer/version-tracking.md) | Renovate + `nix flake update` workflow |

---

## Reference — canonical specs

These are the authoritative sources of truth. Anything in `user/` or `developer/` that conflicts with these is a bug in the docs.

### Architecture decisions (ADR)

| # | Document | Status | Decision |
|---|---|---|---|
| ADR-001 | [Nix flake build](reference/adr/ADR-001-nixos-flakes.md) | Accepted | Manifest-driven Nix flake replaces the monolithic Dockerfile |
| ADR-002 | [RuVector as embedded retrieval](reference/adr/ADR-002-ruvector-standalone.md) | Accepted | Local retrieval cache, not a source of truth |
| ADR-003 | [Guidance control plane](reference/adr/ADR-003-guidance-control-plane.md) | Accepted | Enforcement gates for autonomous agents |
| ADR-004 | [Upstream sync boundaries](reference/adr/ADR-004-upstream-sync.md) | Accepted | Selective sync, not mechanical |
| ADR-005 | [Pluggable adapter architecture](reference/adr/ADR-005-pluggable-adapter-architecture.md) | Accepted | Five-slot adapters × three impl classes |
| ADR-006 | [Immutable runtime bootstrap](reference/adr/ADR-006-immutable-runtime-bootstrap.md) | Accepted | No dependency resolution at startup |
| ADR-007 | [Runtime contract + hardening](reference/adr/ADR-007-runtime-contract-and-container-hardening.md) | Accepted | Image ref + probes + observability + hardening as one contract |
| ADR-008 | [Privacy filter routing](reference/adr/ADR-008-privacy-filter-routing.md) | Accepted | Local openai/privacy-filter sidecar as cross-cutting adapter middleware |
| ADR-009 | [Embedded Nostr relay](reference/adr/ADR-009-embedded-nostr-relay.md) | Accepted | nostr-rs-relay + pod-inbox bridge for external-agent messaging |
| ADR-010 | [solid-pod-rs as first-class pod server](reference/adr/ADR-010-rust-solid-pod-adoption.md) | Accepted | First-party Rust Solid Protocol 0.11 server; default pods implementation |

### Product requirements (PRD)

| # | Document | Summary |
|---|---|---|
| PRD-001 | [Capabilities and adapters](reference/prd/PRD-001-capabilities-and-adapters.md) | Agentbox as a standalone product |
| PRD-002 | [Immutable runtime bootstrap](reference/prd/PRD-002-immutable-runtime-bootstrap.md) | Remove mutable dep-install from startup |
| PRD-003 | [Runtime contract + container hardening](reference/prd/PRD-003-runtime-contract-and-container-hardening.md) | Image selection + probes + observability + hardening |
| PRD-004 | [External agent messaging](reference/prd/PRD-004-external-agent-messaging.md) | Sovereign relay surface + pod-inbox bridge |

### Domain design (DDD)

| # | Document | Focus |
|---|---|---|
| DDD-001 | [Immutable bootstrap domain](reference/ddd/DDD-001-immutable-bootstrap-domain.md) | RuntimeClosure aggregate + BootstrapPolicy |
| DDD-002 | [Runtime contract domain](reference/ddd/DDD-002-runtime-contract-domain.md) | ImageReferencePolicy + ProbeContract + ObservabilityBinding + SecurityProfile |
| DDD-003 | [Sovereign messaging domain](reference/ddd/DDD-003-sovereign-messaging-domain.md) | AgentIdentity + PodMailbox + RelayEndpoint + inbound/outbound envelopes |

---

## Reading order for new contributors

1. [`../README.md`](../README.md) — 5 minutes, product pitch + architecture
2. [`user/quickstart.md`](user/quickstart.md) — build and run
3. [`developer/architecture.md`](developer/architecture.md) — how it works inside
4. [`reference/prd/PRD-001-capabilities-and-adapters.md`](reference/prd/PRD-001-capabilities-and-adapters.md) — full product spec
5. [`reference/adr/ADR-005-pluggable-adapter-architecture.md`](reference/adr/ADR-005-pluggable-adapter-architecture.md) — adapter deep-dive
6. The other ADRs in order — they explain how we got here

## Conventions

- **Plain markdown.** No binary images in docs. Diagrams are Mermaid blocks.
- **Relative cross-refs.** Every link is a relative path so the docs tree is portable.
- **File size limit.** Docs stay under 500 lines; heavier material lives in siblings (`REFERENCE.md`, `EXAMPLES.md`).
- **Status tags.** ADRs carry `Status:` at the top; PRDs carry a version block.
- **Audience tiers are strict.** `user/` never references internal-only tooling; `developer/` never reexplains operator basics; `reference/` never loses a canonical claim to narrative drift.
