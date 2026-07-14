# Connection, Setup & the BlenderMCP Protocol Loop

Source grounding: this document distills technique from the BlenderMCP addon source
(Siddharth Ahuja, MIT, github.com/ahujasid/blender-mcp — read directly from
`digital-sculpting-basics-with-blender-in-claude-code/files/_unpacked/First Video
Files/First Video Files/addon.py`, ~2,600 lines) plus the setup/connection lesson pages
of four courses (`ai-box-modeling-with-blender-in-claude-code`,
`digital-sculpting-basics-with-blender-in-claude-code`, `environment-modeling-with-
blender-ai`, `introduction-to-3d-modeling-with-blender-and-claude-code`). Command
names, parameters, defaults, and socket behaviour below are read from the addon's
Python, not guessed. Everything else is written fresh.

## 1. When this applies

Before any modeling/sculpting/shading skill can drive Blender, the Blender-side addon
and the agent-side MCP server must both be running and talking to each other — read
this first in any Blender task, and return to it whenever the connection drops mid-session.

## 2. Workflow — connecting Blender and Claude Code

### Phase 0 — Prerequisites (once per machine)

- Blender 4.x installed, with the "Bool Tool" / standard modifier set available (stock
  Blender; no special build required).
- `uv`/`uvx` installed on the machine running the agent (the MCP server ships as a
  Python package launched via `uvx`, not a long-running system service you install
  separately). If `uv` isn't on PATH, install it first — every later step depends on it.
- A running Claude Code session with permission to edit MCP configuration
  (`.mcp.json` or `claude mcp add`).

### Phase 1 — Install and enable the Blender-side addon

The addon (`bl_info` name "Blender MCP", category Interface, declares
`location: View3D > Sidebar > BlenderMCP`) ships as a single Python file/zip. Install it
the standard Blender way:

1. `Edit > Preferences > Add-ons`.
2. Use the Add-ons panel's action menu → `Install from Disk`, point it at the
   addon zip (or search Blender's Extensions catalogue for "MCP" if using a
   marketplace-distributed build — same code, different distribution channel).
3. Enable the checkbox next to "Blender MCP".
4. `Save Preferences` so the addon survives a Blender restart. Note: *enabling the
   addon* is what's saved — the *socket server itself* is not persisted (see Phase 2).

This registers a Scene panel (`BLENDERMCP_PT_Panel`, category `BlenderMCP`) reachable
via the 3D viewport sidebar — press `N` if the sidebar is hidden, then find the
`BlenderMCP` tab.

### Phase 2 — Start the socket server (once per Blender session)

The panel exposes, in order: a `Port` field (`IntProperty`, default **9876**, range
1024–65535), the four asset-integration checkboxes (Phase 5), and a toggle button:
`Connect to MCP server` when stopped, `Disconnect from MCP server` + a "Running on
port N" label when running.

Clicking `Connect to MCP server` instantiates a `BlenderMCPServer(host='localhost',
port=<panel port>)` and calls `.start()`, which:
- opens a raw TCP `socket.AF_INET`/`SOCK_STREAM` listener bound to `localhost:<port>`,
  `listen(1)`,
- spawns a daemon accept-loop thread,
- for each accepted client, spawns a per-client daemon thread that reads and buffers
  bytes until they parse as one complete JSON document.

**This step must be repeated every time you (re)open Blender.** The "server running"
flag lives on an in-memory Python object (`bpy.types.blendermcp_server`), not in the
`.blend` file — a fresh Blender process always starts with the socket closed even
though the addon itself stays enabled.

### Phase 3 — Register the agent-side MCP server

The agent side is a separate MCP server process, launched with `uvx blender-mcp`, that
acts as the client of the Blender socket above. It must be registered with whatever
MCP client is driving the session. For Claude Code, that's a stdio server entry — not
the one-click "connector" some Claude *Desktop* course lessons describe (that shortcut
just automates this same registration inside Desktop's own connector marketplace and
does not apply to a CLI/agentbox session).

Minimal `.mcp.json` entry:

```json
{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": ["blender-mcp"]
    }
  }
}
```

Or, via the CLI: `claude mcp add blender -- uvx blender-mcp`.

The MCP server defaults to `localhost:9876` — if you changed the port in the Blender
panel (Phase 2), the agent-side config needs to match, or just leave the panel at its
9876 default and never touch it.

Restart the Claude Code session (or reload MCP servers) after adding/changing this
entry so the new tool list is picked up.

