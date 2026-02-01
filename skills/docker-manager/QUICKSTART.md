# Docker Manager - Quick Start Guide

## Installation

The skill is automatically installed when you build the agentic-workstation container.

To rebuild with the new skill:

```bash
cd /mnt/mldata/githubs/AR-AI-Knowledge-Graph/multi-agent-docker
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Verification

From inside the agentic-workstation container:

```bash
# SSH into container
ssh devuser@localhost -p 2222
# Password: turboflow

# Or docker exec
docker exec -it agentic-workstation /bin/zsh

# Run tests
/home/devuser/.claude/skills/docker-manager/test-skill.sh
```

## Usage From Claude Code

Once inside the container with Claude Code:

```
Use Docker Manager to check VisionFlow status
```

```
Use Docker Manager to build and restart VisionFlow in dev mode
```

```
Use Docker Manager to show the last 50 lines of VisionFlow logs
```

```
Use Docker Manager to execute "npm run test" in VisionFlow
```

## Direct Command Line Usage

```bash
# Add to PATH (optional)
export PATH="/home/devuser/.claude/skills/docker-manager/tools:$PATH"

# Quick status check
visionflow_ctl.sh status

# Build and restart
visionflow_ctl.sh down
visionflow_ctl.sh build --no-cache
visionflow_ctl.sh up -p dev

# View logs
visionflow_ctl.sh logs -n 100 -f

# Execute command
visionflow_ctl.sh exec "npm run test:unit"
```

## Common Workflows

### Development Cycle

1. Edit code in `/home/devuser/workspace/project/`
2. Use Docker Manager: `visionflow_ctl.sh restart --rebuild`
3. Check logs: `visionflow_ctl.sh logs -f`
4. Test: `visionflow_ctl.sh exec "npm run test"`

### Debug Container Issues

```bash
visionflow_ctl.sh status          # Check if running
visionflow_ctl.sh logs -n 200     # View recent logs
visionflow_ctl.sh discover        # List all containers
docker network inspect docker_ragflow  # Check network
```

### Full Rebuild

```bash
visionflow_ctl.sh down --volumes  # Stop and remove volumes
visionflow_ctl.sh build --no-cache --force-rebuild
visionflow_ctl.sh up -p dev
visionflow_ctl.sh status
```

## Troubleshooting

### Docker Socket Permission Denied

```bash
sudo chmod 666 /var/run/docker.sock
# or
sudo usermod -aG docker devuser
exec zsh
```

### Python Dependencies Missing

```bash
pip3 install docker --break-system-packages
```

### Container Not Found

```bash
docker ps -a | grep visionflow
visionflow_ctl.sh discover
```

## Integration with launch.sh

The skill wraps the existing `scripts/launch.sh`:

| Skill Command | launch.sh Equivalent |
|--------------|---------------------|
| `visionflow_ctl.sh build` | `./scripts/launch.sh build` |
| `visionflow_ctl.sh up -p dev` | `./scripts/launch.sh -p dev up` |
| `visionflow_ctl.sh down` | `./scripts/launch.sh down` |
| `visionflow_ctl.sh restart` | `./scripts/launch.sh restart` |

## Architecture Summary

```
┌─────────────────────────────────────┐
│   Your Machine (Host)               │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ agentic-workstation           │ │
│  │                               │ │
│  │  Claude Code + Docker Manager │ │
│  │  ↓                            │ │
│  │  /var/run/docker.sock ────────┼─┼─→ Docker Daemon
│  │  /home/devuser/workspace/     │ │     ↓
│  │    project/scripts/launch.sh  │ │     Controls
│  └───────────────────────────────┘ │     ↓
│                                     │  ┌──────────────┐
│                                     │  │ visionflow_  │
│                                     │  │ container    │
│                                     │  └──────────────┘
└─────────────────────────────────────┘
```

## Next Steps

1. **Verify Installation**: Run `test-skill.sh`
2. **Try Status Check**: `visionflow_ctl.sh status`
3. **Test Build**: `visionflow_ctl.sh build` (optional)
4. **Use with Claude**: "Use Docker Manager to check VisionFlow"

## Reference

- Full documentation: `SKILL.md`
- Developer guide: `README.md`
- Configuration: `config/docker-auth.json`
- Test suite: `test-skill.sh`
