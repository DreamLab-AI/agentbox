# LichtFeld Studio — MCP Tool Catalog

The MCP server exposes 70+ built-in tools plus read-only resources. Rather than
memorise this table, prefer `tools/lfs-mcp.sh list` (live discovery) — this
catalog is the annotated reference.

## Tool Categories (70+ built-in tools)

### Training Control
| Tool | Parameters | Description |
|------|-----------|-------------|
| `scene.load_dataset` | `path`, `images_folder`, `max_iterations`, `strategy` | Load COLMAP dataset |
| `scene.load_checkpoint` | `path` | Resume from .resume file |
| `scene.save_checkpoint` | `path` | Save training state |
| `training.start` | — | Begin/resume training |
| `training.get_state` | — | Get iteration, loss, num_gaussians, is_running |
| `training.get_loss_history` | — | Loss curve data points |
| `training.list_operations` | — | List CommandCenter operations |
| `training.ask_advisor` | `question` | LLM-based training advice with render |

### Camera Control (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `camera.get` | — | Current camera position/rotation/FOV |
| `camera.set_view` | `position`, `target`, `up`, `fov` | Set camera transform |
| `camera.reset` | — | Reset to default view |
| `camera.list` | — | List dataset cameras |
| `camera.go_to_dataset_camera` | `index` | Jump to dataset camera |

### Rendering
| Tool | Parameters | Description |
|------|-----------|-------------|
| `render.capture` | `camera_index`, `width`, `height` | Render to base64 PNG |
| `render.settings.get` | — | Current render settings |
| `render.settings.set` | various | Modify render settings |

### Gaussian Selection
| Tool | Parameters | Description |
|------|-----------|-------------|
| `selection.rect` | `x`, `y`, `width`, `height` | Select in screen rectangle |
| `selection.polygon` | `points` | Select inside polygon |
| `selection.lasso` | `points` | Freeform lasso selection |
| `selection.ring` | `x`, `y` | Pick front-most gaussian |
| `selection.brush` | `x`, `y`, `radius` | Brush/radius select |
| `selection.click` | `x`, `y` | Click select |
| `selection.get` | — | Return selected indices |
| `selection.clear` | — | Clear selection |
| `selection.by_description` | `description` | LLM vision-based NL selection |

### Scene Graph (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `scene.list_nodes` | — | List all scene nodes |
| `scene.get_selected_nodes` | — | Currently selected nodes |
| `scene.select_node` | `name` | Select a node |
| `scene.set_node_visibility` | `name`, `visible` | Toggle visibility |
| `scene.set_node_locked` | `name`, `locked` | Toggle lock |
| `scene.rename_node` | `name`, `new_name` | Rename node |
| `scene.reparent_node` | `name`, `parent` | Move in hierarchy |
| `scene.add_group` | `name` | Create group node |
| `scene.duplicate_node` | `name` | Duplicate a node |
| `scene.merge_group` | `name` | Merge group children |

### Export
| Tool | Parameters | Description |
|------|-----------|-------------|
| `scene.save_ply` | `path` | Export as PLY |
| `scene.export_ply` | `path` | Export as PLY (async) |
| `scene.export_sog` | `path` | Export as SOG |
| `scene.export_spz` | `path` | Export as SPZ (compressed) |
| `scene.export_usd` | `path` | Export as Universal Scene Description |
| `scene.export_html` | `path` | Export as self-contained HTML viewer |
| `scene.export_status` | — | Check async export progress |
| `scene.export_cancel` | — | Cancel running export |

### History/Undo (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `history.get` | — | Current history state |
| `history.list` | — | Full undo stack |
| `history.undo` | — | Undo last action |
| `history.redo` | — | Redo |
| `history.begin_transaction` | `name` | Start grouped operation |
| `history.commit_transaction` | — | Commit group |
| `history.rollback_transaction` | — | Rollback group |

### Crop Box & Ellipsoid
| Tool | Parameters | Description |
|------|-----------|-------------|
| `crop_box.add` | — | Add crop box |
| `crop_box.get` | — | Get crop box params |
| `crop_box.set` | `center`, `size`, `rotation` | Set crop box |
| `crop_box.fit` | — | Fit to scene |
| `ellipsoid.add` | — | Add ellipsoid selector |
| `ellipsoid.set` | `center`, `radii`, `rotation` | Set ellipsoid |

### Python Editor (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `editor.set_code` | `code` | Set Python code |
| `editor.run` | — | Execute code |
| `editor.get_output` | — | Read stdout/stderr |
| `editor.wait` | — | Wait for completion |
| `editor.interrupt` | — | Kill running script |

### Events (pub/sub)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `events.subscribe` | `event_type` | Subscribe to events |
| `events.poll` | `subscription_id` | Poll for events |
| `events.unsubscribe` | `subscription_id` | Unsubscribe |
| `events.list` | — | List event types |

### Low-Level Gaussian Access
| Tool | Parameters | Description |
|------|-----------|-------------|
| `gaussians.read` | `indices`, `attributes` | Read GPU tensor data |
| `gaussians.write` | `indices`, `attributes`, `values` | Write GPU tensor data |

### Plugins
| Tool | Parameters | Description |
|------|-----------|-------------|
| `plugin.list` | — | List registered plugins |
| `plugin.invoke` | `name`, `capability`, `params` | Invoke plugin capability |

## MCP Resources (read-only)

Read with `tools/lfs-mcp.sh read <uri>`.

| URI | Description |
|-----|-------------|
| `lichtfeld://training/state` | Training iteration, loss, gaussians count |
| `lichtfeld://training/loss_curve` | Loss history data points |
| `lichtfeld://render/current` | Current viewport as base64 PNG |
| `lichtfeld://scene/nodes` | Scene graph structure |
| `lichtfeld://selection/mask` | Current selection mask |
| `lichtfeld://history/state` | Undo/redo state |
| `lichtfeld://editor/code` | Python editor content |
| `lichtfeld://editor/output` | Script output |
