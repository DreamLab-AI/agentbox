# DeepSeek Reasoning Skill

MCP bridge for DeepSeek special model reasoning, invoked directly by Claude Code as the current user.

## Quick Start

### 1. Installation

```bash
# Copy to container
docker cp skills/deepseek-reasoning <host-container>:/home/devuser/.claude/skills/

# Set permissions
docker exec <host-container> bash -c "
  chmod +x /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
  chmod +x /home/devuser/.claude/skills/deepseek-reasoning/tools/deepseek_client.js
  chown -R devuser:devuser /home/devuser/.claude/skills/deepseek-reasoning
"
```

### 2. Configuration

Already configured in `$HOME/.config/deepseek/config.json` (typically `/home/devuser/.config/deepseek/config.json`):

```json
{
  "apiKey": "sk-d76e012d700a4cd3983f93c056aafee0",
  "availableEndpoints": {
    "special": "https://api.deepseek.com/v3.2_speciale_expires_on_20251215"
  },
  "models": {
    "chat": "deepseek-chat"
  }
}
```

### 3. Add to Supervisord

Add to `/home/devuser/.config/supervisord.unified.conf`:

```ini
[program:deepseek-reasoning-mcp]
command=/usr/local/bin/node /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
directory=/home/devuser/.claude/skills/deepseek-reasoning/mcp-server
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=530
stdout_logfile=/var/log/deepseek-reasoning-mcp.log
stderr_logfile=/var/log/deepseek-reasoning-mcp.error.log
```

### 4. Start Service

```bash
docker exec <host-container> supervisorctl reread
docker exec <host-container> supervisorctl add deepseek-reasoning-mcp
docker exec <host-container> supervisorctl start deepseek-reasoning-mcp
```

## Usage from Claude Code

Once MCP server is running, tools are available:

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

## Manual Testing

Test individual components:

```bash
# Test client directly
docker exec <host-container> node \
  /home/devuser/.claude/skills/deepseek-reasoning/tools/deepseek_client.js \
  --tool deepseek_reason \
  --params '{"query":"What is 2+2?","format":"steps"}'

# Test MCP server
echo '{"method":"tools/list","params":{},"id":1}' | \
docker exec -i <host-container> \
  /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Claude Code (devuser)                           │
│ - Detects complex query needing reasoning       │
│ - Invokes MCP tool: deepseek_reason()           │
└─────────────────┬───────────────────────────────┘
                  │ MCP Protocol (stdio)
┌─────────────────▼───────────────────────────────┐
│ DeepSeek MCP Server (devuser)                   │
│ - Receives tool call                            │
│ - Validates parameters                          │
│ - Spawns deepseek_client.js directly            │
└─────────────────┬───────────────────────────────┘
                  │ node tools/deepseek_client.js (direct spawn)
┌─────────────────▼───────────────────────────────┐
│ DeepSeek Client (devuser)                       │
│ - Loads credentials from config                 │
│ - Constructs reasoning prompt                   │
│ - Calls special endpoint                        │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────────────────┐
│ DeepSeek Special Endpoint                       │
│ api.deepseek.com/v3.2_speciale_...              │
│ - Processes with thinking mode                  │
│ - Returns structured reasoning                  │
└─────────────────────────────────────────────────┘
```

## Files

```
deepseek-reasoning/
├── SKILL.md                # Skill documentation (read by Claude Code)
├── README.md               # Installation and usage
├── mcp-server/
│   └── server.js          # MCP protocol server (runs as devuser)
└── tools/
    └── deepseek_client.js # API client (runs as devuser, spawned directly)
```

## Security

- **Credentials protected:** API key stored in `$HOME/.config/deepseek/config.json` with mode `0600`
- **Direct spawn:** MCP server spawns `deepseek_client.js` as the current user — no sudo bridge, no separate OS user
- **No global exposure:** config file is readable only by its owner

## Hybrid Workflow

**Best practice:** Use DeepSeek for planning, Claude for execution

1. Complex problem arrives
2. Claude recognizes need for reasoning
3. Calls `deepseek_reason()` or `deepseek_plan()`
4. DeepSeek provides structured chain-of-thought
5. Claude synthesizes into polished code/response

**Example:**
```
User: "Build a distributed lock manager"
  ↓
Claude: [Detects complexity] → deepseek_plan()
  ↓
DeepSeek: Returns 15-step plan with reasoning
  ↓
Claude: Implements each step with clean code
  ↓
Result: Production-ready implementation with tests
```

## Troubleshooting

### MCP server won't start
```bash
# Check logs
docker exec <host-container> tail -f /var/log/deepseek-reasoning-mcp.error.log

# Verify Node.js
docker exec <host-container> which node

# Check permissions
docker exec <host-container> ls -la /home/devuser/.claude/skills/deepseek-reasoning/
```

### API errors
```bash
# Test endpoint directly
docker exec <host-container> curl \
  https://api.deepseek.com/v3.2_speciale_expires_on_20251215/v1/models \
  -H "Authorization: Bearer <your-api-key>"

# Verify config
docker exec <host-container> cat /home/devuser/.config/deepseek/config.json
```

## Performance

- **Latency:** 2-5 seconds (includes reasoning time)
- **Token usage:** 200-500 tokens per reasoning query
- **Concurrency:** 1 request at a time (special endpoint)
- **Quality:** Excellent for multi-step logic

## See Also

- Main skill docs: `SKILL.md`
- Setup guide: `/DEEPSEEK_SETUP_COMPLETE.md`
- API verification: `/DEEPSEEK_API_VERIFIED.md`
