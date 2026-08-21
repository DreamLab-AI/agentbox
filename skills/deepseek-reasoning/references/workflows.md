# DeepSeek Reasoning — Workflows & Advanced Usage

## Invocation from Claude Code

Once the MCP server is running, the tools are available directly:

```javascript
// Complex reasoning
const reasoning = await deepseek_reason({
  query: "Why does binary search achieve O(log n)?",
  format: "structured"
});

// Code analysis
const analysis = await deepseek_analyze({
  code: readFileSync('app.js', 'utf8'),
  issue: "Memory leak in event handlers",
  depth: "deep"
});

// Task planning
const plan = await deepseek_plan({
  goal: "Implement rate limiter",
  constraints: "Redis-backed, 1000 req/s",
  granularity: "medium"
});
```

CLI-style equivalents:

```bash
deepseek_reason "Explain why quicksort is O(n log n) average but O(n²) worst case"

deepseek_analyze --code "$(cat buggy_code.py)" --issue "Memory leak on repeated calls"

deepseek_plan --goal "Implement distributed cache" \
  --constraints "Must handle 10k req/s, 5 nodes max"
```

## Hybrid workflow — DeepSeek plans, Claude executes

**Pattern:** DeepSeek as reasoning planner, Claude as executor.

1. Claude receives a complex query.
2. Forwards it to DeepSeek via MCP for reasoning.
3. DeepSeek returns a structured plan with chain-of-thought.
4. Claude executes the plan with polished code/responses.

**Example flow:**

```yaml
Query: "Build a distributed rate limiter"
  ↓
DeepSeek Reasoning:
  - Algorithm: Token bucket vs sliding window
  - Data structure: Redis sorted sets
  - Synchronization: Lua scripts for atomicity
  - Fallback: Local cache on Redis failure
  ↓
Claude Execution:
  - Generates Redis Lua scripts
  - Implements client library
  - Adds error handling and monitoring
  - Writes comprehensive tests
```

## Worked examples

### Debugging a complex issue

```javascript
// Claude Code detects a tricky bug
const bug = await readFile('app.js');

// Send to DeepSeek for deep reasoning
const analysis = await deepseek_analyze({
  code: bug,
  issue: 'Race condition causing data corruption',
  depth: 'deep'
});

console.log('Root cause:', analysis.root_cause);
// Implement fix based on recommendations
```

### Algorithm design

```javascript
const plan = await deepseek_plan({
  goal: 'Design consistent hashing for distributed cache',
  constraints: 'Min rebalancing on node add/remove, uniform distribution'
});

plan.phases.forEach(phase => {
  phase.tasks.forEach(task => {
    console.log(`Implementing: ${task.description}`);
    console.log(`Reasoning: ${task.reasoning}`);
  });
});
```

### Multi-step problem solving

```javascript
const reasoning = await deepseek_reason({
  query: 'Why does my ML model overfit on validation but not training data?',
  context: 'Using 80/20 split, early stopping, L2 regularization',
  format: 'steps'
});

reasoning.steps.forEach((step, i) => {
  console.log(`Step ${i+1}: ${step.thought}`);
});
console.log('Solution:', reasoning.final_answer);
```

## Advanced usage

### Custom reasoning strategies

```javascript
const result = await deepseek_reason({
  query: 'Design database schema for social network',
  context: 'Must support 1M users, complex friend relationships',
  strategy: 'first_principles',  // vs incremental, analogical
  max_steps: 15
});
```

### Chaining reasoning

```javascript
const stage1 = await deepseek_plan({goal: 'Build payment system'});
const stage2 = await deepseek_analyze({
  code: 'existing_payment_code.js',
  issue: 'Identify integration points'
});

const implementation = synthesize(stage1, stage2);
```

## Best practices

1. **Use for complex reasoning only** — simple queries go to Claude directly.
2. **Provide context** — more background yields better reasoning.
3. **Check reasoning traces** — understand the model's logic before executing.
4. **Hybrid approach** — DeepSeek plans, Claude executes.
5. **Monitor costs** — reasoning tokens add up quickly.
