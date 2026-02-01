# PRD-001: Agentbox NixOS Minimal Container

**Version:** 1.0.0
**Status:** Draft
**Author:** Claude Flow V3 Build-with-Quality Swarm
**Created:** 2026-02-01
**Target:** Oracle Cloud ARM A1 Free Tier

---

## Executive Summary

Transform the DreamLab-AI/agentbox fork from a bloated VisionFlow-integrated repository into a **standalone, minimal agentic container** built with NixOS flakes. The target platform is Oracle Cloud's free tier ARM Ampere A1 (4 cores, 24GB RAM, 200GB storage).

### Key Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Image Size | ~100GB+ | <5GB |
| Build Time | 30-45min | <10min |
| Architecture | x86_64 only | aarch64 + x86_64 |
| GPU Dependency | Required | None |
| Base System | CachyOS (Arch) | NixOS Flakes |

---

## Problem Statement

The current multi-agent-docker container is:

1. **Massive** (89GB ComfyUI + 10GB CUDA + 2GB desktop = 100GB+)
2. **x86_64 only** - cannot run on ARM cloud instances
3. **GPU-dependent** - requires NVIDIA hardware
4. **Monolithic** - includes GUI tools (Blender, QGIS, KiCAD) unnecessary for headless agentic workloads
5. **Hard to rebuild** - Dockerfile is 784 lines with complex dependencies

---

## Goals

### Primary Goals

1. **Minimal footprint**: <5GB container with all essential agentic capabilities
2. **ARM64 native**: First-class aarch64-linux support for Oracle Cloud free tier
3. **NixOS flakes**: Reproducible, declarative builds with layer optimization
4. **GPU-free**: Remove all NVIDIA/CUDA dependencies
5. **Remote-first**: Designed for headless cloud deployment

### Secondary Goals

1. **Fast rebuilds**: <10 minutes using nix2container layer caching
2. **Multi-arch**: Single flake.nix builds both aarch64 and x86_64
3. **Modular**: Separate images for agent runtime vs. PostgreSQL
4. **CI/CD ready**: GitHub Actions workflow for automated builds

---

## Non-Goals

- GUI/desktop environment support
- GPU/CUDA inference capabilities
- ComfyUI integration (use external container if needed)
- Full LaTeX/TeX Live installation
- Blender, QGIS, KiCAD, or other GUI applications

---

## Target Platform

### Oracle Cloud Free Tier - ARM Ampere A1

| Resource | Allocation |
|----------|------------|
| CPU | 4 ARM cores (VM.Standard.A1.Flex) |
| RAM | 24 GB |
| Storage | 200 GB (boot + block) |
| Network | 480 Mbps |
| Architecture | aarch64-linux |

