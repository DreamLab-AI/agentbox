# Multi-Repo Configuration & Patterns

Config files, repository roles, communication strategies, synchronization
consistency models, and reference architecture layouts.

## Configuration

### Multi-Repo Config File
```yaml
# .swarm/multi-repo.yml
version: 1
organization: my-org

repositories:
  - name: frontend
    url: github.com/my-org/frontend
    role: ui
    agents: [coder, designer, tester]

  - name: backend
    url: github.com/my-org/backend
    role: api
    agents: [architect, coder, tester]

  - name: shared
    url: github.com/my-org/shared
    role: library
    agents: [analyst, coder]

coordination:
  topology: hierarchical
  communication: webhook
  memory: redis://shared-memory

dependencies:
  - from: frontend
    to: [backend, shared]
  - from: backend
    to: [shared]
```

### Repository Roles
```javascript
{
  "roles": {
    "ui": {
      "responsibilities": ["user-interface", "ux", "accessibility"],
      "default-agents": ["designer", "coder", "tester"]
    },
    "api": {
      "responsibilities": ["endpoints", "business-logic", "data"],
      "default-agents": ["architect", "coder", "security"]
    },
    "library": {
      "responsibilities": ["shared-code", "utilities", "types"],
      "default-agents": ["analyst", "coder", "documenter"]
    }
  }
}
```

## Communication Strategies

### 1. Webhook-Based Coordination
```javascript
const { MultiRepoSwarm } = require('ruv-swarm');

const swarm = new MultiRepoSwarm({
  webhook: {
    url: 'https://swarm-coordinator.example.com',
    secret: process.env.WEBHOOK_SECRET
  }
});

swarm.on('repo:update', async (event) => {
  await swarm.propagate(event, {
    to: event.dependencies,
    strategy: 'eventual-consistency'
  });
});
```

### 2. Event Streaming
```yaml
# Kafka configuration for real-time coordination
kafka:
  brokers: ['kafka1:9092', 'kafka2:9092']
  topics:
    swarm-events:
      partitions: 10
      replication: 3
    swarm-memory:
      partitions: 5
      replication: 3
```

## Synchronization Patterns

### 1. Eventually Consistent
```javascript
{
  "sync": {
    "strategy": "eventual",
    "max-lag": "5m",
    "retry": {
      "attempts": 3,
      "backoff": "exponential"
    }
  }
}
```

### 2. Strong Consistency
```javascript
{
  "sync": {
    "strategy": "strong",
    "consensus": "raft",
    "quorum": 0.51,
    "timeout": "30s"
  }
}
```

### 3. Hybrid Approach
```javascript
{
  "sync": {
    "default": "eventual",
    "overrides": {
      "security-updates": "strong",
      "dependency-updates": "strong",
      "documentation": "eventual"
    }
  }
}
```

## Architecture Patterns

### Monorepo Structure
```
ruv-FANN/
├── packages/
│   ├── claude-code-flow/
│   │   ├── src/
│   │   ├── .claude/
│   │   └── package.json
│   ├── ruv-swarm/
│   │   ├── src/
│   │   ├── wasm/
│   │   └── package.json
│   └── shared/
│       ├── types/
│       ├── utils/
│       └── config/
├── tools/
│   ├── build/
│   ├── test/
│   └── deploy/
├── docs/
│   ├── architecture/
│   ├── integration/
│   └── examples/
└── .github/
    ├── workflows/
    ├── templates/
    └── actions/
```

### Command Structure
```
.claude/
├── commands/
│   ├── github/
│   │   ├── github-modes.md
│   │   ├── pr-manager.md
│   │   ├── issue-tracker.md
│   │   └── sync-coordinator.md
│   ├── sparc/
│   │   ├── sparc-modes.md
│   │   ├── coder.md
│   │   └── tester.md
│   └── swarm/
│       ├── coordination.md
│       └── orchestration.md
├── templates/
│   ├── issue.md
│   ├── pr.md
│   └── project.md
└── config.json
```
