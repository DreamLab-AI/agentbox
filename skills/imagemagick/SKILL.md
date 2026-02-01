---
name: imagemagick
description: >
  Process and manipulate images with format conversion (PNG→JPG→WebP→GIF),
  resizing, cropping, filtering, batch operations, and image metadata extraction.
  Use for thumbnail generation, image optimization, format conversion, watermarks,
  and bulk image processing tasks.
version: 2.0.0
author: turbo-flow-claude
mcp_server: true
protocol: fastmcp
entry_point: mcp-server/server.py
dependencies:
  - imagemagick
---

# ImageMagick Skill

Comprehensive image processing using ImageMagick via FastMCP protocol.

## When to Use This Skill

- Convert between image formats (PNG, JPG, WebP, GIF, TIFF, BMP, SVG, PDF)
- Resize images for web optimization or thumbnails
- Crop images to specific regions
- Apply filters and effects (blur, sharpen, colorize)
- Batch process multiple images
- Create image montages and composites
- Extract image metadata
- Add watermarks and overlays

## Tools

| Tool | Description |
|------|-------------|
| `create_image` | Create new image with specified dimensions and color |
| `convert_image` | Execute ImageMagick convert with custom arguments |
| `resize_image` | Resize to specified dimensions with aspect ratio control |
| `crop_image` | Crop to region with offset |
| `composite_images` | Overlay images for watermarks or composites |
| `identify_image` | Get image metadata and properties |
| `batch_process` | Bulk process images matching a pattern |

## Examples

```python
# Resize image to 800x600
resize_image({
    "input_path": "/path/to/image.png",
    "output_path": "/path/to/resized.png",
    "width": 800,
    "height": 600,
    "maintain_aspect": True
})

# Convert PNG to optimized WebP
convert_image({
    "args": ["input.png", "-quality", "85", "output.webp"]
})

# Batch generate thumbnails
batch_process({
    "input_pattern": "/images/*.jpg",
    "output_dir": "/thumbnails",
    "operation": "thumbnail",
    "width": 200
})
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGEMAGICK_TIMEOUT` | `300` | Command timeout in seconds |

## VisionFlow Integration

This skill exposes `imagemagick://capabilities` resource for discovery by VisionFlow's MCP TCP client on port 9500.