### Phase 4 — Verify the round trip

Check the connection is live before doing anything else. `get_scene_info` is the
cheapest round trip — it touches nothing, just reads state:

```python
# via the get_scene_info MCP tool, no params
```

Expected shape (read from `BlenderMCPServer.get_scene_info`):

```json
{
  "status": "success",
  "result": {
    "name": "Scene",
    "object_count": 3,
    "objects": [
      {"name": "Cube", "type": "MESH", "location": [0.0, 0.0, 0.0]}
    ],
    "materials_count": 1
  }
}
```

(`objects` is capped at the first 10 — see Pitfalls.) If this returns instead of
timing out or erroring, the loop is closed: agent → `uvx blender-mcp` → TCP
`localhost:9876` → addon → Blender's main thread → response back up the same path.

### Phase 5 — Asset-generation integrations (optional, off by default)

Four checkboxes in the same panel each gate a *set* of extra MCP tools. The Blender
side rebuilds its handler dispatch table on every incoming command by checking these
scene properties live, so the gate is real-time — but the addon's own status messages
(`get_polyhaven_status`, `get_hyper3d_status`, etc.) explicitly instruct you to
stop/restart the MCP connection after flipping a checkbox, so treat that as the
supported procedure rather than relying on hot-toggle behaviour.

| Toggle | Tools unlocked | Enable when… | Auth needed |
|---|---|---|---|
| Use assets from Poly Haven | `get_polyhaven_categories`, `search_polyhaven_assets`, `download_polyhaven_asset`, `set_texture` | you want free, real-world PBR materials/HDRIs/models rather than hand-authored shaders | none |
| Use Hyper3D Rodin 3D model generation | `create_rodin_job`, `poll_rodin_job_status`, `import_generated_asset` | you need a *novel* generated mesh from a text/image prompt instead of modeling it by hand | API key (a one-click "Set Free Trial API Key" operator fills in a shared trial key and sets mode to `hyper3d.ai`); alternate backend `fal.ai` |
| Use assets from Sketchfab | `search_sketchfab_models`, `get_sketchfab_model_preview`, `download_sketchfab_model` | you want to source an *existing published* model rather than generate or model one | Sketchfab API token |
| Use Tencent Hunyuan 3D model generation | `create_hunyuan_job`, `poll_hunyuan_job_status`, `import_generated_asset_hunyuan` | you run (or have access to) a Hunyuan3D generation backend as an alternative to Rodin | local mode: a reachable service URL (default `http://localhost:8081`); official mode: Tencent Cloud SecretId/SecretKey |

Calling any of these tools while its checkbox is off returns `{"status": "error",
"message": "Unknown command type: ..."}` — that error means "go flip the checkbox and
restart the connection," not "the tool doesn't exist."

### Phase 6 — The universal working loop (every task, from here on)

Once connected, essentially all modeling/sculpting/shading work follows the same five
beats, repeated per step of whatever task breakdown you're executing:

1. **Decompose** — turn the user's ask into one small, checkable step (a single
   operator sequence, not a whole prop).
2. **`execute_code`** — send one `bpy` script that performs just that step.
3. **`get_viewport_screenshot`** — capture what actually happened.
4. **Inspect** — read the screenshot; for anything geometric/numeric, cross-check with
   `get_object_info` (exact dimensions, vertex/poly counts, transform values) rather
   than trusting the render alone.
5. **Correct** — if it's wrong, describe the delta precisely and send a corrective
   `execute_code` call; otherwise advance to the next decomposed step.

Treat step 2 as ~90% of total tool calls in any session — `get_scene_info` and
`get_object_info` are for checking state, `execute_code` is for changing it.

## 3. `bpy` technique notes — the protocol layer itself

### Command envelope

Every call across the socket is one JSON object, no framing/length-prefix — the
server just accumulates raw bytes and retries `json.loads()` on the growing buffer
until it parses, then resets the buffer:

```json
{"type": "execute_code", "params": {"code": "import bpy\nbpy.ops.mesh.primitive_cube_add(size=2)\n"}}
```

Response:

```json
{"status": "success", "result": {"executed": true, "result": ""}}
```

or, on failure:

```json
{"status": "error", "message": "Code execution error: <exception text>"}
```

### `execute_code` semantics

```python
def execute_code(self, code):
    namespace = {"bpy": bpy}
    capture_buffer = io.StringIO()
    with redirect_stdout(capture_buffer):
        exec(code, namespace)
    return {"executed": True, "result": capture_buffer.getvalue()}
```

