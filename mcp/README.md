# MCP In Agentbox

This directory contains MCP-related runtime assets and legacy bridge code.

## Current State

Agentbox does not treat the old local TCP and WebSocket bridge layer as the primary architecture anymore.

The current direction is:

- manifest-gated skill/runtime services
- direct stdio MCP servers where appropriate
- sovereign auth alignment
- a Nostr bridge path for decentralized coordination scaffolding

## What Is Here

- `mcp.json`: MCP registry and server definitions
- `servers/`: bridge and server code, including legacy TCP/WS components and the new `nostr-bridge.js`
- `auth/`: MCP-side auth helpers
- `monitoring/`: health and setup checks
- `scripts/`: older setup and bridge utilities

## Important Distinction

These files are not all equally current.

### Current / relevant

- `mcp.json`
- `servers/nostr-bridge.js`
- auth helpers that still support current runtime flows

### Legacy / compatibility-oriented

- `servers/mcp-tcp-server.js`
- `servers/mcp-ws-relay.js`
- scripts and docs built around the older local bridge model

## Architectural Guidance

When updating MCP infrastructure for Agentbox:

- prefer manifest-gated services
- prefer direct per-skill MCP wiring over global bridge complexity
- do not assume local TCP/WS bridge topology is the canonical control path
- align new auth work with the sovereign runtime direction

## Related Files

- [`../skills/mcp.json`](../skills/mcp.json)
- [`../config/entrypoint-unified.sh`](../config/entrypoint-unified.sh)
- [`../mcp/servers/nostr-bridge.js`](servers/nostr-bridge.js)
