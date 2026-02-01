# Agentbox

**Minimal Agentic Container for Claude Flow V3**

[![Architecture](https://img.shields.io/badge/Architecture-ARM64%20%7C%20x86__64-blue?style=for-the-badge)](https://github.com/DreamLab-AI/agentbox)
[![NixOS](https://img.shields.io/badge/NixOS-Flakes-5277C3?style=for-the-badge&logo=nixos)](https://nixos.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Skills](https://img.shields.io/badge/Skills-55-purple?style=for-the-badge)](skills/)

A lightweight, reproducible container optimized for headless agentic workloads. Built with NixOS Flakes targeting Oracle Cloud ARM free tier.

## Why Agentbox?

```mermaid
graph LR
    subgraph "Traditional Container"
        A[100GB+ Image] --> B[GPU Dependencies]
        B --> C[Desktop Environment]
        C --> D[Bloated Runtime]
    end

    subgraph "Agentbox"
        E[<5GB Image] --> F[Headless Optimized]
        F --> G[55 Essential Skills]
        G --> H[10x-100x Autonomy]
    end

    D -.->|"Transform"| E

    style E fill:#10b981,color:#fff
    style F fill:#10b981,color:#fff
    style G fill:#10b981,color:#fff
    style H fill:#10b981,color:#fff
```

## Architecture

```mermaid
graph TB
    subgraph "Agentbox Container"
        subgraph "Services Layer"
            CF[Claude Flow V3<br/>MCP/Swarm]
            MA[Management API<br/>:9090]
            ZAI[Z.AI Service<br/>:9600]
            RV[RuVector<br/>:9700]
        end

        subgraph "Runtime Layer"
            NODE[Node.js 20 LTS]
            PY[Python 3.12]
            RUST[Rust Toolchain]
            WASM[WASM Tools]
        end

        subgraph "Governance Layer"
            GCP[Guidance Control Plane]
            GATES[Enforcement Gates]
            PROOF[Proof Chain]
        end

        subgraph "Base Layer"
            NIX[NixOS Flakes]
        end
    end

    CF --> NODE
    MA --> NODE
    ZAI --> NODE
    RV --> RUST

    CF --> GCP
    GCP --> GATES
    GCP --> PROOF

    NODE --> NIX
    PY --> NIX
    RUST --> NIX
    WASM --> NIX

    style CF fill:#8b5cf6,color:#fff
    style RV fill:#f59e0b,color:#fff
    style GCP fill:#ec4899,color:#fff
    style NIX fill:#5277c3,color:#fff
```

## Quick Start

### Prerequisites

- [Nix](https://nixos.org/download.html) with flakes enabled
- Docker (for running built images)

### Build

```bash
# Clone repository
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox

# Build for your architecture
nix build .#runtime      # Headless runtime image
nix build .#full         # Combined full image
nix build .#desktop      # Desktop with VNC

# Load into Docker
docker load < result
```

### Run

```bash
# Start container
docker run -d \
  --name agentbox \
  -p 22:22 \
  -p 9090:9090 \
  -p 9700:9700 \
  agentbox:runtime-aarch64-linux

# Or with docker-compose
docker-compose up -d
```

### Development Shell

```bash
# Enter development environment
nix develop

# All tools available: node, python, rust, wasm-pack, etc.
```

## Services

```mermaid
graph LR
    subgraph "External Access"
        SSH[SSH :22]
        MGMT[Management :9090]
        RUV[RuVector :9700]
        VNC[VNC :5901]
        CODE[code-server :8080]
    end

    subgraph "Internal Only"
        ZAI[Z.AI :9600]
        MCP[MCP TCP :9500]
    end

    CLIENT((Client)) --> SSH
    CLIENT --> MGMT
    CLIENT --> RUV
    CLIENT -.->|"SSH Tunnel"| VNC
    CLIENT -.->|"Optional"| CODE

    SSH --> ZAI
    MGMT --> ZAI
    MCP --> ZAI

    style ZAI fill:#f59e0b,color:#fff
    style SSH fill:#10b981,color:#fff
    style MGMT fill:#10b981,color:#fff
    style RUV fill:#10b981,color:#fff
```

| Port | Service | Access | Description |
|------|---------|--------|-------------|
| 22 | SSH | Public | Secure shell access |
| 5901 | VNC | SSH Tunnel | Remote desktop (desktop image) |
| 8080 | code-server | Optional | Web IDE |
| 9090 | Management API | Public | Container management |
| 9500 | MCP TCP | Internal | MCP protocol |
| 9600 | Z.AI | Internal | Cost-effective Claude proxy |
| 9700 | RuVector | Public | Vector database API |

## RuVector Vector Database

Standalone Rust-native vector database — **NO PostgreSQL required**.

```mermaid
graph TB
    subgraph "RuVector Architecture"
        API[REST API :9700]
        MCP_S[MCP Server :9701]

        subgraph "Core Engine"
            HNSW[HNSW Index<br/>150x-12,500x faster]
            GNN[GNN Layers<br/>GCN, GAT, GIN]
            LEARN[Self-Learning<br/>ReasoningBank]
        end

        subgraph "Storage"
            REDB[(redb<br/>Embedded)]
        end
    end

    API --> HNSW
    API --> GNN
    MCP_S --> HNSW

    HNSW --> REDB
    GNN --> REDB
    LEARN --> REDB

    style HNSW fill:#f59e0b,color:#fff
    style REDB fill:#6366f1,color:#fff
```

### Features

- **HNSW Indexing** — 150x-12,500x faster similarity search
- **GNN Layers** — GCN, GraphSAGE, GAT, GIN operations
- **Self-Learning** — ReasoningBank pattern recognition
- **384-dim Embeddings** — all-MiniLM-L6-v2 compatible
- **MCP Integration** — Native Claude Code/Flow support

### Usage

```bash
# Start RuVector server
npx ruvector serve --port 9700 --data-dir /var/lib/ruvector

# Start MCP server for Claude integration
npx ruvector mcp --port 9701

# CLI operations
npx ruvector --help
```

## Guidance Control Plane

Governance backbone enabling **10x-100x extended autonomy**.

```mermaid
flowchart TB
    subgraph "Input"
        CLAUDE_MD[CLAUDE.md]
        TASK[Task Intent]
    end

    subgraph "Guidance Control Plane"
        direction TB
        COMPILE[Compile<br/>Constitution + Shards]
        RETRIEVE[Retrieve<br/>Intent Classification]

        subgraph "Enforcement"
            G1[Destructive Ops]
            G2[Tool Allowlist]
            G3[Diff Size]
            G4[Secrets Detection]
        end

        PROOF[Proof Chain<br/>Cryptographic Envelopes]
        TRUST[Trust System<br/>Tier Management]
        ADVERSARIAL[Adversarial Defense<br/>Injection Detection]
    end

    subgraph "Output"
        DECISION{Gate<br/>Decision}
        ALLOW[Allow]
        BLOCK[Block + Log]
    end

    CLAUDE_MD --> COMPILE
    TASK --> RETRIEVE
    COMPILE --> RETRIEVE
    RETRIEVE --> G1 & G2 & G3 & G4
    G1 & G2 & G3 & G4 --> DECISION
    DECISION -->|Pass| ALLOW
    DECISION -->|Fail| BLOCK
    ALLOW --> PROOF
    BLOCK --> PROOF
    PROOF --> TRUST
    TRUST --> ADVERSARIAL

    style COMPILE fill:#8b5cf6,color:#fff
    style PROOF fill:#ec4899,color:#fff
    style TRUST fill:#10b981,color:#fff
```

### Impact

| Metric | Without | With Control Plane | Improvement |
|--------|---------|-------------------|-------------|
| Autonomy Duration | Minutes | Days to Weeks | **10x-100x** |
| Destructive Actions | Common | Rare | **50-90% reduction** |
| Memory Corruption | Frequent | Blocked | **70-90% reduction** |
| Prompt Injection | Vulnerable | Detected | **80-95% reduction** |

## Skills (55)

```mermaid
mindmap
  root((Agentbox<br/>Skills))
    Core Development
      build-with-quality v3.4.0
      verification-quality
      rust-development
      guidance-control-plane
    Claude Flow V3
      v3-core-implementation
      v3-ddd-architecture
      v3-memory-unification
      v3-performance-optimization
      v3-security-overhaul
      v3-swarm-coordination
    AgentDB & Memory
      agentdb-advanced
      agentdb-learning
      agentdb-memory-patterns
      agentdb-vector-search
      reasoningbank-agentdb
    Swarm Orchestration
      hive-mind-advanced
      swarm-advanced
      swarm-orchestration
      sparc-methodology
    GitHub Integration
      github-code-review
      github-multi-repo
      github-project-management
      github-release-management
      github-workflow-automation
    Browser & Automation
      playwright
      chrome-devtools
      claude-flow-browser
      web-summary
```

### Protocol Support (v3.4.0)

```mermaid
graph LR
    subgraph "AG-UI Protocol"
        AGUI[Agent-to-UI<br/>599 tests]
        SSE[SSE Transport]
        WS[WebSocket]
    end

    subgraph "A2A Protocol"
        A2A[Agent-to-Agent<br/>987 tests]
        JSONRPC[JSON-RPC 2.0]
        OAUTH[OAuth 2.0]
    end

    subgraph "A2UI Protocol"
        A2UI[Declarative UI<br/>608 tests]
        WCAG[WCAG 2.2 AA]
        COMPONENTS[31 Components]
    end

    AGENT((Agent)) --> AGUI
    AGENT --> A2A
    AGENT --> A2UI

    AGUI --> SSE & WS
    A2A --> JSONRPC & OAUTH
    A2UI --> WCAG & COMPONENTS

    style AGUI fill:#8b5cf6,color:#fff
    style A2A fill:#10b981,color:#fff
    style A2UI fill:#f59e0b,color:#fff
```

## Swarm Orchestration

```mermaid
sequenceDiagram
    participant User
    participant Claude as Claude Code
    participant Swarm as Swarm Coordinator
    participant Agents as Mesh Agents
    participant Memory as RuVector Memory

    User->>Claude: Complex Task
    Claude->>Swarm: Initialize Mesh Topology

    par Parallel Agent Spawning
        Swarm->>Agents: Spawn Researcher
        Swarm->>Agents: Spawn Coder
        Swarm->>Agents: Spawn Tester
        Swarm->>Agents: Spawn Reviewer
    end

    loop Task Execution
        Agents->>Memory: Store Findings
        Agents->>Agents: Peer Coordination
        Memory->>Agents: Retrieve Context
    end

    Agents->>Swarm: Results
    Swarm->>Claude: Aggregated Output
    Claude->>User: Complete Solution
```

### Topologies

```mermaid
graph TB
    subgraph "Mesh (Default)"
        M1((Agent)) <--> M2((Agent))
        M2 <--> M3((Agent))
        M3 <--> M1
        M1 <--> M4((Agent))
        M4 <--> M2
    end

    subgraph "Hierarchical"
        H1((Queen)) --> H2((Worker))
        H1 --> H3((Worker))
        H1 --> H4((Specialist))
        H2 --> H5((Scout))
    end

    subgraph "Star"
        S1((Hub)) --> S2((Agent))
        S1 --> S3((Agent))
        S1 --> S4((Agent))
        S1 --> S5((Agent))
    end
```

## Target Platform

Optimized for **Oracle Cloud Free Tier ARM Ampere A1**:

| Resource | Allocation |
|----------|------------|
| CPU | 4 ARM cores |
| RAM | 24 GB |
| Storage | 200 GB |
| Cost | **Free** |

## VNC Remote Desktop

The desktop image includes minimal VNC via SSH tunnel:

```bash
# Build desktop image
nix build .#desktop

# Run container
docker run -d --name agentbox -p 22:22 agentbox:desktop-aarch64-linux

# Start VNC services
docker exec agentbox supervisorctl start vnc:*

# Create SSH tunnel (from local machine)
ssh -L 5901:localhost:5901 devuser@<host>

# Connect VNC client to localhost:5901
```

Components: Xvfb + x11vnc + openbox (~150MB overhead)

## Not Included

Intentionally excluded for minimal footprint:

| Excluded | Reason |
|----------|--------|
| GPU/CUDA | No NVIDIA dependencies |
| Desktop Environment | Headless only |
| ComfyUI | Use separate container |
| Blender/QGIS/KiCAD | GUI applications |
| Full LaTeX | Use external service |
| PyTorch GPU | CPU-only inference |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Project configuration |
| [docs/guides/](docs/guides/) | How-to guides |
| [docs/adr/](docs/adr/) | Architecture decisions |
| [docs/reference/](docs/reference/) | API reference |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes following ADR guidelines
4. Submit a pull request

## License

MIT License — See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with NixOS Flakes for reproducibility<br/>
  Designed for Oracle Cloud ARM free tier<br/>
  Powered by Claude Flow V3
</p>
