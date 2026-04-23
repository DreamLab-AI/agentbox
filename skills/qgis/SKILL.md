---
name: qgis
description: >
  Geospatial analysis and GIS operations via QGIS. 51 MCP tools covering layer
  management, feature editing, processing algorithms, rendering, styling, plugin
  development, and system management. Uses nkarasiak/qgis-mcp plugin (port 9877)
  with length-prefixed framing and FastMCP MCP server.
version: 3.0.0
author: agentbox-claude
mcp_server: true
protocol: fastmcp
entry_point: uv run --project /home/devuser/workspace/qgis-mcp src/qgis_mcp/server.py
port: 9877
dependencies:
  - qgis
  - uv
---

# QGIS Skill

Geospatial analysis and GIS operations via the nkarasiak/qgis-mcp plugin and FastMCP server.

## When to Use This Skill

- Calculate distances between geographic points
- Create buffer zones around features (proximity analysis)
- Transform coordinates between CRS (GPS to Web Mercator)
- Load and manipulate geospatial layers (Shapefile, GeoJSON, GeoPackage)
- Perform geoprocessing operations (intersect, union, difference, clip)
- Export map images for reports or web display
- Query features with spatial filters
- Style layers with categorized or graduated symbology
- Run QGIS processing algorithms programmatically
- Manage project variables, settings, bookmarks
- Render maps and take canvas screenshots

## When Not To Use

- For non-geographic image processing (resize, crop, filter) -- use the imagemagick skill instead
- For 3D modelling and scene rendering -- use the blender skill instead
- For generic diagrams and flowcharts -- use the mermaid-diagrams skill instead
- For data analysis without a spatial component -- use the jupyter-notebooks or pytorch-ml skills instead

## Architecture

```
Claude Code (MCP Client)
    |
    | MCP Protocol (stdio)
    v
FastMCP Server (uv run src/qgis_mcp/server.py)
    |
    | TCP Socket (length-prefixed framing, port 9877)
    v
QGIS Desktop (Display :1) with qgis_mcp_plugin
```

The nkarasiak/qgis-mcp plugin uses **length-prefixed binary framing** (4-byte big-endian uint32 header followed by JSON payload), not newline-delimited JSON. The FastMCP server handles this protocol automatically.

## Plugin Source

Cloned at: `/home/devuser/workspace/qgis-mcp`
Symlinked to QGIS at: `~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/qgis_mcp_plugin`

## Auto-Install / Verification

Before using QGIS tools, verify the plugin is installed:

```bash
# Check plugin symlink exists
ls -la ~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/qgis_mcp_plugin

# If missing, re-create it:
ln -s /home/devuser/workspace/qgis-mcp/qgis_mcp_plugin \
  ~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/qgis_mcp_plugin

# If repo not cloned yet:
git clone https://github.com/nkarasiak/qgis-mcp /home/devuser/workspace/qgis-mcp
ln -s /home/devuser/workspace/qgis-mcp/qgis_mcp_plugin \
  ~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/qgis_mcp_plugin
```

## Adding as MCP Server to Claude Code

```bash
claude mcp add --transport stdio qgis -- uv run --project /home/devuser/workspace/qgis-mcp src/qgis_mcp/server.py
```

Or add to `.mcp.json` at project root:
```json
{
  "mcpServers": {
    "qgis": {
      "command": "uv",
      "args": ["run", "--project", "/home/devuser/workspace/qgis-mcp", "src/qgis_mcp/server.py"],
      "env": {
        "QGIS_MCP_PORT": "9877"
      }
    }
  }
}
```

## Tools (51+)

| Category | Tools |
|----------|-------|
| **Project** | `load_project`, `create_new_project`, `save_project`, `get_project_info` |
| **Layers** | `get_layers`, `add_vector_layer`, `add_raster_layer`, `remove_layer`, `find_layer`, `create_memory_layer`, `set_layer_visibility`, `zoom_to_layer`, `get_layer_extent`, `set_layer_property` |
| **Features** | `get_layer_features`, `add_features`, `update_features`, `delete_features`, `select_features`, `get_selection`, `clear_selection`, `get_field_statistics` |
| **Styling** | `set_layer_style` (single, categorized, graduated) |
| **Rendering** | `render_map`, `get_canvas_screenshot`, `get_canvas_extent`, `set_canvas_extent` |
| **Processing** | `execute_processing`, `list_processing_algorithms`, `get_algorithm_help` |
| **Layouts** | `list_layouts`, `export_layout` |
| **Layer tree** | `get_layer_tree`, `create_layer_group`, `move_layer_to_group` |
| **Plugins** | `list_plugins`, `get_plugin_info`, `reload_plugin` |
| **System** | `ping`, `diagnose`, `get_qgis_info`, `get_raster_info`, `get_message_log`, `execute_code`, `batch_commands`, `validate_expression`, `get_project_variables`, `set_project_variable`, `get_setting`, `set_setting`, `transform_coordinates` |

## Examples

```python
# Ping to check connection
ping()

# Load a GeoJSON layer
add_vector_layer(path="/data/cities.geojson", name="Cities")

# Run a processing algorithm
execute_processing(
    algorithm="native:buffer",
    parameters={"INPUT": "Cities", "DISTANCE": 10000, "OUTPUT": "memory:"}
)

# Render the map
render_map(width=1920, height=1080)

# Transform coordinates
transform_coordinates(
    x=-3.3245, y=54.3889,
    source_crs="EPSG:4326", target_crs="EPSG:27700"
)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QGIS_MCP_HOST` | `localhost` | QGIS plugin TCP host |
| `QGIS_MCP_PORT` | `9877` | QGIS plugin TCP port |
| `QGIS_MCP_TRANSPORT` | `stdio` | MCP transport mode |
| `QGIS_MCP_LOG_FILE` | `~/.local/share/qgis-mcp/server.log` | Server log file |
| `QGIS_MCP_LOG_LEVEL` | `INFO` | Log level |
| `QGIS_MCP_TOOL_MODE` | `granular` | `granular` (51 tools) or `compound` (~19 grouped) |

## Compound Tool Mode

To reduce schema overhead, use compound mode (~19 grouped tools instead of 51):
```bash
QGIS_MCP_TOOL_MODE=compound uv run --project /home/devuser/workspace/qgis-mcp src/qgis_mcp/server.py
```

## Troubleshooting

**Connection refused:**
```bash
# Check QGIS is running on Display :1
supervisorctl status qgis

# Verify plugin is loaded and server started
# In QGIS: Plugins > Manage Plugins > search "QGIS MCP" > check enabled
# Click MCP toolbar button to start the server

# Test TCP connection
python3 -c "import socket; s=socket.socket(); s.connect(('localhost',9877)); print('OK'); s.close()"
```

**Protocol mismatch (old plugin vs new):**
The new plugin uses length-prefixed framing (4-byte header), not newline-delimited JSON.
Always use the FastMCP server (`src/qgis_mcp/server.py`) which handles framing automatically.
Do NOT send raw newline-delimited JSON to port 9877 -- it will fail with the new plugin.
