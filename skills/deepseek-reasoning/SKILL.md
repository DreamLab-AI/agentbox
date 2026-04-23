---
name: deepseek-reasoning
description: >
  DeepSeek reasoning bridge. Use when the user says "ask deepseek", "consult with
  deepseek", "delegate reasoning to deepseek", or needs advanced multi-step reasoning.
  Bridges devuser to deepseek-user via MCP for complex problem-solving with structured
  Chain-of-Thought outputs.
version: 1.0.0
author: agentbox-claude
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
dependencies:
  - deepseek-api
---

# DeepSeek Reasoning Skill

Access DeepSeek's special reasoning model endpoint directly from Claude Code with MCP bridge to isolated deepseek-user.

## Overview

This skill provides:
- **Advanced reasoning** via DeepSeek special model endpoint
- **User isolation** - Bridges devuser (Claude Code) to deepseek-user
- **Structured outputs** with reasoning traces
- **Multi-step problem solving** for complex queries
- **Hybrid AI workflow** - Claude as executor, DeepSeek as reasoning planner

## When Not To Use

- For straightforward code generation or editing -- Claude handles this directly without needing a reasoning bridge
- For web research or fetching live information -- use the perplexity-research or gemini-url-context skills instead
- For code review on GitHub PRs -- use the github-code-review skill instead
- For tasks where latency matters more than deep reasoning -- DeepSeek adds 2-5s per call; use Claude directly
- For OpenAI model delegation -- use the openai-codex skill instead

## Architecture

```
Claude Code (devuser)
    ↓ MCP Protocol
DeepSeek MCP Server
    ↓ User bridge (sudo -u deepseek-user)
DeepSeek API Client
    ↓ HTTPS
api.deepseek.com/v3.2_speciale_expires_on_20251215
```

## MCP Server

The skill includes an MCP server that exposes DeepSeek reasoning tools:

### Tools

1. **deepseek_reason** - Complex reasoning with thinking mode
   - Multi-step logical analysis
   - Structured chain-of-thought output
   - Problem decomposition

2. **deepseek_analyze** - Code/system analysis with reasoning
   - Bug detection and root cause analysis
   - Architecture evaluation
   - Performance bottleneck identification

3. **deepseek_plan** - Task planning with reasoning steps
   - Break down complex tasks
   - Generate execution strategies
   - Identify dependencies and prerequisites

## Usage from Claude Code

```bash
# Complex reasoning
deepseek_reason "Explain why quicksort is O(n log n) average case but O(n²) worst case"

# Code analysis with reasoning
deepseek_analyze --code "$(cat buggy_code.py)" \
  --issue "Memory leak on repeated calls"

# Task planning
deepseek_plan --goal "Implement distributed cache" \
  --constraints "Must handle 10k req/s, 5 nodes max"
```

## Configuration

API credentials configured via deepseek-user environment:

```bash
DEEPSEEK_API_KEY=sk-[your deepseek api key]
DEEPSEEK_SPECIAL_ENDPOINT=https://api.deepseek.com/v3.2_speciale_expires_on_20251215
DEEPSEEK_MODEL=deepseek-chat  # Special model
```

Set in `/home/deepseek-user/.config/deepseek/config.json`

## Special Model Features

The special endpoint model provides:
- **Required thinking mode** - Must explicitly engage reasoning
- **Extended context** - Handles complex multi-step problems
- **Structured output** - Clear reasoning + conclusion format
- **Metacognitive traces** - Shows how the model thinks

## Integration with Claude Flow

### Hybrid Workflow

**Pattern:** DeepSeek as Planner, Claude as Executor

1. **Claude receives complex query**
2. **Forwards to DeepSeek** via MCP for reasoning
3. **DeepSeek returns structured plan** with chain-of-thought
4. **Claude executes plan** with polished code/responses

### Example Flow

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

## Tools Reference

### deepseek_reason

**Purpose:** Complex multi-step reasoning

**Parameters:**
- `query` (required) - Question requiring reasoning
- `context` (optional) - Background information
- `max_steps` (optional) - Max reasoning steps (default: 10)
- `format` (optional) - Output format: `prose|structured|steps` (default: structured)

**Returns:**
```json
{
  "reasoning": {
    "steps": [
      {"step": 1, "thought": "...", "conclusion": "..."},
      {"step": 2, "thought": "...", "conclusion": "..."}
    ],
    "final_answer": "...",
    "confidence": 0.95
  },
  "usage": {"total_tokens": 450}
}
```

### deepseek_analyze

**Purpose:** Code/system analysis with root cause reasoning

**Parameters:**
- `code` (required) - Code to analyze
- `issue` (required) - Problem description
- `language` (optional) - Programming language
- `depth` (optional) - Analysis depth: `quick|normal|deep` (default: normal)

**Returns:**
```json
{
  "analysis": {
    "root_cause": "...",
    "reasoning_trace": ["...", "...", "..."],
    "recommendations": [
      {"priority": "high", "action": "...", "rationale": "..."}
    ]
  },
  "code_issues": [
    {"line": 42, "severity": "error", "message": "..."}
  ]
}
```

### deepseek_plan

**Purpose:** Task planning with dependency analysis

**Parameters:**
- `goal` (required) - What to achieve
- `constraints` (optional) - Limitations or requirements
- `context` (optional) - Existing system context
- `granularity` (optional) - Task size: `coarse|medium|fine` (default: medium)

