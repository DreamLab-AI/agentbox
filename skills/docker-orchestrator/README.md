# Docker Orchestrator Skill

Professional Docker container orchestration using Python Docker SDK.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Test the server
python3 server.py

# Add to Claude Desktop
# Copy mcp-config.json content to your Claude Desktop MCP settings
```

## Features

- Container management (list, logs, inspect, exec, stats)
- Image management (list, inspect)
- Volume inspection (list, inspect, file browsing)
- Network topology mapping
- Docker Compose integration
- Health monitoring
- Resource usage statistics

## MCP Tools

See SKILL.md for complete documentation of all 18 MCP tools.

## Requirements

- Docker Engine 20.10+
- Python 3.8+
- Access to Docker socket

## Configuration

The server connects to Docker via the local socket:
- Unix: `/var/run/docker.sock`
- Windows: `npipe:////./pipe/docker_engine`

Ensure the process running the MCP server has appropriate permissions.

## Example Usage

```python
# List running containers
containers = container_list()

# Get container logs
logs = container_logs("nginx-web", tail=200)

# Inspect network topology
topology = network_map()

# Check volume contents
files = volume_files("postgres_data", path="/var/lib/postgresql/data")

# Monitor resource usage
stats = container_stats("api-server")
```

## Version

2.0.0 - Complete Python SDK implementation
