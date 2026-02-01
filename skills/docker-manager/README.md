# Docker Manager Skill

Inter-container Docker management skill for controlling VisionFlow from agentic-workstation.

## Quick Start

### From Claude Code (inside agentic-workstation)

```
Use Docker Manager to build and start VisionFlow in dev mode
```

### From Shell (inside agentic-workstation)

```bash
# Using the wrapper script
/home/devuser/.claude/skills/docker-manager/tools/visionflow_ctl.sh status

# Using Python tool directly
python3 /home/devuser/.claude/skills/docker-manager/tools/docker_manager.py visionflow_status '{}'
```

## Installation

The skill is automatically installed to `/home/devuser/.claude/skills/docker-manager/` when the agentic-workstation container is built.

### Manual Installation (if needed)

```bash
# Inside agentic-workstation
cd /home/devuser/.claude/skills
cp -r /home/devuser/workspace/project/multi-agent-docker/skills/docker-manager .
chmod +x docker-manager/tools/*.py docker-manager/tools/*.sh
```

## Usage Examples

### 1. Check VisionFlow Status
```bash
visionflow_ctl.sh status
```

### 2. Build VisionFlow
```bash
# Standard build
visionflow_ctl.sh build

# Build without cache
visionflow_ctl.sh build --no-cache

# Force rebuild
visionflow_ctl.sh build --force-rebuild
```

### 3. Start VisionFlow
```bash
# Development mode (detached)
visionflow_ctl.sh up -p dev

# Production mode
visionflow_ctl.sh up -p production
```

### 4. Restart VisionFlow
```bash
# Simple restart
visionflow_ctl.sh restart

# Restart with rebuild
visionflow_ctl.sh restart --rebuild
```

### 5. View Logs
```bash
# Last 100 lines
visionflow_ctl.sh logs

# Last 50 lines
visionflow_ctl.sh logs -n 50

# Follow logs (real-time)
visionflow_ctl.sh logs -f
```

### 6. Execute Commands in VisionFlow
```bash
# Run tests
visionflow_ctl.sh exec "npm run test"

# Check Node version
visionflow_ctl.sh exec "node --version"

# Custom workdir
visionflow_ctl.sh exec "ls -la" -w /app/backend
```

### 7. Discover Network Containers
```bash
visionflow_ctl.sh discover
```

## Claude Code Integration

### Natural Language Examples

**Scenario 1: Development Workflow**
```
I've updated the Rust backend code. Please:
1. Use Docker Manager to rebuild VisionFlow with no cache
2. Restart the container in dev mode
3. Check the logs for any startup errors
4. Report the container status
```

**Scenario 2: Quick Test**
```
Use Docker Manager to execute "npm run test:unit" in VisionFlow and show me the results
```

**Scenario 3: Debug Container**
```
VisionFlow isn't responding. Please use Docker Manager to:
- Check container status and health
- Show the last 100 log lines
- Check if the container is running
```

**Scenario 4: Full Deployment**
```
Deploy the latest changes to VisionFlow:
1. Stop the current container
2. Build with force rebuild
3. Start in production mode
4. Verify it's healthy and running
```

## Architecture

### File Structure
```
docker-manager/
├── SKILL.md                 # Skill documentation (for Claude)
├── README.md               # This file (for developers)
├── config/
│   └── docker-auth.json    # Container mappings and config
└── tools/
    ├── docker_manager.py   # Python Docker SDK client
    └── visionflow_ctl.sh   # Zsh wrapper script
```

### How It Works

1. **Docker Socket Access**: Both containers (agentic-workstation and visionflow_container) run on the same Docker host with access to `/var/run/docker.sock`

2. **Shared Project Mount**: The VisionFlow project is mounted at `/home/devuser/workspace/project/` inside agentic-workstation, providing access to `scripts/launch.sh`

3. **Network Discovery**: Containers communicate via the `docker_ragflow` bridge network

4. **Python Docker SDK**: The `docker_manager.py` tool uses the official Docker Python SDK for container operations

5. **Launch Script Integration**: For build/up/down operations, the skill executes the existing `scripts/launch.sh` via subprocess

### Authentication Flow

```
Claude Code Request
       ↓
docker_manager.py (Python)
       ↓
Docker Socket (/var/run/docker.sock)
       ↓
Docker Daemon (host)
       ↓
visionflow_container (target)
```

No SSH, no remote access, no API keys needed - just Docker socket permissions via the docker group.

## Configuration

### docker-auth.json

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

Set these in agentic-workstation (optional):

```bash
export VISIONFLOW_PROFILE=dev          # Default profile
export DOCKER_HOST=unix:///var/run/docker.sock  # Docker socket
```

## Troubleshooting

### Issue: "Docker socket not accessible"

```bash
# Check socket exists
ls -la /var/run/docker.sock

# Check permissions
stat /var/run/docker.sock

# Verify user is in docker group
groups devuser

# Add user to docker group (if needed)
sudo usermod -aG docker devuser

# Restart shell
exec zsh
```

### Issue: "Container not found"

```bash
# List all containers
docker ps -a

# Check network
docker network inspect docker_ragflow

# Use discovery tool
visionflow_ctl.sh discover
```

### Issue: "Launch script not found"

```bash
# Check mount
ls -la /home/devuser/workspace/project/scripts/launch.sh

# Verify project mount in docker-compose
docker inspect agentic-workstation | grep -A5 Mounts
```

### Issue: "Python dependencies missing"

```bash
# Install Docker SDK
pip3 install docker --break-system-packages

# Or use venv
python3 -m venv /opt/venv
/opt/venv/bin/pip install docker
```

## Testing

### Basic Test Suite

```bash
# 1. Check Docker access
docker ps

# 2. Test container discovery
python3 docker_manager.py container_discover '{}'

# 3. Test status check
python3 docker_manager.py visionflow_status '{}'

# 4. Test wrapper script
visionflow_ctl.sh status

# 5. Full cycle test (if safe)
visionflow_ctl.sh down
visionflow_ctl.sh build
visionflow_ctl.sh up
visionflow_ctl.sh status
```

### Integration Test

```bash
# Run from agentic-workstation
cd /home/devuser/.claude/skills/docker-manager/tools

# Test all operations
./visionflow_ctl.sh discover
./visionflow_ctl.sh status
./visionflow_ctl.sh logs -n 20
./visionflow_ctl.sh exec "echo 'Hello from VisionFlow'"
```

## Performance

- **Container Discovery**: <1 second
- **Status Check**: <1 second
- **Build**: 2-5 minutes (depending on cache)
- **Start/Stop**: 5-10 seconds
- **Log Retrieval**: <1 second for 1000 lines

## Security Considerations

1. **Docker Socket Access**: Full Docker daemon access - use with caution
2. **User Isolation**: Operations run as devuser (UID 1000)
3. **Network Isolation**: Containers on docker_ragflow network only
4. **No Remote Access**: All operations local to Docker host
5. **Audit Trail**: All operations can be logged

## Future Enhancements

- [ ] Container health auto-recovery
- [ ] Automated rollback on failed deployments
- [ ] Multi-container orchestration
- [ ] Performance metrics collection
- [ ] Blue-green deployment support
- [ ] Container snapshot/restore
- [ ] Automated testing integration
- [ ] Slack/Discord notifications

## Support

For issues or questions:
1. Check container logs: `visionflow_ctl.sh logs -n 100`
2. Check Docker daemon: `docker info`
3. Verify network: `docker network inspect docker_ragflow`
4. Review SKILL.md for Claude Code usage

## License

Part of the AR-AI-Knowledge-Graph project.
