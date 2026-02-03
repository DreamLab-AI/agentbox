# High Resolution Asset Creation Notes

## GPU: RTX A6000 (48GB VRAM)

### FLUX2 Resolution Sweet Spots

| Resolution | Aspect | VRAM Used | Notes |
|------------|--------|-----------|-------|
| 832x1248 | Portrait | ~33GB | Safe for single-phase |
| 1248x832 | Landscape | ~33GB | Safe for single-phase |
| 1024x1024 | Square | ~30GB | Default, very stable |
| **1536x1024** | Landscape | **~37GB** | **Tested, works well** |
| 1024x1536 | Portrait | ~37GB | Should work |
| 1920x1280 | Landscape | ~42GB+ | May OOM, untested |

**Key finding**: 1536x1024 uses ~37GB peak VRAM during generation with FP8 model.

### SAM3D Pipeline Settings

#### LoadSAM3DModel
- `dtype`: bfloat16 (best for A6000)
- `use_gpu_cache`: true (faster inference)
- `compile`: false (unnecessary overhead)

#### SAM3DSparseGen (Stage 1)
- `stage1_inference_steps`: 25-30 (30 for quality)
- `stage1_cfg_strength`: 7.0-7.5

#### SAM3DSLATGen (Stage 2)
- `stage2_inference_steps`: 25-30
- `stage2_cfg_strength`: 5.0-5.5

#### SAM3DMeshDecode
- `simplify`: 0.95-0.97 (0.97 preserves more detail)
- `save_glb`: true

#### SAM3DGaussianDecode
- `save_ply`: true
- Outputs standard 3DGS PLY format

#### SAM3DTextureBake (Key for quality)
- `texture_size`: **4096** (max, 16x more detail than 1024)
- `texture_mode`: **"opt"** (gradient descent, ~60s extra)
- `simplify`: 0.97
- `with_mesh_postprocess`: false (preserve detail)
- `with_texture_baking`: true
- `rendering_engine`: pytorch3d

### VRAM Usage Per Phase

| Phase | VRAM Used | Time |
|-------|-----------|------|
| FLUX2 1536x1024 | 37GB | ~3min |
| SAM3D Load Models | 18GB | ~30s |
| SAM3D Depth | +2GB | ~5s |
| SAM3D SparseGen | +3GB | ~3s |
| SAM3D SLATGen | +5GB | ~60s |
| SAM3D MeshDecode | +2GB | ~15s |
| SAM3D GaussianDecode | +2GB | ~15s |
| SAM3D TextureBake 4K | +8GB | ~60s |

**Total SAM3D peak**: ~25GB with 4K textures

### Memory Management

**Critical**: FLUX2 and SAM3D cannot run concurrently on most GPUs.

```bash
# After FLUX2, free GPU memory
curl -X POST http://comfyui:8188/free \
  -H "Content-Type: application/json" \
  -d '{"unload_models": true, "free_memory": true}'

# If /free doesn't fully clear, restart container
docker restart comfyui
```

### Output Quality Comparison

**Praying Mantis Test Results:**

| Output | Size | Vertices | Faces | Texture |
|--------|------|----------|-------|---------|
| Mesh GLB | 35MB | 202,135 | 320,272 | 4096x4096 |
| Gaussian PLY | 72MB | 228,992 splats | - | N/A (per-splat color) |
| Point Cloud PLY | 33MB | - | - | Vertex colors |

### Gaussian PLY Format

Standard 3DGS format with properties:
- Position: x, y, z
- Normals: nx, ny, nz
- Color: red, green, blue (uint8)
- SH coefficients: f_dc_0, f_dc_1, f_dc_2
- Opacity: float
- Scale: scale_0, scale_1, scale_2
- Rotation quaternion: rot_0, rot_1, rot_2, rot_3

Compatible with:
- KIRI Engine 3DGS Blender Addon (v4.1.4+, requires Blender 4.3+)
- Standard 3DGS viewers
- Blender native PLY import (point cloud only, no splat rendering)

### Recommended Workflow for Maximum Quality

```
1. FLUX2 @ 1536x1024 landscape (or 1024x1536 portrait)
   - steps: 32
   - guidance: 4

2. Free GPU memory (restart if needed)

3. SAM3D Full Pipeline:
   - LoadSAM3DModel (bfloat16, gpu_cache=true)
   - DepthEstimate
   - SparseGen (steps=30, cfg=7.5)
   - SLATGen (steps=30, cfg=5.5)
   - MeshDecode (simplify=0.97)
   - GaussianDecode (save_ply=true)
   - TextureBake (texture_size=4096, mode=opt)

4. Validate in Blender
   - Import GLB for textured mesh
   - Import PLY for point cloud preview
   - Use KIRI addon for full Gaussian splat rendering
```

### Files Generated

```
sam3d_inference_X/
├── gaussian.ply      # 3DGS splats (main Gaussian output)
├── mesh.glb          # Textured mesh with UV baked texture
├── pointcloud.ply    # Point cloud representation
├── metadata.json     # Generation metadata
├── pointmap.pt       # Depth estimation data
├── slat.pt           # SLAT latent
└── sparse_structure.pt # Voxel structure
```

### Iteration Notes

- Higher FLUX2 resolution = more detail for SAM3D to work with
- 4K texture baking significantly improves mesh quality
- Gradient descent texture mode ("opt") worth the extra 60s
- Gaussian splat output captures fine detail better than mesh for thin structures
- For final delivery, use mesh GLB; for preview/validation, Gaussian PLY shows more detail