Consequences worth internalising:
- **Only `print()` output comes back.** A script that builds geometry and just
  evaluates an expression returns an empty `"result"` string — if you need a value
  back, `print(...)` it explicitly, or make a *separate* `get_object_info`/
  `get_scene_info` call afterward.
- The namespace pre-seeds `bpy` only, but `exec()` without an explicit `__builtins__`
  key still gets the real Python builtins injected — `import os`, `import subprocess`,
  file I/O, and network calls all work from inside `execute_code`. This is a full
  scripting surface, not a restricted DSL (see §5 Security).
- Every `execute_code` call runs synchronously inside a `bpy.app.timers` callback that
  the socket thread schedules onto Blender's main thread. That serializes all bpy
  access safely (no data races), but it also means a slow script — a dense subdivision,
  a large boolean, a multi-second bake — blocks every other pending command, including
  the screenshot you're about to ask for.

### `get_viewport_screenshot(max_size=800, filepath=None, format="png")`

```python
# filepath is REQUIRED — there is no default; pick a scratch path you control
get_viewport_screenshot(max_size=1024, filepath="/tmp/blendermcp_view.png", format="png")
```

Internally this finds the first `VIEW_3D` area in the current screen, overrides
context onto it, calls `bpy.ops.screen.screenshot_area`, then loads and downsamples the
image if either dimension exceeds `max_size`. It needs an actual 3D viewport area in
the current workspace/screen layout to exist — see Pitfalls for when this fails.

### `get_object_info(name)`

Returns location/rotation/scale, `visible_get()`, material slot names, and for mesh
objects a world-space AABB (via a matrix-transform of `obj.bound_box`) plus
vertex/edge/polygon counts:

```python
get_object_info("chest_body")
# → {"name": "chest_body", "type": "MESH", "location": [...], "rotation": [...],
#    "scale": [...], "visible": true, "materials": ["wood_mat"],
#    "world_bounding_box": [[minx,miny,minz],[maxx,maxy,maxz]],
#    "mesh": {"vertices": 812, "edges": 1620, "polygons": 812}}
```

Use this instead of eyeballing the screenshot whenever a claim can be checked
numerically — "is it 40cm wide," "did the boolean actually remove those faces," "is
the origin at world zero."

### `get_scene_info()`

Cheap scene-wide summary: object count, up to the **first 10** objects (name/type/
rounded location only), and a material count. It is a connectivity check and a rough
orientation tool, not a substitute for `get_object_info` on anything you're actively
editing.

## 4. Prompt-strategy notes

**Decompose before generating geometry.** A single broad prompt produces a fast,
plausible-looking first draft with real inaccuracies baked in — misaligned details,
approximate colors, rough proportions — because the model is optimizing for covering
everything in one shot rather than getting any one thing exactly right. Splitting the
same ask into staged prompts, each checked before the next begins, consistently
produces tighter results for the same total effort. Fresh example:

> "Don't build the whole shed yet. First just block out the four wall panels at the
> right footprint and height, then stop and show me a screenshot before adding the
> roof."

**Ask for numbers, not adjectives, when precision matters.** "Make it look old and
worn" is unactionable inside a script; "roughness 0.6–0.8 with a noise-driven variation
node, edge wear via a pointiness mask" is. Fresh example:

> "Give me the exact bpy calls and parameter values for a crate 0.4m × 0.3m × 0.25m —
> not a description of a crate."

**Put reference material inside Blender, not beside it.** The MCP connection only ever
sees what's inside the Blender process — a screenshot viewer, PDF, or pinned reference
app on the same monitor is invisible to it. Drag reference images directly into the 3D
viewport (they import as empties with an image), position them with normal transform
tools, and the agent can see them in every `get_viewport_screenshot` call from then on.

**Close the loop explicitly after every correction.** Don't just describe what's wrong
— name the axis/object/value and ask for a screenshot immediately after the fix, so
the next turn starts from evidence, not memory. Fresh example:

> "In the last screenshot the lid is offset about +0.1 on X relative to the body.
> Write a script that corrects only the lid's location to match, then re-screenshot so
> I can confirm before we move on."

**Treat the first result as a draft, not a failure state.** Multi-pass correction is
the normal shape of this workflow, not a sign something's broken — plan prompts (and
your own patience) around two or three passes per non-trivial step.

## 5. Pitfalls

