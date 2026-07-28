# Reinforcement Learning Plugins

*RL capabilities merged from agentdb-learning. Use to build self-improving agents trained through experience.*

## Quick Start

```bash
# Interactive wizard
npx agentdb@latest create-plugin

# Use specific template (recommended: decision-transformer)
npx agentdb@latest create-plugin -t decision-transformer -n my-agent

# Preview without creating
npx agentdb@latest create-plugin -t q-learning --dry-run
```

## Available Algorithms (9 Total)

| Algorithm | Type | Best For |
|-----------|------|----------|
| **Decision Transformer** *(recommended)* | Offline RL | Logged experience, imitation learning, safe training |
| **Q-Learning** | Value-Based (Off-Policy) | Discrete actions, navigation, resource allocation |
| **SARSA** | Value-Based (On-Policy) | Safety-critical, risk-sensitive tasks |
| **Actor-Critic** | Policy Gradient | Continuous control, continuous/discrete action spaces |
| **Active Learning** | Query-Based | Human-in-the-loop, label-efficient training |
| **Adversarial Training** | Robustness | Security, adversarial defence, safety testing |
| **Curriculum Learning** | Progressive Difficulty | Complex multi-stage tasks, hard exploration |
| **Federated Learning** | Distributed | Privacy-preserving, multi-agent collaborative training |
| **Multi-Task Learning** | Transfer | Task families, domain adaptation, meta-learning |

## Training API

```typescript
import { createAgentDBAdapter } from 'agentic-flow/reasoningbank';

const adapter = await createAgentDBAdapter({
  dbPath: '.agentdb/learning.db',
  enableLearning: true,
  enableReasoning: true,
  cacheSize: 1000,
});

// Store experiences during agent execution
await adapter.insertPattern({
  id: '',
  type: 'experience',
  domain: 'task-domain',
  pattern_data: JSON.stringify({
    embedding: await computeEmbedding('state-action-reward'),
    pattern: {
      state: [0.1, 0.2, 0.3],
      action: 2,
      reward: 1.0,
      next_state: [0.15, 0.25, 0.35],
      done: false,
    },
  }),
  confidence: 0.9,
  usage_count: 1,
  success_count: 1,
  created_at: Date.now(),
  last_used: Date.now(),
});

// Train
const metrics = await adapter.train({ epochs: 50, batchSize: 32 });
console.log('Loss:', metrics.loss, '| Duration:', metrics.duration, 'ms');
```

## Decision Transformer Config (Recommended)

```json
{
  "algorithm": "decision-transformer",
  "model_size": "base",
  "context_length": 20,
  "embed_dim": 128,
  "n_heads": 8,
  "n_layers": 6
}
```

**When RL is NOT what you need**: For production ML training with PyTorch use `pytorch-ml`;
for cloud sandbox training use `flow-nexus-neural`; for CUDA kernels use `cuda`.
