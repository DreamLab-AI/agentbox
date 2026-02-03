---
skill: blender
version: 1.0.0
description: Blender 5.x MCP integration with 52+ tools for 3D modeling, materials, physics, animation, and rendering
author: Blender MCP Team
tags: [3d, blender, modeling, rendering, animation, materials, physics, mcp]
---

# Blender MCP Skill

Control Blender 5.x via WebSocket RPC from Claude Code. This skill provides 52 comprehensive tools for 3D asset creation, manipulation, and rendering.

## Quick Start

### Start the MCP Server

**GUI Mode** (recommended):
```bash
blender  # Server auto-starts on ws://127.0.0.1:8765
```

**Headless Mode** (Docker/CI):
```bash
blender -b -P ~/.claude/skills/blender/scripts/headless_start.py
```

## Architecture

- WebSocket server runs in background thread
- Commands queued and executed on main thread via dispatcher
- Thread-safe execution ensures Blender stability

## Available Tools (52)

### Core (8)
`get_scene_info`, `get_object_info`, `list_objects`, `select_object`, `transform_object`, `duplicate_object`, `delete_object`, `execute_python`

### Creation (6)
`create_primitive`, `create_text`, `create_curve`, `create_empty`, `create_camera`, `create_light`

### Materials (6)
`create_material`, `assign_material`, `set_object_color`, `list_materials`, `get_material_info`, `delete_material`

### Modifiers (6)
`add_modifier`, `apply_modifier`, `remove_modifier`, `list_modifiers`, `set_modifier_property`, `create_armature`

### Physics (6)
`setup_rigid_body`, `setup_cloth`, `setup_collision`, `setup_soft_body`, `bake_physics`, `remove_physics`

### Animation (8)
`create_keyframe`, `animate_transform`, `delete_keyframes`, `set_frame`, `set_frame_range`, `get_animation_info`, `play_animation`

### Rendering (7)
`render_image`, `render_animation`, `get_viewport_screenshot`, `set_render_settings`, `set_camera_view`, `orbit_camera_render`

### Assets (5)
`search_polyhaven`, `download_polyhaven_asset`, `get_csm_status`, `search_csm_models`, `import_csm_model`

### Import/Export (2)
`import_model`, `export_model`

## Message Protocol

Request:
```json
{"id": "1", "tool": "create_primitive", "params": {"type": "cube", "size": 2}}
```

Response:
```json
{"id": "1", "tool": "create_primitive", "status": "success", "data": {...}}
```

## Environment Variables

```bash
BLENDER_WS_HOST=127.0.0.1
BLENDER_WS_PORT=8765
```

## Dependencies

Blender 5.0+, websockets>=15.0 (in Blender Python)
