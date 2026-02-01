# ADR-001: NixOS Flakes Architecture

**Status:** Accepted
**Date:** 2024-12-01
**Author:** Agentbox Team

## Context

Building reproducible, multi-architecture container images for agentic workloads requires:

- Deterministic builds across ARM64 and x86_64
- Minimal image size (<5GB target)
- Layer optimization for fast pulls
- Development shell consistency

```mermaid
graph TB
    subgraph "Traditional Approach"
        D1[Dockerfile] --> D2[apt-get install]
        D2 --> D3[Non-deterministic]
        D3 --> D4[Large Images]
    end

    subgraph "NixOS Flakes"
        N1[flake.nix] --> N2[Declarative Deps]
        N2 --> N3[Hash-locked]
        N3 --> N4[Minimal Layers]
    end

    D4 -.->|"Problem"| N1

    style N1 fill:#5277c3,color:#fff
    style N4 fill:#10b981,color:#fff
```

## Decision

Use NixOS Flakes with nix2container for all container builds.

### Architecture

```mermaid
flowchart TB
    subgraph "flake.nix"
        INPUTS[Inputs<br/>nixpkgs, rust-overlay, nix2container]
        OUTPUTS[Outputs<br/>packages, devShells]
    end

    subgraph "Package Layers"
        BASE[Base Packages<br/>coreutils, bash, git]
        NODE[Node.js 20]
        PYTHON[Python 3.12]
        RUST[Rust Toolchain]
        WASM[WASM Tools]
        SERVICES[Services<br/>supervisor, procps]
    end

    subgraph "Images"
        RUNTIME[runtime<br/>Headless]
        FULL[full<br/>Combined]
        DESKTOP[desktop<br/>VNC]
    end

    INPUTS --> OUTPUTS
    OUTPUTS --> BASE
    BASE --> NODE --> PYTHON --> RUST --> WASM --> SERVICES
    SERVICES --> RUNTIME & FULL & DESKTOP

    style INPUTS fill:#5277c3,color:#fff
    style RUNTIME fill:#10b981,color:#fff
```

### Layer Strategy

| Layer | Contents | Size |
|-------|----------|------|
| 1 | Base utilities | ~50MB |
| 2 | Node.js 20 | ~100MB |
| 3 | Python 3.12 + packages | ~400MB |
| 4 | Rust toolchain | ~200MB |
| 5 | WASM tools | ~30MB |
| 6 | SQLite | ~10MB |
| 7 | Media (ffmpeg, imagemagick) | ~50MB |
| 8 | Services | ~20MB |

## Consequences

### Positive

- **Reproducibility** — Same hash = same image
- **Multi-arch** — Native ARM64 and x86_64 from same source
- **Minimal size** — Only declared dependencies included
- **Dev parity** — `nix develop` matches container exactly

### Negative

- **Learning curve** — Nix syntax unfamiliar to most
- **Build time** — Initial builds slower than cached Docker
- **Ecosystem** — Some packages require overlays

## Alternatives Considered

| Alternative | Rejected Because |
|-------------|------------------|
| Dockerfile | Non-deterministic, large images |
| Buildah | Less ecosystem support |
| Podman build | Same issues as Dockerfile |
