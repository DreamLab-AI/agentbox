# 3D Gaussian Splatting (3DGS) Stack

## Prerequisites

Both conditions must be met before enabling this stack:

```toml
# agentbox.toml
[gpu]
backend = "local-cuda"       # CUDA toolchain baked into the Nix image

[toolchains]
cuda = true                  # (informational; enforced by E006 via gpu.backend)

[skills.spatial_and_3d]
gaussian_splatting = true    # E006 validator enforces gpu.backend=local-cuda
```

Validator rule **E006** rejects manifests where `gaussian_splatting = true` without `gpu.backend = "local-cuda"`. The stack does not build on aarch64 and degrades gracefully to empty derivations.

## Tools

| Tool | Version | Purpose |
|------|---------|---------|
| **COLMAP** | 3.10 (nixpkgs unstable, pinned 2025-03-18) | Structure-from-Motion (SfM) + Multi-View Stereo to reconstruct sparse/dense 3D point clouds from images |
| **METIS** | 5.1.0 (nixpkgs) | Graph partitioning used by COLMAP to split large scenes for parallel processing |
| **LichtFeld Studio** | upstream HEAD (stubbed) | GUI and pipeline for training, viewing, and exporting 3DGS radiance fields; consumes COLMAP sparse reconstruction as input |

## Rough Pipeline

```
images/
  └── (JPEG or PNG frames, ideally 30–150 shots)
        |
        v
  colmap automatic_reconstructor
        |  sparse point cloud + camera poses
        v
  lichtfeld train
        |  3DGS scene (*.splat / *.ply)
        v
  lichtfeld viewer / export
```

1. **Feature extraction** — `colmap feature_extractor --image_path ./images --database_path ./db.db`
2. **Matching** — `colmap exhaustive_matcher --database_path ./db.db`
3. **Sparse reconstruction** — `colmap mapper ...`
4. **Gaussian training** — `lichtfeld train --colmap_path ./sparse/0 --output ./scene`
5. **View / export** — `lichtfeld viewer ./scene`

## Where Outputs Land

| Artefact | Default path |
|----------|-------------|
| COLMAP database | `./reconstruction/db.db` |
| Sparse point cloud | `./reconstruction/sparse/` |
| Dense point cloud | `./reconstruction/dense/` |
| 3DGS scene | `./reconstruction/scene/` |

Override via `--output` flags on each tool.

## Notes

- LichtFeld Studio is sourced from upstream GitHub; the SHA is stubbed in `lib/3dgs-stack.nix` pending repo confirmation — see the `# TODO` comments.
- CUDA architecture target defaults to `sm_86` (Ampere). Edit `cmakeFlags` in `lib/3dgs-stack.nix` for other GPU generations.
- Smoke test: `tests/3dgs/reconstruction-smoke.sh` (exits 77 when gate is off).
