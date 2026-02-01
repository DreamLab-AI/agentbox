# MCP Infrastructure

Core infrastructure for Model Context Protocol (MCP) server management and integration.

## Directory Structure

```
mcp-infrastructure/
├── servers/           # MCP protocol bridges and gateways
│   ├── mcp-tcp-server.js      # TCP bridge for MCP
│   ├── mcp-gateway.js         # MCP gateway/router
│   ├── mcp-ws-relay.js        # WebSocket relay
│   └── mcp-server.js          # Core MCP server
├── auth/              # Authentication and security
│   ├── auth-middleware.js     # Authentication middleware
│   └── secure-client-example.js  # Secure client template
├── monitoring/        # Health checks and status
│   ├── health-check.js        # Health monitoring
│   ├── health-check.sh
│   └── check-setup-status.sh
├── scripts/           # Automation and utilities
│   ├── automated-setup.sh
│   ├── init-claude-flow-agents.sh
│   └── claude-flow-tcp-proxy.js
├── config/            # Configuration templates
├── logging/           # Logging utilities
├── mcp.json           # MCP server registry
└── package.json       # Node.js dependencies
```

## Components

### MCP Servers
- **mcp-tcp-server.js**: TCP-based MCP protocol bridge
- **mcp-gateway.js**: Central gateway for routing MCP requests
- **mcp-ws-relay.js**: WebSocket relay for remote MCP access
- **mcp-server.js**: Full-featured MCP server implementation

### Authentication
- **auth-middleware.js**: JWT/token-based authentication
- **secure-client-example.js**: Reference implementation for secure clients

### Monitoring
- **health-check.js**: Service health monitoring
- **check-setup-status.sh**: Verify installation and configuration

### Scripts
- **automated-setup.sh**: Automated MCP infrastructure setup
- **init-claude-flow-agents.sh**: Initialize Claude Flow agents
- **claude-flow-tcp-proxy.js**: TCP proxy for Claude Flow

## Configuration

**mcp.json**: Complete registry of MCP servers including:
- claude-flow
- ruv-swarm
- blender-mcp
- qgis-mcp
- kicad-mcp
- ngspice-mcp
- imagemagick-mcp
- pbr-generator-mcp
- playwright-visual
- playwright
- web-summary

## Usage

### Install Dependencies
```bash
cd mcp-infrastructure
npm install
```

### Start MCP TCP Server
```bash
node servers/mcp-tcp-server.js
```

### Start MCP Gateway
```bash
node servers/mcp-gateway.js
```

### Run Health Checks
```bash
node monitoring/health-check.js
```

## Integration

These components are used by the skill-specific MCP implementations in:
- `/skills/*/tools/` - Individual skill MCP clients

The infrastructure provides:
1. Protocol bridges (TCP, WebSocket)
2. Authentication layer
3. Health monitoring
4. Configuration templates
