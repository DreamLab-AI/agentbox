---
name: Docker Manager
description: Manage VisionFlow container from within agentic-workstation via Docker API and launch.sh wrapper
---

# Docker Manager Skill

This skill enables Claude Code running inside the agentic-workstation container to manage the VisionFlow application container through Docker socket access and mounted project scripts.

## Capabilities

- **Container Lifecycle**: Start, stop, restart, rebuild VisionFlow container
- **Launch Script Integration**: Execute `scripts/launch.sh` commands (build, up, down, restart)
- **Container Monitoring**: Check status, health, logs, resource usage
- **Direct Execution**: Run commands inside VisionFlow container
- **Network Discovery**: Auto-detect containers on docker_ragflow network

## When to Use This Skill

Use this skill when you need to:
- Build and deploy VisionFlow application changes
- Restart VisionFlow after code modifications
- Check container health and logs
- Execute commands in the VisionFlow runtime environment
- Test end-to-end system functionality
- Debug container networking or startup issues

## Architecture

```
┌─────────────────────────────────────┐
│   agentic-workstation container     │
│  (Claude Code + Docker Manager)     │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ /var/run/docker.sock (host)  │  │
│  │ /home/devuser/workspace/     │  │
│  │   project/scripts/launch.sh  │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
           │                │
           │ Docker API     │ Script Exec
           ▼                ▼
┌─────────────────────────────────────┐
│      visionflow_container           │
│   (VisionFlow Application)          │
│                                     │
│  Ports: 3001 (dev)                  │
│  Network: docker_ragflow            │
└─────────────────────────────────────┘
```

## Tool Functions

### `visionflow_build`
Build VisionFlow container with optional flags.

Parameters:
- `no_cache` (optional): boolean - Build without cache (default: false)
- `force_rebuild` (optional): boolean - Force complete rebuild (default: false)
- `profile` (optional): "dev" | "production" (default: "dev")

Example:
```
Use Docker Manager to build VisionFlow with no cache
```

### `visionflow_up`
Start VisionFlow container (detached mode).

Parameters:
- `profile` (optional): "dev" | "production" (default: "dev")
- `detached` (optional): boolean - Run in background (default: true)

Example:
```
Start VisionFlow in development mode
```

### `visionflow_down`
Stop and remove VisionFlow container.

Parameters:
- `volumes` (optional): boolean - Remove volumes too (default: false)

Example:
```
Stop VisionFlow container
```

### `visionflow_restart`
Restart VisionFlow (down → up cycle).

Parameters:
- `rebuild` (optional): boolean - Rebuild before restart (default: false)
- `profile` (optional): "dev" | "production" (default: "dev")

Example:
```
Restart VisionFlow with rebuild
```

### `visionflow_logs`
Stream logs from VisionFlow container.

Parameters:
- `lines` (optional): number - Number of lines to show (default: 100)
- `follow` (optional): boolean - Follow log output (default: false)
- `timestamps` (optional): boolean - Show timestamps (default: true)

Example:
```
Show last 50 lines of VisionFlow logs
```

### `visionflow_status`
Get comprehensive status of VisionFlow container.

Returns:
- Container state (running, stopped, restarting)
- Health check status
- Uptime
- Resource usage (CPU, memory)
- Port mappings
- Network info

Example:
```
Check VisionFlow container status
```

### `docker_exec`
Execute arbitrary command in VisionFlow container.

Parameters:
- `command` (required): string - Command to execute
- `workdir` (optional): string - Working directory (default: /app)
- `user` (optional): string - User to run as (default: container default)

Example:
```
Execute "npm run test" in VisionFlow container
```

### `container_discover`
Discover and list all containers on docker_ragflow network.

Returns:
- Container names, IDs, status
- Network connections
- Port mappings

Example:
```
List all containers in docker_ragflow network
```

## Technical Implementation

### Docker Socket Access
The skill uses the host's Docker socket mounted at `/var/run/docker.sock` in the agentic-workstation container. The devuser (UID 1000) is in the docker group, providing full Docker API access.

### Launch Script Execution
The VisionFlow project repository is mounted at `/home/devuser/workspace/project/` inside agentic-workstation. The skill executes `scripts/launch.sh` directly from this path:

```bash
cd /home/devuser/workspace/project
./scripts/launch.sh build --no-cache
./scripts/launch.sh up -d
./scripts/launch.sh status
```

