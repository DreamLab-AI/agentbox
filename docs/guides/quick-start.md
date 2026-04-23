# Quick Start

## 1. Configure Features

Edit [`agentbox.toml`](../../agentbox.toml) before building. This file controls package groups, sovereign services, desktop mode, and optional skills.

## 2. Build

```bash
nix build .#runtime
docker load < result
```

For desktop support:

```bash
nix build .#desktop
docker load < result
```

## 3. Run

```bash
cp .env.example .env
docker compose up -d
```

## 4. Verify

```bash
curl http://localhost:9090/health
curl http://localhost:9700/health
curl http://localhost:8484/health
docker exec agentbox supervisorctl status
docker exec -it agentbox zellij --version
docker exec -it agentbox /opt/agentbox/scripts/zellij-stack.sh ruflo-orchestrator
```

## 5. Persistent State

- RuVector: `/var/lib/ruvector`
- Solid-style pod storage: `/var/lib/solid`
- Sovereign identities: `/var/lib/agentbox/identities`
- Workspace: `/workspace`
