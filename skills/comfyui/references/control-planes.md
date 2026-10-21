# Remote ComfyUI control planes

Use native HTTP for the data plane: upload assets, inspect live node/model
schemas, validate and submit API graphs, retain prompt receipts, query terminal
history and retrieve media. WebSocket progress is a responsive feedback path,
not proof that a prompt completed. Resume an existing receipt after a timeout.

The baked ComfyUI MCP adapter exposes `node_info`, `workflow_queue`,
`workflow_submit`, `workflow_status`, `workflow_cancel`, `model_list`,
`output_list` and `memory_free`. Status works across MCP restarts; history
errors remain errors even if partial output exists; missing queue/history is
unknown. Output listing comes from history, not `/view` without a filename.
Old hard-coded FLUX/AnimateDiff convenience tools and unused legacy scaffold modules have been removed. Author a
validated graph from live node schemas instead.

MCP dependencies are built for external ComfyUI as well as builtin mode.
Register the baked server with `COMFYUI_URL=http://comfyui:8188`; the historical
localhost override does not reach the external sidecar. Live MCP SDK handshake,
discovery and completed-job lookup have passed. The underlying native API has
completed Blender endpoint H3 baseline and clay-LoRA jobs.

## Official alternative

[Comfy-Org/comfy-mcp](https://github.com/Comfy-Org/comfy-mcp/tree/6da93118533ff52b3a2527f0ce80f1ae8d73b6b5)
is an authoring/discovery candidate based on comfy-cli. Version 0.10 requires
MCP2.x; comfy-cli must be installed separately. It is stdio, and remote
configuration forwards execution but not all local discovery/download and
lifecycle operations. Prefer deployment beside ComfyUI if adopting it; do not
pretend Agentbox's filesystem is the ComfyUI filesystem. This option has been
source-reviewed, not installed or benchmarked here. Licence: AGPL/commercial.

## Phased GPU use

Use the existing codebase-video pattern: render or generate a stage, retain
artefacts, wait for terminal prompt history and an idle queue, then POST `/free`
with `unload_models` and `free_memory`. `memory_free` refuses an active queue.
The operation is asynchronous: inspect `/system_stats` or `nvidia-smi` until
memory release is visible before starting a competing heavy stage. Do not
interrupt unrelated work. The estate's three 48 GB cards are available for this
project; assign by UUID when useful and verify any explicit model/CLIP/VAE
placement against live device-node choices. Visibility is not model sharding.
