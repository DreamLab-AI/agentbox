#!/usr/bin/env python3
"""
Docker Manager MCP Tool
Manages VisionFlow container from within agentic-workstation via Docker SDK
"""

import json
import sys
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any
import docker
from docker.errors import DockerException, NotFound, APIError

# Configuration
CONFIG_PATH = Path(__file__).parent.parent / "config" / "docker-auth.json"
PROJECT_ROOT = Path("/home/devuser/workspace/project")
LAUNCH_SCRIPT = PROJECT_ROOT / "scripts" / "launch.sh"

def load_config() -> Dict[str, Any]:
    """Load docker-auth.json configuration"""
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        # Default configuration
        return {
            "containers": {
                "visionflow": {
                    "name": "visionflow_container",
                    "network": "docker_ragflow",
                    "image_prefix": "ar-ai-knowledge-graph-webxr"
                }
            },
            "docker_socket": "/var/run/docker.sock",
            "project_path": str(PROJECT_ROOT),
            "launch_script": "scripts/launch.sh"
        }

def get_docker_client() -> docker.DockerClient:
    """Initialize Docker client with socket access"""
    config = load_config()
    try:
        return docker.DockerClient(base_url=f"unix://{config['docker_socket']}")
    except Exception as e:
        raise RuntimeError(f"Failed to connect to Docker socket: {e}")

def find_visionflow_container(client: docker.DockerClient) -> Optional[docker.models.containers.Container]:
    """Find VisionFlow container by name or network"""
    config = load_config()
    container_name = config["containers"]["visionflow"]["name"]

    try:
        # Try by name first
        return client.containers.get(container_name)
    except NotFound:
        # Search by network and image prefix
        network = config["containers"]["visionflow"]["network"]
        image_prefix = config["containers"]["visionflow"]["image_prefix"]

        for container in client.containers.list(all=True):
            networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
            image = container.attrs.get("Config", {}).get("Image", "")

            if network in networks and image_prefix in image:
                return container

        return None

def visionflow_build(no_cache: bool = False, force_rebuild: bool = False, profile: str = "dev") -> Dict[str, Any]:
    """Build VisionFlow container using launch.sh"""
    if not LAUNCH_SCRIPT.exists():
        return {
            "success": False,
            "error": f"Launch script not found at {LAUNCH_SCRIPT}",
            "suggestion": "Ensure project is mounted at /home/devuser/workspace/project"
        }

    cmd = [str(LAUNCH_SCRIPT), "-p", profile, "build"]

    if no_cache:
        cmd.append("--no-cache")
    if force_rebuild:
        cmd.append("--force-rebuild")

    try:
        result = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout
        )

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
            "command": " ".join(cmd)
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Build timed out after 10 minutes",
            "suggestion": "Check Docker daemon status or try with --no-cache"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "command": " ".join(cmd)
        }

def visionflow_up(profile: str = "dev", detached: bool = True) -> Dict[str, Any]:
    """Start VisionFlow container using launch.sh"""
    if not LAUNCH_SCRIPT.exists():
        return {
            "success": False,
            "error": f"Launch script not found at {LAUNCH_SCRIPT}"
        }

    cmd = [str(LAUNCH_SCRIPT), "-p", profile]

    if detached:
        cmd.append("-d")

    cmd.append("up")

    try:
        result = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=120
        )

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
            "command": " ".join(cmd)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def visionflow_down(volumes: bool = False) -> Dict[str, Any]:
    """Stop VisionFlow container using launch.sh"""
    if not LAUNCH_SCRIPT.exists():
        return {
            "success": False,
            "error": f"Launch script not found at {LAUNCH_SCRIPT}"
        }

    cmd = [str(LAUNCH_SCRIPT), "down"]

    if volumes:
        # Pass -v flag to docker-compose via launch.sh
        cmd.append("-v")

    try:
        result = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=60
        )

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def visionflow_restart(rebuild: bool = False, profile: str = "dev") -> Dict[str, Any]:
    """Restart VisionFlow container"""
    results = []

    # Stop container
    down_result = visionflow_down()
    results.append({"operation": "down", "result": down_result})

    if not down_result["success"]:
        return {
            "success": False,
            "error": "Failed to stop container",
            "details": results
        }

    # Optional rebuild
    if rebuild:
        build_result = visionflow_build(profile=profile)
        results.append({"operation": "build", "result": build_result})

        if not build_result["success"]:
            return {
                "success": False,
                "error": "Build failed during restart",
                "details": results
            }

    # Start container
    up_result = visionflow_up(profile=profile)
    results.append({"operation": "up", "result": up_result})

    return {
        "success": up_result["success"],
        "operations": results
    }

