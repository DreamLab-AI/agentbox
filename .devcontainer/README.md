# Agentbox Dev Container

## Quick Start

1. **VS Code Remote / Codespaces**: Open folder, run `Remote-Containers: Reopen in Container`
2. **First run**: Container executes `nix build .#runtime` (fail-fast if flake.nix is misconfigured)
3. **After attach**: Source aliases: `source config/agentbox-aliases.sh`

## Canonical Ports

| Port | Service | Purpose |
|------|---------|---------|
| 9090 | Management API | Agent coordination |
| 9091 | Agent Portal | Web UI |
| 5901 | VNC | Desktop access |
| 8080 | HTTP | General web |
| 8484 | Solid POD | Sovereign storage |
| 9700 | RuVector | Vector database |
| 8888 | Jupyter | Notebooks |

## Federation Modes

**Standalone** (default — `agentbox.toml`):
```bash
zstack  # Full local stack in Zellij
```

**Client** (federate with host mesh):
1. Edit `agentbox.toml`: set `federation.mode = "client"`
2. Set `adapter_endpoints` to your host mesh
3. `zstack` will use external services

## Zellij Workspace

11-tab layout with sensible defaults:

```bash
zstack        # Launch canonical layout
z ls          # List sessions
z attach -c   # Attach to session
```

Tabs: `claude`, `ruflo`, `qe`, `docs`, `build`, `logs`, `vcs`, `memory`, `llm`, `agents`, `host-shell`

## No Docker Socket Bind

Security: docker.sock is **not mounted**. DinD daemon inside container provides isolation.

## NixOS Flakes

Requires `nix flakes` support. If init fails:
```bash
nix flake update
nix build .#runtime --show-trace
```