### Container Targeting
The skill identifies the VisionFlow container by:
1. Container name: `visionflow_container`
2. Network membership: `docker_ragflow`
3. Image prefix: `ar-ai-knowledge-graph-webxr`

### Error Handling
- Docker socket unavailable → Fallback to docker CLI commands
- Container not found → Helpful error with discovery suggestions
- Network issues → Retry with exponential backoff
- Build failures → Parse and return structured error info

## Integration with Development Workflow

### Typical Development Cycle

1. **Make Code Changes** (in project repository)
   ```
   Claude edits files in /mnt/mldata/githubs/AR-AI-Knowledge-Graph/
   ```

2. **Rebuild Container**
   ```
   Use Docker Manager to rebuild VisionFlow with no cache
   ```

3. **Restart Application**
   ```
   Restart VisionFlow in dev mode
   ```

4. **Check Status**
   ```
   Show VisionFlow status and recent logs
   ```

5. **Test Functionality**
   ```
   Execute "npm run test" in VisionFlow
   ```

### Example: Full Deployment Workflow

```
I've updated the Rust backend. Please:
1. Use Docker Manager to stop VisionFlow
2. Rebuild VisionFlow with the latest changes
3. Start VisionFlow in dev mode
4. Stream logs for 30 seconds to verify startup
5. Check container health status
```

## Configuration

### docker-auth.json
Stores container mappings and access credentials:

```json
{
  "containers": {
    "visionflow": {
      "name": "visionflow_container",
      "network": "docker_ragflow",
      "image_prefix": "ar-ai-knowledge-graph-webxr"
    }
  },
  "docker_socket": "/var/run/docker.sock",
  "project_path": "/home/devuser/workspace/project",
  "launch_script": "scripts/launch.sh"
}
```

### Environment Variables

Set in agentic-workstation:
- `DOCKER_HOST`: unix:///var/run/docker.sock (default)
- `VISIONFLOW_PROFILE`: dev | production (default: dev)

## Security Considerations

- Docker socket access provides full host Docker control
- Restricted to devuser (UID 1000) with sudo capabilities
- Container operations isolated to docker_ragflow network
- No external network access required
- All operations logged for audit trail

## Troubleshooting

### Docker Socket Permission Denied
```bash
# Inside agentic-workstation
sudo chmod 666 /var/run/docker.sock
# or
sudo usermod -aG docker devuser
```

### Container Not Found
```bash
# Use container discovery
docker ps -a | grep visionflow
docker network inspect docker_ragflow
```

### Launch Script Failures
```bash
# Check script is executable
ls -la /home/devuser/workspace/project/scripts/launch.sh
chmod +x /home/devuser/workspace/project/scripts/launch.sh
```

### Build Hangs
```bash
# Check Docker daemon status
docker info
# Clear build cache
docker builder prune -f
```

## Performance Notes

- Build time: ~2-5 minutes (depending on cache)
- Container start: ~5-10 seconds
- Log streaming: Real-time (negligible overhead)
- Status checks: <1 second

## Examples

### Example 1: Quick Restart After Code Change
```
I just updated backend/src/main.rs. Please restart VisionFlow to test the changes.
```

Docker Manager will:
1. Execute `./scripts/launch.sh restart -p dev`
2. Wait for container to be healthy
3. Show startup logs
4. Report success/failure

### Example 2: Full Rebuild and Deploy
```
Use Docker Manager to:
1. Stop VisionFlow
2. Build with --no-cache and --force-rebuild
3. Start in development mode
4. Monitor logs for errors
```

### Example 3: Debug Container Issues
```
VisionFlow won't start. Please:
1. Check container status
2. Show last 200 log lines
3. Inspect network connectivity
4. Report any errors found
```

### Example 4: Execute Tests in Container
```
Run the full test suite inside VisionFlow:
docker_exec: "npm run test:all"
```

## Related Skills

Works well with:
- `filesystem` - Edit code before rebuilding
- `git` - Commit changes before deployment
- `playwright` - Test UI after container restart
- `web-summary` - Document deployment process

## Future Enhancements

- [ ] Automatic rollback on failed deployments
- [ ] Multi-container orchestration (db, redis, etc.)
- [ ] Performance metrics collection
- [ ] Blue-green deployment support
- [ ] Container health auto-recovery
