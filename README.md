# Agentbox

**Minimal Agentic Container for Claude Flow V3**

[![Architecture](https://img.shields.io/badge/Architecture-ARM64%20%7C%20x86__64-blue?style=for-the-badge)](https://github.com/DreamLab-AI/agentbox)
[![NixOS](https://img.shields.io/badge/NixOS-Flakes-5277C3?style=for-the-badge&logo=nixos)](https://nixos.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Skills](https://img.shields.io/badge/Skills-66-purple?style=for-the-badge)](skills/)
[![Agents](https://img.shields.io/badge/Subagents-610+-orange?style=for-the-badge)](https://github.com/ChrisRoyse/610ClaudeSubagents)
[![AISP](https://img.shields.io/badge/AISP-5.1%20Platinum-gold?style=for-the-badge)](aisp/)

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
        F --> G[66 Essential Skills]
        G --> H[610+ Agent Templates]
        H --> I[10x-100x Autonomy]
    end

    D -.->|"Transform"| E

    style E fill:#10b981,color:#fff
    style F fill:#10b981,color:#fff
    style G fill:#10b981,color:#fff
    style H fill:#10b981,color:#fff
    style I fill:#10b981,color:#fff
```

## Key Features

| Feature | Description |
|---------|-------------|
| **66 Skills** | Core development, Claude Flow V3, AgentDB, Flow Nexus, GitHub, AI/Media |
| **610+ Subagents** | Pre-loaded Claude agent templates (auto-cloned on first run) |
| **AISP 5.1 Platinum** | Neuro-symbolic AI-to-AI protocol with Hebbian learning |
| **RuVector** | Standalone Rust vector database (no PostgreSQL) |
| **Guidance Control Plane** | 10x-100x extended autonomy with enforcement gates |
| **Multi-Architecture** | ARM64 (Oracle Cloud) + x86_64 support |

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
            GCLOUD[Google Cloud SDK]
        end

        subgraph "Intelligence Layer"
            AISP[AISP 5.1 Platinum<br/>Neuro-Symbolic]
            AGENTS[610+ Subagents<br/>Templates]
            GCP[Guidance Control Plane]
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
    CF --> AISP
    AISP --> AGENTS
    GCP --> AGENTS

    NODE --> NIX
    PY --> NIX
    RUST --> NIX
    WASM --> NIX
    GCLOUD --> NIX

    style CF fill:#8b5cf6,color:#fff
    style RV fill:#f59e0b,color:#fff
    style GCP fill:#ec4899,color:#fff
    style AISP fill:#fcd34d,color:#000
    style AGENTS fill:#fb923c,color:#fff
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
  -v agentbox-workspace:/home/devuser/workspace \
  -v agentbox-agents:/home/devuser/agents \
  agentbox:runtime-aarch64-linux

# Or with docker-compose
docker-compose up -d
```

### Development Shell

```bash
# Enter development environment
nix develop

# All tools available: node, python, rust, wasm-pack, gcloud, etc.
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
        RVMCP[RuVector MCP :9701]
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
| 9701 | RuVector MCP | Internal | MCP integration |

## AISP 5.1 Platinum Integration

Neuro-symbolic AI-to-AI communication protocol with Hebbian learning.

```mermaid
graph TB
    subgraph "AISP Architecture"
        subgraph "Pocket Structure"
            H[ℋ Header<br/>ID, Signal V, Flags]
            M[ℳ Membrane<br/>Affinity, Confidence, Tags]
            N[𝒩 Nucleus<br/>Definition, IR, WASM]
        end

        subgraph "Binding States"
            B0[0: Crash<br/>Logic Conflict]
            B1[1: Null<br/>Socket Mismatch]
            B2[2: Adapt<br/>Type Transform]
            B3[3: Zero-Cost<br/>Post ⊆ Pre]
        end

        subgraph "Quality Tiers"
            T1[◊⁺⁺ Platinum<br/>δ≥0.75]
            T2[◊⁺ Gold<br/>δ≥0.60]
            T3[◊ Silver<br/>δ≥0.40]
            T4[◊⁻ Bronze<br/>δ≥0.20]
        end
    end

    H --> M --> N
    B0 --> B1 --> B2 --> B3

    style H fill:#fcd34d,color:#000
    style M fill:#fb923c,color:#fff
    style N fill:#f97316,color:#fff
    style B3 fill:#10b981,color:#fff
    style T1 fill:#fcd34d,color:#000
```

### Usage

```bash
# Validate AISP document
aisp validate document.md

# Check binding compatibility
aisp binding agent-a agent-b

# Initialize pocket store
aisp init

# Benchmark performance
aisp benchmark
```

### Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| α (alpha) | 0.1 | Hebbian confidence increase rate |
| β (beta) | 0.05 | Hebbian confidence decrease rate |
| τ_v | 0.7 | Affinity threshold for skip |
| V_H | 768 | High-level semantic dimensions |
| V_L | 512 | Low-level topological dimensions |
| V_S | 256 | Safety constraint dimensions |

## 610+ Claude Subagents

Pre-loaded agent templates auto-cloned from [ChrisRoyse/610ClaudeSubagents](https://github.com/ChrisRoyse/610ClaudeSubagents).

```bash
# List available agents
agent-list

# Load specific agent
agent-load doc-planner

# View agent count
ls $AGENTS_DIR/*.md | wc -l
```

### Key Agents

| Agent | Purpose |
|-------|---------|
| `doc-planner` | Documentation strategy |
| `microtask-breakdown` | Task decomposition |
| `github-pr-manager` | PR workflow automation |
| `tdd-london-swarm` | Test-driven development |
| `api-designer` | API specification |
| `security-auditor` | Security analysis |

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

## Skills (66)

```mermaid
mindmap
  root((Agentbox<br/>66 Skills))
    Core Development
      build-with-quality v3.4.0
      verification-quality
      rust-development
      guidance-control-plane
      pair-programming
    Claude Flow V3
      v3-core-implementation
      v3-ddd-architecture
      v3-memory-unification
      v3-performance-optimization
      v3-security-overhaul
      v3-swarm-coordination
      v3-cli-modernization
      v3-mcp-optimization
      v3-integration-deep
    AgentDB & Memory
      agentdb-advanced
      agentdb-learning
      agentdb-memory-patterns
      agentdb-vector-search
      reasoningbank-agentdb
      reasoningbank-intelligence
    Flow Nexus
      flow-nexus-neural
      flow-nexus-platform
      flow-nexus-swarm
    AI & Media
      blender
      comfyui
      cuda
      gemini-url-context
      deepseek-reasoning
      agentic-qe
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
      host-webserver-debug
      console-buddy
```

### Skill Categories

| Category | Count | Key Skills |
|----------|-------|------------|
| Core Development | 7 | build-with-quality, rust-development, guidance-control-plane |
| Claude Flow V3 | 9 | v3-core-implementation, v3-swarm-coordination |
| AgentDB & Memory | 7 | agentdb-advanced, reasoningbank-intelligence |
| Flow Nexus | 3 | flow-nexus-neural, flow-nexus-swarm |
| AI & Media | 9 | blender, comfyui, cuda, gemini-url-context |
| Swarm | 4 | hive-mind-advanced, sparc-methodology |
| GitHub | 5 | github-code-review, github-workflow-automation |
| Browser & Automation | 12 | playwright, chrome-devtools, web-summary |
| Other | 10 | docker-manager, ffmpeg-processing, jupyter-notebooks |

## Turbo Flow Aliases (120+)

Quick command access via turbo-flow-aliases.sh:

```bash
# Source aliases
source /home/devuser/.config/turbo-flow-aliases.sh

# Or they're auto-loaded in zsh
```

### Essential Aliases

| Alias | Command | Description |
|-------|---------|-------------|
| `cf` | `npx @claude-flow/cli@latest` | Claude Flow CLI |
| `cf-swarm` | `cf swarm` | Swarm orchestration |
| `cf-hive` | `cf hive-mind spawn` | Hive-mind agents |
| `cf-doctor` | `cf doctor --fix` | System diagnostics |
| `af-coder` | `agentic-flow --agent coder` | Agentic Flow coder |
| `aqe` | `agentic-qe` | Testing framework |
| `aj` | `agentic-jujutsu` | Quantum-resistant git |
| `gf-swarm` | `gemini-flow swarm` | Gemini 66-agent swarm |
| `turbo-help` | (function) | Quick reference |
| `agent-load` | (function) | Load subagent template |

### Helper Functions

```bash
# Initialize workspace
turbo-init

# Load agent template
agent-load doc-planner

# List all agents
agent-list

# Quick reference
turbo-help
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

## Runtime Packages

Installed via npm on first run or on-demand via npx:

| Package | Version | Purpose |
|---------|---------|---------|
| `@claude-flow/cli` | latest | V3 swarm orchestration |
| `agent-browser` | latest | AI-optimized browser automation |
| `@claude-flow/browser` | latest | Browser MCP integration |
| `agentic-flow` | latest | Multi-agent flow orchestration |
| `agentic-qe` | latest | Testing framework (51 agents) |
| `agentic-jujutsu` | latest | Quantum-resistant git |
| `ruvector` | latest | Standalone vector database |
| `agentdb` | latest | Agent memory database |
| `gemini-flow` | latest | Google Gemini integration |
| `claude-usage-cli` | latest | Usage tracking |

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

| Excluded | Reason | Alternative |
|----------|--------|-------------|
| GPU/CUDA Runtime | No NVIDIA dependencies | Use cuda skill docs only |
| Desktop Environment | Headless only | VNC via SSH tunnel |
| ComfyUI Runtime | Heavy dependencies | External container, use comfyui skill |
| Blender Runtime | GUI application | External container, use blender skill |
| Full LaTeX | Large footprint | Use external service |
| PyTorch GPU | CUDA dependencies | CPU-only inference |

## Directory Structure

```
agentbox/
├── flake.nix              # NixOS container definitions
├── CLAUDE.md              # Project configuration
├── config/
│   ├── supervisord.conf   # Service management
│   ├── turbo-flow-aliases.sh  # 120+ aliases
│   └── claude-flow-config.json
├── skills/                # 66 essential skills
│   ├── build-with-quality/
│   ├── claude-flow-browser/
│   ├── flow-nexus-*/
│   ├── gemini-url-context/
│   └── ...
├── aisp/                  # AISP 5.1 Platinum
│   ├── index.js           # Core implementation
│   ├── cli.js             # CLI interface
│   └── benchmark.js       # Performance testing
├── mcp/                   # MCP infrastructure
├── management-api/        # Express.js API
├── claude-zai/            # Z.AI proxy service
├── https-bridge/          # HTTPS bridging
└── docs/
    ├── guides/            # How-to guides
    ├── adr/               # Architecture decisions
    └── reference/         # API reference
```

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Project configuration |
| [docs/guides/quick-start.md](docs/guides/quick-start.md) | Getting started guide |
| [docs/adr/ADR-001-nixos-flakes.md](docs/adr/ADR-001-nixos-flakes.md) | NixOS architecture |
| [docs/adr/ADR-002-ruvector-standalone.md](docs/adr/ADR-002-ruvector-standalone.md) | RuVector design |
| [docs/adr/ADR-003-guidance-control-plane.md](docs/adr/ADR-003-guidance-control-plane.md) | Governance design |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes following ADR guidelines
4. Run `nix build` to verify
5. Submit a pull request

## License

MIT License — See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with NixOS Flakes for reproducibility<br/>
  Designed for Oracle Cloud ARM free tier<br/>
  Powered by Claude Flow V3 + AISP 5.1 Platinum<br/>
  <br/>
  <strong>66 Skills • 610+ Subagents • 120+ Aliases</strong>
</p>
