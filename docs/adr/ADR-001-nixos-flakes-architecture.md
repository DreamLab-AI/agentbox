# ADR-001: NixOS Flakes for Container Architecture

## Status

**Accepted**

## Context

The current multi-agent-docker uses a traditional Dockerfile (784 lines) built on CachyOS with:
- Heavy GPU dependencies (CUDA, cuDNN, PyTorch)
- x86_64 architecture only
- Large image size (100GB+)
- Poor layer caching (single-stage build)
- Manual dependency management

We need to support Oracle Cloud ARM free tier (4 cores, 24GB RAM) and reduce image size by 95%.

## Decision

**Use NixOS Flakes with nix2container for container builds.**

### Key choices:

1. **nix2container over dockerTools.buildImage**
   - 5x faster rebuilds (1.8s vs 10s)
   - Archive-less layer management
   - Better layer deduplication

2. **Multi-arch in single flake.nix**
   ```nix
   flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ]
   ```

3. **Explicit layer separation**
   - Base utilities (Layer 1)
   - Language runtimes (Layers 2-4)
   - Application code (Layers 5-10)

4. **rust-overlay for Rust toolchain**
   - Consistent cross-platform Rust builds
   - Minimal toolchain (no GPU targets)

## Consequences

### Positive
- Reproducible builds via flake.lock
- ARM64 native support without emulation overhead
- Layer caching reduces rebuild time to <10 minutes
- Image size reduced to <5GB
- Declarative dependency management

### Negative
- Learning curve for Nix syntax
- Requires Nix installation on build machines
- Some packages may need custom overlays for ARM64

### Risks
- nix2container is less mature than dockerTools
- ARM64 package availability varies

## References

- https://github.com/nlewo/nix2container
- https://tech.aufomm.com/how-to-build-multi-arch-docker-image-on-nixos/
- https://grahamc.com/blog/nix-and-layered-docker-images/
