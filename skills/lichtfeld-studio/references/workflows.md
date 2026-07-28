# LichtFeld Studio — Workflows, CLI & Raw HTTP

The `tools/lfs-mcp.sh` wrapper is the ergonomic path for all MCP calls. The raw
JSON-RPC forms below are the fallback when the wrapper is unavailable.

## Raw HTTP tool invocation

All LichtFeld MCP tools can be called via HTTP POST at
`http://127.0.0.1:45677/mcp`. The pattern is:

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "TOOL_NAME",
      "arguments": { ... }
    }
  }' | jq
```

### Listing available tools

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

### Listing available resources

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | jq '.result.resources[].uri'
```

### Reading a resource

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"lichtfeld://training/state"}}' | jq
```

## Workflow examples

### Train a model from a COLMAP dataset

```bash
# 1. Launch headless
LichtFeld-Studio --headless --data-path ./my_dataset --output-path ./output &

# 2. Wait for MCP server, then monitor
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"training.get_state","arguments":{}}}' | jq

# 3. Capture a render at a dataset camera
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"render.capture","arguments":{"camera_index":0,"width":1920,"height":1080}}}' | jq
```

### Export to multiple formats

```bash
# Export pipeline
for fmt in ply spz html; do
  curl -s -X POST http://127.0.0.1:45677/mcp \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"scene.export_${fmt}\",\"arguments\":{\"path\":\"./output/model.${fmt}\"}}}"
done
```

### LLM-guided scene cleanup

```bash
# Select floaters using natural language
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"selection.by_description","arguments":{"description":"floating artifacts and noise outside the main object"}}}'

# Delete selected gaussians
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"gaussians.write","arguments":{"delete_selected":true}}}'
```

### Batch multi-view render

```bash
# List cameras, then render each
CAMERAS=$(curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"camera.list","arguments":{}}}' | jq -r '.result.content[0].text | fromjson | length')

for i in $(seq 0 $((CAMERAS-1))); do
  curl -s -X POST http://127.0.0.1:45677/mcp \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"render.capture\",\"arguments\":{\"camera_index\":$i,\"width\":1920,\"height\":1080}}}" \
    | jq -r '.result.content[0].text' | base64 -d > "render_${i}.png"
done
```

## CLI reference

```bash
# GUI mode (default)
LichtFeld-Studio

# Headless training
LichtFeld-Studio --headless --data-path ./data --output-path ./out

# Resume from checkpoint
LichtFeld-Studio --headless --resume checkpoint.resume

# With strategy
LichtFeld-Studio --headless -d ./data -o ./out --strategy mcmc --eval

# Format conversion
LichtFeld-Studio convert input.ply output.spz
LichtFeld-Studio convert input.ply output.html

# Plugin management
LichtFeld-Studio plugin list
LichtFeld-Studio plugin create my_plugin
LichtFeld-Studio plugin check my_plugin

# PTX warmup (build verification)
LichtFeld-Studio --warmup

# With Python training callbacks
LichtFeld-Studio --headless -d ./data -o ./out --python-script callbacks.py
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LICHTFELD_MCP_ENDPOINT` | `http://127.0.0.1:45677/mcp` | MCP HTTP endpoint |
| `LICHTFELD_EXECUTABLE` | auto-detect in build/ | Path to binary |
| `LICHTFELD_MCP_START_TIMEOUT_S` | `90` | Startup timeout for bridge |
| `LICHTFELD_MCP_BRIDGE_LOG` | `~/.codex/log/lichtfeld-mcp-bridge.log` | Bridge log file |
