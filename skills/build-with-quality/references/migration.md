# Migration & Supersession

## What This Skill Supersedes

This skill **replaces** the following skills:
- `agentic-qe` - All 51 agents and 100 MCP tools are now integrated
- `reasoningbank-intelligence` - Pattern learning is now in unified SONA + ReasoningBank memory
- `reasoningbank-agentdb` - Storage is now in HNSW-indexed unified memory
- `pair-programming` - Driver/navigator workflows are now provided by coder + reviewer + TDD agents

## Migration from Deprecated Skills

### From agentic-qe
```bash
# Old
npx aqe agent spawn test-generator -t "Generate tests"

# New
npx claude-flow@alpha agent spawn --type unit-test-generator
```

### From reasoningbank-intelligence
```typescript
// Old
import { ReasoningBank } from 'agentic-flow/reasoningbank';
const rb = new ReasoningBank({ persist: true });

// New - Unified memory handles this
import { UnifiedMemory } from '@claude-flow/build-with-quality-skill';
const memory = new UnifiedMemory({ sonaMode: 'balanced' });
```

### From pair-programming
```bash
# Old
claude-flow pair --start --mode tdd

# New - Use TDD agents directly
npx claude-flow@alpha agent spawn --type tdd-red-phase
npx claude-flow@alpha agent spawn --type tdd-green-phase
npx claude-flow@alpha agent spawn --type tdd-refactor-phase
```
