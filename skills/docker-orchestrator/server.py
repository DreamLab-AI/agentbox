#!/usr/bin/env python3
"""
Docker Orchestrator MCP Server
Professional Docker container orchestration using Python SDK
"""

import json
import docker
from datetime import datetime
from typing import Optional, Dict, List, Any
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP server
mcp = FastMCP("docker-orchestrator")

# Initialize Docker client
try:
    docker_client = docker.from_env()
except Exception as e:
    print(f"Warning: Could not connect to Docker daemon: {e}")
    docker_client = None


def _ensure_docker():
    """Ensure Docker client is connected"""
    if docker_client is None:
        raise RuntimeError("Docker daemon is not accessible. Ensure Docker is running and socket is accessible.")


def _format_ports(ports: Dict) -> List[str]:
    """Format container port mappings"""
    if not ports:
        return []

    formatted = []
    for container_port, host_bindings in ports.items():
        if host_bindings:
            for binding in host_bindings:
                host_port = binding.get('HostPort', '')
                formatted.append(f"{host_port}:{container_port}")
        else:
            formatted.append(container_port)
    return formatted


def _calculate_cpu_percent(stats: Dict) -> float:
    """Calculate CPU percentage from stats"""
    try:
        cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - \
                   stats['precpu_stats']['cpu_usage']['total_usage']
        system_delta = stats['cpu_stats']['system_cpu_usage'] - \
                      stats['precpu_stats']['system_cpu_usage']

        if system_delta > 0 and cpu_delta > 0:
            num_cpus = len(stats['cpu_stats']['cpu_usage'].get('percpu_usage', [1]))
            return (cpu_delta / system_delta) * num_cpus * 100.0
    except (KeyError, ZeroDivisionError) as e:
        import logging
        logging.debug(f"Could not calculate CPU percentage: {e}")
        return 0.0
    return 0.0