def visionflow_logs(lines: int = 100, follow: bool = False, timestamps: bool = True) -> Dict[str, Any]:
    """Get logs from VisionFlow container"""
    try:
        client = get_docker_client()
        container = find_visionflow_container(client)

        if not container:
            return {
                "success": False,
                "error": "VisionFlow container not found",
                "suggestion": "Use container_discover to list available containers"
            }

        logs = container.logs(
            tail=lines,
            timestamps=timestamps,
            stream=follow
        )

        if follow:
            # Return generator for streaming
            return {
                "success": True,
                "streaming": True,
                "logs": logs
            }
        else:
            return {
                "success": True,
                "container": container.name,
                "logs": logs.decode('utf-8') if isinstance(logs, bytes) else str(logs),
                "lines": lines
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def visionflow_status() -> Dict[str, Any]:
    """Get comprehensive status of VisionFlow container"""
    try:
        client = get_docker_client()
        container = find_visionflow_container(client)

        if not container:
            return {
                "success": False,
                "error": "VisionFlow container not found"
            }

        # Reload to get fresh stats
        container.reload()

        attrs = container.attrs
        state = attrs.get("State", {})
        network_settings = attrs.get("NetworkSettings", {})

        # Get resource stats (non-blocking)
        try:
            stats = container.stats(stream=False)
            cpu_percent = calculate_cpu_percent(stats)
            memory_usage = stats.get("memory_stats", {}).get("usage", 0)
            memory_limit = stats.get("memory_stats", {}).get("limit", 0)
            memory_percent = (memory_usage / memory_limit * 100) if memory_limit > 0 else 0
        except:
            cpu_percent = 0
            memory_usage = 0
            memory_percent = 0

        return {
            "success": True,
            "container": {
                "id": container.id[:12],
                "name": container.name,
                "status": container.status,
                "state": {
                    "running": state.get("Running", False),
                    "paused": state.get("Paused", False),
                    "restarting": state.get("Restarting", False),
                    "exit_code": state.get("ExitCode", 0),
                    "started_at": state.get("StartedAt"),
                    "finished_at": state.get("FinishedAt")
                },
                "health": state.get("Health", {}).get("Status", "none"),
                "image": attrs.get("Config", {}).get("Image"),
                "ports": network_settings.get("Ports", {}),
                "networks": list(network_settings.get("Networks", {}).keys()),
                "resources": {
                    "cpu_percent": round(cpu_percent, 2),
                    "memory_usage_mb": round(memory_usage / 1024 / 1024, 2),
                    "memory_percent": round(memory_percent, 2)
                }
            }
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def calculate_cpu_percent(stats: Dict) -> float:
    """Calculate CPU percentage from Docker stats"""
    try:
        cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - \
                   stats["precpu_stats"]["cpu_usage"]["total_usage"]
        system_delta = stats["cpu_stats"]["system_cpu_usage"] - \
                      stats["precpu_stats"]["system_cpu_usage"]
        cpu_count = stats["cpu_stats"].get("online_cpus", 1)

        if system_delta > 0 and cpu_delta > 0:
            return (cpu_delta / system_delta) * cpu_count * 100.0
    except (KeyError, ZeroDivisionError):
        pass
    return 0.0

def docker_exec(command: str, workdir: str = "/app", user: Optional[str] = None) -> Dict[str, Any]:
    """Execute command in VisionFlow container"""
    try:
        client = get_docker_client()
        container = find_visionflow_container(client)

        if not container:
            return {
                "success": False,
                "error": "VisionFlow container not found"
            }

        if container.status != "running":
            return {
                "success": False,
                "error": f"Container is not running (status: {container.status})"
            }

        exec_result = container.exec_run(
            command,
            workdir=workdir,
            user=user,
            demux=True
        )

        stdout = exec_result.output[0].decode('utf-8') if exec_result.output[0] else ""
        stderr = exec_result.output[1].decode('utf-8') if exec_result.output[1] else ""

        return {
            "success": exec_result.exit_code == 0,
            "exit_code": exec_result.exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "command": command
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def container_discover() -> Dict[str, Any]:
    """Discover all containers on docker_ragflow network"""
    try:
        client = get_docker_client()
        config = load_config()
        network_name = config["containers"]["visionflow"]["network"]

        # Get network
        try:
            network = client.networks.get(network_name)
        except NotFound:
            return {
                "success": False,
                "error": f"Network '{network_name}' not found",
                "available_networks": [n.name for n in client.networks.list()]
            }

        # Get all containers in network
        containers = []
        for container in client.containers.list(all=True):
            networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})

            if network_name in networks:
                network_info = networks[network_name]
                containers.append({
                    "id": container.id[:12],
                    "name": container.name,
                    "status": container.status,
                    "image": container.attrs.get("Config", {}).get("Image"),
                    "ip_address": network_info.get("IPAddress"),
                    "ports": container.attrs.get("NetworkSettings", {}).get("Ports", {})
                })

        return {
            "success": True,
            "network": network_name,
            "container_count": len(containers),
            "containers": containers
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    """MCP tool entry point"""
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "No operation specified",
            "usage": "docker_manager.py <operation> [args...]",
            "operations": [
                "visionflow_build",
                "visionflow_up",
                "visionflow_down",
                "visionflow_restart",
                "visionflow_logs",
                "visionflow_status",
                "docker_exec",
                "container_discover"
            ]
        }))
        sys.exit(1)

    operation = sys.argv[1]
    args = sys.argv[2:] if len(sys.argv) > 2 else []

    # Parse arguments as JSON if provided
    kwargs = {}
    if args:
        try:
            kwargs = json.loads(args[0])
        except json.JSONDecodeError:
            pass

    # Execute operation
    operations = {
        "visionflow_build": visionflow_build,
        "visionflow_up": visionflow_up,
        "visionflow_down": visionflow_down,
        "visionflow_restart": visionflow_restart,
        "visionflow_logs": visionflow_logs,
        "visionflow_status": visionflow_status,
        "docker_exec": docker_exec,
        "container_discover": container_discover
    }

    if operation not in operations:
        print(json.dumps({
            "error": f"Unknown operation: {operation}",
            "available": list(operations.keys())
        }))
        sys.exit(1)

    try:
        result = operations[operation](**kwargs)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "operation": operation
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
