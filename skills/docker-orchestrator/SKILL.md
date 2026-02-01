---
name: docker-orchestrator
version: 2.0.0
description: Docker container orchestration using Python SDK - logs, inspect, network mapping
author: agentic-workstation
tags: [docker, containers, orchestration, compose, networking]
mcp_server: true
---

# Docker Orchestrator Skill

Professional Docker container orchestration using the Python Docker SDK for comprehensive container management, networking visualization, and volume inspection.

## Overview

This skill provides native Python-based Docker operations without shell wrappers, using the official Docker SDK for Python. It offers detailed container inspection, real-time log streaming, network topology mapping, and volume content exploration.

**Key Capabilities**:
- Container lifecycle management and inspection
- Real-time log streaming with filtering
- Network topology visualization and mapping
- Volume content inspection via temporary containers
- Docker Compose integration
- Resource usage statistics (CPU, memory, I/O)
- Health check monitoring
- Process inspection inside containers

## MCP Tools

### Container Management

#### `container_list`
Lists Docker containers with optional filtering.

**Parameters**:
- `all` (bool, optional): Show all containers including stopped (default: False)
- `filters` (dict, optional): Filter results (e.g., {"status": "running", "label": "app=web"})

**Returns**: List of container objects with ID, name, status, image, and ports

**Example**:
```python
# List running containers
containers = container_list()

# List all containers including stopped
all_containers = container_list(all=True)

# Filter by status and label
filtered = container_list(filters={"status": "running", "label": "env=production"})
```

#### `container_logs`
Retrieves container logs with streaming support.

**Parameters**:
- `name` (str, required): Container name or ID
- `tail` (int, optional): Number of lines from end (default: 100)
- `since` (str, optional): Show logs since timestamp/duration (e.g., "2023-01-01T00:00:00", "10m")
- `follow` (bool, optional): Stream logs in real-time (default: False)

**Returns**: Container logs as text or stream

**Example**:
```python
# Get last 100 lines
logs = container_logs("nginx-web")

# Get last 500 lines
logs = container_logs("api-server", tail=500)

# Get logs from last 10 minutes
logs = container_logs("worker", since="10m")

# Stream logs in real-time
logs = container_logs("app", follow=True)
```

#### `container_inspect`
Provides detailed container inspection data.

**Parameters**:
- `name` (str, required): Container name or ID

**Returns**: Complete container configuration, state, network settings, mounts, and metadata

**Example**:
```python
details = container_inspect("postgres-db")
# Returns: Config, State, NetworkSettings, Mounts, Env vars, etc.
```

#### `container_stats`
Retrieves real-time resource usage statistics.

**Parameters**:
- `name` (str, required): Container name or ID

**Returns**: CPU usage, memory usage, network I/O, and block I/O statistics

**Example**:
```python
stats = container_stats("redis-cache")
# Returns: cpu_percent, memory_usage, memory_limit, network_rx, network_tx, etc.
```

#### `container_exec`
Executes commands inside a running container.

**Parameters**:
- `name` (str, required): Container name or ID
- `command` (str, required): Command to execute
- `workdir` (str, optional): Working directory for the command

**Returns**: Command output (stdout and stderr)

**Example**:
```python
# Check disk usage
output = container_exec("web-app", "df -h")

# Run command in specific directory
output = container_exec("api", "ls -la", workdir="/app/logs")

# Check process list
output = container_exec("worker", "ps aux")
```

#### `container_top`
Lists processes running inside a container.

**Parameters**:
- `name` (str, required): Container name or ID

**Returns**: Process list with PID, user, time, and command

**Example**:
```python
processes = container_top("nginx-web")
# Returns: List of processes with details
```

### Image Management

#### `image_list`
Lists Docker images with optional filtering.

**Parameters**:
- `filters` (dict, optional): Filter results (e.g., {"dangling": "true", "label": "version=1.0"})

**Returns**: List of images with ID, tags, size, and created date

**Example**:
```python
# List all images
images = image_list()

# List dangling images
dangling = image_list(filters={"dangling": "true"})

# Filter by label
tagged = image_list(filters={"label": "env=production"})
```

#### `image_inspect`
Provides detailed image inspection data.

**Parameters**:
- `name` (str, required): Image name or ID

**Returns**: Image configuration, layers, size, labels, and metadata

**Example**:
```python
details = image_inspect("nginx:latest")
# Returns: Config, Architecture, Layers, Size, Labels, etc.
```