def _format_bytes(bytes_value: int) -> str:
    """Format bytes to human readable string"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_value < 1024.0:
            return f"{bytes_value:.2f} {unit}"
        bytes_value /= 1024.0
    return f"{bytes_value:.2f} PB"


@mcp.tool()
def container_list(all: bool = False, filters: Optional[Dict] = None) -> str:
    """
    List Docker containers with optional filtering

    Args:
        all: Show all containers including stopped (default: False)
        filters: Filter results (e.g., {"status": "running", "label": "app=web"})

    Returns:
        JSON string with list of containers
    """
    _ensure_docker()

    try:
        containers = docker_client.containers.list(all=all, filters=filters or {})

        result = []
        for container in containers:
            result.append({
                "id": container.short_id,
                "name": container.name,
                "image": container.image.tags[0] if container.image.tags else container.image.short_id,
                "status": container.status,
                "state": container.attrs['State']['Status'],
                "ports": _format_ports(container.ports),
                "created": container.attrs['Created'],
                "labels": container.labels
            })

        return json.dumps(result, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def container_logs(name: str, tail: int = 100, since: Optional[str] = None, follow: bool = False) -> str:
    """
    Retrieve container logs with streaming support

    Args:
        name: Container name or ID
        tail: Number of lines from end (default: 100)
        since: Show logs since timestamp/duration (e.g., "2023-01-01T00:00:00", "10m")
        follow: Stream logs in real-time (default: False)

    Returns:
        Container logs as text
    """
    _ensure_docker()

    try:
        container = docker_client.containers.get(name)

        kwargs = {
            "stdout": True,
            "stderr": True,
            "tail": tail
        }

        if since:
            kwargs["since"] = since

        if follow:
            kwargs["stream"] = True
            logs = container.logs(**kwargs)
            # For streaming, return first chunk with note
            first_chunk = next(logs).decode('utf-8', errors='replace')
            return f"[STREAMING STARTED]\n{first_chunk}\n[Stream continues...]"
        else:
            logs = container.logs(**kwargs)
            return logs.decode('utf-8', errors='replace')

    except docker.errors.NotFound:
        return f"Error: Container '{name}' not found"
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
def container_inspect(name: str) -> str:
    """
    Provide detailed container inspection data

    Args:
        name: Container name or ID

    Returns:
        JSON string with complete container configuration and state
    """
    _ensure_docker()

    try:
        container = docker_client.containers.get(name)
        attrs = container.attrs

        # Extract key information
        result = {
            "Id": container.short_id,
            "Name": container.name,
            "Image": attrs['Config']['Image'],
            "Created": attrs['Created'],
            "State": attrs['State'],
            "Config": {
                "Hostname": attrs['Config'].get('Hostname'),
                "Env": attrs['Config'].get('Env', []),
                "Cmd": attrs['Config'].get('Cmd'),
                "WorkingDir": attrs['Config'].get('WorkingDir'),
                "Labels": attrs['Config'].get('Labels', {})
            },
            "NetworkSettings": {
                "IPAddress": attrs['NetworkSettings'].get('IPAddress'),
                "Ports": attrs['NetworkSettings'].get('Ports', {}),
                "Networks": attrs['NetworkSettings'].get('Networks', {})
            },
            "Mounts": attrs.get('Mounts', []),
            "RestartCount": attrs.get('RestartCount', 0)
        }

        return json.dumps(result, indent=2)

    except docker.errors.NotFound:
        return json.dumps({"error": f"Container '{name}' not found"}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def container_stats(name: str) -> str:
    """
    Retrieve real-time resource usage statistics

    Args:
        name: Container name or ID

    Returns:
        JSON string with CPU, memory, network, and block I/O stats
    """
    _ensure_docker()

    try:
        container = docker_client.containers.get(name)
        stats = container.stats(stream=False)

        # Calculate metrics
        cpu_percent = _calculate_cpu_percent(stats)

        memory_stats = stats.get('memory_stats', {})
        memory_usage = memory_stats.get('usage', 0)
        memory_limit = memory_stats.get('limit', 1)
        memory_percent = (memory_usage / memory_limit * 100) if memory_limit > 0 else 0

        networks = stats.get('networks', {})
        network_rx = sum(net.get('rx_bytes', 0) for net in networks.values())
        network_tx = sum(net.get('tx_bytes', 0) for net in networks.values())

        blkio_stats = stats.get('blkio_stats', {}).get('io_service_bytes_recursive', [])
        block_read = sum(stat['value'] for stat in blkio_stats if stat['op'] == 'read')
        block_write = sum(stat['value'] for stat in blkio_stats if stat['op'] == 'write')

        result = {
            "container": name,
            "timestamp": datetime.now().isoformat(),
            "cpu": {
                "percent": round(cpu_percent, 2),
                "system_cpu_usage": stats['cpu_stats'].get('system_cpu_usage', 0),
                "online_cpus": stats['cpu_stats'].get('online_cpus', 1)
            },
            "memory": {
                "usage": _format_bytes(memory_usage),
                "usage_bytes": memory_usage,
                "limit": _format_bytes(memory_limit),
                "limit_bytes": memory_limit,
                "percent": round(memory_percent, 2)
            },
            "network": {
                "rx": _format_bytes(network_rx),
                "rx_bytes": network_rx,
                "tx": _format_bytes(network_tx),
                "tx_bytes": network_tx
            },
            "block_io": {
                "read": _format_bytes(block_read),
                "read_bytes": block_read,
                "write": _format_bytes(block_write),
                "write_bytes": block_write
            }
        }

        return json.dumps(result, indent=2)

    except docker.errors.NotFound:
        return json.dumps({"error": f"Container '{name}' not found"}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def container_exec(name: str, command: str, workdir: Optional[str] = None) -> str:
    """
    Execute commands inside a running container

    Args:
        name: Container name or ID
        command: Command to execute
        workdir: Working directory for the command (optional)

    Returns:
        Command output (stdout and stderr)
    """
    _ensure_docker()

    try:
        container = docker_client.containers.get(name)

        if container.status != 'running':
            return f"Error: Container '{name}' is not running (status: {container.status})"

        kwargs = {}
        if workdir:
            kwargs['workdir'] = workdir

        result = container.exec_run(command, **kwargs)

        output = result.output.decode('utf-8', errors='replace')
        exit_code = result.exit_code

        return f"Exit code: {exit_code}\n\n{output}"

    except docker.errors.NotFound:
        return f"Error: Container '{name}' not found"
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
def container_top(name: str) -> str:
    """
    List processes running inside a container

    Args:
        name: Container name or ID

    Returns:
        JSON string with process list
    """
    _ensure_docker()

    try:
        container = docker_client.containers.get(name)

        if container.status != 'running':
            return json.dumps({"error": f"Container '{name}' is not running"}, indent=2)

        top = container.top()

        result = {
            "container": name,
            "titles": top.get('Titles', []),
            "processes": top.get('Processes', [])
        }

        return json.dumps(result, indent=2)

    except docker.errors.NotFound:
        return json.dumps({"error": f"Container '{name}' not found"}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def image_list(filters: Optional[Dict] = None) -> str:
    """
    List Docker images with optional filtering

    Args:
        filters: Filter results (e.g., {"dangling": "true", "label": "version=1.0"})

    Returns:
        JSON string with list of images
    """
    _ensure_docker()

    try:
        images = docker_client.images.list(filters=filters or {})

        result = []
        for image in images:
            result.append({
                "id": image.short_id.replace('sha256:', ''),
                "tags": image.tags,
                "size": _format_bytes(image.attrs['Size']),
                "size_bytes": image.attrs['Size'],
                "created": image.attrs['Created'],
                "labels": image.labels
            })

        return json.dumps(result, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def image_inspect(name: str) -> str:
    """
    Provide detailed image inspection data

    Args:
        name: Image name or ID

    Returns:
        JSON string with image configuration, layers, and metadata
    """
    _ensure_docker()

    try:
        image = docker_client.images.get(name)
        attrs = image.attrs

        result = {
            "Id": image.short_id.replace('sha256:', ''),
            "Tags": image.tags,
            "Created": attrs.get('Created'),
            "Size": _format_bytes(attrs.get('Size', 0)),
            "Architecture": attrs.get('Architecture'),
            "Os": attrs.get('Os'),
            "Config": {
                "Env": attrs['Config'].get('Env', []),
                "Cmd": attrs['Config'].get('Cmd'),
                "WorkingDir": attrs['Config'].get('WorkingDir'),
                "ExposedPorts": list(attrs['Config'].get('ExposedPorts', {}).keys()),
                "Labels": attrs['Config'].get('Labels', {})
            },
            "Layers": attrs.get('RootFS', {}).get('Layers', [])
        }

        return json.dumps(result, indent=2)

    except docker.errors.ImageNotFound:
        return json.dumps({"error": f"Image '{name}' not found"}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def volume_list() -> str:
    """
    List all Docker volumes

    Returns:
        JSON string with list of volumes
    """
    _ensure_docker()

    try:
        volumes = docker_client.volumes.list()

        result = []
        for volume in volumes:
            result.append({
                "name": volume.name,
                "driver": volume.attrs.get('Driver'),
                "mountpoint": volume.attrs.get('Mountpoint'),
                "created": volume.attrs.get('CreatedAt'),
                "labels": volume.attrs.get('Labels', {})
            })

        return json.dumps(result, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def volume_inspect(name: str) -> str:
    """
    Provide detailed volume inspection data

    Args:
        name: Volume name

    Returns:
        JSON string with volume configuration and metadata
    """
    _ensure_docker()

    try:
        volume = docker_client.volumes.get(name)
        attrs = volume.attrs

        result = {
            "Name": volume.name,
            "Driver": attrs.get('Driver'),
            "Mountpoint": attrs.get('Mountpoint'),
            "CreatedAt": attrs.get('CreatedAt'),
            "Labels": attrs.get('Labels', {}),
            "Options": attrs.get('Options', {}),
            "Scope": attrs.get('Scope')
        }

        return json.dumps(result, indent=2)

    except docker.errors.NotFound:
        return json.dumps({"error": f"Volume '{name}' not found"}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def volume_files(name: str, path: str = "/") -> str:
    """
    List files and directories within a volume using a temporary container

    Args:
        name: Volume name
        path: Path within volume to list (default: "/")

    Returns:
        Directory listing with file details
    """
    _ensure_docker()

    temp_container = None
    try:
        # Verify volume exists
        volume = docker_client.volumes.get(name)

        # Create temporary Alpine container with volume mounted
        temp_container = docker_client.containers.run(
            "alpine:latest",
            command=f"ls -lah {path}",
            volumes={volume.name: {'bind': '/data', 'mode': 'ro'}},
            working_dir="/data",
            remove=False,
            detach=False
        )

        output = temp_container.decode('utf-8', errors='replace')

        return f"Contents of volume '{name}' at path '{path}':\n\n{output}"

    except docker.errors.NotFound:
        return f"Error: Volume '{name}' not found"
    except docker.errors.ContainerError as e:
        return f"Error: {e.stderr.decode('utf-8', errors='replace')}"
    except Exception as e:
        return f"Error: {str(e)}"
    finally:
        # Cleanup temporary container
        if temp_container:
            try:
                docker_client.containers.get(temp_container.id).remove(force=True)
            except Exception as e:
                import logging
                logging.warning(f"Failed to remove temporary container {temp_container.id}: {e}")


@mcp.tool()
def network_list() -> str:
    """
    List all Docker networks

    Returns:
        JSON string with list of networks
    """
    _ensure_docker()

    try:
        networks = docker_client.networks.list()

        result = []
        for network in networks:
            result.append({
                "id": network.short_id,
                "name": network.name,
                "driver": network.attrs.get('Driver'),
                "scope": network.attrs.get('Scope'),
                "created": network.attrs.get('Created'),
                "labels": network.attrs.get('Labels', {})
            })

        return json.dumps(result, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def network_inspect(name: str) -> str:
    """
    Provide detailed network inspection data

    Args:
        name: Network name or ID

    Returns:
        JSON string with network configuration and connected containers
    """
    _ensure_docker()

    try:
        network = docker_client.networks.get(name)
        attrs = network.attrs

        result = {
            "Id": network.short_id,
            "Name": network.name,
            "Driver": attrs.get('Driver'),
            "Scope": attrs.get('Scope'),
            "IPAM": attrs.get('IPAM', {}),
            "Containers": attrs.get('Containers', {}),
            "Options": attrs.get('Options', {}),
            "Labels": attrs.get('Labels', {})
        }

        return json.dumps(result, indent=2)

    except docker.errors.NotFound:
        return json.dumps({"error": f"Network '{name}' not found"}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def network_map() -> str:
    """
    Generate a JSON graph of container network connections

    Returns:
        JSON string with network topology (nodes and edges)
    """
    _ensure_docker()

    try:
        networks = docker_client.networks.list()

        topology = {
            "networks": {},
            "containers": {},
            "connections": []
        }

        for network in networks:
            attrs = network.attrs
            network_name = network.name

            network_info = {
                "id": network.short_id,
                "driver": attrs.get('Driver'),
                "scope": attrs.get('Scope'),
                "containers": []
            }

            ipam = attrs.get('IPAM', {})
            if ipam and ipam.get('Config'):
                network_info['subnet'] = ipam['Config'][0].get('Subnet')
                network_info['gateway'] = ipam['Config'][0].get('Gateway')

            containers = attrs.get('Containers', {})
            for container_id, container_info in containers.items():
                container_name = container_info.get('Name')

                container_data = {
                    "name": container_name,
                    "ip": container_info.get('IPv4Address', '').split('/')[0],
                    "mac": container_info.get('MacAddress')
                }

                network_info['containers'].append(container_data)

                # Track container's networks
                if container_name not in topology['containers']:
                    topology['containers'][container_name] = {
                        "id": container_id[:12],
                        "networks": []
                    }
                topology['containers'][container_name]['networks'].append(network_name)

            topology['networks'][network_name] = network_info

        # Generate connections (containers on same network can communicate)
        for network_name, network_info in topology['networks'].items():
            containers = [c['name'] for c in network_info['containers']]
            for i, c1 in enumerate(containers):
                for c2 in containers[i+1:]:
                    topology['connections'].append({
                        "from": c1,
                        "to": c2,
                        "network": network_name
                    })

        return json.dumps(topology, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def compose_ps(project: Optional[str] = None) -> str:
    """
    List containers for a Docker Compose project

    Args:
        project: Compose project name (defaults to current directory)

    Returns:
        JSON string with list of services and their status
    """
    _ensure_docker()

    try:
        filters = {}
        if project:
            filters['label'] = f'com.docker.compose.project={project}'
        else:
            filters['label'] = 'com.docker.compose.project'

        containers = docker_client.containers.list(all=True, filters=filters)

        result = []
        for container in containers:
            labels = container.labels
            result.append({
                "project": labels.get('com.docker.compose.project'),
                "service": labels.get('com.docker.compose.service'),
                "container_name": container.name,
                "status": container.status,
                "image": container.image.tags[0] if container.image.tags else container.image.short_id,
                "ports": _format_ports(container.ports)
            })

        return json.dumps(result, indent=2)

    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
def compose_logs(project: str, service: Optional[str] = None, tail: int = 100) -> str:
    """
    Retrieve logs from Docker Compose services

    Args:
        project: Compose project name
        service: Specific service name (all services if not specified)
        tail: Number of lines from end (default: 100)

    Returns:
        Service logs as text
    """
    _ensure_docker()

    try:
        filters = {'label': f'com.docker.compose.project={project}'}
        if service:
            filters['label'] = [
                f'com.docker.compose.project={project}',
                f'com.docker.compose.service={service}'
            ]

        containers = docker_client.containers.list(all=True, filters=filters)

        if not containers:
            return f"No containers found for project '{project}'" + (f" service '{service}'" if service else "")

        all_logs = []
        for container in containers:
            service_name = container.labels.get('com.docker.compose.service', 'unknown')
            logs = container.logs(tail=tail).decode('utf-8', errors='replace')
            all_logs.append(f"=== {service_name} ({container.name}) ===\n{logs}\n")

        return "\n".join(all_logs)

    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
def health_check(name: str) -> str:
    """
    Check container health status

    Args:
        name: Container name or ID

    Returns:
        JSON string with health status and details
    """
    _ensure_docker()

    try:
        container = docker_client.containers.get(name)
        attrs = container.attrs

        health = attrs.get('State', {}).get('Health')

        if not health:
            return json.dumps({
                "container": name,
                "status": "no_healthcheck",
                "message": "Container has no health check configured"
            }, indent=2)

        result = {
            "container": name,
            "status": health.get('Status'),
            "failing_streak": health.get('FailingStreak', 0),
            "log": []
        }

        # Get last few health check logs
        for log_entry in health.get('Log', [])[-5:]:
            result['log'].append({
                "start": log_entry.get('Start'),
                "end": log_entry.get('End'),
                "exit_code": log_entry.get('ExitCode'),
                "output": log_entry.get('Output', '').strip()[:200]  # Truncate long output
            })

        return json.dumps(result, indent=2)

    except docker.errors.NotFound:
        return json.dumps({"error": f"Container '{name}' not found"}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


if __name__ == "__main__":
    # Run the MCP server
    mcp.run()
