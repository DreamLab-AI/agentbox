# Agentbox

<div align="center">

<img src="docs/agentbox.png" alt="Agentbox" width="1920" />

### A manifest-driven, reproducible runtime for sovereign software agents.

[![Build](https://img.shields.io/github/actions/workflow/status/DreamLab-AI/agentbox/build-multi-arch.yml?branch=main&style=flat-square&logo=github)](https://github.com/DreamLab-AI/agentbox/actions)
[![License](https://img.shields.io/badge/License-AGPL%203.0-blue?style=flat-square)](LICENSE)
[![Nix](https://img.shields.io/badge/Nix-flakes-5277C3?style=flat-square&logo=nixos)](flake.nix)
[![Multi-arch](https://img.shields.io/badge/arch-amd64%20%7C%20arm64-green?style=flat-square&logo=docker)](https://github.com/DreamLab-AI/agentbox/pkgs/container/agentbox)

**One TOML manifest. One Nix flake. One runtime contract.**

**Maintainer**: [John O'Hare](https://github.com/jjohare) · **Upstream IP**: [Melvin Carvalho](https://github.com/melvincarvalho) ([JSS](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer), [DID:Nostr](https://github.com/nicholasgasior/did-nostr)) · [MAINTAINERS.md](MAINTAINERS.md)

[Quickstart](#quickstart) · [Why Agentbox](#why-agentbox) · [Capabilities](#included-capabilities) · [Sovereign Architecture](#the-sovereign-data-stack) · [Docs](docs/README.md)

</div>

---

## What is Agentbox?

Agentbox is a hardened, fully reproducible Linux container environment built specifically to host, orchestrate, and trace autonomous AI agents.

Instead of juggling custom Dockerfiles, scattered API keys, and brittle dependency scripts, **everything in Agentbox is driven by a single `agentbox.toml` manifest**. You declare the agents you want, the tools they need — from browser automation to 3D rendering — and the storage backends they use. Agentbox builds a byte-for-byte reproducible image using Nix, spins up the environment, and routes durable agent writes (memory, pods, beads, events) through a local privacy-redaction filter and cryptographic audit trails.

## Why Agentbox?

Most agent runtimes are just a collection of tools with no provenance, privacy, or reproducible state. Agentbox is built differently:

- 🚀 **Batteries Included (via MCP)**: Out-of-the-box support for Claude Code, Codex, Gemini, DeepSeek, and ruflo. Instantly equip them with 90+ skills including Playwright, ComfyUI, QGIS, Blender, LaTeX, and Jupyter via the Model Context Protocol (MCP).
- 🔒 **Privacy by Default**: An embedded `openai/privacy-filter` sidecar sits in the adapter-dispatch path, redacting PII and secrets _before_ durable writes hit memory or pods. Policy is **per slot** — `strict` (redact-then-write, fail-closed) for `memory` and `pods`, `soft` for `events`/`beads`, `off` for the `orchestrator` control plane. It is not a universal interceptor on every tool call; see [ADR-008](docs/reference/adr/ADR-008-privacy-filter-routing.md).
- 🛡️ **Hardened & Reproducible**: Built with Nix flakes. The `pg` Node module is baked into the image (no `npm install pg` at boot); a small set of `npx -y` CLI aliases is the one remaining runtime-fetch path, pending SRI pinning ([tracked in `lib/npm-cli.nix`](lib/npm-cli.nix)). Runs as non-root (uid 1000) with a read-only root filesystem, `cap_drop: ALL`, `no-new-privileges:true`, and a **supplemental seccomp denylist** (47 high-risk syscall denials layered on Docker's default profile — not a replacement allowlist; the container runtime is the security boundary). Published ports bind host-loopback only ([ADR-027](docs/reference/adr/ADR-027-default-secure-posture.md)).
- 🔗 **Sovereign Data & Auditability**: Agents own their data cryptographically. Every generated file, memory, and action is stamped with a `did:nostr` identity and stored in an embedded Solid Pod (`solid-pod-rs`). See [The Sovereign Data Stack](#the-sovereign-data-stack).
- 🔌 **Pluggable Adapters**: Run entirely standalone on a laptop (SQLite + local JSONL), or effortlessly federate into a cloud mesh (Postgres pgvector + HTTP event sinks) by flipping a TOML switch.

---

## Quickstart

### Interactive onboarding (recommended)

Use the browser-based setup wizard to configure your manifest, select your tools, and boot the container:

```sh
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox
./scripts/start-agentbox.sh
```

The wizard opens in your default browser — no dependencies beyond Python 3 (for the local HTTP server). It renders all `agentbox.toml` sections with schema-validated form controls and the DreamLab glassmorphism design system. Pass `--tui` to use the legacy terminal wizard instead.

<div align="center">
<img src="docs/images/setup-wizard-overview.png" alt="Setup Wizard" width="720" />
<br><em>Browser-based configuration wizard with schema-driven form controls</em>
</div>

### Fast path (pre-built image)

```sh
export AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest
docker pull "$AGENTBOX_IMAGE_REF"
./agentbox.sh up --registry
./agentbox.sh health
./agentbox.sh shell
```

### Build from source

```sh
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox
./scripts/agentbox-config-validate.sh
./agentbox.sh up --build
./agentbox.sh health
```

Next steps:

- [Configuration guide](docs/user/configuration.md)
- [Provider and API key setup](docs/user/providers.md)
- [Desktop mode and VNC access](docs/user/running.md)

---

## Included Capabilities

Your `agentbox.toml` manifest toggles capabilities on or off. Disabled features add zero bloat to your final image.

| Category | Highlights |
| :--- | :--- |
| **Agent toolchains** | `claude-code`, `ruflo`, `antigravity` (agy), `agentic-qe`, `openai-codex` |
| **Consultants** | Meta-router for named external consultations: DeepSeek, Perplexity, Z.AI, Antigravity |
| **Browser and web** | External browsercontainer sidecar (chrome-devtools-mcp, Chrome Beta 149+, GPU-accelerated) |
| **Media and design** | Local ComfyUI (or external URL), ImageMagick, FFmpeg |
| **Spatial and 3D** | QGIS geospatial analysis, Blender modelling, 3D Gaussian Splatting |
| **Data science and docs** | PyTorch, Jupyter Lab, LaTeX, Mermaid rendering |
| **Code-as-Harness** | Persistent Python kernel MCP, ExpeL post-task lesson distillation, Voyager verified-skill library, SWE-agent ACI MCP, execution-gated tree-search (PRD-008) |
| **Governance** | Agent Control Surface Protocol (kinds 31400-31405) — cross-repo human-in-the-loop integration with the DreamLab forum and the host project's broker via the embedded relay. The agentbox producer (`management-api/lib/agent-control-surface.js`) mints and publishes the panel events; see [sovereign mesh](docs/developer/sovereign-mesh.md). |
| **Embodied agent loop** | Bi-directional `/wss/agent-events` channel (ADR-014) — agents emit a canonical `agent_action` signal (identity preserved per ADR-013) that a host project renders as a live agent actor (coloured beam + transient attractive edge), and consume inbound user-interaction events so agents become user-aware. A privacy-safe memory-flash beacon (env-gated on `VISIONCLAW_API_URL`) fires the host's embedding-cloud visual on every RuVector access. See [ADR-014](docs/reference/adr/ADR-014-bidirectional-graph-state-ingress.md), [ADR-026](docs/reference/adr/ADR-026-cross-substrate-agent-loop-seams.md), [PRD-014](docs/reference/prd/PRD-014-embodied-agent-loop.md). |
| **Operations** | OTLP tracing, Prometheus metrics (`:9091/metrics`), Tailscale VPN integration |

### Code-as-Harness (PRD-008)

A persistent IPython kernel MCP exposes six tools (`kernel.exec`, `kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`) so that variable state, imported modules, and computed DataFrames survive across tool calls within a session. An ExpeL post-task hook distils completed trajectories into reusable `DistilledLesson` records in RuVector. A Voyager verified-skill library accumulates assertion-passing Python functions for retrieval and injection at future task start. A SWE-agent-style ACI MCP provides bounded file viewing, compact-diff editing, budget-capped search, structured test execution, and task submission for autonomous repo-level bug-fixing. An execution-gated tree-search skill generates N candidates, executes each in a fresh kernel session, and scores by assertion-pass rate. Multi-tier memory uses OWL2-typed RuVector namespaces (semantic / procedural / episodic) with no schema changes. All records carry `did:nostr` identity and PROV-O action receipts. Phase 1 surfaces (`code_interpreter`, `codeact`, `expel_lesson_extraction`) are opt-in; Phase 2 surfaces (`voyager_skill_library`, `aci_shell`, `tree_search_coder`) are scaffolded and default off. See `docs/developer/code-as-harness.md` for the operator guide.

---

## The Sovereign Data Stack

The core differentiator of Agentbox is the **Identity and Tracing Mesh**.

When an agent acts, how do you know _which_ agent did it? How do you prove it later? Without an identity root, audit logs are meaningless.

Agentbox solves this by generating a BIP-340 secp256k1 keypair at bootstrap. The agent's public key becomes a `did:nostr:<hex-pubkey>` identity. **Every resource, action, and event in the system is rooted in this cryptographic identity.**

From that single root, 18 kinds of `urn:agentbox:<kind>:[<scope>:]<local>` identifiers name every entity: pods, credentials, receipts, activities, events, memories, skills, architecture docs, and more. Owner-scoped kinds embed the hex pubkey — `urn:agentbox:credential:<hex-pubkey>:<sha256-12-…>` means that credential was issued by that agent and no other. Content-addressed kinds are deterministic: the same payload always produces the same URN, so re-emitting never double-counts and signed credentials keep a stable `@id` across JCS canonicalisation.

<details>
<summary><b>Identity root diagram</b></summary>

```mermaid
flowchart TB
    KP[secp256k1 keypair\nBIP-340 x-only]
    HEX[64-char hex pubkey]
    DID[did:nostr:hex-pubkey\nPrimary agent DID]
    KP --> HEX
    HEX --> DID

    subgraph identity["Identity surfaces"]
        POD_ID[Solid pod identity\nWAC agent field]
        RELAY_ID[Nostr relay NIP-42\nNIP-98 HTTP auth]
        DID_DOC[DID Document\nGET /.well-known/did.json]
    end

    DID --> POD_ID
    DID --> RELAY_ID
    DID --> DID_DOC

    subgraph owned["Owner-scoped URNs — hex pubkey in scope"]
        CRED[urn:agentbox:credential\nhex-pubkey:sha256-12-...]
        RECEIPT[urn:agentbox:receipt\nhex-pubkey:sha256-12-...]
        ACTIVITY[urn:agentbox:activity\nhex-pubkey:sha256-12-...]
        BEAD[urn:agentbox:bead\nhex-pubkey:sha256-12-...]
        EVENT[urn:agentbox:event\nhex-pubkey:sha256-12-...]
        MANDATE[urn:agentbox:mandate\nhex-pubkey:sha256-12-...]
        AGENT[urn:agentbox:agent\nhex-pubkey:sha256-12-...]
        ENVELOP[urn:agentbox:envelope\nhex-pubkey:sha256-12-...]
    end

    DID --> CRED
    DID --> RECEIPT
    DID --> ACTIVITY
    DID --> BEAD
    DID --> EVENT
    DID --> MANDATE
    DID --> AGENT
    DID --> ENVELOP
```

</details>

<details>
<summary><b>Request lifecycle and adapter dispatch pipeline</b></summary>

Every request through the management API follows a rigorous lifecycle: identity verification → adapter routing → privacy redaction → JSON-LD encoding → OTLP tracing.

```mermaid
sequenceDiagram
    participant AG as Agent did:nostr:hex
    participant MA as management-api
    participant AR as adapter resolver
    participant PF as privacy filter
    participant UM as uris.mint
    participant PO as solid-pod-rs
    participant OT as OTLP exporter

    AG->>MA: POST /v1/pods/:id/resources NIP-98 signed
    MA->>OT: span open agentbox.adapter.pods.write
    MA->>AR: resolve slot=pods
    AR->>PF: write(slot=pods payload=data)
    PF->>PF: policy=strict redact via opf-router
    PF-->>AR: redacted payload
    AR->>UM: mint kind=pod pubkey=hex payload=redacted
    UM-->>AR: urn:agentbox:pod:hex:sha256-12-abc
    AR->>PO: PUT resource atomic rename
    PO-->>AR: 201 ETag
    AR->>UM: mint kind=activity pubkey=hex action=write
    UM-->>AR: urn:agentbox:activity:hex:sha256-12-def
    MA->>OT: span close resource-urn=urn:agentbox:pod:...
    MA-->>AG: 201 JSON-LD @id=urn:agentbox:pod:hex:sha256-12-abc
```

</details>

<details>
<summary><b>Full URN kind taxonomy (18 kinds)</b></summary>

```mermaid
flowchart LR
    subgraph identity_k["Identity"]
        POD_K[pod]
        AGENT_K[agent]
    end

    subgraph comms["Communications"]
        ENVELOPE_K[envelope]
        EVENT_K[event]
        RECEIPT_K[receipt]
    end

    subgraph state["Durable state"]
        BEAD_K[bead]
        MEMORY_K[memory]
        DATASET_K[dataset]
        THING_K[thing]
    end

    subgraph auth["Auth and trust"]
        CRED_K[credential]
        MANDATE_K[mandate]
        MCP_K[mcp]
    end

    subgraph trace["Tracing"]
        ACTIVITY_K[activity]
        SKILL_K[skill]
    end

    subgraph docs["Governance docs"]
        ADR_K[adr]
        PRD_K[prd]
        DDD_K[ddd]
        META_K[meta]
    end
```

| Kind | Owner-scoped | Content-addressed | Example URN |
|------|:---:|:---:|-------------|
| `pod` | yes | yes | `urn:agentbox:pod:hex:sha256-12-abc` |
| `envelope` | yes | yes | `urn:agentbox:envelope:hex:sha256-12-abc` |
| `credential` | yes | yes | `urn:agentbox:credential:hex:sha256-12-abc` |
| `mandate` | yes | yes | `urn:agentbox:mandate:hex:sha256-12-abc` |
| `receipt` | yes | yes | `urn:agentbox:receipt:hex:sha256-12-abc` |
| `activity` | yes | yes | `urn:agentbox:activity:hex:sha256-12-abc` |
| `event` | yes | yes | `urn:agentbox:event:hex:sha256-12-abc` |
| `bead` | yes | yes | `urn:agentbox:bead:hex:sha256-12-abc` |
| `agent` | yes | no | `urn:agentbox:agent:hex:agent-name` |
| `mcp` | no | no | `urn:agentbox:mcp:server-slug` |
| `memory` | yes | no | `urn:agentbox:memory:hex:name` |
| `skill` | no | no | `urn:agentbox:skill:slug` |
| `dataset` | yes | no | `urn:agentbox:dataset:hex:name` |
| `thing` | yes | no | `urn:agentbox:thing:hex:name` |
| `adr` | no | no | `urn:agentbox:adr:ADR-013` |
| `prd` | no | no | `urn:agentbox:prd:PRD-006` |
| `ddd` | no | no | `urn:agentbox:ddd:DDD-004` |
| `meta` | no | no | `urn:agentbox:meta:slug` |

</details>

Because Agentbox uses canonical URIs and Linked Data (JSON-LD), you can spin up the built-in [Linked-Data browser](docs/user/browser.md) at `/lo/*` to navigate the graph of your agent's memories, architectural decisions, and credentials. The `/v1/uri/<urn>` resolver maps any URN to its current HTTP representation.

Deeper reading:

- [Identity and tracing mesh](docs/developer/identity-mesh.md)
- [ADR-013 — Canonical URI grammar](docs/reference/adr/ADR-013-canonical-uri-grammar.md)
- [ADR-005 — Pluggable adapter architecture](docs/reference/adr/ADR-005-pluggable-adapter-architecture.md)
- [PRD-006 — Linked-data interfaces](docs/reference/prd/PRD-006-linked-data-interfaces.md)

---

## Federation Transports

Agentbox participates in all three DreamLab federation transport strata. Each stratum is independently enabled via `agentbox.toml` and `.env` configuration.

```mermaid
graph LR
    subgraph "This Agentbox"
        TS["Tailscale\nuserspace-networking"]
        NR["nostr-rs-relay\n:7777"]
        MA["management-api\n:9090"]
    end

    TS <-->|"WireGuard\nMagicDNS"| OTHER["Other Agentboxes\nsolid-pod-rs hosts"]
    NR <-->|"NIP-01 WS"| RELAY["Private/Public\nNostr Relays"]
    MA -->|"CF Tunnel\nHTTPS"| CF["Cloudflare Edge"]
```

### Stratum 1 — Tailscale (Private Mesh)

Each agentbox container joins the tailnet with its own identity using `--tun=userspace-networking` (no `/dev/net/tun` needed). The container's MagicDNS hostname (configured via `[networking].hostname` in `agentbox.toml`) becomes the service discovery address for other mesh participants.

```toml
# agentbox.toml
[networking]
tailscale = true
hostname = "agentbox-london"

# .env
TAILSCALE_AUTHKEY=tskey-auth-...
```

**Security:** Tailscale runs inside the container, isolated from host networking. Tailscale ACLs control access — `did:nostr` signatures are not evaluated at this layer.

### Stratum 2 — Nostr Relays (All Components)

The embedded `nostr-rs-relay` (`:7777`) serves as both a local event store and a mesh relay. Peer relays are configured in `agentbox.toml`:

```toml
[sovereign_mesh.mesh]
peer_relays = [
    "ws://agentbox-paris.tailnet-name.ts.net:7777",   # Tailscale peer
    "wss://relay.damus.io",                             # Public relay
]
```

All relay traffic is authenticated via NIP-98/NIP-42 `did:nostr` Schnorr signatures. Private relays keep governance events (kinds 31400-31405) within the organisation. Public relays provide censorship-resistant message passing when private infrastructure is unavailable.

### Stratum 3 — Cloudflare Tunnels (Edge ↔ Local)

A Cloudflare tunnel exposes the management API and solid-pod-rs to CF Workers services (nostr-rust-forum, dreamlab-ai-website) without opening ports to the public internet. Configure via:

```
# .env
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
AGENTBOX_PUBLIC_URL=https://pods-native.dreamlab-ai.com
```

CF Workers reach the local agentbox through the tunnel for pod provisioning, resource access, and NIP-05 federated resolution.

See [Tailscale guide](docs/user/tailscale.md) · [Mesh deployment](docs/user/mesh-deployment.md) · [Identity mesh](docs/developer/identity-mesh.md)

---

## Documentation

### For operators

- [Quickstart](docs/user/quickstart.md)
- [Installation](docs/user/installation.md)
- [Configuration](docs/user/configuration.md)
- [Running](docs/user/running.md)
- [Providers](docs/user/providers.md)
- [Backup and restore](docs/user/backup-restore.md)
- [Troubleshooting](docs/user/troubleshooting.md)

### For sovereign data and linked data

- [Sovereign stack](docs/user/sovereign-stack.md)
- [Solid pod](docs/user/solid-pod.md)
- [Nostr relay](docs/user/nostr-relay.md)
- [Privacy filter](docs/user/privacy-filter.md)
- [Linked-data interfaces](docs/user/linked-data.md)
- [Canonical URIs](docs/user/uris.md)
- [JSON-LD browser](docs/user/browser.md)
- [Consultants](docs/user/consultants.md)

### For developers

- [Architecture overview](docs/developer/architecture.md)
- [Identity and tracing mesh](docs/developer/identity-mesh.md)
- [Adapter pattern](docs/developer/adapters.md)
- [Sovereign mesh](docs/developer/sovereign-mesh.md)
- [Ecosystem integration](docs/developer/ecosystem.md)
- [Testing](docs/developer/testing.md)

### Canonical specs

- [ADR index](docs/reference/adr/)
- [PRD index](docs/reference/prd/)
- [DDD index](docs/reference/ddd/)
- [Docs hub](docs/README.md)

---

## Platforms

| Target | Build | Run | Notes |
| --- | --- | --- | --- |
| Linux x86_64 | Native | Native | Full support, richest local feature set |
| Linux aarch64 | Native | Native | Supported, subject to feature-specific gates |
| macOS | Compose/dev tooling | Docker Desktop/OrbStack/Colima | CPU or remote-GPU paths |
| Windows | Compose/dev tooling | Docker Desktop + WSL2 | WSL2 is the practical path |
| Remote Linux | Native or registry | Native | OCI/Fly/Hetzner/bare workflows supported |

---

## Contributing

1. Read [docs/developer/architecture.md](docs/developer/architecture.md).
2. Validate the manifest before changing build or runtime behavior.
3. Prefer manifest-gated additions over ad hoc runtime mutation.
4. Treat hardening, probe semantics, URI grammar, and linked-data surfaces as architectural changes — propose them via an ADR.

## Part of VisionFlow

Agentbox is the **harness engineering** substrate of the [VisionFlow](https://github.com/DreamLab-AI/VisionFlow) coordination platform — a federated architecture for human–AI intelligence built on `did:nostr` identity, OWL 2 EL reasoning, and Nostr message passing. agentbox runs the agents; VisionClaw renders the embodied agent loop; solid-pod-rs stores sovereignly; the forum and website provide governance and operator surfaces.

| Substrate | Repository | Role |
|:----------|:-----------|:-----|
| **VisionFlow** | [DreamLab-AI/VisionFlow](https://github.com/DreamLab-AI/VisionFlow) | Umbrella canon — ecosystem guide and coordination architecture |
| **VisionClaw** | [DreamLab-AI/VisionClaw](https://github.com/DreamLab-AI/VisionClaw) | Knowledge engineering — OWL 2 EL, 92 CUDA kernels, XR; renders the embodied agent loop |
| **Agentbox** | **[DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)** | **Harness engineering — Nix, 90+ skills, sovereign pods; runs the agents** |
| **solid-pod-rs** | [DreamLab-AI/solid-pod-rs](https://github.com/DreamLab-AI/solid-pod-rs) | Cryptographic foundation — JSS Rust port, DID:Nostr |
| **nostr-rust-forum** | [DreamLab-AI/nostr-rust-forum](https://github.com/DreamLab-AI/nostr-rust-forum) | Forum kit — passkey auth, governance events |
| **dreamlab-ai-website** | [DreamLab-AI/dreamlab-ai-website](https://github.com/DreamLab-AI/dreamlab-ai-website) | Branded deployment — React, WASM, Cloudflare Workers |

Deeper reading: [Ecosystem integration guide](docs/developer/ecosystem.md)

---

## License

Core project: [AGPL-3.0](LICENSE).

Using agentbox as a hosted service — including running it on behalf of other users — requires you to make the full source (including any modifications) available to those users. Self-hosted and internal use carry no additional obligations beyond the standard copyleft terms.

Optional components (`linkedobjects/browser`, `solid-pod-rs`) are also AGPL-3.0 and therefore consistent with the project license. Other bundled components are MIT or Apache-2.0. See [Licensing details](docs/developer/licensing.md) for the full matrix.

---

<div align="center">

[Documentation](docs/README.md) · [Issues](https://github.com/DreamLab-AI/agentbox/issues) · [Releases](https://github.com/DreamLab-AI/agentbox/releases) · [Container Registry](https://github.com/DreamLab-AI/agentbox/pkgs/container/agentbox)

</div>