### Volume Management

#### `volume_list`
Lists all Docker volumes.

**Returns**: List of volumes with name, driver, and mountpoint

**Example**:
```python
volumes = volume_list()
# Returns: [{"Name": "db_data", "Driver": "local", "Mountpoint": "/var/lib/docker/volumes/db_data/_data"}]
```

#### `volume_inspect`
Provides detailed volume inspection data.

**Parameters**:
- `name` (str, required): Volume name

**Returns**: Volume configuration, driver, labels, and options

**Example**:
```python
details = volume_inspect("postgres_data")
# Returns: Name, Driver, Mountpoint, Labels, Options, Scope
```

#### `volume_files`
Lists files and directories within a volume using a temporary container.

**Parameters**:
- `name` (str, required): Volume name
- `path` (str, optional): Path within volume to list (default: "/")

**Returns**: Directory listing with file details

**Example**:
```python
# List root of volume
files = volume_files("app_data")

# List specific directory
logs = volume_files("app_data", path="/logs")
```

**How it works**: Creates a temporary Alpine container with the volume mounted, executes `ls -lah`, then removes the container.

### Network Management

#### `network_list`
Lists all Docker networks.

**Returns**: List of networks with ID, name, driver, and scope

**Example**:
```python
networks = network_list()
# Returns: [{"Id": "abc123", "Name": "bridge", "Driver": "bridge", "Scope": "local"}]
```

#### `network_inspect`
Provides detailed network inspection data.

**Parameters**:
- `name` (str, required): Network name or ID

**Returns**: Network configuration, containers, IPAM config, and options

**Example**:
```python
details = network_inspect("app_network")
# Returns: Name, Driver, IPAM, Containers, Options, Labels
```

#### `network_map`
Generates a JSON graph of container network connections.

**Returns**: Network topology with nodes (containers) and edges (connections)

**Example**:
```python
topology = network_map()
# Returns: {
#   "networks": {
#     "bridge": {
#       "containers": ["web", "db"],
#       "connections": [{"from": "web", "to": "db"}]
#     }
#   }
# }
```

**Use case**: Visualize container connectivity, identify network isolation, troubleshoot communication issues.

### Docker Compose Integration

#### `compose_ps`
Lists containers for a Docker Compose project.

**Parameters**:
- `project` (str, optional): Compose project name (defaults to current directory)

**Returns**: List of services with status, ports, and container names

**Example**:
```python
# List services in current project
services = compose_ps()

# List services for specific project
services = compose_ps(project="myapp")
```

#### `compose_logs`
Retrieves logs from Docker Compose services.

**Parameters**:
- `project` (str, required): Compose project name
- `service` (str, optional): Specific service name (all services if not specified)
- `tail` (int, optional): Number of lines from end (default: 100)

**Returns**: Service logs as text

**Example**:
```python
# Get all service logs
logs = compose_logs("myapp")

# Get logs for specific service
logs = compose_logs("myapp", service="web")

# Get last 500 lines
logs = compose_logs("myapp", service="worker", tail=500)
```

### Health Monitoring

#### `health_check`
Checks container health status.

**Parameters**:
- `name` (str, required): Container name or ID

**Returns**: Health status (healthy, unhealthy, starting, none) with last check details

**Example**:
```python
health = health_check("api-server")
# Returns: {"status": "healthy", "failing_streak": 0, "log": [...]}
```

## Network Visualization

The `network_map` tool provides a comprehensive view of Docker network topology:

**Visualization Data Structure**:
```json
{
  "networks": {
    "app_network": {
      "driver": "bridge",
      "containers": [
        {
          "name": "web-frontend",
          "ip": "172.20.0.2",
          "mac": "02:42:ac:14:00:02",
          "ports": ["80:8080", "443:8443"]
        },
        {
          "name": "api-backend",
          "ip": "172.20.0.3",
          "mac": "02:42:ac:14:00:03",
          "ports": ["8000:8000"]
        }
      ],
      "subnet": "172.20.0.0/16",
      "gateway": "172.20.0.1"
    }
  },
  "connections": [
    {"from": "web-frontend", "to": "api-backend", "network": "app_network"}
  ]
}
```

**Use Cases**:
- Debug connectivity issues between containers
- Verify network isolation and segmentation
- Document microservice communication patterns
- Plan network architecture changes
- Identify exposed ports and services