**Returns:**
```json
{
  "plan": {
    "phases": [
      {
        "name": "Phase 1: Setup",
        "tasks": [
          {"id": "T1", "description": "...", "dependencies": [], "reasoning": "..."}
        ],
        "reasoning": "Why this phase is needed"
      }
    ],
    "critical_path": ["T1", "T3", "T7"],
    "estimated_complexity": "high"
  }
}
```

## User Isolation

**Security:** DeepSeek credentials isolated to deepseek-user (UID 1004)

- MCP server runs as `devuser`
- API calls execute as `deepseek-user` via sudo bridge
- Credentials never exposed to devuser environment
- Separate workspace: `/home/deepseek-user/workspace`

## Workflow Examples

### Debugging Complex Issue

```javascript
// Claude Code detects tricky bug
const bug = await readFile('app.js');

// Send to DeepSeek for deep reasoning
const analysis = await deepseek_analyze({
  code: bug,
  issue: 'Race condition causing data corruption',
  depth: 'deep'
});

// Claude uses reasoning to fix
console.log('Root cause:', analysis.root_cause);
// Implement fix based on recommendations
```

### Algorithm Design

```javascript
// Complex algorithm design task
const plan = await deepseek_plan({
  goal: 'Design consistent hashing for distributed cache',
  constraints: 'Min rebalancing on node add/remove, uniform distribution'
});

// Claude implements based on plan
plan.phases.forEach(phase => {
  phase.tasks.forEach(task => {
    console.log(`Implementing: ${task.description}`);
    console.log(`Reasoning: ${task.reasoning}`);
    // Generate code here
  });
});
```

### Multi-Step Problem Solving

```javascript
// Complex reasoning required
const reasoning = await deepseek_reason({
  query: 'Why does my ML model overfit on validation but not training data?',
  context: 'Using 80/20 split, early stopping, L2 regularization',
  format: 'steps'
});

// Claude synthesizes solution
reasoning.steps.forEach((step, i) => {
  console.log(`Step ${i+1}: ${step.thought}`);
});
console.log('Solution:', reasoning.final_answer);
```

## Performance

- **Response time:** 2-5s for typical reasoning queries
- **Token usage:** Higher than standard (includes reasoning tokens)
- **Quality:** Superior for multi-step logic, debugging, planning
- **Cost:** Special endpoint pricing (check DeepSeek docs)

## Limitations

- Requires thinking mode (cannot disable)
- Special endpoint has expiration (v3.2_speciale_expires_on_20251215)
- Higher latency than standard deepseek-chat
- Reasoning tokens count toward usage

## Integration Notes

### Claude Code Skills

Automatically available when MCP server is running:
- Tools appear in Claude Code tool list
- Invoke directly from prompts
- Streaming support for long reasoning chains

### Supervisord Configuration

Add to `supervisord.unified.conf`:
```ini
[program:deepseek-reasoning-mcp]
command=/usr/local/bin/node /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
directory=/home/devuser/.claude/skills/deepseek-reasoning/mcp-server
user=devuser
environment=HOME="/home/devuser",DEEPSEEK_USER="deepseek-user"
autostart=true
autorestart=true
priority=530
stdout_logfile=/var/log/deepseek-reasoning-mcp.log
stderr_logfile=/var/log/deepseek-reasoning-mcp.error.log
```

## Best Practices

1. **Use for complex reasoning only** - Simple queries use Claude directly
2. **Provide context** - More background = better reasoning
3. **Check reasoning traces** - Understand AI's logic before executing
4. **Hybrid approach** - DeepSeek plans, Claude executes
5. **Monitor costs** - Reasoning tokens add up quickly

## Comparison: DeepSeek vs Claude Reasoning

| Aspect | DeepSeek Special | Claude Sonnet 4.5 |
|--------|------------------|-------------------|
| Multi-step logic | Excellent | Very Good |
| Code generation | Good | Excellent |
| Reasoning transparency | Explicit traces | Implicit |
| Speed | Medium (2-5s) | Fast (<1s) |
| Cost | Lower | Higher |
| Best for | Planning, analysis | Execution, polish |

**Recommendation:** Use both in hybrid workflow for optimal results.

## Troubleshooting

### "invalid_request_error: non-thinking mode"
- Special endpoint requires reasoning mode (automatic in this skill)

### "Permission denied" errors
- Check deepseek-user exists (UID 1004)
- Verify sudo access: `devuser ALL=(deepseek-user) NOPASSWD: ALL`

### Slow responses
- Normal for reasoning model (includes thinking time)
- Reduce `max_steps` if too slow
- Use `format: quick` for faster responses

### API key errors
- Verify config: `/home/deepseek-user/.config/deepseek/config.json`
- Check API key is valid
- Ensure special endpoint URL is correct

## Advanced Usage

### Custom Reasoning Strategies

```javascript
// Force specific reasoning approach
const result = await deepseek_reason({
  query: 'Design database schema for social network',
  context: 'Must support 1M users, complex friend relationships',
  strategy: 'first_principles',  // vs incremental, analogical
  max_steps: 15
});
```

### Chaining Reasoning

```javascript
// Multi-stage reasoning
const stage1 = await deepseek_plan({goal: 'Build payment system'});
const stage2 = await deepseek_analyze({
  code: 'existing_payment_code.js',
  issue: 'Identify integration points'
});

// Claude synthesizes both
const implementation = synthesize(stage1, stage2);
```

## See Also

- DeepSeek API docs: https://api-docs.deepseek.com/
- MCP protocol: https://github.com/anthropics/mcp
- Claude Code skills: https://docs.claude.ai/code/skills
