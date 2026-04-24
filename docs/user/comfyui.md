# ComfyUI Integration

Agentbox supports two mutually exclusive ComfyUI paths. Only one may be active at a time.

## Why this exists

ComfyUI is a node-based workflow engine for image and video generation. Agents call into it through an MCP server (Model Context Protocol — a standard way for agents to call external tools) so a single prompt can kick off a complex diffusion pipeline. Agentbox gives you two ways to connect: run ComfyUI inside the same container (`comfyui_builtin`), or point the MCP server at a ComfyUI you already run elsewhere (`comfyui_external`). Only one can be active; the validator rejects both-enabled manifests with `E007`.

**What it solves**

- Re-using a powerful external ComfyUI (on a GPU box or Salad Cloud) without re-deploying models.
- Or a self-contained setup where everything runs in one container for offline use.
- A single MCP endpoint regardless of which path you pick, so agent code does not change.

**When to skip this**: if you do not need image or video generation, leave both switches off — the MCP server is present in the image but idle.

## Paths at a glance

| Switch | Where | Effect |
|--------|-------|--------|
| `skills.media.comfyui_builtin = true` | `agentbox.toml` | Fetches ComfyUI source, wraps a Python env, starts `[program:comfyui-builtin]` on `127.0.0.1:8188` |
| `integrations.comfyui_external.enabled = true` | `agentbox.toml` | Skips the supervisor block; injects `COMFYUI_URL` + `COMFYUI_WS_URL` from the manifest values |

Default — both `false` — ComfyUI is absent. The MCP server entry in `mcp/mcp.json` is always present
but will fail to connect unless one path is active.

## Built-in path

```toml
[skills.media]
comfyui_builtin = true
```

ComfyUI runs on `127.0.0.1:8188` (not exposed outside the container). The MCP server connects
via `http://127.0.0.1:8188`. No additional configuration required.

The Python environment is baked from nixpkgs at build time. GPU support follows `[gpu].backend`.

## External path

```toml
[integrations.comfyui_external]
enabled = true
url    = "http://my-comfyui-host:8188"
ws_url = "ws://my-comfyui-host:8188/ws"
```

`url` and `ws_url` accept any reachable URL — LAN address, DNS name, or Docker service name.
The defaults (`http://comfyui:8188`) assume a `docker_ragflow`-network peer named `comfyui`.

`COMFYUI_URL` and `COMFYUI_WS_URL` are baked into the image environment at build time.
The MCP server inherits them from the container environment.

## Mutual exclusion (E007)

Setting both switches to `true` is rejected by the validator:

```
E007: skills.media.comfyui_builtin and integrations.comfyui_external.enabled are mutually exclusive
```

Run validation with:

```bash
node scripts/agentbox-config-validate.js agentbox.toml
```

## Port collision note

The built-in path binds only to `127.0.0.1:8188`. If you run an external ComfyUI on the same
host and expose port 8188, ensure it does not conflict before enabling the built-in path.
