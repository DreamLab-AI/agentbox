# Agentbox

**Minimal Agentic Container for Claude Flow V3**

[![Architecture](https://img.shields.io/badge/Architecture-ARM64%20%2B%20x86__64-blue?style=flat-square)](https://github.com/DreamLab-AI/agentbox)
[![NixOS](https://img.shields.io/badge/NixOS-Flakes-5277C3?style=flat-square&logo=nixos)](https://nixos.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

A lightweight, multi-architecture container optimized for headless agentic workloads. Built with NixOS Flakes for reproducible builds, targeting Oracle Cloud ARM free tier.

## Features

- **Multi-Architecture**: Native ARM64 and x86_64 support
- **Minimal Footprint**: <5GB image (down from 100GB+)
- **GPU-Free**: No NVIDIA/CUDA dependencies
- **Headless**: Optimized for remote deployment
- **Claude Flow V3**: Full swarm orchestration support
- **54 Essential Skills**: Curated for agentic workflows

## Quick Start

### Prerequisites

- [Nix](https://nixos.org/download.html) with flakes enabled
- Docker (for running the built images)

### Build

```bash
# Clone the repository
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox

# Build for your architecture
nix build .#runtime      # Runtime image
nix build .#postgres     # PostgreSQL image
nix build .#full         # Combined image

# Load into Docker
docker load < result
```

### Run

```bash
# Start the container
docker run -d \
  --name agentbox \
  -p 22:22 \
  -p 8080:8080 \
  -p 9090:9090 \
  agentbox:runtime-aarch64-linux

# Or with docker-compose
docker-compose up -d
```

### Development Shell

```bash
# Enter development environment
nix develop

# All tools available: node, python, rust, etc.
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Agentbox Container                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Claude Flow  │  │  Management  │  │    Z.AI      │      │
│  │     V3       │  │     API      │  │   Service    │      │
│  │  (MCP/Swarm) │  │   (9090)     │  │   (9600)     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Node.js    │  │   Python     │  │    Rust      │      │
│  │    20 LTS    │  │    3.12      │  │   Toolchain  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
├─────────────────────────────────────────────────────────────┤
│                    NixOS Base (Flakes)                      │
└─────────────────────────────────────────────────────────────┘
```

## Services

| Port | Service | Description |
|------|---------|-------------|
| 22 | SSH | Secure shell access |
| 8080 | code-server | Web IDE (optional) |
| 9090 | Management API | Container management |
| 9500 | MCP TCP | MCP protocol |
| 9600 | Z.AI | Claude API proxy (internal) |

## Skills

54 essential skills included, categorized for headless agentic workflows:

### Core Development
- `build-with-quality` - Quality gates and verification
- `rust-development` - Rust toolchain support
- `docker-manager` - Container operations

### Claude Flow V3
- `v3-*` - Full V3 implementation skills (9 skills)
- `hive-mind-advanced` - Swarm coordination
- `swarm-orchestration` - Multi-agent orchestration

### AgentDB
- `agentdb-*` - Vector memory operations (5 skills)
- `reasoningbank-*` - Neural learning (2 skills)

### GitHub Integration
- `github-*` - Full GitHub workflow support (5 skills)

### Browser Automation
- `playwright` - Headless browser automation
- `chrome-devtools` - DevTools integration

[Full skill list in CLAUDE.md](CLAUDE.md)

## Target Platform

Optimized for **Oracle Cloud Free Tier ARM Ampere A1**:

| Resource | Allocation |
|----------|------------|
| CPU | 4 ARM cores |
| RAM | 24 GB |
| Storage | 200 GB |
| Cost | Free |

## Documentation

- [PRD-001: Agentbox NixOS Minimal Container](docs/prd/PRD-001-agentbox-nix.md)
- [ADR-001: NixOS Flakes Architecture](docs/adr/ADR-001-nixos-flakes-architecture.md)
- [ADR-002: Skill Categorization](docs/adr/ADR-002-skill-categorization.md)
- [ADR-003: GPU Removal](docs/adr/ADR-003-gpu-removal.md)

## Not Included

Intentionally excluded for minimal footprint:

- GPU/CUDA - No NVIDIA dependencies
- Desktop Environment - Headless only
- ComfyUI - Use separate container
- Blender/QGIS/KiCAD - GUI applications
- Full LaTeX - Use external service

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes following ADR guidelines
4. Submit a pull request

## License

MIT License - See [LICENSE](LICENSE) for details.

---

Built with NixOS Flakes for reproducibility. Designed for Oracle Cloud ARM free tier.
