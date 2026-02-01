# Quick Start Guide

Get Agentbox running in under 5 minutes.

## Prerequisites

```mermaid
graph LR
    NIX[Nix with Flakes] --> BUILD[Build Image]
    DOCKER[Docker] --> RUN[Run Container]
    BUILD --> RUN
    RUN --> USE[Use Agentbox]

    style NIX fill:#5277c3,color:#fff
    style DOCKER fill:#2496ed,color:#fff
    style USE fill:#10b981,color:#fff
```

### Install Nix

```bash
# Linux/macOS
curl -L https://nixos.org/nix/install | sh

# Enable flakes
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

### Install Docker

Follow instructions at [docker.com](https://docs.docker.com/get-docker/).

## Build

```mermaid
flowchart LR
    subgraph "Build Options"
        R[runtime<br/>Headless]
        F[full<br/>Combined]
        D[desktop<br/>VNC Support]
    end

    SRC[Source] --> R & F & D
    R --> IMG1[agentbox:runtime]
    F --> IMG2[agentbox:full]
    D --> IMG3[agentbox:desktop]

    style R fill:#10b981,color:#fff
    style F fill:#8b5cf6,color:#fff
    style D fill:#f59e0b,color:#fff
```

```bash
# Clone
git clone https://github.com/DreamLab-AI/agentbox.git
cd agentbox

# Build runtime image (recommended)
nix build .#runtime

# Load into Docker
docker load < result
```

## Run

### Basic

```bash
docker run -d \
  --name agentbox \
  -p 22:22 \
  -p 9090:9090 \
  -p 9700:9700 \
  agentbox:runtime-aarch64-linux
```

### With Environment

```bash
docker run -d \
  --name agentbox \
  -p 22:22 \
  -p 9090:9090 \
  -p 9700:9700 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e GITHUB_TOKEN=ghp_... \
  -v ./workspace:/workspace \
  agentbox:runtime-aarch64-linux
```

### Docker Compose

```bash
cp .env.example .env
# Edit .env with your API keys
docker-compose up -d
```

## Verify

```mermaid
sequenceDiagram
    participant You
    participant Container
    participant Services

    You->>Container: docker exec agentbox supervisorctl status
    Container->>Services: Check all services
    Services-->>Container: Status report
    Container-->>You: Running services list

    You->>Container: curl localhost:9090/health
    Container-->>You: {"status": "healthy"}
```

```bash
# Check services
docker exec agentbox supervisorctl status

# Test Management API
curl http://localhost:9090/health

# Test RuVector
curl http://localhost:9700/health
```

## Connect

### SSH

```bash
ssh devuser@localhost -p 22
# Default password: See .env.example
```

### Claude Flow

```bash
# Inside container
npx claude-flow@v3alpha swarm init --topology mesh
npx claude-flow@v3alpha swarm status
```

### RuVector

```bash
# Start RuVector MCP for Claude integration
npx ruvector mcp --port 9701
```

## Next Steps

```mermaid
graph TB
    START[Quick Start Complete] --> A[Configure Skills]
    START --> B[Set Up Swarm]
    START --> C[Enable Guidance]

    A --> A1[Edit CLAUDE.md]
    A --> A2[Review skills/]

    B --> B1[Initialize Topology]
    B --> B2[Spawn Agents]

    C --> C1[Compile Constitution]
    C --> C2[Enable Gates]

    style START fill:#10b981,color:#fff
```

- **[Configure Skills](./configure-skills.md)** — Customize the 55 available skills
- **[Swarm Setup](./swarm-setup.md)** — Multi-agent orchestration
- **[Guidance Control Plane](./guidance-setup.md)** — Enable extended autonomy
