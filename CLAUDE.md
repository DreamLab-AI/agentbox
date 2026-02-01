# Agentbox - Minimal Agentic Container

## Overview

Agentbox is a minimal, multi-architecture container for running Claude Flow V3 agentic workloads. Built with NixOS Flakes for reproducible builds targeting Oracle Cloud ARM free tier.

## Architecture

| Metric | Value |
|--------|-------|
| Target Size | <5GB |
| Architectures | aarch64-linux, x86_64-linux |
| Base System | NixOS Flakes + nix2container |
| GPU | None (headless) |

## Directory Structure

```
agentbox/
├── flake.nix           # NixOS container definitions
├── config/             # Container configuration
│   ├── supervisord.conf
│   └── entrypoint.sh
├── mcp/                # MCP infrastructure
├── management-api/     # Express.js management API
├── claude-zai/         # Z.AI cost-effective Claude proxy
├── skills/             # 54 essential skills
├── aisp/               # AISP integration
├── https-bridge/       # HTTPS bridging
└── docs/               # Documentation
    ├── prd/            # Product requirements
    └── adr/            # Architecture decisions
```

## Build Commands

```bash
# Build runtime image
nix build .#runtime

# Build PostgreSQL image
nix build .#postgres

# Build full combined image
nix build .#full

# Development shell
nix develop
```

## Ports

| Port | Service |
|------|---------|
| 22 | SSH |
| 8080 | code-server (optional) |
| 9090 | Management API |
| 9500 | MCP TCP |
| 9600 | Z.AI (internal) |

## Claude Flow V3 Integration

This container is optimized for Claude Flow V3 swarm orchestration:

```bash
# Initialize swarm
npx claude-flow@v3alpha swarm init --topology hierarchical-mesh

# Check status
npx claude-flow@v3alpha swarm status
```

## Essential Skills (54)

### Core Development
- build-with-quality, verification-quality, pair-programming
- rust-development, docker-manager, docker-orchestrator

### Claude Flow V3
- v3-cli-modernization, v3-core-implementation, v3-ddd-architecture
- v3-integration-deep, v3-mcp-optimization, v3-memory-unification
- v3-performance-optimization, v3-security-overhaul, v3-swarm-coordination

### AgentDB
- agentdb-advanced, agentdb-learning, agentdb-memory-patterns
- agentdb-optimization, agentdb-vector-search

### Swarm & Learning
- hive-mind-advanced, swarm-advanced, swarm-orchestration
- reasoningbank-agentdb, reasoningbank-intelligence, sparc-methodology

### GitHub Integration
- github-code-review, github-multi-repo, github-project-management
- github-release-management, github-workflow-automation

### Automation & Tools
- hooks-automation, skill-creator, stream-chain
- playwright, chrome-devtools, claude-flow-browser
- ffmpeg-processing, imagemagick, web-summary, perplexity

## Not Included

The following are intentionally excluded for minimal footprint:

- **GPU/CUDA** - No NVIDIA dependencies
- **Desktop Environment** - Headless only
- **ComfyUI** - Use external container
- **Blender/QGIS/KiCAD** - GUI applications
- **Full LaTeX** - Use external service
- **PyTorch GPU** - CPU-only inference

## Target Platform

**Oracle Cloud Free Tier - ARM Ampere A1**

| Resource | Allocation |
|----------|------------|
| CPU | 4 ARM cores |
| RAM | 24 GB |
| Storage | 200 GB |
| Architecture | aarch64-linux |

## References

- [PRD-001: Agentbox NixOS Minimal Container](docs/prd/PRD-001-agentbox-nix.md)
- [ADR-001: NixOS Flakes Architecture](docs/adr/ADR-001-nixos-flakes-architecture.md)
- [ADR-002: Skill Categorization](docs/adr/ADR-002-skill-categorization.md)
- [ADR-003: GPU Removal](docs/adr/ADR-003-gpu-removal.md)

## Development Notes

**File Organization Rules:**
- Never save working files to root (/)
- Use appropriate subdirectories: docs/, config/, skills/

**Concurrent Operations:**
- Batch all related operations in single messages
- Use Claude Flow V3 MCP tools for coordination
- Task tool spawns agents for actual work
