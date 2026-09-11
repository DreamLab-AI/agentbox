# DeepSeek Reasoning — Workflows & Advanced Usage

## Invocation from Claude Code

The MCP tool is `mcp__consultant-deepseek__consult` (plus `health` and
`cost_estimate`); there is one tool for every kind of question, shaped by what
you put in `question` and `context_excerpt` — there are no separate
`reason`/`analyze`/`plan` tools.

```javascript
// Complex reasoning
const reasoning = await mcp__consultant_deepseek__consult({
  question: "Why does binary search achieve O(log n)?",
  format: "structured"
});

// Code analysis — put the code and the problem statement in context_excerpt/question
const analysis = await mcp__consultant_deepseek__consult({
  question: "Find the root cause of this memory leak and recommend a fix.",
  context_excerpt: readFileSync('app.js', 'utf8')
});

// Task planning
const plan = await mcp__consultant_deepseek__consult({
  question: "Plan implementing a Redis-backed rate limiter at 1000 req/s. " +
            "Break it into phases with dependencies and a critical path.",
});
```

Check cost before an expensive call:

```javascript
const estimate = await mcp__consultant_deepseek__cost_estimate({
  question_size: 500,
  expected_response_size: 1200
});
```

## Hybrid workflow — DeepSeek plans, Claude executes

**Pattern:** DeepSeek as reasoning planner, Claude as executor.

1. Claude receives a complex query.
2. Forwards it to DeepSeek via `consult`, asking explicitly for a structured
   phased plan with reasoning per phase.
3. DeepSeek returns a `<reasoning>...</reasoning>` trace followed by the answer.
4. Claude executes the plan with polished code/responses.

**Example flow:**

```yaml
Query: "Build a distributed rate limiter"
  ↓
DeepSeek consult (question asks for phased plan + reasoning):
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
const bug = await readFile('app.js');

const analysis = await mcp__consultant_deepseek__consult({
  question: "Root-cause this race condition causing data corruption. " +
            "Show your reasoning step by step, then give a fix.",
  context_excerpt: bug
});

console.log(analysis.response); // <reasoning>...</reasoning> then the fix
```

### Algorithm design

```javascript
const plan = await mcp__consultant_deepseek__consult({
  question: "Design consistent hashing for a distributed cache. " +
            "Minimise rebalancing on node add/remove; keep distribution uniform. " +
            "Return a phased task breakdown with dependencies."
});
```

### Multi-step problem solving

```javascript
const reasoning = await mcp__consultant_deepseek__consult({
  question: "Why does my ML model overfit on validation but not training data? " +
            "Setup: 80/20 split, early stopping, L2 regularization. " +
            "Walk through the reasoning in numbered steps."
});
```

## Advanced usage

### Cross-model closure verification

When a change was produced by one model family and needs an independent
check, pass `producer_family` so the envelope records whether this consult is
a genuine cross-model verification (REC-8 anti-fox):

```javascript
const verification = await mcp__consultant_deepseek__consult({
  question: "Review this diff for correctness issues the author might have missed.",
  context_excerpt: diffText,
  producer_family: "claude"
});
```

### Chaining reasoning

```javascript
const stage1 = await mcp__consultant_deepseek__consult({
  question: "Plan a payment system implementation."
});
const stage2 = await mcp__consultant_deepseek__consult({
  question: "Identify integration points for this existing payment code.",
  context_excerpt: existingPaymentCode
});

const implementation = synthesize(stage1.response, stage2.response);
```

## Best practices

1. **Use for complex reasoning only** — simple queries go to Claude directly.
2. **Provide context via `context_excerpt`** — more background yields better reasoning, but keep it curated and small.
3. **Check the `<reasoning>` trace** — understand the model's logic before executing.
4. **Hybrid approach** — DeepSeek plans, Claude executes.
5. **Check cost first** — call `cost_estimate` before a large `consult`.
