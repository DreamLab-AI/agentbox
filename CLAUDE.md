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
# Build runtime image (headless)
nix build .#runtime

# Build full combined image (headless)
nix build .#full

# Build desktop image (with VNC via SSH tunnel)
nix build .#desktop

# Development shell
nix develop
```

## RuVector Vector Database

Standalone Rust-native vector database - NO PostgreSQL required:

```bash
# Start RuVector server
npx ruvector serve --port 9700 --data-dir /var/lib/ruvector

# Start RuVector MCP server
npx ruvector mcp --port 9701

# CLI operations
npx ruvector --help
```

Features: HNSW indexing (150x-12,500x faster), GNN layers, self-learning, MCP integration.

## VNC Remote Desktop

The desktop image includes minimal VNC support via SSH tunnel:

```bash
# Start VNC services
supervisorctl start vnc:*

# Connect via SSH tunnel
ssh -L 5901:localhost:5901 devuser@host
# Then: vnc://localhost:5901
```

Components: Xvfb + x11vnc + openbox (~150MB overhead)

## Ports

| Port | Service |
|------|---------|
| 22 | SSH |
| 5901 | VNC (localhost via SSH tunnel) |
| 8080 | code-server (optional) |
| 9090 | Management API |
| 9500 | MCP TCP |
| 9600 | Z.AI (internal) |
| 9700 | RuVector API |
| 9701 | RuVector MCP (optional) |

## Claude Flow V3 Integration

This container is optimized for Claude Flow V3 swarm orchestration:

```bash
# Initialize swarm
npx claude-flow@v3alpha swarm init --topology hierarchical-mesh

# Check status
npx claude-flow@v3alpha swarm status
```

## Guidance Control Plane

Governance backbone for extended autonomy (10x-100x longer agent runs):

```bash
# Initialize guidance hooks
npx @claude-flow/guidance init

# Compile CLAUDE.md into constitution + shards
npx @claude-flow/guidance compile

# Check enforcement gates
npx @claude-flow/guidance check-gates
```

Key capabilities:
- **Compile**: CLAUDE.md → constitution + task-scoped shards
- **Retrieve**: Intent classification → relevant rules at task start
- **Enforce**: 4 gates (destructive ops, tool allowlist, diff size, secrets)
- **Prove**: Hash-chained cryptographic envelopes for audit
- **Trust**: Per-agent trust accumulation with decay and tiers
- **Adversarial**: Prompt injection, memory poisoning detection

Impact: 50-90% reduction in destructive actions, 70-90% reduction in memory corruption.

## Essential Skills (55)

### Core Development
- build-with-quality (v3.4.0), verification-quality, pair-programming
- rust-development, docker-manager, docker-orchestrator
- guidance-control-plane

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