**References:**
- [Oracle Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)
- [NixOS on Oracle Cloud](https://mtlynch.io/notes/nix-oracle-cloud/)
- [NixOS on ARM](https://nixos.wiki/wiki/NixOS_on_ARM)

---

## Architecture

### Bounded Contexts (DDD)

```
+-------------------+     +-------------------+     +-------------------+
|   Agent Runtime   |     |   Memory Store    |     |   MCP Gateway     |
+-------------------+     +-------------------+     +-------------------+
| - Claude Flow V3  |     | - PostgreSQL 16   |     | - MCP Servers     |
| - Node.js 20      |<--->| - pgvector        |<--->| - Tool Registry   |
| - Python 3.12     |     | - HNSW Index      |     | - Claude Bridge   |
| - Rust toolchain  |     | - RuVector        |     |                   |
| - Skills (35+)    |     +-------------------+     +-------------------+
+-------------------+
```

### Container Images

| Image | Purpose | Size Target |
|-------|---------|-------------|
| `agentbox:runtime` | Main agentic workload | <3GB |
| `agentbox:postgres` | RuVector memory store | <500MB |
| `agentbox:full` | Combined (single container) | <5GB |

### Layer Strategy (nix2container)

```
Layer 1: Base (cacert, coreutils, bash)     ~50MB
Layer 2: Node.js 20 LTS                     ~100MB
Layer 3: Python 3.12 + pip                  ~150MB
Layer 4: Rust toolchain (minimal)           ~200MB
Layer 5: PostgreSQL client                  ~50MB
Layer 6: Git, curl, jq, ripgrep             ~50MB
Layer 7: Claude Flow V3 + MCP               ~100MB
Layer 8: Skills (35 essential)              ~200MB
Layer 9: Management API + Z.AI              ~50MB
Layer 10: User config + entrypoint          ~10MB
─────────────────────────────────────────────────
Total:                                      ~960MB
```

---

## Components

### Essential (Keep)

#### Core Runtime
- Node.js 20 LTS (ARM64 native)
- Python 3.12 (no GPU wheels)
- Rust toolchain (minimal, no GPU targets)
- Git, curl, jq, ripgrep, fd, bat, tmux, zsh

#### Claude Flow V3
- MCP infrastructure (servers, registry, scripts)
- Hooks system (26 hooks)
- Memory coordination (HNSW, ReasoningBank)
- Swarm orchestration

#### Skills (35 Essential)
```
agentdb-*          (5)  - Vector memory operations
build-with-quality (1)  - Quality gates
github-*           (5)  - GitHub integration
hive-mind-advanced (1)  - Swarm coordination
hooks-automation   (1)  - V3 hooks
playwright         (1)  - Browser automation (headless)
reasoningbank-*    (2)  - Neural learning
swarm-*            (2)  - Swarm orchestration
v3-*               (8)  - V3 implementation
verification-*     (1)  - Quality verification
sparc-methodology  (1)  - SPARC workflow
skill-builder      (1)  - Skill creation
docker-manager     (1)  - Container ops
ffmpeg-processing  (1)  - Media (CLI only)
imagemagick        (1)  - Image processing
rust-development   (1)  - Rust toolchain
pair-programming   (1)  - Pair programming
```

#### Services
- Management API (Express.js)
- Z.AI service (cost-effective Claude API)
- PostgreSQL client (connect to external RuVector)
- Supervisord (process management)
- SSH server

### Removed (GPU/Heavy)

| Component | Size | Reason |
|-----------|------|--------|
| ComfyUI | 89GB | GPU inference, external container |
| CUDA/cuDNN/cuTensor | 10GB | NVIDIA-specific |
| Blender | 1.5GB | GUI, no ARM64 |
| QGIS | 1GB | GUI, GIS heavy |
| KiCAD | 500MB | GUI, EDA |
| TeX Live | 500MB | Full LaTeX unnecessary |
| Hyprland/Desktop | 700MB | GUI environment |
| PyTorch cu130 | 3GB | GPU wheels |
| Antigravity IDE | 200MB | No ARM64 build |

---

## Technical Specification

### flake.nix Structure

```nix
{
  description = "Agentbox - Minimal Agentic Container";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nix2container.url = "github:nlewo/nix2container";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = { self, nixpkgs, flake-utils, nix2container, rust-overlay }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };
        n2c = nix2container.packages.${system}.nix2container;
      in {
        packages = {
          runtime = n2c.buildImage { ... };
          postgres = n2c.buildImage { ... };
          full = n2c.buildImage { ... };
        };
      });
}
```

### Directory Structure (Post-Cleanup)

```
agentbox/
├── flake.nix                 # NixOS flake definition
├── flake.lock                # Locked dependencies
├── nix/
│   ├── runtime.nix           # Agent runtime image
│   ├── postgres.nix          # PostgreSQL image
│   ├── full.nix              # Combined image
│   ├── layers/               # Layer definitions
│   └── overlays/             # Custom overlays
├── config/
│   ├── supervisord.conf      # Process manager
│   ├── entrypoint.sh         # Container init
│   └── users/                # Multi-user setup
├── mcp/
│   ├── servers/              # MCP server implementations
│   ├── registry.json         # Tool registry
│   └── scripts/              # Init scripts
├── skills/                   # 35 essential skills
├── management-api/           # Express.js API
├── claude-zai/               # Z.AI service
├── docs/
│   ├── prd/                  # Product requirements
│   └── adr/                  # Architecture decisions
├── CLAUDE.md                 # Project instructions
└── README.md                 # Documentation
```

---

## Migration Plan

### Phase 1: Repository Cleanup (Day 1)

1. Remove all VisionFlow-specific code (src/, Cargo.toml, etc.)
2. Remove GPU-specific skills (cuda, comfyui, pytorch-ml, etc.)
3. Remove heavy GUI skills (blender, qgis, kicad, ngspice)
4. Remove unnecessary media files (*.gif, *.jpg, *.png)
5. Keep: docs/, mcp/, skills/ (filtered), management-api/, claude-zai/

### Phase 2: NixOS Flake Setup (Day 2-3)

1. Create flake.nix with multi-arch support
2. Define layer structure for optimal caching
3. Port essential config from Dockerfile.unified
4. Create runtime, postgres, and full images
5. Test local builds for both architectures

### Phase 3: Configuration Migration (Day 4-5)

1. Port supervisord.conf (remove GPU services)
2. Port entrypoint.sh (ARM64 compatible)
3. Port multi-user setup
4. Port MCP infrastructure
5. Update CLAUDE.md for new structure

### Phase 4: Testing & Validation (Day 6-7)

1. Build and test on x86_64
2. Build and test on aarch64 (QEMU or native)
3. Deploy to Oracle Cloud ARM instance
4. Validate Claude Flow V3 functionality
5. Run build-with-quality validation

---

## Quality Gates

### Pre-Merge

| Check | Threshold |
|-------|-----------|
| Nix flake check | Pass |
| Image builds (both arch) | Success |
| Image size | <5GB |
| Essential skills present | 35+ |
| MCP servers functional | All |

### Post-Deploy

| Check | Threshold |
|-------|-----------|
| Container starts | <30s |
| Claude Flow V3 init | Success |
| Memory usage | <8GB |
| CPU usage (idle) | <5% |
| Swarm orchestration | Functional |

---

## Success Criteria

1. **Repository cleaned**: <50MB source (excluding skills)
2. **Multi-arch images**: Both aarch64 and x86_64 build successfully
3. **Size target met**: Combined image <5GB
4. **Oracle deployment**: Running on ARM A1 free tier
5. **Agentic functionality**: Claude Flow V3 swarm coordination working
6. **Build time**: <10 minutes on CI/CD

---

## References

- [NixOS Flakes](https://nixos.wiki/wiki/Flakes)
- [nix2container](https://github.com/nlewo/nix2container)
- [Multi-arch Docker on NixOS](https://tech.aufomm.com/how-to-build-multi-arch-docker-image-on-nixos/)
- [NixOS on Oracle Cloud](https://mtlynch.io/notes/nix-oracle-cloud/)
- [Oracle Free Tier](https://www.oracle.com/cloud/free/faq/)
- [docker-nixos](https://github.com/skiffos/docker-nixos)

---

## Appendix A: Removed Files

See ADR-001 for full list of files to be removed during cleanup.

## Appendix B: Skill Inventory

See ADR-002 for complete skill categorization (essential vs. removed).