## Volume Inspection

The `volume_files` tool enables exploration of volume contents without direct host access:

**How it works**:
1. Creates temporary Alpine Linux container
2. Mounts target volume to `/data`
3. Executes `ls -lah` or `find` commands
4. Returns output
5. Automatically cleans up temporary container

**Example Output**:
```
total 48K
drwxr-xr-x    5 postgres postgres      4.0K Dec 18 10:30 .
drwxr-xr-x    1 root     root          4.0K Dec 18 10:25 ..
-rw-------    1 postgres postgres        3 Dec 18 10:30 PG_VERSION
drwx------    6 postgres postgres      4.0K Dec 18 10:30 base
drwx------    2 postgres postgres      4.0K Dec 18 10:30 global
```

**Use Cases**:
- Verify backup data in volumes
- Debug permission issues
- Inspect application data without container restart
- Monitor log file growth in mounted volumes
- Audit configuration files

## Common Workflows

### 1. Container Debugging
```python
# Get container details
info = container_inspect("problematic-app")

# Check recent logs
logs = container_logs("problematic-app", tail=200)

# Check resource usage
stats = container_stats("problematic-app")

# Check processes
processes = container_top("problematic-app")

# Execute diagnostic command
output = container_exec("problematic-app", "curl -v localhost:8080/health")
```

### 2. Network Troubleshooting
```python
# Map network topology
topology = network_map()

# Inspect specific network
network_details = network_inspect("app_network")

# Check container connectivity
container = container_inspect("web-frontend")
network_settings = container["NetworkSettings"]
```

### 3. Volume Data Inspection
```python
# List all volumes
volumes = volume_list()

# Inspect volume details
volume_info = volume_inspect("app_data")

# Check volume contents
files = volume_files("app_data", path="/uploads")

# Verify backup data
backup_files = volume_files("backup_volume", path="/backups")
```

### 4. Performance Monitoring
```python
# Get container stats
web_stats = container_stats("web-server")
cpu_usage = web_stats["cpu_percent"]
memory_usage = web_stats["memory_percent"]

# Check all running containers
containers = container_list(filters={"status": "running"})
for container in containers:
    stats = container_stats(container["name"])
    print(f"{container['name']}: CPU {stats['cpu_percent']}% Memory {stats['memory_percent']}%")
```

### 5. Compose Project Management
```python
# Check service status
services = compose_ps("myapp")

# Get service logs
web_logs = compose_logs("myapp", service="web", tail=500)
db_logs = compose_logs("myapp", service="db", tail=500)

# Check health of all services
for service in services:
    health = health_check(service["container_name"])
    print(f"{service['service']}: {health['status']}")
```

## Configuration

The MCP server connects to Docker via the local socket:

- **Unix**: `/var/run/docker.sock`
- **Windows**: `npipe:////./pipe/docker_engine`

Requires appropriate permissions to access the Docker socket.

## Best Practices

1. **Permission Management**: Ensure the MCP server process has access to the Docker socket
2. **Resource Limits**: Use filters to limit large queries (images, containers)
3. **Log Streaming**: Use `tail` parameter to avoid overwhelming output
4. **Temporary Containers**: The `volume_files` tool automatically cleans up temporary containers
5. **Network Security**: Review network maps to ensure proper isolation
6. **Health Monitoring**: Regularly check container health status
7. **Compose Integration**: Use project names consistently across compose operations

## Error Handling

The server provides detailed error messages for common issues:

- **Container not found**: Returns clear error with available containers
- **Permission denied**: Indicates Docker socket access issues
- **Volume mount errors**: Provides troubleshooting steps
- **Network conflicts**: Explains network configuration problems

## Requirements

- Docker Engine 20.10+
- Python 3.8+
- docker-py SDK
- FastMCP framework
- Read/write access to Docker socket

## Installation

```bash
cd /home/devuser/workspace/project/multi-agent-docker/skills/docker-orchestrator
pip install -r requirements.txt

# Add to Claude Desktop MCP configuration
# See mcp-config.json for configuration example
```

## Related Skills

- **supervisor-manager**: Service management inside containers
- **comfyui**: GPU container orchestration
- **blender**: Render container management
- **flow-nexus-swarm**: Multi-container swarm deployment

## Version History

- **2.0.0**: Complete Python SDK implementation with network mapping and volume inspection
- **1.0.0**: Initial shell-based wrapper (deprecated)
