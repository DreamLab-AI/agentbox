---
name: Blender 3D
description: Control Blender for 3D modeling, scene creation, and rendering operations via socket-based communication
---

# Blender 3D Skill

This skill enables Claude to interact with Blender for 3D modeling, scene manipulation, material application, and rendering operations through a socket-based server.

## Capabilities

- Create and manipulate 3D objects (meshes, curves, lights, cameras)
- Apply and modify materials with PBR properties
- Manage scenes and collections
- Execute Blender Python scripts
- Render scenes with various settings
- Import/export 3D models in multiple formats

## When to Use This Skill

Use this skill when you need to:
- Create 3D models programmatically
- Automate Blender workflows
- Generate scenes from descriptions
- Batch process 3D assets
- Create visualization prototypes
- Prepare renders for design review

## When Not To Use

- For 2D image processing (resize, crop, filter, format conversion) -- use the imagemagick skill instead
- For AI image generation from text prompts -- use the comfyui skill instead
- For diagrams and flowcharts -- use the mermaid-diagrams skill instead
- For video editing, transcoding, or audio extraction -- use the ffmpeg-processing skill instead
- For geospatial 3D visualisation -- use the qgis skill instead

## Prerequisites

- Blender must be running with the socket server plugin active
- Default connection: localhost:2800
- Blender 3.0+ recommended

## Instructions

### Basic Object Creation

To create 3D objects:
1. Specify the object type (mesh, curve, light, camera)
2. Provide position, rotation, scale parameters
3. Optionally apply materials and modifiers

### Scene Management

For scene operations:
1. Create or select a scene
2. Add objects to collections
3. Configure lighting and camera setup
4. Set render parameters

### Material Application

To apply materials:
1. Specify the object to modify
2. Define material properties (color, metallic, roughness)
3. Configure texture mapping if needed

## Tool Functions

### `create_object`
Create a new 3D object in Blender.

Parameters:
- `type` (required): "cube" | "sphere" | "cylinder" | "plane" | "monkey" | "camera" | "light"
- `name` (optional): Object name (default: auto-generated)
- `location` (optional): [x, y, z] coordinates (default: [0, 0, 0])
- `scale` (optional): [x, y, z] scale values (default: [1, 1, 1])
- `rotation` (optional): [x, y, z] rotation in radians (default: [0, 0, 0])

### `apply_material`
Apply a material to an object.

Parameters:
- `object_name` (required): Name of the object
- `material_name` (required): Name for the new material
- `base_color` (optional): [R, G, B, A] values 0-1 (default: [0.8, 0.8, 0.8, 1.0])
- `metallic` (optional): Metallic value 0-1 (default: 0.0)
- `roughness` (optional): Roughness value 0-1 (default: 0.5)
- `emission` (optional): [R, G, B] emission color (default: [0, 0, 0])

### `execute_script`
Execute arbitrary Python code in Blender.

Parameters:
- `script` (required): Python code to execute
- `return_data` (optional): boolean, capture and return output (default: false)

### `render_scene`
Render the current scene.

Parameters:
- `output_path` (required): Path to save the render
- `resolution_x` (optional): Render width in pixels (default: 1920)
- `resolution_y` (optional): Render height in pixels (default: 1080)
- `samples` (optional): Number of render samples (default: 128)
- `engine` (optional): "CYCLES" | "EEVEE" (default: "CYCLES")

### `import_model`
Import a 3D model file.

Parameters:
- `file_path` (required): Path to the model file
- `format` (optional): "obj" | "fbx" | "gltf" | "stl" (auto-detected from extension)

### `export_model`
Export objects to a file.

Parameters:
- `file_path` (required): Path to save the exported file
- `objects` (optional): List of object names to export (default: all selected)
- `format` (optional): "obj" | "fbx" | "gltf" | "stl" (auto-detected from extension)

## Examples

### Example 1: Create a Simple Scene
```
Use the Blender skill to create a scene with:
- A cube at the origin
- A camera at position [5, -5, 5] looking at the origin
- A sun light at [0, 0, 10]
- Apply a red metallic material to the cube
```

### Example 2: Batch Material Application
```
Apply different PBR materials to objects in the scene:
- Cube: metallic gold (metallic=1.0, roughness=0.2, base_color=[1.0, 0.766, 0.336, 1.0])
- Sphere: rough plastic (metallic=0.0, roughness=0.8, base_color=[0.1, 0.5, 0.8, 1.0])
```

### Example 3: Automated Rendering Pipeline
```
Set up and render multiple camera angles:
1. Create 4 cameras around the object in a circle
2. For each camera, render a 4K image
3. Save renders to /output/render_001.png through render_004.png
```

## Technical Details

- Uses socket communication on port 2800 (configurable)
- Supports async operations for long-running tasks
- Python scripts execute in Blender's Python environment
- Materials use Principled BSDF shader
- Render operations can be queued

## Error Handling

The skill handles:
- Blender not running (connection refused)
- Invalid object names (suggests alternatives)
- Script execution errors (returns Python traceback)
- Render failures (provides diagnostic info)

## Integration with Other Skills

Works well with:
- `imagemagick` skill for post-processing renders

## Performance Notes

- Object creation: < 100ms
- Material application: < 50ms
- Render operations: varies by complexity (seconds to minutes)
- Script execution: depends on script complexity

## Advanced Usage

### Custom Python Scripts

Execute complex operations:
```python
script = """
import bpy
import math

# Create a grid of cubes
for x in range(-5, 6):
    for y in range(-5, 6):
        bpy.ops.mesh.primitive_cube_add(location=(x*2, y*2, 0))
        obj = bpy.context.active_object
        obj.scale = (0.8, 0.8, 0.8 + math.sin(x + y) * 0.3)
"""

Execute Blender skill with execute_script tool and the above script.
```

### Modifier Application

Apply modifiers via script:
```python
# Add subdivision surface to smooth objects
obj = bpy.data.objects['Cube']
mod = obj.modifiers.new(name='Subsurf', type='SUBSURF')
mod.levels = 2
```