- **Port already in use / "Failed to start server."** Usually a previous Blender
  session's server thread never cleanly stopped (e.g. Blender crashed rather than
  quitting). `SO_REUSEADDR` is set, but a genuinely orphaned process holding the port
  will still block a new bind. Fully quit Blender (and check for a lingering process)
  before retrying, or change the panel's `Port` field and update the agent-side config
  to match.
- **"Connected" in the panel but every command times out.** Enabling the addon and
  clicking `Connect to MCP server` are two different things — the button must be
  clicked again after every Blender restart (Phase 2). A stale `blendermcp_server_
  running` scene property can also read `True` from a saved `.blend` file even though
  no live thread exists in the current process — click `Disconnect` then `Connect`
  again to force a real restart.
- **`uv`/`uvx` not found.** The agent-side MCP server won't launch at all; the MCP
  client log shows a plain "command not found"/spawn failure rather than anything
  Blender-specific. Install `uv` on the host running the agent before touching the
  Blender side.
- **MCP server not registered, or registered for the wrong client.** A course written
  around Claude Desktop's connector marketplace does not automatically carry over to
  Claude Code — Code needs an explicit `.mcp.json` entry or `claude mcp add` (Phase 3).
  Confirm the tool actually appears in the current session's tool list before assuming
  the addon side is the problem.
- **Screenshots come back blank, black, or errored `"No 3D viewport found"`.** The
  screenshot handler searches the *current screen's* areas for a `VIEW_3D` type — if
  Blender is on the Scripting/Shading workspace tab with no 3D viewport visible, or
  running with `--background` (no window at all), there is nothing to capture. Switch
  to the Layout workspace (or any tab showing a 3D viewport) before requesting a
  screenshot.
- **`execute_code` "worked" but nothing changed.** Only `print()` output is returned —
  silence in `"result"` does not mean failure. Follow up with `get_object_info`/
  `get_scene_info` to confirm state changed, especially after operators that depend on
  current selection or active object (a script that assumes something is selected when
  it isn't will often run without raising, and just do nothing useful).
- **Two commands "in flight" at once corrupt the buffer.** The server accumulates
  bytes until they parse as one JSON document; if a second command is sent before the
  first one's response has been read, the two payloads can concatenate into something
  that never parses, and the command is silently dropped (`json.JSONDecodeError` is
  caught and treated as "wait for more data" forever). Always wait for a response
  before sending the next call.
- **Asset-gen tool calls return "Unknown command type."** The checkbox is off, or was
  toggled without restarting the connection per Phase 5 — this is the addon's
  documented behaviour, not a bug to route around.
- **Hyper3D/Sketchfab/Hunyuan calls fail with auth errors.** Each backend needs its
  own credential (free-trial key button for Rodin's main-site mode, a personal token
  for Sketchfab, Secret ID/Key or a local service URL for Hunyuan3D) — `get_hyper3d_
  status`/`get_sketchfab_status`/etc. report exactly what's missing; check status
  before assuming the generation call itself is broken.

## Security reality — read this before enabling `execute_code` on anything you care about

`execute_code` is not a sandboxed scripting mini-language — it is `exec()` of
arbitrary Python inside the same process as Blender, with the real Python builtins
available (file I/O, `os`, `subprocess`, network access via `requests`, which the
addon already imports for its own asset downloads). Anything that can get text into
that tool call — the agent itself, a compromised MCP client, or content the agent was
tricked into treating as an instruction — can do anything your local user account can
do: read/write/delete files, exfiltrate data, reach the network, install software.

Treat the Blender-MCP connection as a full remote-code-execution channel scoped to
whatever account is running Blender, and act accordingly:
- Don't run the addon on a machine or account with access to anything you wouldn't
  hand to an untrusted script.
- The panel's "Needs Approval" permission mode (Claude Desktop's connector setting;
  conceptually equivalent to confirming each tool call in any MCP client) trades speed
  for a human checkpoint before each `execute_code` call — worth it whenever the
  driving prompt includes content from outside your own control (an imported
  reference image with embedded text, a downloaded asset's metadata, etc.).
  "Always Allow" is fine for a solo modeling session on a disposable scene; it is not
  a safe default for anything touching real data or a shared machine.
- The addon links its own Terms and Conditions (`BLENDERMCP_OT_OpenTerms`, opening
  `github.com/ahujasid/blender-mcp/blob/main/TERMS_AND_CONDITIONS.md`) — that
  acknowledgment exists because of exactly this trust boundary, not as a formality to
  click past.
