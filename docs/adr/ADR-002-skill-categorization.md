# ADR-002: Skill Categorization for Minimal Container

## Status

**Accepted**

## Context

The current container includes 97 skills totaling ~189MB. Many skills require GPU (cuda, comfyui, pytorch-ml) or heavy GUI tools (blender, qgis, kicad) that are incompatible with a minimal ARM64 headless deployment.

## Decision

**Categorize skills into Essential (keep) and Removed (delete) based on:**
1. ARM64 compatibility
2. Headless operation (no GUI required)
3. Core agentic functionality
4. Size impact

### Essential Skills (35)

| Category | Skills |
|----------|--------|
| **AgentDB** | agentdb-advanced, agentdb-learning, agentdb-memory-patterns, agentdb-optimization, agentdb-vector-search |
| **Quality** | build-with-quality, verification-quality, pair-programming |
| **GitHub** | github-code-review, github-multi-repo, github-project-management, github-release-management, github-workflow-automation |
| **Swarm** | hive-mind-advanced, swarm-advanced, swarm-orchestration |
| **V3 Core** | v3-cli-modernization, v3-core-implementation, v3-ddd-architecture, v3-integration-deep, v3-mcp-optimization, v3-memory-unification, v3-performance-optimization, v3-security-overhaul, v3-swarm-coordination |
| **Learning** | reasoningbank-agentdb, reasoningbank-intelligence, sparc-methodology |
| **Automation** | hooks-automation, skill-builder, stream-chain |
| **Browser** | playwright (headless) |
| **DevOps** | docker-manager, rust-development |
| **Media** | ffmpeg-processing (CLI), imagemagick (CLI) |
| **Research** | perplexity-research |
| **Misc** | agentic-jujutsu, performance-analysis |

### Removed Skills (62)

| Category | Skills | Reason |
|----------|--------|--------|
| **GPU** | cuda, comfyui, comfyui-3d, pytorch-ml | NVIDIA required |
| **GUI Heavy** | blender, qgis, kicad, ngspice | Desktop apps |
| **Desktop** | canvas-design, theme-factory, brand-guidelines | GUI design |
| **Docs** | docx, pptx, xlsx, pdf, latex-documents | MS Office/LaTeX |
| **Specialized** | wardley-maps, algorithmic-art, ontology-* | Domain-specific |
| **Infrastructure** | grafana-monitor, kubernetes-ops, linux-admin, network-analysis, tmux-ops | Ops-specific |
| **Legacy** | agentic-lightning, agentic-qe | Superseded |
| **Misc** | fossflow, jss-memory, console-buddy, etc. | Low priority |

## Consequences

### Positive
- Skills directory reduced from 189MB to ~50MB
- All remaining skills work on ARM64 headless
- Core agentic functionality preserved
- Faster container startup

### Negative
- Some specialized workflows unavailable
- Users needing GPU/GUI must use external containers
- LaTeX document generation removed (use external service)

### Mitigation
- Heavy skills can be mounted as volumes if needed
- ComfyUI available as separate container
- Document alternative workflows in README

## References

- PRD-001: Agentbox NixOS Minimal Container
- Current skill inventory: /home/devuser/workspace/project/multi-agent-docker/skills/
