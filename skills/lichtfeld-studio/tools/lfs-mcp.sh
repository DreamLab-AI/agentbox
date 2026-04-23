#!/usr/bin/env bash
# LichtFeld Studio MCP CLI wrapper
# Usage: lfs-mcp <method> [tool_name] [json_args]
# Examples:
#   lfs-mcp ping
#   lfs-mcp list
#   lfs-mcp resources
#   lfs-mcp call training.get_state
#   lfs-mcp call scene.load_dataset '{"path":"/data/colmap"}'
#   lfs-mcp call render.capture '{"width":1920,"height":1080}'
#   lfs-mcp read lichtfeld://training/state

set -euo pipefail

ENDPOINT="${LICHTFELD_MCP_ENDPOINT:-http://127.0.0.1:45677/mcp}"
ID="${RANDOM}"

post() {
    curl -s -X POST "$ENDPOINT" \
        -H "Content-Type: application/json" \
        -d "$1"
}

case "${1:-help}" in
    ping)
        post "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"ping\"}"
        ;;
    list)
        post "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"tools/list\"}" | jq -r '.result.tools[] | "\(.name)\t\(.description // "")"' 2>/dev/null || post "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"tools/list\"}"
        ;;
    resources)
        post "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"resources/list\"}" | jq -r '.result.resources[] | "\(.uri)\t\(.name // "")"' 2>/dev/null || post "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"resources/list\"}"
        ;;
    call)
        TOOL="${2:?Tool name required}"
        ARGS="${3:-{}}"
        post "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}"
        ;;
    read)
        URI="${2:?Resource URI required}"
        post "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"resources/read\",\"params\":{\"uri\":\"$URI\"}}"
        ;;
    help|*)
        echo "LichtFeld Studio MCP CLI"
        echo ""
        echo "Usage: lfs-mcp <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  ping                          Check if MCP server is running"
        echo "  list                          List all available tools"
        echo "  resources                     List all available resources"
        echo "  call <tool> [json_args]       Call an MCP tool"
        echo "  read <uri>                    Read an MCP resource"
        echo ""
        echo "Examples:"
        echo "  lfs-mcp call training.get_state"
        echo "  lfs-mcp call render.capture '{\"width\":1920,\"height\":1080}'"
        echo "  lfs-mcp read lichtfeld://training/state"
        ;;
esac
