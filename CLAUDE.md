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
├── skills/             # 66 essential skills
├── aisp/               # AISP integration
├── https-bridge/       # HTTPS bridging
└── docs/               # Documentation
    ├── adr/            # Architecture decisions
    ├── guides/         # User guides
    └── reference/      # Technical reference
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

## Essential Skills (66)

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

### Flow Nexus (NEW)
- flow-nexus-neural, flow-nexus-platform, flow-nexus-swarm

### AI & Media (NEW)
- blender (Blender 5.x MCP), comfyui (external container)
- cuda (GPU development docs), gemini-url-context
- agentic-qe, console-buddy

### Automation & Tools
- hooks-automation, skill-creator, stream-chain
- playwright, chrome-devtools, claude-flow-browser
- ffmpeg-processing, imagemagick, web-summary, perplexity

## AISP 5.1 Platinum Integration

AI-to-AI protocol for neuro-symbolic communication:

```bash
# Validate AISP document
aisp validate document.md

# Check binding compatibility between agents
aisp binding agent-a agent-b

# Initialize AISP pocket store
aisp init
```

Features:
- **Pocket Architecture**: `⟨ℋ:Header, ℳ:Membrane, 𝒩:Nucleus⟩`
- **Binding States**: crash (0), null (1), adapt (2), zero-cost (3)
- **Quality Tiers**: ◊⁺⁺ (platinum), ◊⁺ (gold), ◊ (silver), ◊⁻ (bronze)
- **Hebbian Learning**: α=0.1 (confidence increase), β=0.05 (decrease)
- **Signal Dimensions**: V_H=768, V_L=512, V_S=256

## 610+ Claude Subagents

Pre-loaded agent templates from ChrisRoyse/610ClaudeSubagents:

```bash
# List available agents
agent-list

# Load specific agent
agent-load doc-planner

# View all agents
ls $AGENTS_DIR/*.md | wc -l
```

Key agents: doc-planner, microtask-breakdown, github-pr-manager, tdd-london-swarm

## Turbo Flow Aliases (120+)

Quick access via turbo-flow-aliases.sh:

```bash
# Claude Flow
cf-swarm          # Swarm orchestration
cf-hive           # Hive-mind spawn
cf-doctor         # System diagnostics

# Agentic ecosystem
af-coder          # Agentic Flow coder
aqe               # Agentic QE testing
aj                # Agentic Jujutsu (git)

# Utilities
turbo-help        # Quick reference
turbo-init        # Initialize workspace
```

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

- [ADR-001: NixOS Flakes Architecture](docs/adr/ADR-001-nixos-flakes.md)
- [ADR-002: RuVector Standalone](docs/adr/ADR-002-ruvector-standalone.md)
- [ADR-003: Guidance Control Plane](docs/adr/ADR-003-guidance-control-plane.md)
- [ADR-004: Upstream Feature Sync](docs/adr/ADR-004-upstream-sync.md)
- [Quick Start Guide](docs/guides/quick-start.md)

## Development Notes

**File Organization Rules:**
- Never save working files to root (/)
- Use appropriate subdirectories: docs/, config/, skills/

**Concurrent Operations:**
- Batch all related operations in single messages
- Use Claude Flow V3 MCP tools for coordination
- Task tool spawns agents for actual work
