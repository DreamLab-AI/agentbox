---
name: deepseek-reasoning
description: >
  DeepSeek V3.2-Exp reasoning bridge - Advanced multi-step reasoning via MCP,
  using DeepSeek's thinking mode (deepseek-reasoner) for complex problem-solving
  with structured Chain-of-Thought outputs.
version: 2.0.0
author: turbo-flow-claude
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
dependencies:
  - openai-sdk
---

# DeepSeek Reasoning Skill

Access DeepSeek's V3.2-Exp reasoning models directly from Claude Code via MCP bridge.

## Overview

This skill provides:
- **Advanced reasoning** via DeepSeek V3.2-Exp models
- **Two modes**: `deepseek-chat` (non-thinking) and `deepseek-reasoner` (thinking mode)
- **OpenAI-compatible API** - Uses standard OpenAI SDK format
- **Structured outputs** with reasoning traces
- **Multi-step problem solving** for complex queries
- **Hybrid AI workflow** - Claude as executor, DeepSeek as reasoning planner

## DeepSeek V3.2-Exp Models

| Model | Mode | Description |
|-------|------|-------------|
| `deepseek-chat` | Non-thinking | Fast responses, standard chat |
| `deepseek-reasoner` | Thinking | Chain-of-thought, explicit reasoning traces |

Both models are upgraded to **DeepSeek-V3.2-Exp** as of December 2025.

## Architecture

```
Claude Code (devuser)
    ↓ MCP Protocol
DeepSeek MCP Server
    ↓ User bridge (sudo -u deepseek-user)
DeepSeek API Client
    ↓ HTTPS (OpenAI-compatible)
https://api.deepseek.com/chat/completions
```

## MCP Tools

### 1. deepseek_reason
Complex reasoning with thinking mode (`deepseek-reasoner`)
- Multi-step logical analysis
- Structured chain-of-thought output
- Problem decomposition

### 2. deepseek_analyze
Code/system analysis with reasoning
- Bug detection and root cause analysis
- Architecture evaluation
- Performance bottleneck identification

### 3. deepseek_plan
Task planning with reasoning steps
- Break down complex tasks
- Generate execution strategies
- Identify dependencies and prerequisites

## Configuration

### API Settings

```bash
# Base URL (OpenAI-compatible)
DEEPSEEK_BASE_URL=https://api.deepseek.com

# Alternative (also valid, "v1" has no relation to model version)
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# API Key
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# Models
DEEPSEEK_CHAT_MODEL=deepseek-chat        # Non-thinking mode
DEEPSEEK_REASONER_MODEL=deepseek-reasoner # Thinking mode (default for this skill)
```

### Config File Location

Set in `/home/deepseek-user/.config/deepseek/config.json`:

```json
{
  "base_url": "https://api.deepseek.com",
  "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  "default_model": "deepseek-reasoner",
  "models": {
    "chat": "deepseek-chat",
    "reasoner": "deepseek-reasoner"
  }
}
```

## API Usage Examples

### Direct cURL (Chat Completions)

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -d '{
        "model": "deepseek-reasoner",
        "messages": [
          {"role": "system", "content": "You are a helpful reasoning assistant."},
          {"role": "user", "content": "Explain why quicksort averages O(n log n) but worst case is O(n²)"}
        ],
        "stream": false
      }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-xxxxxxxxxxxxxxxxxxxxxxxx",
    base_url="https://api.deepseek.com"
)

# Using thinking mode
response = client.chat.completions.create(
    model="deepseek-reasoner",
    messages=[
        {"role": "system", "content": "You are a helpful reasoning assistant."},
        {"role": "user", "content": "Design a distributed cache system"}
    ]
)

print(response.choices[0].message.content)
```

### Node.js (OpenAI SDK)

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com'
});

const response = await client.chat.completions.create({
  model: 'deepseek-reasoner',
  messages: [
    { role: 'system', content: 'You are a helpful reasoning assistant.' },
    { role: 'user', content: 'Analyze this algorithm for time complexity' }
  ]
});
```

## Usage from Claude Code

```bash
# Complex reasoning (uses deepseek-reasoner)
deepseek_reason "Explain why quicksort is O(n log n) average case but O(n²) worst case"

# Code analysis with reasoning
deepseek_analyze --code "$(cat buggy_code.py)" \
  --issue "Memory leak on repeated calls"

# Task planning
deepseek_plan --goal "Implement distributed cache" \
  --constraints "Must handle 10k req/s, 5 nodes max"
```

## Tool Reference

### deepseek_reason

**Purpose:** Complex multi-step reasoning

**Parameters:**
- `query` (required) - Question requiring reasoning
- `context` (optional) - Background information
- `max_steps` (optional) - Max reasoning steps (default: 10)
- `format` (optional) - Output format: `prose|structured|steps` (default: structured)
- `model` (optional) - Model override: `deepseek-chat|deepseek-reasoner` (default: deepseek-reasoner)

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

### deepseek_plan

**Purpose:** Task planning with dependency analysis

**Parameters:**
- `goal` (required) - What to achieve
- `constraints` (optional) - Limitations or requirements
- `context` (optional) - Existing system context
- `granularity` (optional) - Task size: `coarse|medium|fine` (default: medium)

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
DeepSeek Reasoner (thinking mode):
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

## User Isolation

**Security:** DeepSeek credentials isolated to deepseek-user (UID 1004)

- MCP server runs as `devuser`
- API calls execute as `deepseek-user` via sudo bridge
- Credentials never exposed to devuser environment
- Separate workspace: `/home/deepseek-user/workspace`

## Supervisord Configuration

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

## Performance

- **Response time:** 2-5s for typical reasoning queries
- **Token usage:** Higher with `deepseek-reasoner` (includes thinking tokens)
- **Quality:** Superior for multi-step logic, debugging, planning
- **Cost:** Check DeepSeek pricing at https://api-docs.deepseek.com/

## Comparison: DeepSeek vs Claude

| Aspect | DeepSeek-Reasoner | Claude Opus 4.5 |
|--------|-------------------|-----------------|
| Multi-step logic | Excellent | Very Good |
| Code generation | Good | Excellent |
| Reasoning transparency | Explicit traces | Implicit |
| Speed | Medium (2-5s) | Fast (<1s) |
| Cost | Lower | Higher |
| Best for | Planning, analysis | Execution, polish |

**Recommendation:** Use both in hybrid workflow for optimal results.

## Troubleshooting

### API Connection Errors
```bash
# Test API connectivity
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"test"}]}'
```

### Permission denied errors
- Check deepseek-user exists (UID 1004)
- Verify sudo access: `devuser ALL=(deepseek-user) NOPASSWD: ALL`

### Slow responses
- Normal for `deepseek-reasoner` (includes thinking time)
- Use `deepseek-chat` for faster non-reasoning responses
- Reduce `max_steps` if reasoning is too verbose

### API key errors
- Verify config: `/home/deepseek-user/.config/deepseek/config.json`
- Check API key at https://platform.deepseek.com/
- Ensure base_url is `https://api.deepseek.com`

## Best Practices

1. **Use deepseek-reasoner for complex reasoning** - Simple queries use Claude directly
2. **Provide context** - More background = better reasoning
3. **Check reasoning traces** - Understand AI's logic before executing
4. **Hybrid approach** - DeepSeek plans, Claude executes
5. **Monitor costs** - Reasoning tokens add up quickly

## See Also

- DeepSeek API docs: https://api-docs.deepseek.com/
- DeepSeek Platform: https://platform.deepseek.com/
- MCP protocol: https://github.com/anthropics/mcp
- Claude Code skills: https://docs.claude.ai/code/skills
