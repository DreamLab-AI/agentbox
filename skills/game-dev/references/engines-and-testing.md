# Engines, External MCP, and Testing

## Engine Support Matrix

| Engine | Version | Availability | Binary | Notes |
|--------|---------|-------------|--------|-------|
| **Godot** | 4.6.1 | Native (installed) | `godot` | Full support. Headless mode available. GDScript, C#, GDExtension. |
| **Blender** | 5.0.1 | Native (installed) | `blender` | Asset pipeline. Modelling, texturing, animation export. |
| **Unity** | 2023+ | External MCP | -- | Requires external MCP server connection. Not installable in container. |
| **Unreal** | 5.x | External MCP | -- | Requires external MCP server connection. Not installable in container. |

### Godot (Native)

Godot 4.6.1 is installed and available on `$PATH` as `godot`. It supports:

- Headless execution: `godot --headless --script res://tests/run_tests.gd`
- Project validation: `godot --headless --check-only`
- Scene export: `godot --headless --export-release`
- GDScript, C#, and GDExtension (C/C++/Rust via gdext)
- VNC display at `:1` for visual testing when needed

The engine reference directory (`engine-reference/godot/`) contains version-pinned
API documentation, breaking changes from 4.4 through 4.6, deprecated APIs, and
current best practices. Because the LLM knowledge cutoff predates Godot 4.4,
cross-reference this directory before suggesting Godot API calls.

### Blender (Native)

Blender 5.0.1 is installed for the asset pipeline. Use it for:

- 3D model creation and editing
- Texture baking and UV mapping
- Animation authoring and export (glTF, FBX, Collada)
- Headless rendering: `blender --background --python script.py`

### Unity and Unreal (External)

Unity and Unreal Engine cannot be installed inside this container. They require
a host machine or external MCP server. See the External MCP Requirements section
below.

## External MCP Requirements

Unity and Unreal Engine require a running instance on a host machine with an
MCP server bridge. The container cannot run these engines natively.

### Unity External MCP Setup

1. Install Unity on the host machine (2023.x LTS or later recommended).

2. Install the Unity MCP bridge package. This exposes Unity Editor operations
   (scene manipulation, asset import, build, play mode) as MCP tool calls.

3. Configure the MCP connection in the container:

   ```json
   {
     "mcpServers": {
       "unity": {
         "type": "sse",
         "url": "http://<host-ip>:<port>/mcp",
         "description": "Unity Editor MCP bridge"
       }
     }
   }
   ```

4. Unity-specialist agents will detect the MCP connection and route engine
   operations through it. Without this connection, Unity agents can still
   produce code and configuration files but cannot interact with the editor
   directly.

### Unreal External MCP Setup

1. Install Unreal Engine 5.x on the host machine.

2. Install the Unreal MCP bridge plugin. This exposes editor operations
   (Blueprint compilation, level loading, PIE, packaging) as MCP tool calls.

3. Configure the MCP connection in the container:

   ```json
   {
     "mcpServers": {
       "unreal": {
         "type": "sse",
         "url": "http://<host-ip>:<port>/mcp",
         "description": "Unreal Editor MCP bridge"
       }
     }
   }
   ```

4. Unreal-specialist agents will detect the MCP connection and route engine
   operations through it. Without this connection, Unreal agents can still
   produce C++ code, Blueprint pseudocode, and configuration but cannot
   interact with the editor.

### Verifying MCP Connections

After configuration, verify the connection is active:

```bash
# Check MCP server status
claude-flow mcp status
```

If the external MCP is not available, agents will fall back to file-only mode:
generating source files, configs, and documentation that can be manually
imported into the engine on the host machine.

## Godot Headless Testing

Godot 4.6.1 supports headless execution for automated testing and validation
without a display server. This is the primary method for CI and agent-driven
testing. A helper is bundled at `tools/godot-headless.sh`.

### Running GDScript Tests

```bash
# Run a test script
godot --headless --script res://tests/run_tests.gd

# Run with specific scene
godot --headless --path /path/to/project res://tests/test_scene.tscn

# Validate project (check for errors without running)
godot --headless --check-only --path /path/to/project
```

### Test Script Pattern

```gdscript
# tests/run_tests.gd
extends SceneTree

func _init() -> void:
    var results := []
    # Run test suites
    results.append(TestCombatSystem.run())
    results.append(TestInventorySystem.run())

    # Report
    var failures := results.filter(func(r): return not r.passed)
    if failures.is_empty():
        print("ALL TESTS PASSED")
    else:
        for f in failures:
            printerr("FAIL: %s - %s" % [f.name, f.message])
    quit(0 if failures.is_empty() else 1)
```

### Visual Testing via VNC

When visual verification is required (shader output, UI layout, particle
effects), use the VNC display:

```bash
# Run Godot with display output on VNC
DISPLAY=:1 godot --path /path/to/project res://scenes/test_visual.tscn
```

Connect to VNC on port 5901 to observe the output. Take screenshots with
the browser automation tools for visual regression comparison.

### Export Validation

```bash
# Dry-run export to check for errors
godot --headless --export-release "Linux" /tmp/test_export

# List available export presets
godot --headless --path /path/to/project --list-exports
```
